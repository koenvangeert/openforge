use axum::http::StatusCode;
use serde::de::DeserializeOwned;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AppInvokeError {
    pub(crate) status: StatusCode,
    pub(crate) message: String,
}

impl AppInvokeError {
    fn bad_request(message: String) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message,
        }
    }
}

impl From<AppInvokeError> for (StatusCode, String) {
    fn from(error: AppInvokeError) -> Self {
        (error.status, error.message)
    }
}

pub(crate) fn string(payload: &serde_json::Value, key: &str) -> Result<String, AppInvokeError> {
    payload
        .get(key)
        .and_then(|value| value.as_str())
        .map(ToString::to_string)
        .ok_or_else(|| AppInvokeError::bad_request(format!("payload.{key} must be a string")))
}

pub(crate) fn optional_string(
    payload: &serde_json::Value,
    key: &str,
) -> Result<Option<String>, AppInvokeError> {
    match payload.get(key) {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(value) => value
            .as_str()
            .map(|value| Some(value.to_string()))
            .ok_or_else(|| {
                AppInvokeError::bad_request(format!("payload.{key} must be a string or null"))
            }),
    }
}

pub(crate) fn bool(payload: &serde_json::Value, key: &str) -> Result<bool, AppInvokeError> {
    payload
        .get(key)
        .and_then(|value| value.as_bool())
        .ok_or_else(|| AppInvokeError::bad_request(format!("payload.{key} must be a boolean")))
}

pub(crate) fn field<T: DeserializeOwned>(
    payload: &serde_json::Value,
    key: &str,
) -> Result<T, AppInvokeError> {
    let value = payload
        .get(key)
        .cloned()
        .ok_or_else(|| AppInvokeError::bad_request(format!("payload.{key} is required")))?;

    serde_json::from_value(value)
        .map_err(|e| AppInvokeError::bad_request(format!("payload.{key} is invalid: {e}")))
}

pub(crate) fn i64(payload: &serde_json::Value, key: &str) -> Result<i64, AppInvokeError> {
    payload
        .get(key)
        .and_then(|value| value.as_i64())
        .ok_or_else(|| AppInvokeError::bad_request(format!("payload.{key} must be an integer")))
}

pub(crate) fn string_vec(
    payload: &serde_json::Value,
    key: &str,
) -> Result<Vec<String>, AppInvokeError> {
    let Some(value) = payload.get(key) else {
        return Err(AppInvokeError::bad_request(format!(
            "payload.{key} is required"
        )));
    };
    let Some(values) = value.as_array() else {
        return Err(AppInvokeError::bad_request(format!(
            "payload.{key} must be an array of strings"
        )));
    };

    values
        .iter()
        .map(|value| {
            value.as_str().map(ToString::to_string).ok_or_else(|| {
                AppInvokeError::bad_request(format!("payload.{key} must be an array of strings"))
            })
        })
        .collect()
}

pub(crate) fn optional_i32(
    payload: &serde_json::Value,
    key: &str,
) -> Result<Option<i32>, AppInvokeError> {
    match payload.get(key) {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(value) => {
            let Some(value) = value.as_i64() else {
                return Err(AppInvokeError::bad_request(format!(
                    "payload.{key} must be an integer or null"
                )));
            };
            i32::try_from(value)
                .map(Some)
                .map_err(|_| AppInvokeError::bad_request(format!("payload.{key} must fit in i32")))
        }
    }
}

pub(crate) fn optional_usize(
    payload: &serde_json::Value,
    key: &str,
) -> Result<Option<usize>, AppInvokeError> {
    match payload.get(key) {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(value) => {
            let Some(value) = value.as_u64() else {
                return Err(AppInvokeError::bad_request(format!(
                    "payload.{key} must be an unsigned integer or null"
                )));
            };
            usize::try_from(value).map(Some).map_err(|_| {
                AppInvokeError::bad_request(format!("payload.{key} must fit in usize"))
            })
        }
    }
}
