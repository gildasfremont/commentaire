mod audio;
mod classifier;
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

    // First classify via Haiku
    let mut ctx = classifier::ClassifierContext::new();
    ctx.add_segment(&text);

    let classified = match classifier::classify_segment(&text, &paragraph_text, &ctx) {
        Ok(c) => c,
        Err(e) => {
            info!("Classification failed, treating as question: {}", e);
            classifier::ClassifiedSegment {
                segment_type: "question".to_string(),
                contenu_nettoye: text.clone(),
                confiance: 1.0,
            }
        }
    };

    info!("Classified as: {} (conf: {:.2})", classified.segment_type, classified.confiance);

    // Emit classified segment to frontend
    use tauri::Emitter;
    let _ = app.emit("classified-segment", serde_json::json!({
        "segmentType": &classified.segment_type,
        "text": &classified.contenu_nettoye,
        "rawText": &text,
        "confidence": classified.confiance,
        "timestamp": chrono::Local::now().format("%H:%M:%S").to_string(),
        "paragraphId": &paragraph_id,
    }));

    // If it's a question, trigger the responder
    if classified.segment_type == "question" {
        let qid = format!("q-sim-{}", chrono::Local::now().format("%H%M%S"));
        responder::handle_question(
            app,
            qid,
            classified.contenu_nettoye,
            paragraph_id,
            paragraph_text,
            document_text,
            Vec::new(),
        );
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![simulate_question])
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

            // Start audio capture pipeline
            let segment_rx = audio::start_capture(app.handle().clone())
                .expect("Failed to start audio capture");

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
