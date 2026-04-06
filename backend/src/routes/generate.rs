use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    routing::post,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::AppState;

// Public Harbor Freight product photos — actual Vulcan OmniPro 220
const HF_MACHINE_URL: &str = "https://www.harborfreight.com/media/catalog/product/cache/c7f358f04aec81e7c5e0be4c56edf041/5/7/57812_W3.jpg";
const HF_PANEL_URL: &str = "https://www.harborfreight.com/media/catalog/product/cache/c7f358f04aec81e7c5e0be4c56edf041/5/7/57812_W6.jpg";

#[derive(Deserialize)]
pub struct GenerateRequest {
    pub prompt: String,
}

#[derive(Serialize)]
pub struct GenerateResponse {
    pub url: String,
}

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/", post(generate_handler))
        .with_state(state)
}

/// Extract just the polarity setups block from structured_facts for prompt injection.
/// Returns an empty string if not found.
fn extract_polarity_facts(facts: Option<&str>) -> &str {
    let Some(text) = facts else { return "" };
    let start = match text.find("=== POLARITY SETUPS ===") {
        Some(i) => i,
        None => return "",
    };
    // Take up to the next section header or end of string
    let slice = &text[start..];
    let end = slice[1..].find("===").map(|i| i + 1).unwrap_or(slice.len());
    slice[..end].trim_end()
}

async fn generate_handler(
    State(state): State<Arc<AppState>>,
    Json(req): Json<GenerateRequest>,
) -> Result<Json<GenerateResponse>, (StatusCode, String)> {
    let fal_key = state.fal_key.as_deref().ok_or_else(|| {
        (StatusCode::SERVICE_UNAVAILABLE, "Image generation not configured (FAL_KEY missing)".to_string())
    })?;

    if req.prompt.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "prompt is required".to_string()));
    }

    // Inject polarity/socket knowledge so the model knows exactly which terminal is which
    let polarity_facts = extract_polarity_facts(state.structured_facts.as_deref());
    let knowledge_block = if polarity_facts.is_empty() {
        String::new()
    } else {
        format!("\n\nMachine facts to incorporate accurately:\n{polarity_facts}")
    };

    let full_prompt = format!(
        "{}{}\n\nStyle: pure white background (#FFFFFF), clean paper — no texture, no stains, no noise. Hand-drawn technical manual sketch aesthetic. Dark ink lines (#1a1a1a). All text labels must be rendered clearly and legibly in a small monospace or typewriter font. Be extremely explicit and precise with every label — spell out each control name in full.",
        req.prompt.trim(),
        knowledge_block,
    );

    eprintln!(
        "generate: prompt={:?}",
        &full_prompt[..full_prompt.len().min(120)]
    );

    // Always use the /edit endpoint with the real machine photos as reference
    let response = state.http_client
        .post("https://fal.run/fal-ai/nano-banana-pro/edit")
        .header("Authorization", format!("Key {fal_key}"))
        .json(&serde_json::json!({
            "prompt": full_prompt,
            "image_urls": [HF_MACHINE_URL, HF_PANEL_URL],
        }))
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("fal.ai request failed: {e}")))?;

    if !response.status().is_success() {
        let status = response.status();
        let body_text = response.text().await.unwrap_or_default();
        return Err((StatusCode::BAD_GATEWAY, format!("fal.ai error {status}: {body_text}")));
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("fal.ai response parse error: {e}")))?;

    let url = body["images"][0]["url"]
        .as_str()
        .ok_or_else(|| (StatusCode::BAD_GATEWAY, "No image URL in fal.ai response".to_string()))?
        .to_string();

    Ok(Json(GenerateResponse { url }))
}
