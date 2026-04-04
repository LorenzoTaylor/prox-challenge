use axum::{
    Json, Router,
    extract::State,
    response::{IntoResponse, sse::{Event, Sse}},
    routing::post,
};
use futures::StreamExt;
use serde::Deserialize;
use serde_json::{json, Value};
use std::convert::Infallible;
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;

use crate::{AppState, prompts::build_system_prompt};

#[derive(Deserialize)]
pub struct ChatRequest {
    pub messages: Vec<Message>,
}

#[derive(Deserialize)]
pub struct Message {
    pub role: String,
    pub content: String,
}

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/", post(chat_handler))
        .with_state(state)
}

async fn chat_handler(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ChatRequest>,
) -> impl IntoResponse {
    let (tx, rx) = mpsc::channel(32);

    tokio::spawn(async move {
        if let Err(e) = stream_chat(state, req, &tx).await {
            let data = json!({"type": "error", "message": e.to_string()}).to_string();
            let _ = tx.send(Ok(Event::default().data(data))).await;
        }
    });

    (
        [("x-accel-buffering", "no")],
        Sse::new(ReceiverStream::new(rx)),
    )
}

async fn stream_chat(
    state: Arc<AppState>,
    req: ChatRequest,
    tx: &mpsc::Sender<Result<Event, Infallible>>,
) -> anyhow::Result<()> {
    // Build Anthropic messages array.
    // PDF page images are injected as content blocks in the first user message.
    let mut messages: Vec<Value> = Vec::new();

    // Find the last user message to use for relevance scoring
    let last_user_query = req.messages.iter().rev()
        .find(|m| m.role == "user")
        .map(|m| m.content.as_str())
        .unwrap_or("");

    let relevant = state.relevant_images(last_user_query, 3);
    eprintln!("Injecting {} relevant page images for query: {:?}", relevant.len(), &last_user_query[..last_user_query.len().min(60)]);

    for (i, msg) in req.messages.iter().enumerate() {
        if i == 0 && msg.role == "user" && !relevant.is_empty() {
            let mut content: Vec<Value> = relevant
                .iter()
                .map(|img| {
                    json!({
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": img.base64
                        }
                    })
                })
                .collect();
            content.push(json!({"type": "text", "text": msg.content}));
            messages.push(json!({"role": "user", "content": content}));
        } else {
            messages.push(json!({"role": msg.role, "content": msg.content}));
        }
    }

    let system_prompt = build_system_prompt(state.structured_facts.as_deref());

    let body = json!({
        "model": "claude-sonnet-4-6",
        "max_tokens": 8096,
        "stream": true,
        "system": system_prompt,
        "messages": messages
    });

    let client = reqwest::Client::new();
    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &state.api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let body_text = response.text().await.unwrap_or_default();
        eprintln!("Anthropic API error {status}: {body_text}");
        anyhow::bail!("Anthropic API error {status}: {body_text}");
    }

    // Parse Anthropic's SSE stream line by line.
    // Anthropic sends event+data pairs separated by blank lines.
    // We only act on content_block_delta events with text_delta type.
    let mut byte_stream = response.bytes_stream();
    let mut line_buf: Vec<u8> = Vec::new();
    let mut current_event = String::new();
    let mut current_data = String::new();

    while let Some(chunk_result) = byte_stream.next().await {
        let chunk = chunk_result?;

        for &byte in chunk.iter() {
            if byte == b'\n' {
                let line = String::from_utf8_lossy(&line_buf).to_string();
                line_buf.clear();

                if line.is_empty() {
                    // End of SSE event — process accumulated event + data
                    if current_event == "content_block_delta" {
                        if let Ok(parsed) = serde_json::from_str::<Value>(&current_data) {
                            if parsed["delta"]["type"] == "text_delta" {
                                if let Some(text) = parsed["delta"]["text"].as_str() {
                                    if !text.is_empty() {
                                        let data =
                                            json!({"type": "delta", "text": text}).to_string();
                                        if tx.send(Ok(Event::default().data(data))).await.is_err() {
                                            return Ok(()); // client disconnected
                                        }
                                    }
                                }
                            }
                        }
                    } else if current_event == "message_stop" {
                        let data = json!({"type": "done"}).to_string();
                        let _ = tx.send(Ok(Event::default().data(data))).await;
                        return Ok(());
                    }

                    current_event.clear();
                    current_data.clear();
                } else if byte != b'\r' {
                    if let Some(event_type) = line.strip_prefix("event: ") {
                        current_event = event_type.to_string();
                    } else if let Some(data) = line.strip_prefix("data: ") {
                        current_data = data.to_string();
                    }
                }
            } else if byte != b'\r' {
                line_buf.push(byte);
            }
        }
    }

    // Stream ended without a message_stop — emit done anyway
    let data = json!({"type": "done"}).to_string();
    let _ = tx.send(Ok(Event::default().data(data))).await;
    Ok(())
}
