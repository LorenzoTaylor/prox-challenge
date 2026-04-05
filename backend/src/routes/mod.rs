use axum::Router;
use std::sync::Arc;
use crate::AppState;

pub mod chat;
pub mod generate;
pub mod speak;

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .nest("/chat", chat::router(state.clone()))
        .nest("/generate", generate::router(state.clone()))
        .nest("/speak", speak::router(state.clone()))
}
