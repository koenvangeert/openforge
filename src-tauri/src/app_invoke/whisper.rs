use super::*;

pub(super) async fn handle_app_whisper_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> Result<Option<serde_json::Value>, (StatusCode, String)> {
    let Some(whisper) = state.whisper.as_ref() else {
        return Ok(None);
    };

    let value = match request.command.as_str() {
        "transcribe_audio" => {
            let audio_data: Vec<f32> = payload_field(&request.payload, "audioData")?;
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
                        publish_app_event(&event_tx, "whisper-download-progress", &payload);
                        if let Some(app) = app.as_ref() {
                            let _ = app.emit("whisper-download-progress", payload);
                        }
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
