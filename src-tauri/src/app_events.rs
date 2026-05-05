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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_publish_app_event_fans_out_to_app_event_stream_sender() {
        let (sender, mut receiver) = tokio::sync::broadcast::channel(16);
        let payload = serde_json::json!({ "instance_id": 42 });

        publish_app_event(&Some(sender), "pty-exit-T-1-shell-2", &payload);

        let received = receiver.try_recv().expect("event should be published");
        assert_eq!(received.event_name, "pty-exit-T-1-shell-2");
        assert_eq!(received.payload["instance_id"], 42);
    }
}
