use log::{error, info, warn};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::mpsc;
use tauri::{AppHandle, Emitter, Listener};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::audio::AudioSegment;
use crate::classifier::{self, ClassifierContext};

/// Scroll position sent by the frontend.
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScrollPosition {
    paragraph_id: String,
    paragraph_text: String,
}

/// Payload sent to the frontend for each classified segment.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassifiedPayload {
    /// "lecture", "commentaire", "question", "instruction"
    pub segment_type: String,
    /// Cleaned text from Haiku
    pub text: String,
    /// Raw transcription from Whisper
    pub raw_text: String,
    /// Confidence 0-1
    pub confidence: f64,
    /// Timestamp when segment started
    pub timestamp: String,
    /// Paragraph ID the segment is anchored to
    pub paragraph_id: String,
}

/// Start the transcription + classification loop in a new thread.
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
    let current_scroll = std::sync::Arc::new(std::sync::Mutex::new(ScrollPosition {
        paragraph_id: "p-0".to_string(),
        paragraph_text: String::new(),
    }));

    let scroll_clone = current_scroll.clone();
    app.listen("scroll-position", move |event| {
        if let Ok(pos) = serde_json::from_str::<ScrollPosition>(event.payload()) {
            let mut s = scroll_clone.lock().unwrap();
            *s = pos;
        }
    });

    // Create Whisper state once and reuse
    let mut state = ctx
        .create_state()
        .map_err(|e| format!("Failed to create Whisper state: {}", e))?;

    info!("Whisper state created, ready for transcription");

    // Classifier context (last 3 segments)
    let mut classifier_ctx = ClassifierContext::new();

    for segment in segment_rx.iter() {
        let start = std::time::Instant::now();

        // --- Whisper transcription ---
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
        let whisper_elapsed = start.elapsed();

        if text.is_empty() || text == "[BLANK_AUDIO]" || text.starts_with('[') {
            info!("Empty or noise segment, skipping");
            continue;
        }

        let scroll = current_scroll.lock().unwrap().clone();

        info!(
            "Transcribed in {:.1}s: \"{}\" (paragraph: {})",
            whisper_elapsed.as_secs_f32(),
            &text,
            &scroll.paragraph_id
        );

        // --- Haiku classification ---
        classifier_ctx.add_segment(&text);

        match classifier::classify_segment(&text, &scroll.paragraph_text, &classifier_ctx) {
            Ok(classified) => {
                let total_elapsed = start.elapsed();
                info!(
                    "Classified as '{}' (conf: {:.2}) in {:.1}s total — \"{}\"",
                    classified.segment_type,
                    classified.confiance,
                    total_elapsed.as_secs_f32(),
                    classified.contenu_nettoye
                );

                // Skip "lecture" segments — user is just reading aloud
                if classified.segment_type == "lecture" {
                    info!("Lecture segment filtered out");
                    continue;
                }

                let payload = ClassifiedPayload {
                    segment_type: classified.segment_type,
                    text: classified.contenu_nettoye,
                    raw_text: text,
                    confidence: classified.confiance,
                    timestamp: segment.timestamp,
                    paragraph_id: scroll.paragraph_id,
                };

                if let Err(e) = app.emit("classified-segment", &payload) {
                    error!("Failed to emit classified segment event: {}", e);
                }
            }
            Err(e) => {
                warn!("Classification failed, emitting raw segment: {}", e);
                // Fallback: emit as unclassified comment
                let payload = ClassifiedPayload {
                    segment_type: "commentaire".to_string(),
                    text: text.clone(),
                    raw_text: text,
                    confidence: 0.0,
                    timestamp: segment.timestamp,
                    paragraph_id: scroll.paragraph_id,
                };
                if let Err(e) = app.emit("classified-segment", &payload) {
                    error!("Failed to emit fallback segment event: {}", e);
                }
            }
        }
    }

    Ok(())
}
