mod audio;
mod classifier;
mod latency;
mod responder;
mod transcriber;

use log::info;
use std::path::PathBuf;
use tauri::Manager;

/// Tauri command: simulate a question without using the microphone.
/// Used for testing the full pipeline: classification → ack → Opus response.
#[tauri::command]
fn simulate_question(
    app: tauri::AppHandle,
    text: String,
    paragraph_id: String,
) {
    info!("simulate_question: \"{}\" at {}", text, paragraph_id);

    // Load document and paragraph text
    let doc_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("frontend")
        .join("document.md");

    let document_text = std::fs::read_to_string(&doc_path).unwrap_or_default();

    // Extract paragraph text from markdown (rough: find by paragraph index)
    let paragraph_text = extract_paragraph_text(&document_text, &paragraph_id);

    // Create metrics for this simulated segment
    let sim_id = format!("sim-{}", chrono::Local::now().format("%H%M%S"));
    let mut metrics = latency::SegmentLatency::new(sim_id.clone());
    metrics.text_preview = latency::preview(&text);
    // Mark whisper as not applicable (skipped in simulation) by leaving it None.

    // Classify via Haiku
    let mut ctx = classifier::ClassifierContext::new();
    ctx.add_segment(&text);

    let haiku_start = std::time::Instant::now();
    let classified = match classifier::classify_segment(&text, &paragraph_text, &ctx) {
        Ok(c) => {
            metrics.haiku_ms = Some(haiku_start.elapsed().as_millis());
            c
        }
        Err(e) => {
            info!("Classification failed, treating as question: {}", e);
            metrics.haiku_ms = Some(haiku_start.elapsed().as_millis());
            classifier::ClassifiedSegment {
                segment_type: "question".to_string(),
                contenu_nettoye: text.clone(),
                confiance: 1.0,
            }
        }
    };

    metrics.segment_type = classified.segment_type.clone();
    info!("Classified as: {} (conf: {:.2})", classified.segment_type, classified.confiance);

    let is_question = classified.segment_type == "question";
    let question_id = if is_question {
        format!("q-{}", sim_id)
    } else {
        String::new()
    };

    // Emit classified segment to frontend
    use tauri::Emitter;
    let _ = app.emit("classified-segment", serde_json::json!({
        "segmentType": &classified.segment_type,
        "text": &classified.contenu_nettoye,
        "rawText": &text,
        "confidence": classified.confiance,
        "timestamp": chrono::Local::now().format("%H:%M:%S").to_string(),
        "paragraphId": &paragraph_id,
        "questionId": &question_id,
    }));

    // If it's a question, trigger the responder (it will log metrics).
    // Otherwise log now.
    if is_question {
        responder::handle_question(
            app,
            question_id,
            classified.contenu_nettoye,
            paragraph_id,
            paragraph_text,
            document_text,
            Vec::new(),
            metrics,
        );
    } else {
        latency::log_segment(&metrics);
    }
}

/// Extract the text of a paragraph by its ID (e.g., "p-3" → 4th paragraph).
fn extract_paragraph_text(markdown: &str, paragraph_id: &str) -> String {
    let index: usize = paragraph_id
        .strip_prefix("p-")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    // Split markdown into paragraphs (separated by blank lines)
    let paragraphs: Vec<&str> = markdown
        .split("\n\n")
        .filter(|p| {
            let trimmed = p.trim();
            !trimmed.is_empty() && !trimmed.starts_with('#')
        })
        .collect();

    paragraphs.get(index).unwrap_or(&"").trim().to_string()
}

/// Tauri command: start recording audio. Called from the frontend when the
/// user toggles the push-to-talk button on.
#[tauri::command]
fn start_recording(controller: tauri::State<'_, audio::AudioController>) {
    controller.start_recording();
}

/// Tauri command: stop recording. Ships the accumulated buffer to the
/// transcription pipeline. Returns the sample count (0 if too short).
#[tauri::command]
fn stop_recording(controller: tauri::State<'_, audio::AudioController>) -> usize {
    controller.stop_recording()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            simulate_question,
            start_recording,
            stop_recording
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Resolve model path relative to the project root
            let model_path = resolve_model_path();
            info!("Whisper model path: {:?}", model_path);

            // Start audio capture pipeline (push-to-talk mode)
            let (segment_rx, controller) =
                audio::start_capture(app.handle().clone())
                    .expect("Failed to start audio capture");

            // Expose the controller to Tauri commands
            app.manage(controller);

            // Start transcription pipeline
            transcriber::start_transcriber(
                app.handle().clone(),
                segment_rx,
                model_path,
            );

            info!("Audio pipeline started");

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Find the Whisper model. In dev mode, look in the project's models/ directory.
fn resolve_model_path() -> PathBuf {
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("models")
        .join("ggml-small.bin");

    if dev_path.exists() {
        return dev_path;
    }

    PathBuf::from("models/ggml-small.bin")
}
