mod audio;
mod transcriber;

use log::info;
use std::path::PathBuf;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            let segment_rx = audio::start_capture()
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
    // Try models/ relative to the project root (works in dev mode)
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("models")
        .join("ggml-small.bin");

    if dev_path.exists() {
        return dev_path;
    }

    // Fallback: current directory
    PathBuf::from("models/ggml-small.bin")
}
