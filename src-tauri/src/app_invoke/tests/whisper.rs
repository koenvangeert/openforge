use super::*;

#[tokio::test]
async fn handles_model_status_selection_and_transcription_errors() {
    let (state, path) = test_state("app_invoke_whisper_status_selection");

    let statuses = invoke_ok(
        &state,
        "get_all_whisper_model_statuses",
        serde_json::Value::Null,
    )
    .await;
    let statuses = statuses.as_array().expect("whisper statuses");
    assert_eq!(statuses.len(), 5);
    assert!(statuses
        .iter()
        .any(|status| status["size"] == "small" && status["is_active"] == true));

    invoke_ok(&state, "set_whisper_model", json!({ "modelSize": "tiny" })).await;
    let active_status =
        invoke_ok(&state, "get_whisper_model_status", serde_json::Value::Null).await;
    assert_eq!(active_status["size"], "tiny");

    let err = invoke(
        &state,
        "transcribe_audio",
        json!({ "audioPcmBase64": "AAAAAM3MzD3Nzcy9" }),
    )
    .await
    .expect_err("missing local model should fail transcription");
    assert_eq!(err.0, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(err.1.contains("Transcription failed"));

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn accepts_compact_voice_transcription_payloads() {
    let (state, path) = test_state("app_invoke_compact_voice_transcription_payload");
    let samples = 120_000;
    let raw_pcm_bytes = vec![0_u8; samples * 4];
    let audio_pcm_base64 =
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, raw_pcm_bytes);
    let json_number_array_len = r#"{"command":"transcribe_audio","payload":{"audioData":[]}}"#
        .len()
        + samples * "-0.12345678901234568,".len();
    assert!(
        audio_pcm_base64.len() * 2 < json_number_array_len,
        "base64 PCM payload should be materially smaller than decimal JSON samples"
    );

    let err = invoke(
        &state,
        "transcribe_audio",
        json!({ "audioPcmBase64": audio_pcm_base64 }),
    )
    .await
    .expect_err("missing local model should fail transcription");
    assert_eq!(err.0, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(err.1.contains("Transcription failed"));

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn rejects_bad_transcription_payloads_as_bad_request() {
    let (state, path) = test_state("app_invoke_rejects_bad_whisper_payload");

    let malformed = invoke(&state, "transcribe_audio", serde_json::Value::Null)
        .await
        .expect_err("null transcription payload should be rejected");
    assert_eq!(malformed.0, StatusCode::BAD_REQUEST);

    let unaligned = invoke(
        &state,
        "transcribe_audio",
        json!({ "audioPcmBase64": "AAA=" }),
    )
    .await
    .expect_err("unaligned pcm payload should be rejected");
    assert_eq!(unaligned.0, StatusCode::BAD_REQUEST);
    assert!(unaligned
        .1
        .contains("payload.audioPcmBase64 decoded byte length must be divisible by 4"));

    let _ = std::fs::remove_file(path);
}
