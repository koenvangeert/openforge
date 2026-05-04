use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AppEventEnvelope {
    #[serde(rename = "eventName")]
    pub event_name: String,
    pub payload: serde_json::Value,
}

pub type AppEventSender = tokio::sync::broadcast::Sender<AppEventEnvelope>;

pub fn publish_app_event(
    sender: &Option<AppEventSender>,
    event_name: &str,
    payload: &serde_json::Value,
) {
    if let Some(sender) = sender {
        let _ = sender.send(AppEventEnvelope {
            event_name: event_name.to_string(),
            payload: payload.clone(),
        });
    }
}
