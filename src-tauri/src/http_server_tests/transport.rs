use super::*;

#[test]
fn test_resolve_http_server_port_prefers_electron_sidecar_env() {
    assert_eq!(
        resolve_http_server_port(Some("17642".to_string()), Some("17422".to_string())),
        17642
    );
    assert_eq!(
        resolve_http_server_port(None, Some("17422".to_string())),
        17422
    );
    assert_eq!(
        resolve_http_server_port(Some("not-a-port".to_string()), None),
        17422
    );
}

#[test]
fn test_app_event_sse_data_uses_openforge_event_envelope_shape() {
    let envelope = AppEventEnvelope {
        event_name: "pty-output-T-1-shell-2".to_string(),
        payload: serde_json::json!({ "data": "hi", "instance_id": 7 }),
    };

    let data = serde_json::from_str::<serde_json::Value>(&app_event_sse_data(&envelope))
        .expect("sse data should be valid JSON");
    assert_eq!(data["eventName"], "pty-output-T-1-shell-2");
    assert_eq!(data["payload"]["instance_id"], 7);
}

#[tokio::test]
async fn test_app_events_requires_backend_token() {
    let (state, path) = test_state("app_events_requires_token");
    let router = create_router(state);

    let unauthorized = router
        .oneshot(
            Request::builder()
                .uri("/app/events")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("request should succeed");
    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_app_health_requires_backend_token() {
    let (state, path) = test_state("app_health_requires_token");
    let router = create_router(state);

    let unauthorized = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/app/health")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("request should succeed");
    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

    let authorized = router
        .oneshot(
            Request::builder()
                .uri("/app/health")
                .header("authorization", "Bearer test-token")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("request should succeed");
    assert_eq!(authorized.status(), StatusCode::OK);
    assert_eq!(response_body_json(authorized).await["status"], "ok");

    let _ = std::fs::remove_file(path);
}
