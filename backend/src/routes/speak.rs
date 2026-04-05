use axum::{Json, Router, extract::State, response::IntoResponse, http::StatusCode, routing::post};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::Deserialize;
use std::sync::Arc;

use crate::AppState;

#[derive(Deserialize)]
pub struct SpeakRequest {
    pub text: String,
}

const DEFAULT_VOICE_ID: &str = "21m00Tcm4TlvDq8ikWAM"; // Rachel
const MAX_TEXT_CHARS: usize = 500;

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/", post(speak_handler))
        .with_state(state)
}

// ---------------------------------------------------------------------------
// Abbreviation normalizer
// ElevenLabs mispronounces all-caps abbreviations and unit suffixes.
// These regexes run in order — put longer/more-specific patterns first.
// ---------------------------------------------------------------------------

struct Replacement {
    re: Regex,
    with: &'static str,
}

static REPLACEMENTS: Lazy<Vec<Replacement>> = Lazy::new(|| {
    let rules: &[(&str, &str)] = &[
        // Numeric + unit  (e.g. "24V", "150A", "60Hz", "0.8Ω")
        (r"(?i)\b(\d+(?:\.\d+)?)\s*kVA\b",  "$1 kilovolt amps"),
        (r"(?i)\b(\d+(?:\.\d+)?)\s*kW\b",   "$1 kilowatts"),
        (r"(?i)\b(\d+(?:\.\d+)?)\s*Hz\b",   "$1 hertz"),
        (r"(?i)\b(\d+(?:\.\d+)?)\s*V\b",    "$1 volts"),
        (r"(?i)\b(\d+(?:\.\d+)?)\s*A\b",    "$1 amps"),
        (r"(?i)\b(\d+(?:\.\d+)?)\s*PSI\b",  "$1 P S I"),
        (r"(?i)\b(\d+(?:\.\d+)?)\s*CFH\b",  "$1 cubic feet per hour"),
        (r"(?i)\b(\d+(?:\.\d+)?)\s*IPM\b",  "$1 inches per minute"),
        (r"(?i)\b(\d+(?:\.\d+)?)\s*AWG\b",  "$1 A W G"),
        (r"(?i)\b(\d+(?:\.\d+)?)\s*%\s*(?:duty|DC)\b", "$1 percent duty cycle"),
        // Standalone process abbreviations (pronounceable — lowercase so TTS handles them)
        (r"\bMIG\b",   "mig"),
        (r"\bTIG\b",   "tig"),
        (r"\bFCAW\b",  "flux core"),
        (r"\bGMAW\b",  "G MAW"),
        (r"\bGTAW\b",  "G TAW"),
        (r"\bSMAW\b",  "stick"),
        (r"\bMMA\b",   "M M A"),
        // Polarity / electrical
        (r"\bDCEP\b",  "D C E P"),
        (r"\bDCEN\b",  "D C E N"),
        (r"\bDC\b",    "D C"),
        (r"\bAC\b",    "A C"),
        (r"\bOCV\b",   "open circuit voltage"),
        (r"\bWFS\b",   "wire feed speed"),
        // Chemical / gas
        (r"\bCO2\b",   "C O 2"),
        (r"\bCO₂\b",   "C O 2"),
        (r"\bAr\b",    "argon"),
        // Misc units
        (r"\bAWG\b",   "A W G"),
        (r"\bPSI\b",   "P S I"),
        (r"\bCFH\b",   "cubic feet per hour"),
        (r"\bIPM\b",   "inches per minute"),
        (r"\bRPM\b",   "R P M"),
    ];

    rules.iter().map(|(pattern, with)| Replacement {
        re: Regex::new(pattern).expect("bad regex"),
        with,
    }).collect()
});

fn normalize_for_tts(text: &str) -> String {
    let mut out = text.to_string();
    for r in REPLACEMENTS.iter() {
        out = r.re.replace_all(&out, r.with).into_owned();
    }
    out
}

// ---------------------------------------------------------------------------

async fn speak_handler(
    State(state): State<Arc<AppState>>,
    Json(req): Json<SpeakRequest>,
) -> impl IntoResponse {
    let Some(ref eleven_key) = state.eleven_key else {
        return (StatusCode::SERVICE_UNAVAILABLE, "ElevenLabs not configured").into_response();
    };

    let raw: String = req.text.chars().take(MAX_TEXT_CHARS).collect();
    if raw.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, "Empty text").into_response();
    }

    let text = normalize_for_tts(&raw);

    let url = format!(
        "https://api.elevenlabs.io/v1/text-to-speech/{DEFAULT_VOICE_ID}?output_format=mp3_44100_128"
    );

    let client = reqwest::Client::new();
    let result = client
        .post(&url)
        .header("xi-api-key", eleven_key)
        .header("content-type", "application/json")
        .json(&serde_json::json!({
            "text": text,
            "model_id": "eleven_multilingual_v2",
            "voice_settings": {
                "stability": 0.5,
                "similarity_boost": 0.75
            }
        }))
        .send()
        .await;

    match result {
        Ok(resp) if resp.status().is_success() => {
            match resp.bytes().await {
                Ok(bytes) => (
                    StatusCode::OK,
                    [("content-type", "audio/mpeg")],
                    bytes,
                ).into_response(),
                Err(e) => {
                    eprintln!("ElevenLabs read error: {e}");
                    (StatusCode::BAD_GATEWAY, "Failed to read TTS response").into_response()
                }
            }
        }
        Ok(resp) => {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            eprintln!("ElevenLabs error {status}: {body}");
            (StatusCode::BAD_GATEWAY, "TTS service error").into_response()
        }
        Err(e) => {
            eprintln!("ElevenLabs request error: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "TTS request failed").into_response()
        }
    }
}
