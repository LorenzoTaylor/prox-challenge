use axum::Router;
use std::sync::Arc;
use crate::AppState;

pub mod chat;
pub mod generate;

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .nest("/chat", chat::router(state.clone()))
        .nest("/generate", generate::router(state.clone()))
}
