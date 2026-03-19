//! Whisper Model Lifecycle Manager
//!
//! Manages the lifecycle of a local Whisper model for speech-to-text transcription.
//! Handles model download with progress events, SHA1 integrity verification,
//! lazy context loading, and transcription inference via whisper-rs.
//!
//! ## Models
//! Supports multiple model sizes (tiny, base, small, medium) stored in the
//! user's data directory. Models are downloaded from HuggingFace.
//!
//! ## Usage
//! 1. Call `get_all_model_statuses()` to check which models are present on disk.
//! 2. Call `set_active_model()` to select the desired model size.
//! 3. Call `download_model()` to fetch and verify a model file.
//! 4. Call `transcribe()` with 16 kHz mono f32 PCM audio data.

use log::info;
use reqwest::Client;
use serde::{Deserialize, Serialize};
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

// ============================================================================
// Constants
// ============================================================================

const APP_DIR_NAME: &str = "openforge";
const MODELS_SUBDIR: &str = "models";

// ============================================================================
// Model Size Enum
// ============================================================================

/// Available Whisper model sizes, ordered from smallest to largest.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WhisperModelSize {
    Tiny,
    Base,
    Small,
    Medium,
}

impl WhisperModelSize {
    /// All available model sizes in order.
    pub fn all() -> &'static [WhisperModelSize] {
        &[
            WhisperModelSize::Tiny,
            WhisperModelSize::Base,
            WhisperModelSize::Small,
            WhisperModelSize::Medium,
        ]
    }

    /// Parse a model size from a string (case-insensitive).
    pub fn from_str(s: &str) -> Option<WhisperModelSize> {
        match s.to_lowercase().as_str() {
            "tiny" => Some(WhisperModelSize::Tiny),
            "base" => Some(WhisperModelSize::Base),
            "small" => Some(WhisperModelSize::Small),
            "medium" => Some(WhisperModelSize::Medium),
            _ => None,
        }
    }

    /// Return the specification (metadata) for this model size.
    pub fn spec(&self) -> ModelSpec {
        match self {
            WhisperModelSize::Tiny => ModelSpec {
                display_name: "Tiny",
                filename: "ggml-tiny.bin",
                url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
                sha1: "bd577a113a864445d4c299885e0cb97d4ba92b5f",
                disk_size_mb: 75,
                ram_usage_mb: 390,
            },
            WhisperModelSize::Base => ModelSpec {
                display_name: "Base",
                filename: "ggml-base.bin",
                url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
                sha1: "465707469ff3a37a2b9b8d8f89f2f99de7299dac",
                disk_size_mb: 142,
                ram_usage_mb: 500,
            },
            WhisperModelSize::Small => ModelSpec {
                display_name: "Small",
                filename: "ggml-small.bin",
                url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
                sha1: "55356645c2b361a969dfd0ef2c5a50d530afd8d5",
                disk_size_mb: 466,
                ram_usage_mb: 1000,
            },
            WhisperModelSize::Medium => ModelSpec {
                display_name: "Medium",
                filename: "ggml-medium.bin",
                url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin",
                sha1: "fd9727b6e1217c2f614f9b698455c4ffd82463b4",
                disk_size_mb: 1500,
                ram_usage_mb: 2600,
            },
        }
    }

    /// Serde-compatible string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            WhisperModelSize::Tiny => "tiny",
            WhisperModelSize::Base => "base",
            WhisperModelSize::Small => "small",
            WhisperModelSize::Medium => "medium",
        }
    }
}

impl fmt::Display for WhisperModelSize {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

// ============================================================================
// Model Spec
// ============================================================================

/// Metadata for a specific Whisper model variant.
pub struct ModelSpec {
    pub display_name: &'static str,
    pub filename: &'static str,
    pub url: &'static str,
    pub sha1: &'static str,
    pub disk_size_mb: u32,
    pub ram_usage_mb: u32,
}

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

/// Status of a Whisper model on disk.
#[derive(Debug, Clone, Serialize)]
pub struct WhisperModelStatus {
    /// Model size identifier ("tiny", "base", "small", "medium").
    pub size: String,
    /// Human-readable display name ("Tiny", "Base", "Small", "Medium").
    pub display_name: String,
    /// Whether the model file exists on disk.
    pub downloaded: bool,
    /// Absolute path to the model file, if resolvable.
    pub model_path: Option<String>,
    /// File size in bytes, if present.
    pub model_size_bytes: Option<u64>,
    /// Human-readable model filename.
    pub model_name: String,
    /// Approximate download size in megabytes.
    pub disk_size_mb: u32,
    /// Approximate RAM usage during inference in megabytes.
    pub ram_usage_mb: u32,
    /// Whether this model is the currently active/selected model.
    pub is_active: bool,
}

/// Progress payload emitted as a Tauri event during model download.
#[derive(Debug, Clone, Serialize)]
pub struct WhisperDownloadProgress {
    /// Which model size is being downloaded.
    pub model_size: String,
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
/// Supports multiple model sizes. The active model can be changed at runtime;
/// the `WhisperContext` is loaded lazily on first use and reloaded when the
/// active model changes.
///
/// Thread-safe via `RwLock` — multiple concurrent readers are allowed, but
/// loading/unloading holds an exclusive write lock.
pub struct WhisperManager {
    /// Lazily-loaded Whisper inference context. `None` until first `ensure_loaded()`.
    context: RwLock<Option<WhisperContext>>,
    /// Path to the model file resolved at load time.
    model_path: RwLock<Option<PathBuf>>,
    /// Which model size is currently loaded in `context`. `None` if nothing loaded.
    loaded_model: RwLock<Option<WhisperModelSize>>,
    /// The user-selected model size (persisted in config DB).
    active_model: RwLock<WhisperModelSize>,
    /// Reusable HTTP client for model downloads.
    client: Client,
}

impl WhisperManager {
    /// Create a new `WhisperManager` with a specific active model.
    pub fn with_active_model(size: WhisperModelSize) -> Self {
        Self {
            context: RwLock::new(None),
            model_path: RwLock::new(None),
            loaded_model: RwLock::new(None),
            active_model: RwLock::new(size),
            client: Client::new(),
        }
    }

    // ============================================================================
    // Model Path Helpers
    // ============================================================================

    /// Return the expected on-disk path for a model file of the given size.
    ///
    /// Path: `$DATA_DIR/openforge/models/<filename>`
    fn model_file_path_for(size: WhisperModelSize) -> Option<PathBuf> {
        let spec = size.spec();
        dirs::data_dir().map(|d| d.join(APP_DIR_NAME).join(MODELS_SUBDIR).join(spec.filename))
    }

    // ============================================================================
    // Public API
    // ============================================================================

    /// Return the currently active model size.
    pub fn get_active_model(&self) -> WhisperModelSize {
        *self.active_model.read().unwrap()
    }

    /// Set the active model size. If the loaded model differs, the context is
    /// unloaded so it will be lazily reloaded on next transcription.
    pub fn set_active_model(&self, size: WhisperModelSize) {
        let mut active = self.active_model.write().unwrap();
        let previous = *active;
        *active = size;
        drop(active);

        // If the loaded model differs from the new active model, unload context.
        let loaded = self.loaded_model.read().unwrap();
        if loaded.as_ref() != Some(&size) && loaded.is_some() && previous != size {
            drop(loaded);
            let mut ctx_guard = self.context.write().unwrap();
            *ctx_guard = None;
            let mut path_guard = self.model_path.write().unwrap();
            *path_guard = None;
            let mut loaded_guard = self.loaded_model.write().unwrap();
            *loaded_guard = None;
            info!("[whisper] Unloaded model (switching from {} to {})", previous, size);
        }
    }

    /// Return the status of the currently active model.
    pub fn get_model_status(&self) -> WhisperModelStatus {
        let active = self.get_active_model();
        self.get_model_status_for(active)
    }

    /// Return the status of a specific model size.
    pub fn get_model_status_for(&self, size: WhisperModelSize) -> WhisperModelStatus {
        let spec = size.spec();
        let active = self.get_active_model();

        match Self::model_file_path_for(size) {
            None => WhisperModelStatus {
                size: size.as_str().to_string(),
                display_name: spec.display_name.to_string(),
                downloaded: false,
                model_path: None,
                model_size_bytes: None,
                model_name: spec.filename.to_string(),
                disk_size_mb: spec.disk_size_mb,
                ram_usage_mb: spec.ram_usage_mb,
                is_active: size == active,
            },
            Some(path) => {
                if path.exists() {
                    let file_size = std::fs::metadata(&path).ok().map(|m| m.len());
                    WhisperModelStatus {
                        size: size.as_str().to_string(),
                        display_name: spec.display_name.to_string(),
                        downloaded: true,
                        model_path: Some(path.to_string_lossy().to_string()),
                        model_size_bytes: file_size,
                        model_name: spec.filename.to_string(),
                        disk_size_mb: spec.disk_size_mb,
                        ram_usage_mb: spec.ram_usage_mb,
                        is_active: size == active,
                    }
                } else {
                    WhisperModelStatus {
                        size: size.as_str().to_string(),
                        display_name: spec.display_name.to_string(),
                        downloaded: false,
                        model_path: Some(path.to_string_lossy().to_string()),
                        model_size_bytes: None,
                        model_name: spec.filename.to_string(),
                        disk_size_mb: spec.disk_size_mb,
                        ram_usage_mb: spec.ram_usage_mb,
                        is_active: size == active,
                    }
                }
            }
        }
    }

    /// Return the status of all available models.
    pub fn get_all_model_statuses(&self) -> Vec<WhisperModelStatus> {
        WhisperModelSize::all()
            .iter()
            .map(|size| self.get_model_status_for(*size))
            .collect()
    }

    /// Ensure the `WhisperContext` is loaded for the active model.
    ///
    /// If the context is already loaded for the active model, this is a no-op.
    /// If a different model is loaded, it is unloaded first. On first call or
    /// after a model switch, acquires a write lock and loads from disk.
    ///
    /// # Errors
    /// - `WhisperError::ModelNotFound` if the model file does not exist.
    /// - `WhisperError::ContextLoadError` if whisper-rs fails to open the model.
    pub fn ensure_loaded(&self) -> Result<(), WhisperError> {
        let active = self.get_active_model();

        // Fast path: correct model already loaded.
        {
            let guard = self.context.read().unwrap();
            let loaded = self.loaded_model.read().unwrap();
            if guard.is_some() && *loaded == Some(active) {
                return Ok(());
            }
        }

        // Slow path: load from disk.
        let path = Self::model_file_path_for(active).ok_or(WhisperError::ModelNotFound)?;
        if !path.exists() {
            return Err(WhisperError::ModelNotFound);
        }

        let path_str = path.to_string_lossy().to_string();
        info!("[whisper] Loading model: {} ({})", active, path_str);

        let ctx = WhisperContext::new_with_params(&path_str, WhisperContextParameters::default())
            .map_err(|e| WhisperError::ContextLoadError(e.to_string()))?;

        let mut ctx_guard = self.context.write().unwrap();
        *ctx_guard = Some(ctx);

        let mut path_guard = self.model_path.write().unwrap();
        *path_guard = Some(path);

        let mut loaded_guard = self.loaded_model.write().unwrap();
        *loaded_guard = Some(active);

        info!("[whisper] Model loaded: {}", active);
        Ok(())
    }

    /// Transcribe 16 kHz mono f32 PCM audio data to text.
    ///
    /// Lazily loads the active model on first call via `ensure_loaded()`.
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
        let n_segments = state.full_n_segments();

        let mut text = String::new();
        for i in 0..n_segments {
            let segment = state
                .get_segment(i)
                .ok_or_else(|| WhisperError::InferenceError(format!("segment {} not found", i)))?;
            let segment_text = segment
                .to_str_lossy()
                .map_err(|e| WhisperError::InferenceError(format!("segment {} text: {}", i, e)))?;
            text.push_str(&segment_text);
        }

        Ok(TranscriptionResult {
            text: text.trim().to_string(),
            duration_ms,
        })
    }

    /// Download a Whisper model file with SHA1 verification.
    ///
    /// Emits `whisper-download-progress` Tauri events throughout the download.
    /// On completion, verifies the SHA1 hash and returns the path to the downloaded model.
    ///
    /// # Arguments
    /// * `app` — Tauri `AppHandle` used to emit progress events.
    /// * `size` — Which model size to download.
    ///
    /// # Returns
    /// The absolute path to the downloaded model file on success.
    ///
    /// # Errors
    /// - `WhisperError::ModelDownloadFailed` on network or I/O errors.
    /// - `WhisperError::HashMismatch` if the downloaded file's SHA1 differs from expected.
    pub async fn download_model(
        &self,
        app: AppHandle,
        size: WhisperModelSize,
    ) -> Result<String, WhisperError> {
        let spec = size.spec();

        // Determine the target path and ensure parent directories exist.
        let dest_path = Self::model_file_path_for(size).ok_or_else(|| {
            WhisperError::ModelDownloadFailed("Cannot resolve data directory".to_string())
        })?;

        if let Some(parent) = dest_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                WhisperError::ModelDownloadFailed(format!("create_dir_all failed: {}", e))
            })?;
        }

        info!(
            "[whisper] Downloading model: {} ({}) from {}",
            size, spec.filename, spec.url
        );

        // Start HTTP GET with streaming body.
        let response = self
            .client
            .get(spec.url)
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
                    model_size: size.as_str().to_string(),
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
        if actual_hash != spec.sha1 {
            let _ = std::fs::remove_file(&tmp_path);
            return Err(WhisperError::HashMismatch {
                expected: spec.sha1.to_string(),
                actual: actual_hash,
            });
        }

        std::fs::rename(&tmp_path, &dest_path).map_err(|e| {
            WhisperError::ModelDownloadFailed(format!("rename temp to dest: {}", e))
        })?;

        let path_str = dest_path.to_string_lossy().to_string();
        info!("[whisper] Model downloaded and verified: {} ({})", size, path_str);
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
    fn test_manager_with_active_model() {
        let mgr = WhisperManager::with_active_model(WhisperModelSize::Tiny);
        assert_eq!(mgr.get_active_model(), WhisperModelSize::Tiny);
    }

    #[test]
    fn test_model_sizes_all() {
        let sizes = WhisperModelSize::all();
        assert_eq!(sizes.len(), 4);
        assert_eq!(sizes[0], WhisperModelSize::Tiny);
        assert_eq!(sizes[3], WhisperModelSize::Medium);
    }

    #[test]
    fn test_model_size_from_str() {
        assert_eq!(
            WhisperModelSize::from_str("tiny"),
            Some(WhisperModelSize::Tiny)
        );
        assert_eq!(
            WhisperModelSize::from_str("Small"),
            Some(WhisperModelSize::Small)
        );
        assert_eq!(
            WhisperModelSize::from_str("MEDIUM"),
            Some(WhisperModelSize::Medium)
        );
        assert_eq!(WhisperModelSize::from_str("huge"), None);
    }

    #[test]
    fn test_model_size_as_str() {
        assert_eq!(WhisperModelSize::Tiny.as_str(), "tiny");
        assert_eq!(WhisperModelSize::Base.as_str(), "base");
        assert_eq!(WhisperModelSize::Small.as_str(), "small");
        assert_eq!(WhisperModelSize::Medium.as_str(), "medium");
    }

    #[test]
    fn test_model_size_display() {
        assert_eq!(format!("{}", WhisperModelSize::Tiny), "tiny");
        assert_eq!(format!("{}", WhisperModelSize::Medium), "medium");
    }

    #[test]
    fn test_model_spec_tiny() {
        let spec = WhisperModelSize::Tiny.spec();
        assert_eq!(spec.display_name, "Tiny");
        assert_eq!(spec.filename, "ggml-tiny.bin");
        assert_eq!(spec.disk_size_mb, 75);
    }

    #[test]
    fn test_model_spec_small() {
        let spec = WhisperModelSize::Small.spec();
        assert_eq!(spec.display_name, "Small");
        assert_eq!(spec.filename, "ggml-small.bin");
        assert_eq!(spec.sha1, "55356645c2b361a969dfd0ef2c5a50d530afd8d5");
    }

    #[test]
    fn test_model_spec_medium() {
        let spec = WhisperModelSize::Medium.spec();
        assert_eq!(spec.display_name, "Medium");
        assert_eq!(spec.filename, "ggml-medium.bin");
        assert_eq!(spec.disk_size_mb, 1500);
    }

    #[test]
    fn test_model_file_path_contains_model_name() {
        for size in WhisperModelSize::all() {
            let spec = size.spec();
            if let Some(path) = WhisperManager::model_file_path_for(*size) {
                assert!(path.to_string_lossy().contains(spec.filename));
            }
        }
    }

    #[test]
    fn test_get_model_status_returns_correct_info() {
        let mgr = WhisperManager::with_active_model(WhisperModelSize::Small);
        let status = mgr.get_model_status();
        assert_eq!(status.size, "small");
        assert_eq!(status.display_name, "Small");
        assert_eq!(status.model_name, "ggml-small.bin");
        assert!(status.is_active);
    }

    #[test]
    fn test_get_all_model_statuses() {
        let mgr = WhisperManager::with_active_model(WhisperModelSize::Small);
        let statuses = mgr.get_all_model_statuses();
        assert_eq!(statuses.len(), 4);
        assert_eq!(statuses[0].size, "tiny");
        assert_eq!(statuses[1].size, "base");
        assert_eq!(statuses[2].size, "small");
        assert_eq!(statuses[3].size, "medium");

        // Only "small" should be active (default).
        let active_count = statuses.iter().filter(|s| s.is_active).count();
        assert_eq!(active_count, 1);
        assert!(statuses[2].is_active);
    }

    #[test]
    fn test_set_active_model() {
        let mgr = WhisperManager::with_active_model(WhisperModelSize::Small);
        assert_eq!(mgr.get_active_model(), WhisperModelSize::Small);

        mgr.set_active_model(WhisperModelSize::Tiny);
        assert_eq!(mgr.get_active_model(), WhisperModelSize::Tiny);

        let status = mgr.get_model_status();
        assert_eq!(status.size, "tiny");
        assert!(status.is_active);
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
        let mgr = WhisperManager::with_active_model(WhisperModelSize::Small);
        // If the model is not on disk, ensure_loaded should return ModelNotFound.
        // (This test only passes in CI where the model is absent.)
        if WhisperManager::model_file_path_for(WhisperModelSize::Small)
            .map(|p| !p.exists())
            .unwrap_or(true)
        {
            let result = mgr.ensure_loaded();
            assert!(matches!(result, Err(WhisperError::ModelNotFound)));
        }
    }

    #[test]
    fn test_get_model_status_downloaded_when_file_exists() {
        if let Some(path) = WhisperManager::model_file_path_for(WhisperModelSize::Small) {
            // Only create a temp file if the model isn't already on disk.
            let created = if !path.exists() {
                if let Some(parent) = path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                std::fs::File::create(&path).is_ok()
            } else {
                false
            };
            let mgr = WhisperManager::with_active_model(WhisperModelSize::Small);
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
            size: "small".to_string(),
            display_name: "Small".to_string(),
            downloaded: true,
            model_path: Some("/tmp/model.bin".to_string()),
            model_size_bytes: Some(1234),
            model_name: "ggml-small.bin".to_string(),
            disk_size_mb: 466,
            ram_usage_mb: 1000,
            is_active: true,
        };
        let val = serde_json::to_value(&status).unwrap();
        assert_eq!(val["downloaded"], true);
        assert_eq!(val["model_name"], "ggml-small.bin");
        assert_eq!(val["size"], "small");
        assert_eq!(val["display_name"], "Small");
        assert_eq!(val["is_active"], true);
        assert_eq!(val["disk_size_mb"], 466);
        assert_eq!(val["ram_usage_mb"], 1000);
    }

    #[test]
    fn test_whisper_download_progress_serializes() {
        let progress = WhisperDownloadProgress {
            model_size: "tiny".to_string(),
            bytes_downloaded: 512,
            total_bytes: 1024,
            percentage: 50.0,
        };
        let val = serde_json::to_value(&progress).unwrap();
        assert_eq!(val["model_size"], "tiny");
        assert_eq!(val["bytes_downloaded"], 512);
        assert_eq!(val["total_bytes"], 1024);
        assert!((val["percentage"].as_f64().unwrap() - 50.0).abs() < 0.001);
    }

    #[test]
    fn test_model_size_serde_roundtrip() {
        let size = WhisperModelSize::Small;
        let json = serde_json::to_string(&size).unwrap();
        assert_eq!(json, "\"small\"");
        let parsed: WhisperModelSize = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, size);
    }

    #[test]
    fn test_all_model_sizes_serde() {
        for size in WhisperModelSize::all() {
            let json = serde_json::to_string(size).unwrap();
            let parsed: WhisperModelSize = serde_json::from_str(&json).unwrap();
            assert_eq!(&parsed, size);
        }
    }
}
