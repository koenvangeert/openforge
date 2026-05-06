use super::*;
use crate::app_events::{AppEventBus, AppEventCursor};
use std::time::Duration;

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
        id: None,
        event_name: "pty-output-T-1-shell-2".to_string(),
        payload: serde_json::json!({ "data": "hi", "instance_id": 7 }),
        meta: None,
    };

    let data = serde_json::from_str::<serde_json::Value>(&app_event_sse_data(&envelope))
        .expect("sse data should be valid JSON");
    assert_eq!(data["eventName"], "pty-output-T-1-shell-2");
    assert_eq!(data["payload"]["instance_id"], 7);
}

#[tokio::test]
async fn test_app_events_keepalive_during_quiet_periods() {
    let (state, path) = test_state("app_events_keepalive");
    let _keep_sender_alive = state
        .app_event_tx
        .as_ref()
        .expect("test state should have app events")
        .clone();
    let router = create_router(state);

    let response = router
        .oneshot(
            Request::builder()
                .uri("/app/events")
                .header("authorization", "Bearer test-token")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("request should succeed");
    assert_eq!(response.status(), StatusCode::OK);

    let mut stream = response.into_body().into_data_stream();
    let chunk = tokio::time::timeout(Duration::from_secs(1), stream.next())
        .await
        .expect("keepalive should arrive promptly in tests")
        .expect("stream should yield a chunk")
        .expect("chunk should be ok");
    let text = String::from_utf8_lossy(&chunk);
    assert!(
        text.contains("openforge-event-stream-keepalive"),
        "expected keepalive text in SSE chunk, got: {text}"
    );

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_app_events_streams_bus_events_with_sse_ids() {
    let (mut state, path) = test_state("app_events_bus_sse_id");
    let bus = AppEventBus::new(16, 8);
    let publisher = bus.clone();
    state.app_event_tx = Some(bus.sender());
    state.app_event_bus = Some(bus);
    let router = create_router(state);

    let response = router
        .oneshot(
            Request::builder()
                .uri("/app/events")
                .header("authorization", "Bearer test-token")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("request should succeed");
    assert_eq!(response.status(), StatusCode::OK);

    publisher
        .tasks()
        .updated("T-1009", None)
        .expect("event should publish");

    let mut stream = response.into_body().into_data_stream();
    let chunk = tokio::time::timeout(Duration::from_secs(1), stream.next())
        .await
        .expect("event should arrive promptly")
        .expect("stream should yield a chunk")
        .expect("chunk should be ok");
    let text = String::from_utf8_lossy(&chunk);
    assert!(
        text.contains("id: "),
        "expected SSE id in chunk, got: {text}"
    );
    assert!(
        text.contains("\"eventName\":\"task-changed\""),
        "expected event envelope in chunk, got: {text}"
    );

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn test_app_events_stream_reports_gap_for_expired_last_event_id() {
    let (mut state, path) = test_state("app_events_bus_gap");
    let bus = AppEventBus::new(16, 1);
    let first = bus
        .tasks()
        .updated("T-1", None)
        .expect("first event should publish");
    bus.tasks()
        .updated("T-2", None)
        .expect("second event should publish");
    bus.tasks()
        .updated("T-3", None)
        .expect("third event should publish");
    state.app_event_tx = Some(bus.sender());
    state.app_event_bus = Some(bus);
    let router = create_router(state);

    let response = router
        .oneshot(
            Request::builder()
                .uri("/app/events")
                .header("authorization", "Bearer test-token")
                .header("last-event-id", AppEventCursor::after(first.id).as_sse_id())
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("request should succeed");
    assert_eq!(response.status(), StatusCode::OK);

    let mut stream = response.into_body().into_data_stream();
    let chunk = tokio::time::timeout(Duration::from_secs(1), stream.next())
        .await
        .expect("gap should arrive promptly")
        .expect("stream should yield a chunk")
        .expect("chunk should be ok");
    let text = String::from_utf8_lossy(&chunk);
    assert!(
        text.contains("\"eventName\":\"openforge-app-events-gap\""),
        "expected gap envelope in chunk, got: {text}"
    );
    assert!(
        text.contains("\"requestedAfter\""),
        "expected gap payload in chunk, got: {text}"
    );

    let _ = std::fs::remove_file(path);
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
