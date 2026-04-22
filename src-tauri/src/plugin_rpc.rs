use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

static REQUEST_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Serialize)]
struct JsonRpcRequest {
    jsonrpc: &'static str,
    id: u64,
    method: String,
    params: Value,
}

#[derive(Debug, Deserialize)]
struct JsonRpcResponse {
    jsonrpc: String,
    id: Option<u64>,
    result: Option<Value>,
    error: Option<JsonRpcError>,
}

#[derive(Debug, Deserialize, Serialize)]
struct JsonRpcError {
    code: i64,
    message: String,
    data: Option<Value>,
}

#[derive(Debug)]
pub enum RpcResult {
    Success(Value),
    Error(i64, String),
}

#[derive(Debug)]
pub struct ParsedResponse {
    pub id: u64,
    pub result: RpcResult,
}

#[derive(Debug)]
pub struct RpcError(pub String);

pub fn format_request(plugin_id: &str, method: &str, params: Value) -> (u64, String) {
    let id = REQUEST_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    let request = JsonRpcRequest {
        jsonrpc: "2.0",
        id,
        method: format!("{plugin_id}.{method}"),
        params,
    };

    let raw = serde_json::to_string(&request)
        .expect("serializing JsonRpcRequest should not fail for serde_json::Value params");

    (id, raw)
}

pub fn parse_response(raw: &str) -> Result<RpcResult, RpcError> {
    Ok(parse_response_message(raw)?.result)
}

pub fn parse_response_message(raw: &str) -> Result<ParsedResponse, RpcError> {
    let response: JsonRpcResponse = serde_json::from_str(raw)
        .map_err(|error| RpcError(format!("failed to parse JSON-RPC response: {error}")))?;

    if response.jsonrpc != "2.0" {
        return Err(RpcError(format!(
            "invalid JSON-RPC version in response: {}",
            response.jsonrpc
        )));
    }

    let response_id = response
        .id
        .ok_or_else(|| RpcError("missing JSON-RPC response id".to_string()))?;

    if response.result.is_some() && response.error.is_some() {
        return Err(RpcError(format!(
            "invalid JSON-RPC response {response_id}: result and error are both present"
        )));
    }

    if let Some(result) = response.result {
        return Ok(ParsedResponse {
            id: response_id,
            result: RpcResult::Success(result),
        });
    }

    if let Some(error) = response.error {
        return Ok(ParsedResponse {
            id: response_id,
            result: RpcResult::Error(error.code, error.message),
        });
    }

    Err(RpcError(format!(
        "invalid JSON-RPC response {response_id}: missing result or error"
    )))
}

pub fn rpc_error_from_code(code: i64, message: &str) -> String {
    match code {
        -32700 => format!("parse error: {message}"),
        -32600 => format!("invalid request: {message}"),
        -32601 => format!("method not found: {message}"),
        -32602 => format!("invalid params: {message}"),
        -32603 => format!("internal error: {message}"),
        _ => format!("unknown JSON-RPC error ({code}): {message}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn format_request_creates_valid_json_rpc() {
        let (id, raw) = format_request("my-plugin", "getData", json!({"key": "value"}));
        let parsed: Value = serde_json::from_str(&raw).expect("request JSON should parse");
        assert_eq!(parsed["jsonrpc"], "2.0");
        assert_eq!(parsed["id"], id);
        assert_eq!(parsed["method"], "my-plugin.getData");
        assert_eq!(parsed["params"]["key"], "value");
    }

    #[test]
    fn parse_response_success() {
        let raw = r#"{"jsonrpc":"2.0","id":1,"result":{"data":"hello"}}"#;
        let result = parse_response(raw).expect("response should parse");
        match result {
            RpcResult::Success(val) => assert_eq!(val["data"], "hello"),
            RpcResult::Error(code, msg) => {
                panic!("Expected success, got error {}: {}", code, msg)
            }
        }
    }

    #[test]
    fn parse_response_error() {
        let raw =
            r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"Method not found"}}"#;
        let result = parse_response(raw).expect("response should parse");
        match result {
            RpcResult::Success(_) => panic!("Expected error"),
            RpcResult::Error(code, msg) => {
                assert_eq!(code, -32601);
                assert_eq!(msg, "Method not found");
            }
        }
    }

    #[test]
    fn parse_response_message_preserves_id() {
        let raw = r#"{"jsonrpc":"2.0","id":41,"result":{"ok":true}}"#;
        let parsed = parse_response_message(raw).expect("response should parse");
        assert_eq!(parsed.id, 41);
        match parsed.result {
            RpcResult::Success(value) => assert_eq!(value["ok"], true),
            RpcResult::Error(code, message) => {
                panic!("Expected success, got error {}: {}", code, message)
            }
        }
    }

    #[test]
    fn error_code_mapping() {
        assert!(rpc_error_from_code(-32601, "Method not found").contains("not found"));
        assert!(rpc_error_from_code(-32600, "Invalid request").contains("invalid"));
    }

    #[test]
    fn request_ids_are_unique() {
        let (id1, _) = format_request("p1", "m1", json!(null));
        let (id2, _) = format_request("p2", "m2", json!(null));
        assert_ne!(id1, id2);
    }
}
