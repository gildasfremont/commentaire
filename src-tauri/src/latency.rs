//! Structured latency logging. Writes one JSON line per segment to logs/latency.jsonl.
//!
//! Each segment entry has:
//! - timestamp: ISO-8601 start time
//! - segment_type: "lecture" | "commentaire" | "question" | "instruction"
//! - whisper_ms: transcription duration
//! - haiku_ms: classification duration
//! - ack_ms: acknowledgment duration (questions only)
//! - opus_first_token_ms: time to first Opus output chunk (questions only)
//! - opus_total_ms: total Opus duration (questions only)
//! - text_preview: first 80 chars of transcribed text

use log::{error, info};
use serde::Serialize;
use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Clone, Default, Serialize)]
pub struct SegmentLatency {
    pub timestamp: String,
    pub segment_id: String,
    pub segment_type: String,
    pub text_preview: String,
    pub whisper_ms: Option<u128>,
    pub haiku_ms: Option<u128>,
    pub ack_ms: Option<u128>,
    pub opus_first_token_ms: Option<u128>,
    pub opus_total_ms: Option<u128>,
}

impl SegmentLatency {
    pub fn new(segment_id: String) -> Self {
        Self {
            timestamp: chrono::Local::now().to_rfc3339(),
            segment_id,
            ..Default::default()
        }
    }
}

/// Append a segment latency entry to logs/latency.jsonl.
/// Thread-safe: uses a global mutex to serialize writes.
pub fn log_segment(entry: &SegmentLatency) {
    static WRITE_LOCK: Mutex<()> = Mutex::new(());
    let _guard = WRITE_LOCK.lock().unwrap();

    let log_path = log_file_path();

    // Ensure logs/ directory exists
    if let Some(parent) = log_path.parent() {
        if let Err(e) = create_dir_all(parent) {
            error!("Failed to create logs directory: {}", e);
            return;
        }
    }

    match OpenOptions::new().create(true).append(true).open(&log_path) {
        Ok(mut f) => match serde_json::to_string(entry) {
            Ok(json) => {
                if let Err(e) = writeln!(f, "{}", json) {
                    error!("Failed to write latency log: {}", e);
                }
            }
            Err(e) => error!("Failed to serialize latency entry: {}", e),
        },
        Err(e) => error!("Failed to open latency log file {:?}: {}", log_path, e),
    }
}

/// Truncate text for preview in logs.
pub fn preview(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() > 80 {
        format!("{}...", chars[..80].iter().collect::<String>())
    } else {
        text.to_string()
    }
}

fn log_file_path() -> PathBuf {
    // In dev mode, write to project root / logs / latency.jsonl
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    let path = root.join("logs").join("latency.jsonl");
    info!("Latency log path: {:?}", path);
    path
}
