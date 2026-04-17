use log::{error, info, warn};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::mpsc;
use tauri::{AppHandle, Emitter, Listener};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::audio::AudioSegment;
use crate::classifier::{self, ClassifierContext};
use crate::latency::{self, SegmentLatency};
use crate::responder;

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

    // Load document text for Opus context
    let document_text = load_document_text();

    // Track all comments for Opus context
    let mut all_comments: Vec<String> = Vec::new();

    // Question counter for unique IDs
    let mut question_counter: u32 = 0;
    let mut segment_counter: u32 = 0;

    for segment in segment_rx.iter() {
        let start = std::time::Instant::now();
        segment_counter += 1;
        let segment_id = format!("s-{}", segment_counter);
        let mut metrics = SegmentLatency::new(segment_id.clone());

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
        metrics.whisper_ms = Some(whisper_elapsed.as_millis());
        metrics.text_preview = latency::preview(&text);

        if text.is_empty() || text == "[BLANK_AUDIO]" || text.starts_with('[') {
            info!("Empty or noise segment, skipping");
            metrics.segment_type = "noise".to_string();
            latency::log_segment(&metrics);
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
        let haiku_start = std::time::Instant::now();

        match classifier::classify_segment(&text, &scroll.paragraph_text, &classifier_ctx) {
            Ok(classified) => {
                metrics.haiku_ms = Some(haiku_start.elapsed().as_millis());
                let total_elapsed = start.elapsed();
                info!(
                    "Classified as '{}' (conf: {:.2}) in {:.1}s total — \"{}\"",
                    classified.segment_type,
                    classified.confiance,
                    total_elapsed.as_secs_f32(),
                    classified.contenu_nettoye
                );

                metrics.segment_type = classified.segment_type.clone();

                // Skip "lecture" segments — user is just reading aloud
                if classified.segment_type == "lecture" {
                    info!("Lecture segment filtered out");
                    latency::log_segment(&metrics);
                    continue;
                }

                let is_question = classified.segment_type == "question";
                let clean_text = classified.contenu_nettoye.clone();

                let payload = ClassifiedPayload {
                    segment_type: classified.segment_type,
                    text: classified.contenu_nettoye,
                    raw_text: text.clone(),
                    confidence: classified.confiance,
                    timestamp: segment.timestamp.clone(),
                    paragraph_id: scroll.paragraph_id.clone(),
                };

                // Track comment for Opus context
                all_comments.push(format!("[{}] {}", scroll.paragraph_id, &clean_text));

                if let Err(e) = app.emit("classified-segment", &payload) {
                    error!("Failed to emit classified segment event: {}", e);
                }

                // Trigger responder for questions (responder owns logging for questions)
                if is_question {
                    question_counter += 1;
                    let qid = format!("q-{}", question_counter);

                    info!("Question detected, triggering responder ({})", qid);
                    responder::handle_question(
                        app.clone(),
                        qid,
                        clean_text,
                        scroll.paragraph_id.clone(),
                        scroll.paragraph_text.clone(),
                        document_text.clone(),
                        all_comments.clone(),
                        metrics.clone(),
                    );
                } else {
                    latency::log_segment(&metrics);
                }
            }
            Err(e) => {
                warn!("Classification failed, emitting raw segment: {}", e);
                metrics.haiku_ms = Some(haiku_start.elapsed().as_millis());
                metrics.segment_type = "classification_failed".to_string();
                latency::log_segment(&metrics);
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

/// Load the document markdown text for Opus context.
fn load_document_text() -> String {
    let doc_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("frontend")
        .join("document.md");

    match std::fs::read_to_string(&doc_path) {
        Ok(text) => {
            info!("Loaded document ({} chars) for Opus context", text.len());
            text
        }
        Err(e) => {
            error!("Failed to load document from {:?}: {}", doc_path, e);
            String::new()
        }
    }
}
