use log::{error, info};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::mpsc;
use tauri::{AppHandle, Emitter, Listener};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::audio::AudioSegment;

/// Payload sent to the frontend for each transcribed segment.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionSegment {
    pub text: String,
    pub timestamp: String,
    pub paragraph_id: String,
}

/// Start the transcription loop in a new thread.
pub fn start_transcriber(
    app: AppHandle,
    segment_rx: mpsc::Receiver<AudioSegment>,
    model_path: PathBuf,
) {
    std::thread::spawn(move || {
        if let Err(e) = run_transcription_loop(app, segment_rx, &model_path) {
            error!("Transcription error: {}", e);
        }
    });
}

fn run_transcription_loop(
    app: AppHandle,
    segment_rx: mpsc::Receiver<AudioSegment>,
    model_path: &PathBuf,
) -> Result<(), String> {
    info!("Loading Whisper model from {:?}", model_path);

    if !model_path.exists() {
        return Err(format!(
            "Whisper model not found at {:?}. Download ggml-small.bin to the models/ directory.",
            model_path
        ));
    }

    let ctx = WhisperContext::new_with_params(
        model_path.to_str().unwrap_or_default(),
        WhisperContextParameters::default(),
    )
    .map_err(|e| format!("Failed to load Whisper model: {}", e))?;

    info!("Whisper model loaded successfully");

    // Track the current visible paragraph via frontend events
    let current_paragraph = std::sync::Arc::new(std::sync::Mutex::new("p-0".to_string()));

    let paragraph_clone = current_paragraph.clone();
    app.listen("scroll-position", move |event| {
        if let Ok(id) = serde_json::from_str::<String>(event.payload()) {
            let mut p = paragraph_clone.lock().unwrap();
            *p = id;
        }
    });

    // Create state once and reuse across segments (avoids re-allocating ~300 Mo buffers)
    let mut state = ctx
        .create_state()
        .map_err(|e| format!("Failed to create Whisper state: {}", e))?;

    info!("Whisper state created, ready for transcription");

    for segment in segment_rx.iter() {
        let start = std::time::Instant::now();

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(Some("fr"));
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_single_segment(true);
        params.set_no_context(true);

        if let Err(e) = state.full(params, &segment.samples) {
            error!("Transcription failed: {}", e);
            continue;
        }

        let num_segments = state.full_n_segments();
        let mut text = String::new();
        for i in 0..num_segments {
            if let Some(seg) = state.get_segment(i) {
                if let Ok(seg_text) = seg.to_str_lossy() {
                    text.push_str(&seg_text);
                }
            }
        }

        let text = text.trim().to_string();
        let elapsed = start.elapsed();

        if text.is_empty() || text == "[BLANK_AUDIO]" || text.starts_with('[') {
            info!("Empty or noise segment, skipping");
            continue;
        }

        let paragraph_id = current_paragraph.lock().unwrap().clone();

        info!(
            "Transcribed in {:.1}s: \"{}\" (paragraph: {})",
            elapsed.as_secs_f32(),
            &text,
            &paragraph_id
        );

        let payload = TranscriptionSegment {
            text,
            timestamp: segment.timestamp,
            paragraph_id,
        };

        if let Err(e) = app.emit("transcription-segment", &payload) {
            error!("Failed to emit transcription event: {}", e);
        }
    }

    Ok(())
}
