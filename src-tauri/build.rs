fn main() {
  // whisper.cpp uses std::filesystem which requires macOS 10.15+
  // Set for both Rust and the cmake subprocess that builds whisper-rs-sys
  std::env::set_var("MACOSX_DEPLOYMENT_TARGET", "11.0");
  std::env::set_var("CMAKE_OSX_DEPLOYMENT_TARGET", "11.0");
  tauri_build::build()
}
