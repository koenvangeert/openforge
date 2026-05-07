use super::*;
use base64::{engine::general_purpose, Engine as _};

fn payload_float32_pcm_base64(payload: &serde_json::Value) -> AppResult<Vec<f32>> {
    let encoded = payload_string(payload, "audioPcmBase64")?;
    let bytes = general_purpose::STANDARD.decode(encoded).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            format!("payload.audioPcmBase64 must be valid base64: {e}"),
        )
    })?;

    if bytes.len() % std::mem::size_of::<f32>() != 0 {
        return Err((
            StatusCode::BAD_REQUEST,
            "payload.audioPcmBase64 decoded byte length must be divisible by 4".to_string(),
        ));
    }

    Ok(bytes
        .chunks_exact(std::mem::size_of::<f32>())
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect())
}

pub(super) async fn handle_app_whisper_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> Result<Option<serde_json::Value>, (StatusCode, String)> {
    let Some(whisper) = state.whisper.as_ref() else {
        return Ok(None);
    };

    let value = match request.command.as_str() {
        "transcribe_audio" => {
            let audio_data = payload_float32_pcm_base64(&request.payload)?;
            json_value(whisper.transcribe(&audio_data).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Transcription failed: {e}"),
                )
            })?)?
        }
        "get_whisper_model_status" => json_value(whisper.get_model_status())?,
        "get_all_whisper_model_statuses" => json_value(whisper.get_all_model_statuses())?,
        "set_whisper_model" => {
            let model_size = payload_string(&request.payload, "modelSize")?;
            let size = WhisperModelSize::from_str(&model_size).ok_or_else(|| {
                (
                    StatusCode::BAD_REQUEST,
                    format!("Invalid model size: {model_size}"),
                )
            })?;
            whisper.set_active_model(size);
            let db = crate::db::acquire_db(&state.db);
            db.set_config("whisper_model_size", size.as_str())
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to save model size to config: {e}"),
                    )
                })?;
            serde_json::Value::Null
        }
        "download_whisper_model" => {
            let model_size = payload_string(&request.payload, "modelSize")?;
            let size = WhisperModelSize::from_str(&model_size).ok_or_else(|| {
                (
                    StatusCode::BAD_REQUEST,
                    format!("Invalid model size: {model_size}"),
                )
            })?;
            let app = state.app.clone();
            let event_tx = state.app_event_tx.clone();
            let path = whisper
                .download_model_with_progress(size, move |progress| {
                    if let Ok(payload) = serde_json::to_value(&progress) {
                        publish_app_event_to_runtime(
                            app.as_ref(),
                            &event_tx,
                            "whisper-download-progress",
                            &payload,
                        );
                    }
                })
                .await
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Model download failed: {e}"),
                    )
                })?;
            let db = crate::db::acquire_db(&state.db);
            db.set_config("whisper_model_path", &path).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to save model path to config: {e}"),
                )
            })?;
            serde_json::Value::Null
        }
        _ => return Ok(None),
    };

    Ok(Some(value))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn decodes_base64_little_endian_float32_pcm() {
        let payload = json!({ "audioPcmBase64": "AAAAAAAAgD4AAIC+" });

        let decoded = payload_float32_pcm_base64(&payload).expect("decode pcm payload");

        assert_eq!(decoded, vec![0.0, 0.25, -0.25]);
    }

    #[test]
    fn rejects_base64_payloads_not_aligned_to_float32_samples() {
        let payload = json!({ "audioPcmBase64": "AAA=" });

        let error = payload_float32_pcm_base64(&payload).expect_err("reject unaligned payload");

        assert_eq!(error.0, StatusCode::BAD_REQUEST);
        assert!(error
            .1
            .contains("payload.audioPcmBase64 decoded byte length must be divisible by 4"));
    }

    #[test]
    fn rejects_invalid_base64_pcm_payloads() {
        let payload = json!({ "audioPcmBase64": "not valid base64" });

        let error = payload_float32_pcm_base64(&payload).expect_err("reject invalid base64");

        assert_eq!(error.0, StatusCode::BAD_REQUEST);
        assert!(error
            .1
            .contains("payload.audioPcmBase64 must be valid base64"));
    }
}
