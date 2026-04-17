//! Push-to-talk audio capture.
//!
//! The stream runs continuously in a cpal callback so that we can emit
//! amplitude ticks for visual feedback even when we're not recording.
//! Recording itself is gated by an `AudioController`: `start_recording`
//! opens a buffer, `stop_recording` closes it and ships the accumulated
//! samples to the transcription pipeline through a channel.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::SampleFormat;
use log::{error, info};
use rubato::{SincFixedIn, SincInterpolationParameters, SincInterpolationType, Resampler, WindowFunction};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

/// A completed audio segment ready for transcription.
pub struct AudioSegment {
    /// PCM samples at 16kHz mono, f32
    pub samples: Vec<f32>,
    /// ISO timestamp when the segment started
    pub timestamp: String,
}

/// Minimum duration (1 second at 16kHz) below which we drop a recording as
/// probably an accidental click.
const MIN_SEGMENT_SAMPLES: usize = 16000;

/// Throttle amplitude events to ~30Hz so we don't flood the frontend.
const AMPLITUDE_EMIT_INTERVAL_MS: u128 = 33;

/// Public handle to control recording and read state from Tauri commands.
pub struct AudioController {
    state: Arc<Mutex<CaptureState>>,
    segment_tx: mpsc::Sender<AudioSegment>,
    app: Arc<AppHandle>,
}

impl AudioController {
    /// Start accumulating audio into the recording buffer.
    /// Idempotent: calling it while already recording is a no-op.
    pub fn start_recording(&self) {
        let mut state = self.state.lock().unwrap();
        if state.recording {
            return;
        }
        state.recording = true;
        state.buffer.clear();
        state.recording_start = Some(chrono::Local::now().format("%H:%M:%S").to_string());
        info!("Recording started");
        let _ = self.app.emit("recording-started", ());
    }

    /// Stop recording and ship the accumulated buffer to the transcription pipeline.
    /// Returns the number of samples captured (0 if not recording or too short).
    pub fn stop_recording(&self) -> usize {
        let mut state = self.state.lock().unwrap();
        if !state.recording {
            return 0;
        }
        state.recording = false;
        let buffer = std::mem::take(&mut state.buffer);
        let timestamp = state.recording_start.take().unwrap_or_default();
        drop(state); // release lock before emitting / sending

        let len = buffer.len();
        info!("Recording stopped: {} samples ({:.1}s)", len, len as f32 / 16000.0);
        let _ = self.app.emit("recording-stopped", len);

        if len < MIN_SEGMENT_SAMPLES {
            info!("Recording too short (<1s), discarding");
            return 0;
        }

        let segment = AudioSegment { samples: buffer, timestamp };
        if let Err(e) = self.segment_tx.send(segment) {
            error!("Failed to send audio segment: {}", e);
            return 0;
        }
        len
    }
}

/// Start capturing audio from the default input device.
///
/// Returns a receiver of finished segments and a controller to start/stop
/// recording. The cpal input stream is kept alive inside a dedicated thread.
pub fn start_capture(
    app: AppHandle,
) -> Result<(mpsc::Receiver<AudioSegment>, AudioController), String> {
    let (segment_tx, segment_rx) = mpsc::channel::<AudioSegment>();

    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or("No input device available")?;

    #[allow(deprecated)]
    let device_name = device.name().unwrap_or_default();
    info!("Using input device: {}", device_name);

    let config = device
        .default_input_config()
        .map_err(|e| format!("Failed to get default input config: {}", e))?;

    let source_sample_rate = config.sample_rate();
    let source_channels = config.channels() as usize;
    info!(
        "Input config: {}Hz, {} channels, {:?}",
        source_sample_rate,
        source_channels,
        config.sample_format()
    );

    let state = Arc::new(Mutex::new(CaptureState::new(
        source_sample_rate,
        source_channels,
    )));
    let app_handle = Arc::new(app);

    let controller = AudioController {
        state: state.clone(),
        segment_tx: segment_tx.clone(),
        app: app_handle.clone(),
    };

    // Spawn a thread that owns the cpal stream. cpal streams are !Send in
    // some backends, so we keep the stream local to its thread and just park.
    let state_for_thread = state.clone();
    let app_for_thread = app_handle.clone();
    let sample_format = config.sample_format();
    let stream_config: cpal::StreamConfig = config.into();

    std::thread::spawn(move || {
        let build_result = match sample_format {
            SampleFormat::F32 => device.build_input_stream(
                &stream_config,
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    process_audio_data(data, &state_for_thread, &app_for_thread);
                },
                |err| error!("Stream error: {}", err),
                None,
            ),
            SampleFormat::I16 => device.build_input_stream(
                &stream_config,
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    let float_data: Vec<f32> =
                        data.iter().map(|&s| s as f32 / 32768.0).collect();
                    process_audio_data(&float_data, &state_for_thread, &app_for_thread);
                },
                |err| error!("Stream error: {}", err),
                None,
            ),
            format => {
                error!("Unsupported sample format: {:?}", format);
                return;
            }
        };

        let stream = match build_result {
            Ok(s) => s,
            Err(e) => {
                error!("Failed to build input stream: {}", e);
                return;
            }
        };

        if let Err(e) = stream.play() {
            error!("Failed to start stream: {}", e);
            return;
        }

        info!("Audio capture started");

        // Park forever to keep the stream alive.
        loop {
            std::thread::sleep(std::time::Duration::from_secs(3600));
        }
    });

    Ok((segment_rx, controller))
}

struct CaptureState {
    /// Accumulated mono 16kHz samples for the current recording (only filled when `recording`).
    buffer: Vec<f32>,
    /// True when the user is actively recording (between start_recording and stop_recording).
    recording: bool,
    /// Timestamp (HH:MM:SS) of the current recording.
    recording_start: Option<String>,
    /// Source sample rate (for resampling)
    source_sample_rate: u32,
    /// Source channel count
    source_channels: usize,
    /// Resampler (created lazily if source != 16kHz)
    resampler: Option<SincFixedIn<f32>>,
    /// Last amplitude emission, for throttling
    last_amplitude_emit_ms: u128,
}

impl CaptureState {
    fn new(source_sample_rate: u32, source_channels: usize) -> Self {
        let resampler = if source_sample_rate != 16000 {
            let params = SincInterpolationParameters {
                sinc_len: 256,
                f_cutoff: 0.95,
                interpolation: SincInterpolationType::Linear,
                oversampling_factor: 256,
                window: WindowFunction::BlackmanHarris2,
            };
            SincFixedIn::<f32>::new(
                16000.0 / source_sample_rate as f64,
                2.0,
                params,
                1024,
                1,
            )
            .ok()
        } else {
            None
        };

        Self {
            buffer: Vec::new(),
            recording: false,
            recording_start: None,
            source_sample_rate,
            source_channels,
            resampler,
            last_amplitude_emit_ms: 0,
        }
    }
}

fn process_audio_data(
    data: &[f32],
    state: &Arc<Mutex<CaptureState>>,
    app: &Arc<AppHandle>,
) {
    let mut state = state.lock().unwrap();

    // Downmix to mono if needed
    let mono: Vec<f32> = if state.source_channels > 1 {
        data.chunks(state.source_channels)
            .map(|frame| frame.iter().sum::<f32>() / state.source_channels as f32)
            .collect()
    } else {
        data.to_vec()
    };

    // Resample to 16kHz if needed
    let source_rate = state.source_sample_rate;
    let resampled = if let Some(ref mut resampler) = state.resampler {
        let mut output = Vec::new();
        for chunk in mono.chunks(1024) {
            if chunk.len() < 1024 {
                let mut padded = chunk.to_vec();
                padded.resize(1024, 0.0);
                if let Ok(result) = resampler.process(&[&padded], None) {
                    let valid_len =
                        (chunk.len() as f64 * 16000.0 / source_rate as f64) as usize;
                    output.extend_from_slice(&result[0][..valid_len.min(result[0].len())]);
                }
            } else if let Ok(result) = resampler.process(&[chunk], None) {
                output.extend_from_slice(&result[0]);
            }
        }
        output
    } else {
        mono
    };

    // RMS is always computed (for amplitude ticks). Used only as visual feedback.
    let rms = if resampled.is_empty() {
        0.0
    } else {
        (resampled.iter().map(|s| s * s).sum::<f32>() / resampled.len() as f32).sqrt()
    };

    // Accumulate samples only when recording
    if state.recording {
        state.buffer.extend_from_slice(&resampled);
    }

    // Throttled amplitude emission — even when not recording, so the user
    // can see the mic is alive before they start.
    let now_ms = chrono::Local::now().timestamp_millis() as u128;
    if now_ms - state.last_amplitude_emit_ms >= AMPLITUDE_EMIT_INTERVAL_MS {
        state.last_amplitude_emit_ms = now_ms;
        let recording = state.recording;
        drop(state); // release lock before emitting
        let _ = app.emit("amplitude-tick", AmplitudePayload { rms, recording });
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AmplitudePayload {
    rms: f32,
    recording: bool,
}
