//! Whisper Model Lifecycle Manager
//!
//! Manages the lifecycle of a local Whisper model for speech-to-text transcription.
//! Handles model download with progress events, SHA1 integrity verification,
//! lazy context loading, and transcription inference via whisper-rs.
//!
//! ## Model
//! Uses whisper-small (`ggml-small.bin`) stored in the user's data directory.
//! Model URL: `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin`
//! SHA1: `55356645c2b361a969dfd0ef2c5a50d530afd8d5`
//!
//! ## Usage
//! 1. Call `get_model_status()` to check if model is present on disk.
//! 2. Call `download_model()` to fetch and verify the model file.
//! 3. Call `transcribe()` with 16 kHz mono f32 PCM audio data.

use reqwest::Client;
use serde::Serialize;
use sha1::{Digest, Sha1};
use std::error::Error as StdError;
use std::fmt;
use std::io::Write;
use std::path::PathBuf;
use std::sync::RwLock;
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use tokio_stream::StreamExt;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::db::Database;

// ============================================================================
// Constants
// ============================================================================

const MODEL_NAME: &str = "ggml-small.bin";
const MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin";
const MODEL_SHA1: &str = "55356645c2b361a969dfd0ef2c5a50d530afd8d5";
const APP_DIR_NAME: &str = "ai-command-center";
const MODELS_SUBDIR: &str = "models";
const CONFIG_KEY: &str = "whisper_model_path";

// ============================================================================
// Public Data Types
// ============================================================================

/// Result of a successful transcription inference.
#[derive(Debug, Clone, Serialize)]
pub struct TranscriptionResult {
    /// Transcribed text, with leading/trailing whitespace trimmed.
    pub text: String,
    /// Wall-clock duration of the inference call in milliseconds.
    pub duration_ms: u64,
}

/// Status of the local Whisper model on disk.
#[derive(Debug, Clone, Serialize)]
pub struct WhisperModelStatus {
    /// Whether the model file exists on disk.
    pub downloaded: bool,
    /// Absolute path to the model file, if present.
    pub model_path: Option<String>,
    /// File size in bytes, if present.
    pub model_size_bytes: Option<u64>,
    /// Human-readable model name.
    pub model_name: String,
}

/// Progress payload emitted as a Tauri event during model download.
#[derive(Debug, Clone, Serialize)]
pub struct WhisperDownloadProgress {
    pub bytes_downloaded: u64,
    pub total_bytes: u64,
    pub percentage: f32,
}

// ============================================================================
// Error Types
// ============================================================================

/// Errors that can occur during Whisper model management and transcription.
#[derive(Debug)]
pub enum WhisperError {
    /// The model file is not present on disk.
    ModelNotFound,
    /// Downloading the model file failed.
    ModelDownloadFailed(String),
    /// The downloaded file's SHA1 hash does not match the expected value.
    HashMismatch { expected: String, actual: String },
    /// Transcription inference failed.
    InferenceError(String),
    /// Loading the WhisperContext from the model file failed.
    ContextLoadError(String),
}

impl fmt::Display for WhisperError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            WhisperError::ModelNotFound => {
                write!(f, "Whisper model not found — download it first")
            }
            WhisperError::ModelDownloadFailed(msg) => {
                write!(f, "Model download failed: {}", msg)
            }
            WhisperError::HashMismatch { expected, actual } => {
                write!(
                    f,
                    "Model hash mismatch — expected {}, got {}",
                    expected, actual
                )
            }
            WhisperError::InferenceError(msg) => {
                write!(f, "Transcription inference error: {}", msg)
            }
            WhisperError::ContextLoadError(msg) => {
                write!(f, "Failed to load Whisper context: {}", msg)
            }
        }
    }
}

impl StdError for WhisperError {}

// ============================================================================
// WhisperManager
// ============================================================================

/// Manages the Whisper model context with lazy initialisation.
///
/// The `WhisperContext` is loaded on first use and cached for subsequent calls.
/// Thread-safe via `RwLock` — multiple concurrent readers are allowed, but
/// loading/unloading holds an exclusive write lock.
pub struct WhisperManager {
    /// Lazily-loaded Whisper inference context. `None` until first `ensure_loaded()`.
    context: RwLock<Option<WhisperContext>>,
    /// Path to the model file resolved at load time.
    model_path: RwLock<Option<PathBuf>>,
    /// Reusable HTTP client for model downloads.
    client: Client,
}

impl WhisperManager {
    /// Create a new `WhisperManager` with no context loaded.
    pub fn new() -> Self {
        Self {
            context: RwLock::new(None),
            model_path: RwLock::new(None),
            client: Client::new(),
        }
    }

    // ============================================================================
    // Model Path Helpers
    // ============================================================================

    /// Return the expected on-disk path for the model file.
    ///
    /// Path: `$DATA_DIR/ai-command-center/models/ggml-small.bin`
    fn model_file_path() -> Option<PathBuf> {
        dirs::data_dir().map(|d| d.join(APP_DIR_NAME).join(MODELS_SUBDIR).join(MODEL_NAME))
    }

    // ============================================================================
    // Public API
    // ============================================================================

    /// Return the current status of the model file on disk.
    ///
    /// Does not attempt to load or download the model.
    pub fn get_model_status(&self) -> WhisperModelStatus {
        match Self::model_file_path() {
            None => WhisperModelStatus {
                downloaded: false,
                model_path: None,
                model_size_bytes: None,
                model_name: MODEL_NAME.to_string(),
            },
            Some(path) => {
                if path.exists() {
                    let size = std::fs::metadata(&path).ok().map(|m| m.len());
                    WhisperModelStatus {
                        downloaded: true,
                        model_path: Some(path.to_string_lossy().to_string()),
                        model_size_bytes: size,
                        model_name: MODEL_NAME.to_string(),
                    }
                } else {
                    WhisperModelStatus {
                        downloaded: false,
                        model_path: Some(path.to_string_lossy().to_string()),
                        model_size_bytes: None,
                        model_name: MODEL_NAME.to_string(),
                    }
                }
            }
        }
    }

    /// Ensure the `WhisperContext` is loaded from disk.
    ///
    /// If the context is already loaded, this is a no-op (cheap read-lock check).
    /// On first call, acquires a write lock and loads the model from disk.
    ///
    /// # Errors
    /// - `WhisperError::ModelNotFound` if the model file does not exist.
    /// - `WhisperError::ContextLoadError` if whisper-rs fails to open the model.
    pub fn ensure_loaded(&self) -> Result<(), WhisperError> {
        // Fast path: already loaded.
        {
            let guard = self.context.read().unwrap();
            if guard.is_some() {
                return Ok(());
            }
        }

        // Slow path: load from disk.
        let path = Self::model_file_path().ok_or(WhisperError::ModelNotFound)?;
        if !path.exists() {
            return Err(WhisperError::ModelNotFound);
        }

        let path_str = path.to_string_lossy().to_string();
        let ctx = WhisperContext::new_with_params(&path_str, WhisperContextParameters::default())
            .map_err(|e| WhisperError::ContextLoadError(e.to_string()))?;

        let mut ctx_guard = self.context.write().unwrap();
        *ctx_guard = Some(ctx);

        let mut path_guard = self.model_path.write().unwrap();
        *path_guard = Some(path);

        Ok(())
    }

    /// Transcribe 16 kHz mono f32 PCM audio data to text.
    ///
    /// Lazily loads the model on first call via `ensure_loaded()`.
    ///
    /// # Arguments
    /// * `audio_data` — Raw 16 kHz mono PCM samples in the range `[-1.0, 1.0]`.
    ///
    /// # Returns
    /// `TranscriptionResult` containing the concatenated segment text and
    /// wall-clock inference duration in milliseconds.
    ///
    /// # Errors
    /// - `WhisperError::ModelNotFound` if the model is not downloaded.
    /// - `WhisperError::ContextLoadError` if the context cannot be initialised.
    /// - `WhisperError::InferenceError` if the inference call fails.
    pub fn transcribe(&self, audio_data: &[f32]) -> Result<TranscriptionResult, WhisperError> {
        // 1. Ensure the context is loaded.
        self.ensure_loaded()?;

        // 2. Acquire read lock on context.
        let ctx_guard = self.context.read().unwrap();
        let ctx = ctx_guard.as_ref().ok_or_else(|| {
            WhisperError::ContextLoadError("Context unexpectedly absent after load".to_string())
        })?;

        // 3. Create per-inference state.
        let mut state = ctx
            .create_state()
            .map_err(|e| WhisperError::InferenceError(format!("create_state failed: {}", e)))?;

        // 4. Build inference params: greedy, English.
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(Some("en"));
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);

        // 5. Run inference and measure wall-clock time.
        let start = Instant::now();
        state
            .full(params, audio_data)
            .map_err(|e| WhisperError::InferenceError(format!("full() failed: {}", e)))?;
        let duration_ms = start.elapsed().as_millis() as u64;

        // 6. Collect and concatenate segment texts.
        let n_segments = state
            .full_n_segments()
            .map_err(|e| WhisperError::InferenceError(format!("full_n_segments failed: {}", e)))?;

        let mut text = String::new();
        for i in 0..n_segments {
            let segment = state
                .full_get_segment_text(i)
                .map_err(|e| WhisperError::InferenceError(format!("segment {} text: {}", i, e)))?;
            text.push_str(&segment);
        }

        Ok(TranscriptionResult {
            text: text.trim().to_string(),
            duration_ms,
        })
    }

    /// Download the Whisper model file with SHA1 verification.
    ///
    /// Emits `whisper-download-progress` Tauri events throughout the download.
    /// On completion, verifies the SHA1 hash and returns the path to the downloaded model.
    ///
    /// # Arguments
    /// * `app` — Tauri `AppHandle` used to emit progress events.
    ///
    /// # Returns
    /// The absolute path to the downloaded model file on success.
    ///
    /// # Errors
    /// - `WhisperError::ModelDownloadFailed` on network or I/O errors.
    /// - `WhisperError::HashMismatch` if the downloaded file's SHA1 differs from expected.
    pub async fn download_model(&self, app: AppHandle) -> Result<String, WhisperError> {
        // Determine the target path and ensure parent directories exist.
        let dest_path = Self::model_file_path().ok_or_else(|| {
            WhisperError::ModelDownloadFailed("Cannot resolve data directory".to_string())
        })?;

        if let Some(parent) = dest_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                WhisperError::ModelDownloadFailed(format!("create_dir_all failed: {}", e))
            })?;
        }

        // Start HTTP GET with streaming body.
        let response = self
            .client
            .get(MODEL_URL)
            .send()
            .await
            .map_err(|e| WhisperError::ModelDownloadFailed(format!("GET failed: {}", e)))?;

        if !response.status().is_success() {
            return Err(WhisperError::ModelDownloadFailed(format!(
                "HTTP {}: {}",
                response.status().as_u16(),
                response.status().canonical_reason().unwrap_or("unknown")
            )));
        }

        let total_bytes = response.content_length().unwrap_or(0);

        // Write to a temporary file so we don't leave a partial model on failure.
        let tmp_path = dest_path.with_extension("bin.part");
        let mut file = std::fs::File::create(&tmp_path)
            .map_err(|e| WhisperError::ModelDownloadFailed(format!("create temp file: {}", e)))?;

        let mut hasher = Sha1::new();
        let mut bytes_downloaded: u64 = 0;
        let mut stream = response.bytes_stream();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk
                .map_err(|e| WhisperError::ModelDownloadFailed(format!("stream chunk: {}", e)))?;

            hasher.update(&chunk);
            file.write_all(&chunk)
                .map_err(|e| WhisperError::ModelDownloadFailed(format!("write chunk: {}", e)))?;

            bytes_downloaded += chunk.len() as u64;

            let percentage = if total_bytes > 0 {
                (bytes_downloaded as f32 / total_bytes as f32) * 100.0
            } else {
                0.0
            };

            // Emit progress event (best-effort — ignore emit errors).
            let _ = app.emit(
                "whisper-download-progress",
                WhisperDownloadProgress {
                    bytes_downloaded,
                    total_bytes,
                    percentage,
                },
            );
        }

        // Flush and close before hashing.
        drop(file);

        // Verify SHA1 hash.
        let actual_hash = format!("{:x}", hasher.finalize());
        if actual_hash != MODEL_SHA1 {
            let _ = std::fs::remove_file(&tmp_path);
            return Err(WhisperError::HashMismatch {
                expected: MODEL_SHA1.to_string(),
                actual: actual_hash,
            });
        }

        std::fs::rename(&tmp_path, &dest_path).map_err(|e| {
            WhisperError::ModelDownloadFailed(format!("rename temp to dest: {}", e))
        })?;

        let path_str = dest_path.to_string_lossy().to_string();
        println!("[whisper] Model downloaded and verified: {}", path_str);
        Ok(path_str)
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_manager_new() {
        let _mgr = WhisperManager::new();
    }

    #[test]
    fn test_model_file_path_contains_model_name() {
        if let Some(path) = WhisperManager::model_file_path() {
            assert!(path.to_string_lossy().contains(MODEL_NAME));
        }
    }

    #[test]
    fn test_get_model_status_returns_correct_name() {
        let mgr = WhisperManager::new();
        let status = mgr.get_model_status();
        assert_eq!(status.model_name, MODEL_NAME);
    }

    #[test]
    fn test_error_display_model_not_found() {
        let e = WhisperError::ModelNotFound;
        assert!(e.to_string().contains("not found"));
    }

    #[test]
    fn test_error_display_hash_mismatch() {
        let e = WhisperError::HashMismatch {
            expected: "aaa".to_string(),
            actual: "bbb".to_string(),
        };
        assert!(e.to_string().contains("aaa"));
        assert!(e.to_string().contains("bbb"));
    }

    #[test]
    fn test_error_display_download_failed() {
        let e = WhisperError::ModelDownloadFailed("timeout".to_string());
        assert!(e.to_string().contains("timeout"));
    }

    #[test]
    fn test_error_display_inference_error() {
        let e = WhisperError::InferenceError("oom".to_string());
        assert!(e.to_string().contains("oom"));
    }

    #[test]
    fn test_error_display_context_load_error() {
        let e = WhisperError::ContextLoadError("bad path".to_string());
        assert!(e.to_string().contains("bad path"));
    }

    #[test]
    fn test_ensure_loaded_returns_not_found_when_missing() {
        let mgr = WhisperManager::new();
        // If the model is not on disk, ensure_loaded should return ModelNotFound.
        // (This test only passes in CI where the model is absent.)
        if WhisperManager::model_file_path()
            .map(|p| !p.exists())
            .unwrap_or(true)
        {
            let result = mgr.ensure_loaded();
            assert!(matches!(result, Err(WhisperError::ModelNotFound)));
        }
    }

    #[test]
    fn test_get_model_status_downloaded_when_file_exists() {
        if let Some(path) = WhisperManager::model_file_path() {
            // Only create a temp file if the model isn't already on disk.
            let created = if !path.exists() {
                if let Some(parent) = path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                std::fs::File::create(&path).is_ok()
            } else {
                false
            };
            let mgr = WhisperManager::new();
            let status = mgr.get_model_status();
            assert!(status.downloaded);
            assert!(status.model_size_bytes.is_some());
            if created {
                let _ = std::fs::remove_file(&path);
            }
        }
    }

    #[test]
    fn test_transcription_result_serializes() {
        let result = TranscriptionResult {
            text: "hello".to_string(),
            duration_ms: 100,
        };
        let val = serde_json::to_value(&result).unwrap();
        assert_eq!(val["text"], "hello");
        assert_eq!(val["duration_ms"], 100);
    }

    #[test]
    fn test_whisper_model_status_serializes() {
        let status = WhisperModelStatus {
            downloaded: true,
            model_path: Some("/tmp/model.bin".to_string()),
            model_size_bytes: Some(1234),
            model_name: "ggml-small.bin".to_string(),
        };
        let val = serde_json::to_value(&status).unwrap();
        assert_eq!(val["downloaded"], true);
        assert_eq!(val["model_name"], "ggml-small.bin");
        assert_eq!(val["model_path"], "/tmp/model.bin");
        assert_eq!(val["model_size_bytes"], 1234);
    }

    #[test]
    fn test_whisper_download_progress_serializes() {
        let progress = WhisperDownloadProgress {
            bytes_downloaded: 512,
            total_bytes: 1024,
            percentage: 50.0,
        };
        let val = serde_json::to_value(&progress).unwrap();
        assert_eq!(val["bytes_downloaded"], 512);
        assert_eq!(val["total_bytes"], 1024);
        assert!((val["percentage"].as_f64().unwrap() - 50.0).abs() < 0.001);
    }
}
