use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::SampleFormat;
use log::{error, info, warn};
use rubato::{SincFixedIn, SincInterpolationParameters, SincInterpolationType, Resampler, WindowFunction};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Instant;

/// A completed audio segment ready for transcription.
pub struct AudioSegment {
    /// PCM samples at 16kHz mono, f32
    pub samples: Vec<f32>,
    /// ISO timestamp when the segment started
    pub timestamp: String,
}

/// Configuration for the VAD (voice activity detection).
const RMS_THRESHOLD: f32 = 0.015; // Energy threshold for speech detection
const SILENCE_DURATION_SECS: f32 = 2.0; // Seconds of silence to end a segment
const MIN_SEGMENT_SAMPLES: usize = 16000; // Minimum 1 second of audio to transcribe

/// Start capturing audio from the default input device.
/// Returns a receiver that yields completed audio segments.
pub fn start_capture() -> Result<mpsc::Receiver<AudioSegment>, String> {
    let (segment_tx, segment_rx) = mpsc::channel::<AudioSegment>();

    std::thread::spawn(move || {
        if let Err(e) = run_capture_loop(segment_tx) {
            error!("Audio capture error: {}", e);
        }
    });

    Ok(segment_rx)
}

fn run_capture_loop(segment_tx: mpsc::Sender<AudioSegment>) -> Result<(), String> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or("No input device available")?;

    info!("Using input device: {}", device.name().unwrap_or_default());

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

    // Shared state for accumulating audio
    let state = Arc::new(Mutex::new(CaptureState::new(
        source_sample_rate,
        source_channels,
    )));

    let state_clone = state.clone();
    let segment_tx_clone = segment_tx.clone();

    // Build input stream based on sample format
    let stream = match config.sample_format() {
        SampleFormat::F32 => device.build_input_stream(
            &config.into(),
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                process_audio_data(data, &state_clone, &segment_tx_clone);
            },
            |err| error!("Stream error: {}", err),
            None,
        ),
        SampleFormat::I16 => device.build_input_stream(
            &config.into(),
            move |data: &[i16], _: &cpal::InputCallbackInfo| {
                let float_data: Vec<f32> = data.iter().map(|&s| s as f32 / 32768.0).collect();
                process_audio_data(&float_data, &state_clone, &segment_tx_clone);
            },
            |err| error!("Stream error: {}", err),
            None,
        ),
        format => return Err(format!("Unsupported sample format: {:?}", format)),
    }
    .map_err(|e| format!("Failed to build input stream: {}", e))?;

    stream
        .play()
        .map_err(|e| format!("Failed to start stream: {}", e))?;

    info!("Audio capture started");

    // Keep thread alive
    loop {
        std::thread::sleep(std::time::Duration::from_secs(1));
    }
}

struct CaptureState {
    /// Accumulated mono 16kHz samples for the current segment
    buffer: Vec<f32>,
    /// Whether we're currently detecting speech
    is_speaking: bool,
    /// When silence started (for gap detection)
    silence_start: Option<Instant>,
    /// When the current segment started
    segment_start: Option<String>,
    /// Source sample rate for resampling
    source_sample_rate: u32,
    /// Source channel count
    source_channels: usize,
    /// Resampler (created lazily if needed)
    resampler: Option<SincFixedIn<f32>>,
}

impl CaptureState {
    fn new(source_sample_rate: u32, source_channels: usize) -> Self {
        // Create resampler if source rate differs from target 16kHz
        let resampler = if source_sample_rate != 16000 {
            let params = SincInterpolationParameters {
                sinc_len: 256,
                f_cutoff: 0.95,
                interpolation: SincInterpolationType::Linear,
                oversampling_factor: 256,
                window: WindowFunction::BlackmanHarris2,
            };
            // Process in chunks of 1024 samples
            SincFixedIn::<f32>::new(
                16000.0 / source_sample_rate as f64,
                2.0,
                params,
                1024,
                1, // mono output
            )
            .ok()
        } else {
            None
        };

        Self {
            buffer: Vec::new(),
            is_speaking: false,
            silence_start: None,
            segment_start: None,
            source_sample_rate,
            source_channels,
            resampler,
        }
    }
}

fn process_audio_data(
    data: &[f32],
    state: &Arc<Mutex<CaptureState>>,
    segment_tx: &mpsc::Sender<AudioSegment>,
) {
    let mut state = state.lock().unwrap();

    // Convert to mono if stereo/multi-channel
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
        // Process in chunks that match the resampler's chunk size
        for chunk in mono.chunks(1024) {
            if chunk.len() < 1024 {
                // Pad short chunks
                let mut padded = chunk.to_vec();
                padded.resize(1024, 0.0);
                if let Ok(result) = resampler.process(&[&padded], None) {
                    // Only take proportional output for the non-padded part
                    let valid_len = (chunk.len() as f64 * 16000.0 / source_rate as f64) as usize;
                    output.extend_from_slice(&result[0][..valid_len.min(result[0].len())]);
                }
            } else {
                if let Ok(result) = resampler.process(&[chunk], None) {
                    output.extend_from_slice(&result[0]);
                }
            }
        }
        output
    } else {
        mono
    };

    // Calculate RMS energy
    let rms = if resampled.is_empty() {
        0.0
    } else {
        (resampled.iter().map(|s| s * s).sum::<f32>() / resampled.len() as f32).sqrt()
    };

    let speech_detected = rms > RMS_THRESHOLD;

    if speech_detected {
        if !state.is_speaking {
            // Speech just started
            state.is_speaking = true;
            state.segment_start = Some(chrono::Local::now().format("%H:%M:%S").to_string());
            info!("Speech started (RMS: {:.4})", rms);
        }
        state.silence_start = None;
        state.buffer.extend_from_slice(&resampled);
    } else if state.is_speaking {
        // We were speaking, now silence
        state.buffer.extend_from_slice(&resampled);

        if state.silence_start.is_none() {
            state.silence_start = Some(Instant::now());
        }

        if let Some(silence_start) = state.silence_start {
            let silence_duration = silence_start.elapsed().as_secs_f32();
            if silence_duration >= SILENCE_DURATION_SECS {
                // Segment complete
                if state.buffer.len() >= MIN_SEGMENT_SAMPLES {
                    let segment = AudioSegment {
                        samples: std::mem::take(&mut state.buffer),
                        timestamp: state.segment_start.take().unwrap_or_default(),
                    };
                    info!(
                        "Segment complete: {} samples ({:.1}s)",
                        segment.samples.len(),
                        segment.samples.len() as f32 / 16000.0
                    );
                    if segment_tx.send(segment).is_err() {
                        warn!("Failed to send audio segment");
                    }
                } else {
                    info!("Segment too short, discarding");
                    state.buffer.clear();
                }
                state.is_speaking = false;
                state.silence_start = None;
                state.segment_start = None;
            }
        }
    }
}
