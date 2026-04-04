use axum::{Router, routing::get, Json};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::json;
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::sync::atomic::AtomicU32;
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, Semaphore};
use tower_http::cors::{CorsLayer, Any};
use tower_http::services::ServeDir;

mod prompts;
mod routes;

pub struct PageImage {
    pub source_file: String,
    pub page: u32,
    pub base64: String,
}

pub struct PageMeta {
    pub doc_name: String,
    pub page: u32,
    pub summary: String,
    pub tags: Vec<String>,
}

/// Sliding-window per-IP rate limiter (no external crates).
pub struct RateLimiter {
    windows: Mutex<HashMap<IpAddr, (u32, Instant)>>,
    max_per_minute: u32,
}

impl RateLimiter {
    pub fn new(max_per_minute: u32) -> Self {
        Self { windows: Mutex::new(HashMap::new()), max_per_minute }
    }

    /// Returns true if the request is allowed, false if the IP is over limit.
    pub async fn check(&self, ip: IpAddr) -> bool {
        let mut map = self.windows.lock().await;
        let now = Instant::now();
        let entry = map.entry(ip).or_insert((0, now));
        if now.duration_since(entry.1) >= Duration::from_secs(60) {
            *entry = (1, now);
            true
        } else if entry.0 < self.max_per_minute {
            entry.0 += 1;
            true
        } else {
            false
        }
    }
}

pub struct AppState {
    pub api_key: String,
    pub fal_key: Option<String>,
    pub images: Vec<PageImage>,
    pub page_meta: Vec<PageMeta>,
    pub structured_facts: Option<String>,
    /// Max 2 in-flight requests at once.
    pub semaphore: Arc<Semaphore>,
    /// Lifetime request counter — hard cap for demo cost control.
    pub request_count: Arc<AtomicU32>,
    /// Per-IP sliding window: 10 requests / minute.
    pub rate_limiter: Arc<RateLimiter>,
}

impl AppState {
    /// Score each page against a query and return base64 data for the top N matches.
    /// Falls back to empty vec if no pages score above zero.
    pub fn relevant_images(&self, query: &str, max: usize) -> Vec<&PageImage> {
        if self.images.is_empty() || self.page_meta.is_empty() {
            return vec![];
        }

        let query_lower = query.to_lowercase();
        let words: Vec<&str> = query_lower.split_whitespace().collect();

        let mut scored: Vec<(&PageMeta, u32)> = self
            .page_meta
            .iter()
            .map(|meta| {
                let haystack = format!(
                    "{} {}",
                    meta.summary.to_lowercase(),
                    meta.tags.join(" ").to_lowercase()
                );
                let score = words.iter().filter(|w| haystack.contains(**w)).count() as u32;
                (meta, score)
            })
            .filter(|(_, s)| *s > 0)
            .collect();

        scored.sort_by(|a, b| b.1.cmp(&a.1));
        scored.truncate(max);

        scored
            .iter()
            .filter_map(|(meta, _)| {
                self.images
                    .iter()
                    .find(|img| img.source_file == meta.doc_name && img.page == meta.page)
            })
            .collect()
    }
}

async fn load_page_images() -> Vec<PageImage> {
    let index_path = std::env::var("PAGE_INDEX_PATH")
        .unwrap_or_else(|_| "scripts/page_index.json".to_string());

    let index_str = match tokio::fs::read_to_string(&index_path).await {
        Ok(s) => s,
        Err(_) => {
            eprintln!("Warning: page index not found at '{index_path}' — starting with no images. Run scripts/process_pdfs.py first.");
            return vec![];
        }
    };

    let index: serde_json::Value = match serde_json::from_str(&index_str) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("Warning: failed to parse page index: {e}");
            return vec![];
        }
    };

    let mut images = Vec::new();

    if let Some(obj) = index.as_object() {
        for (source_file, entry) in obj {
            let pages = match entry["pages"].as_array() {
                Some(p) => p,
                None => continue,
            };
            for page_entry in pages {
                let page_num = match page_entry["page"].as_u64() {
                    Some(n) => n as u32,
                    None => continue,
                };
                let path = match page_entry["path"].as_str() {
                    Some(p) => p,
                    None => continue,
                };
                match tokio::fs::read(path).await {
                    Ok(bytes) => {
                        images.push(PageImage {
                            source_file: source_file.clone(),
                            page: page_num,
                            base64: STANDARD.encode(&bytes),
                        });
                    }
                    Err(e) => {
                        eprintln!("Warning: could not read {path}: {e}");
                    }
                }
            }
        }
    }

    println!("Loaded {} page images", images.len());
    images
}

async fn load_structured_facts() -> (Option<String>, Vec<PageMeta>) {
    let path = std::env::var("STRUCTURED_FACTS_PATH")
        .unwrap_or_else(|_| "scripts/structured_facts.json".to_string());

    let content = match tokio::fs::read_to_string(&path).await {
        Ok(s) => s,
        Err(_) => {
            println!("No structured_facts.json found — running without structured knowledge. Run scripts/extract_knowledge.py first.");
            return (None, vec![]);
        }
    };

    let facts: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("Warning: failed to parse structured_facts.json: {e}");
            return (None, vec![]);
        }
    };

    // Build page_meta index for relevance scoring
    let mut page_meta = Vec::new();
    if let Some(pages) = facts["page_catalog"].as_array() {
        for page in pages {
            let doc_name = page["doc"].as_str().unwrap_or("").to_string();
            let page_num = page["page"].as_u64().unwrap_or(0) as u32;
            let summary = page["summary"].as_str().unwrap_or("").to_string();
            let tags: Vec<String> = page["tags"]
                .as_array()
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default();
            if page_num > 0 {
                page_meta.push(PageMeta { doc_name, page: page_num, summary, tags });
            }
        }
    }

    let mut output = String::new();

    if let Some(cycles) = facts["duty_cycles"].as_array() {
        if !cycles.is_empty() {
            output.push_str("=== DUTY CYCLES ===\n");
            for dc in cycles {
                let process = dc["process"].as_str().unwrap_or("");
                let voltage = dc["voltage"].as_i64().unwrap_or(0);
                let rated_pct = dc["rated_pct"].as_i64().unwrap_or(0);
                let rated_amps = dc["rated_amps"].as_i64().unwrap_or(0);
                let cont_pct = dc["continuous_pct"].as_i64().unwrap_or(0);
                let cont_amps = dc["continuous_amps"].as_i64().unwrap_or(0);
                output.push_str(&format!(
                    "{process} {voltage}V: {rated_pct}% @ {rated_amps}A rated, {cont_pct}% @ {cont_amps}A continuous\n"
                ));
            }
            output.push('\n');
        }
    }

    if let Some(setups) = facts["polarity_setups"].as_array() {
        if !setups.is_empty() {
            output.push_str("=== POLARITY SETUPS ===\n");
            for ps in setups {
                let process = ps["process"].as_str().unwrap_or("");
                let ground = ps["ground_socket"].as_str().unwrap_or("");
                let torch = ps["torch_socket"].as_str().unwrap_or("");
                let gas = ps["gas_type"].as_str().unwrap_or("none");
                let polarity = ps["polarity_type"].as_str().unwrap_or("");
                output.push_str(&format!(
                    "{process}: ground→{ground}, torch→{torch}, gas={gas}, polarity={polarity}\n"
                ));
            }
            output.push('\n');
        }
    }

    if let Some(entries) = facts["troubleshooting"].as_array() {
        if !entries.is_empty() {
            output.push_str("=== TROUBLESHOOTING ===\n");
            for te in entries {
                let symptom = te["symptom"].as_str().unwrap_or("");
                let process = te["process"].as_str().unwrap_or("");
                let causes: Vec<&str> = te["causes"].as_array()
                    .map(|a| a.iter().filter_map(|v| v.as_str()).collect())
                    .unwrap_or_default();
                output.push_str(&format!(
                    "{symptom} ({process}): {}\n",
                    causes.join("; ")
                ));
            }
            output.push('\n');
        }
    }

    if let Some(pages) = facts["page_catalog"].as_array() {
        if !pages.is_empty() {
            output.push_str("=== MANUAL PAGE CATALOG ===\n");
            output.push_str("Use these paths in image/surface artifacts to surface manual pages.\n");
            for page in pages {
                let doc = page["doc"].as_str().unwrap_or("");
                let num = page["page"].as_i64().unwrap_or(0);
                let summary = page["summary"].as_str().unwrap_or("");
                let tags: Vec<&str> = page["tags"].as_array()
                    .map(|a| a.iter().filter_map(|v| v.as_str()).collect())
                    .unwrap_or_default();
                output.push_str(&format!(
                    "/pages/{doc}/page_{num:03}.png — {summary} [{}]\n",
                    tags.join(", ")
                ));
            }
        }
    }

    let facts_text = if output.is_empty() { None } else {
        println!("Loaded structured knowledge facts ({} pages indexed)", page_meta.len());
        Some(output)
    };

    (facts_text, page_meta)
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    let api_key = std::env::var("ANTHROPIC_API_KEY")
        .expect("ANTHROPIC_API_KEY must be set");
    let fal_key = std::env::var("FAL_KEY").ok();
    if fal_key.is_none() {
        println!("Note: FAL_KEY not set — image generation disabled");
    }

    let images = load_page_images().await;
    let (structured_facts, page_meta) = load_structured_facts().await;
    let state = Arc::new(AppState {
        api_key,
        fal_key,
        images,
        page_meta,
        structured_facts,
        semaphore: Arc::new(Semaphore::new(2)),
        request_count: Arc::new(AtomicU32::new(0)),
        rate_limiter: Arc::new(RateLimiter::new(10)),
    });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(health))
        .nest("/api", routes::router(state))
        .nest_service("/pages", ServeDir::new("scripts/pages"))
        .layer(cors);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3001").await?;
    println!("Backend listening on http://localhost:3001");
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await?;

    Ok(())
}

async fn health() -> Json<serde_json::Value> {
    Json(json!({ "status": "ok" }))
}
