use super::*;

#[tokio::test]
async fn sidecar_runtime_shutdown_cleanup_is_safe_and_idempotent_without_live_children() {
    let (state, _path) = test_state("sidecar_runtime_shutdown_cleanup_empty");

    shutdown_sidecar_runtime(&state).await;
    shutdown_sidecar_runtime(&state).await;
}
