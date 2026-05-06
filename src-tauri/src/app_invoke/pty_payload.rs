use super::AppResult;
use axum::http::StatusCode;
use serde::de::DeserializeOwned;
use serde::Deserialize;

fn decode_payload<T: DeserializeOwned>(command: &str, payload: &serde_json::Value) -> AppResult<T> {
    serde_json::from_value(payload.clone()).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            format!("payload for {command} is invalid: {e}"),
        )
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct PtySpawnPayload {
    pub(super) task_id: String,
    pub(super) server_port: u16,
    pub(super) opencode_session_id: String,
    pub(super) cols: u16,
    pub(super) rows: u16,
}

impl PtySpawnPayload {
    pub(super) fn decode(command: &str, payload: &serde_json::Value) -> AppResult<Self> {
        decode_payload(command, payload)
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct PtySpawnShellPayload {
    pub(super) task_id: String,
    pub(super) cwd: String,
    pub(super) cols: u16,
    pub(super) rows: u16,
    pub(super) terminal_index: Option<u32>,
}

impl PtySpawnShellPayload {
    pub(super) fn decode(command: &str, payload: &serde_json::Value) -> AppResult<Self> {
        decode_payload(command, payload)
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct PtyWritePayload {
    pub(super) task_id: String,
    pub(super) data: String,
}

impl PtyWritePayload {
    pub(super) fn decode(command: &str, payload: &serde_json::Value) -> AppResult<Self> {
        decode_payload(command, payload)
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct PtyResizePayload {
    pub(super) task_id: String,
    pub(super) cols: u16,
    pub(super) rows: u16,
}

impl PtyResizePayload {
    pub(super) fn decode(command: &str, payload: &serde_json::Value) -> AppResult<Self> {
        decode_payload(command, payload)
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct PtyTaskPayload {
    pub(super) task_id: String,
}

impl PtyTaskPayload {
    pub(super) fn decode(command: &str, payload: &serde_json::Value) -> AppResult<Self> {
        decode_payload(command, payload)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::StatusCode;
    use serde::Deserialize;

    #[derive(Debug, Deserialize)]
    struct PtyPayloadContracts {
        valid: Vec<PtyPayloadCase>,
        invalid: Vec<PtyPayloadCase>,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct PtyPayloadCase {
        name: String,
        command: String,
        payload: serde_json::Value,
        error_contains: Option<String>,
    }

    fn contracts() -> PtyPayloadContracts {
        serde_json::from_str(include_str!("tests/fixtures/pty_payload_contracts.json"))
            .expect("PTY payload contract fixtures should be valid JSON")
    }

    fn decode_case(command: &str, payload: &serde_json::Value) -> Result<(), (StatusCode, String)> {
        match command {
            "pty_spawn" => PtySpawnPayload::decode(command, payload).map(|_| ()),
            "pty_spawn_shell" => PtySpawnShellPayload::decode(command, payload).map(|_| ()),
            "pty_write" => PtyWritePayload::decode(command, payload).map(|_| ()),
            "pty_resize" => PtyResizePayload::decode(command, payload).map(|_| ()),
            "pty_kill" | "pty_kill_shells_for_task" | "get_pty_buffer" => {
                PtyTaskPayload::decode(command, payload).map(|_| ())
            }
            other => panic!("unsupported PTY fixture command {other}"),
        }
    }

    #[test]
    fn decodes_shared_valid_pty_payload_contract_fixtures() {
        for case in contracts().valid {
            decode_case(&case.command, &case.payload)
                .unwrap_or_else(|error| panic!("{} should decode: {error:?}", case.name));
        }
    }

    #[test]
    fn rejects_shared_invalid_pty_payload_contract_fixtures() {
        for case in contracts().invalid {
            let error = decode_case(&case.command, &case.payload)
                .expect_err("invalid PTY payload fixture should be rejected");
            assert_eq!(error.0, StatusCode::BAD_REQUEST, "{}", case.name);
            let expected = case
                .error_contains
                .as_deref()
                .expect("invalid fixture should declare expected error text");
            assert!(
                error.1.contains(expected),
                "{} expected error containing {expected:?}, got {:?}",
                case.name,
                error.1
            );
        }
    }

    #[test]
    fn preserves_optional_terminal_index_null_as_none() {
        let payload = serde_json::json!({
            "taskId": "T-pty",
            "cwd": "/tmp/openforge-worktree",
            "cols": 80,
            "rows": 24,
            "terminalIndex": null,
        });

        let decoded = PtySpawnShellPayload::decode("pty_spawn_shell", &payload)
            .expect("null terminalIndex should decode");

        assert_eq!(decoded.terminal_index, None);
    }
}
