use axum::Router;
use std::sync::Arc;
use crate::AppState;

pub mod chat;

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .nest("/chat", chat::router(state.clone()))
}
