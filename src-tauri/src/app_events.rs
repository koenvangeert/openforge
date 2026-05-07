use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock, Weak};

const APP_EVENT_SCHEMA_VERSION: u16 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppEventId {
    pub epoch: String,
    pub seq: u64,
}

impl AppEventId {
    pub fn as_sse_id(&self) -> String {
        format!("{}:{}", self.epoch, self.seq)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppEventCursor {
    pub epoch: String,
    pub seq: u64,
}

impl AppEventCursor {
    #[allow(dead_code)]
    pub fn after(id: AppEventId) -> Self {
        Self {
            epoch: id.epoch,
            seq: id.seq,
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        let (epoch, seq) = value.rsplit_once(':')?;
        let seq = seq.parse::<u64>().ok()?;
        if epoch.is_empty() {
            return None;
        }
        Some(Self {
            epoch: epoch.to_string(),
            seq,
        })
    }

    pub fn as_sse_id(&self) -> String {
        format!("{}:{}", self.epoch, self.seq)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum DeliveryClass {
    RealtimeLossy,
    StateInvalidation,
    UserNotification,
    Lifecycle,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppEventMeta {
    pub sequence: u64,
    #[serde(rename = "emittedAtMs")]
    pub emitted_at_ms: u64,
    #[serde(rename = "orderingKey", skip_serializing_if = "Option::is_none")]
    pub ordering_key: Option<String>,
    pub delivery: DeliveryClass,
    #[serde(rename = "schemaVersion")]
    pub schema_version: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AppEventEnvelope {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<AppEventId>,
    #[serde(rename = "eventName")]
    pub event_name: String,
    pub payload: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<AppEventMeta>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppEventGap {
    pub requested_after: AppEventCursor,
    pub oldest_available: AppEventCursor,
    pub newest_available: AppEventCursor,
}

impl AppEventGap {
    pub fn event_name() -> &'static str {
        "openforge-app-events-gap"
    }

    pub fn into_envelope(self) -> AppEventEnvelope {
        AppEventEnvelope {
            id: Some(AppEventId {
                epoch: self.newest_available.epoch.clone(),
                seq: self.newest_available.seq,
            }),
            event_name: Self::event_name().to_string(),
            payload: serde_json::json!({
                "requestedAfter": self.requested_after.as_sse_id(),
                "oldestAvailable": self.oldest_available.as_sse_id(),
                "newestAvailable": self.newest_available.as_sse_id(),
            }),
            meta: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum AppEventFrame {
    Event(AppEventEnvelope),
    Gap(AppEventGap),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmitReceipt {
    pub id: AppEventId,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppEventError {
    BusClosed,
}

#[derive(Debug, Clone)]
pub struct AppEvent {
    event_name: String,
    payload: serde_json::Value,
    delivery: DeliveryClass,
    ordering_key: Option<String>,
}

/// Adapter Interface at the Seam where Rust runtime lifecycle notifications become AppEventBus envelopes.
///
/// This Module keeps launch lifecycle producers from needing to know the AppEventBus
/// Implementation while still giving Electron/Svelte durable, replayable envelopes.
pub trait RustAppEventAdapter: Send + Sync {
    fn emit(
        &self,
        event_name: &str,
        payload: serde_json::Value,
    ) -> Result<EmitReceipt, AppEventError>;
}

#[derive(Clone)]
pub struct InMemoryAppEventAdapter {
    bus: AppEventBus,
}

impl InMemoryAppEventAdapter {
    pub fn new(bus: AppEventBus) -> Self {
        Self { bus }
    }
}

impl RustAppEventAdapter for InMemoryAppEventAdapter {
    fn emit(
        &self,
        event_name: &str,
        payload: serde_json::Value,
    ) -> Result<EmitReceipt, AppEventError> {
        let delivery = legacy_delivery_class(event_name);
        let ordering_key = legacy_ordering_key(event_name, &payload);
        self.bus
            .try_emit(AppEvent::new(event_name, payload, delivery, ordering_key))
    }
}

impl AppEvent {
    pub fn new(
        event_name: impl Into<String>,
        payload: serde_json::Value,
        delivery: DeliveryClass,
        ordering_key: Option<String>,
    ) -> Self {
        Self {
            event_name: event_name.into(),
            payload,
            delivery,
            ordering_key,
        }
    }
}

struct AppEventBusInner {
    sender: tokio::sync::broadcast::Sender<AppEventEnvelope>,
    replay: Mutex<VecDeque<AppEventEnvelope>>,
    replay_capacity: usize,
    sequence: AtomicU64,
    epoch: String,
}

#[derive(Clone)]
pub struct AppEventBus {
    inner: Arc<AppEventBusInner>,
}

impl AppEventBus {
    pub fn new(channel_capacity: usize, replay_capacity: usize) -> Self {
        let (sender, _) = tokio::sync::broadcast::channel(channel_capacity);
        let bus = Self {
            inner: Arc::new(AppEventBusInner {
                sender,
                replay: Mutex::new(VecDeque::with_capacity(replay_capacity)),
                replay_capacity,
                sequence: AtomicU64::new(0),
                epoch: uuid::Uuid::new_v4().to_string(),
            }),
        };
        register_bus_sender(&bus);
        bus
    }

    pub fn sender(&self) -> AppEventSender {
        self.inner.sender.clone()
    }

    pub fn tasks(&self) -> TaskEvents {
        TaskEvents { bus: self.clone() }
    }

    #[allow(dead_code)]
    pub fn github(&self) -> GithubEvents {
        GithubEvents { bus: self.clone() }
    }

    pub fn try_emit<E>(&self, event: E) -> Result<EmitReceipt, AppEventError>
    where
        E: Into<AppEvent>,
    {
        let event = event.into();
        let seq = self.inner.sequence.fetch_add(1, Ordering::SeqCst) + 1;
        let id = AppEventId {
            epoch: self.inner.epoch.clone(),
            seq,
        };
        let envelope = AppEventEnvelope {
            id: Some(id.clone()),
            event_name: event.event_name,
            payload: event.payload,
            meta: Some(AppEventMeta {
                sequence: seq,
                emitted_at_ms: now_ms(),
                ordering_key: event.ordering_key,
                delivery: event.delivery,
                schema_version: APP_EVENT_SCHEMA_VERSION,
            }),
        };

        if self.inner.replay_capacity > 0 {
            if let Ok(mut replay) = self.inner.replay.lock() {
                replay.push_back(envelope.clone());
                while replay.len() > self.inner.replay_capacity {
                    replay.pop_front();
                }
            }
        }

        self.inner
            .sender
            .send(envelope)
            .map(|_| EmitReceipt { id: id.clone() })
            .or_else(|error| {
                // No active subscribers is not a publish failure; the replay ring still records the event.
                if error.0.id.as_ref() == Some(&id) {
                    Ok(EmitReceipt { id })
                } else {
                    Err(AppEventError::BusClosed)
                }
            })
    }

    pub fn subscribe(
        &self,
        cursor: Option<AppEventCursor>,
    ) -> Result<AppEventSubscription, AppEventError> {
        let receiver = self.inner.sender.subscribe();
        let mut queued = VecDeque::new();

        let replay = self
            .inner
            .replay
            .lock()
            .map_err(|_| AppEventError::BusClosed)?;
        let oldest = replay.front().and_then(envelope_cursor);
        let newest = replay.back().and_then(envelope_cursor);

        if let Some(cursor) = cursor {
            if let (Some(oldest), Some(newest)) = (oldest, newest) {
                if cursor.epoch != newest.epoch || cursor.seq + 1 < oldest.seq {
                    queued.push_back(AppEventFrame::Gap(AppEventGap {
                        requested_after: cursor,
                        oldest_available: oldest,
                        newest_available: newest,
                    }));
                } else {
                    for envelope in replay.iter() {
                        if envelope
                            .id
                            .as_ref()
                            .map(|id| id.epoch == cursor.epoch && id.seq > cursor.seq)
                            .unwrap_or(false)
                        {
                            queued.push_back(AppEventFrame::Event(envelope.clone()));
                        }
                    }
                }
            }
        } else {
            queued.extend(
                replay
                    .iter()
                    .filter(|envelope| {
                        envelope
                            .meta
                            .as_ref()
                            .map(|meta| meta.delivery == DeliveryClass::Lifecycle)
                            .unwrap_or(false)
                    })
                    .cloned()
                    .map(AppEventFrame::Event),
            );
        }
        drop(replay);

        let last_delivered = queued
            .iter()
            .filter_map(frame_cursor)
            .max_by_key(|cursor| cursor.seq);

        Ok(AppEventSubscription {
            inner: Arc::clone(&self.inner),
            queued,
            receiver,
            last_delivered,
        })
    }
}

pub struct AppEventSubscription {
    inner: Arc<AppEventBusInner>,
    queued: VecDeque<AppEventFrame>,
    receiver: tokio::sync::broadcast::Receiver<AppEventEnvelope>,
    last_delivered: Option<AppEventCursor>,
}

impl AppEventSubscription {
    pub async fn recv(&mut self) -> Option<AppEventFrame> {
        if let Some(frame) = self.queued.pop_front() {
            self.note_delivered(&frame);
            return Some(frame);
        }

        loop {
            match self.receiver.recv().await {
                Ok(envelope) => {
                    if self.already_delivered(&envelope) {
                        continue;
                    }
                    let frame = AppEventFrame::Event(envelope);
                    self.note_delivered(&frame);
                    return Some(frame);
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    if let Some(gap) = self.current_gap() {
                        let frame = AppEventFrame::Gap(gap);
                        self.note_delivered(&frame);
                        return Some(frame);
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => return None,
            }
        }
    }

    fn already_delivered(&self, envelope: &AppEventEnvelope) -> bool {
        let Some(cursor) = envelope_cursor(envelope) else {
            return false;
        };
        self.last_delivered
            .as_ref()
            .map(|last| last.epoch == cursor.epoch && cursor.seq <= last.seq)
            .unwrap_or(false)
    }

    fn note_delivered(&mut self, frame: &AppEventFrame) {
        if let Some(cursor) = frame_cursor(frame) {
            let should_update = self
                .last_delivered
                .as_ref()
                .map(|last| last.epoch != cursor.epoch || cursor.seq > last.seq)
                .unwrap_or(true);
            if should_update {
                self.last_delivered = Some(cursor);
            }
        }
    }

    fn current_gap(&self) -> Option<AppEventGap> {
        let replay = self.inner.replay.lock().ok()?;
        let oldest = replay.front().and_then(envelope_cursor)?;
        let newest = replay.back().and_then(envelope_cursor)?;
        let requested_after = self
            .last_delivered
            .clone()
            .unwrap_or_else(|| AppEventCursor {
                epoch: newest.epoch.clone(),
                seq: 0,
            });
        Some(AppEventGap {
            requested_after,
            oldest_available: oldest,
            newest_available: newest,
        })
    }
}

#[derive(Clone)]
pub struct TaskEvents {
    bus: AppEventBus,
}

impl TaskEvents {
    pub fn created(
        &self,
        task_id: &str,
        project_id: Option<&str>,
    ) -> Result<EmitReceipt, AppEventError> {
        self.changed("created", task_id, project_id)
    }

    pub fn updated(
        &self,
        task_id: &str,
        project_id: Option<&str>,
    ) -> Result<EmitReceipt, AppEventError> {
        self.changed("updated", task_id, project_id)
    }

    fn changed(
        &self,
        action: &str,
        task_id: &str,
        project_id: Option<&str>,
    ) -> Result<EmitReceipt, AppEventError> {
        let mut payload = serde_json::json!({
            "action": action,
            "task_id": task_id,
        });
        if let Some(project_id) = project_id {
            payload["project_id"] = serde_json::json!(project_id);
        }
        self.bus.try_emit(AppEvent::new(
            "task-changed",
            payload,
            DeliveryClass::StateInvalidation,
            Some(format!("task:{task_id}")),
        ))
    }
}

#[allow(dead_code)]
#[derive(Clone)]
pub struct GithubEvents {
    bus: AppEventBus,
}

#[allow(dead_code)]
impl GithubEvents {
    pub fn sync_complete(&self, result: &serde_json::Value) -> Result<EmitReceipt, AppEventError> {
        self.bus.try_emit(AppEvent::new(
            "github-sync-complete",
            result.clone(),
            DeliveryClass::StateInvalidation,
            Some("github".to_string()),
        ))
    }

    pub fn rate_limited(&self, reset_at: Option<i64>) -> Result<EmitReceipt, AppEventError> {
        self.bus.try_emit(AppEvent::new(
            "github-rate-limited",
            serde_json::json!({ "reset_at": reset_at }),
            DeliveryClass::UserNotification,
            Some("github".to_string()),
        ))
    }
}

fn register_bus_sender(bus: &AppEventBus) {
    if let Ok(mut registry) = bus_registry().lock() {
        registry.retain(|registered| registered.upgrade().is_some());
        registry.push(Arc::downgrade(&bus.inner));
    }
}

fn bus_registry() -> &'static Mutex<Vec<Weak<AppEventBusInner>>> {
    static REGISTRY: OnceLock<Mutex<Vec<Weak<AppEventBusInner>>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(Vec::new()))
}

fn bus_for_sender(sender: &AppEventSender) -> Option<AppEventBus> {
    let mut registry = bus_registry().lock().ok()?;
    registry.retain(|registered| registered.upgrade().is_some());
    registry.iter().filter_map(Weak::upgrade).find_map(|inner| {
        if inner.sender.same_channel(sender) {
            Some(AppEventBus { inner })
        } else {
            None
        }
    })
}

fn legacy_delivery_class(event_name: &str) -> DeliveryClass {
    if event_name.starts_with("pty-output-") {
        DeliveryClass::RealtimeLossy
    } else if event_name.starts_with("pty-exit-")
        || event_name.starts_with("plugin:")
        || matches!(event_name, "server-resumed" | "startup-resume-complete")
    {
        DeliveryClass::Lifecycle
    } else if matches!(
        event_name,
        "new-pr-comment" | "implementation-failed" | "github-rate-limited"
    ) {
        DeliveryClass::UserNotification
    } else {
        DeliveryClass::StateInvalidation
    }
}

fn legacy_ordering_key(event_name: &str, payload: &serde_json::Value) -> Option<String> {
    if let Some(session_key) = event_name
        .strip_prefix("pty-output-")
        .or_else(|| event_name.strip_prefix("pty-exit-"))
    {
        return Some(format!("pty:{session_key}"));
    }
    if matches!(event_name, "server-resumed" | "startup-resume-complete") {
        return Some(format!("lifecycle:{event_name}"));
    }
    payload
        .get("task_id")
        .and_then(|value| value.as_str())
        .map(|task_id| format!("task:{task_id}"))
        .or_else(|| {
            payload
                .get("ticket_id")
                .and_then(|value| value.as_str())
                .map(|task_id| format!("task:{task_id}"))
        })
}

fn envelope_cursor(envelope: &AppEventEnvelope) -> Option<AppEventCursor> {
    envelope.id.as_ref().map(|id| AppEventCursor {
        epoch: id.epoch.clone(),
        seq: id.seq,
    })
}

fn frame_cursor(frame: &AppEventFrame) -> Option<AppEventCursor> {
    match frame {
        AppEventFrame::Event(envelope) => envelope_cursor(envelope),
        AppEventFrame::Gap(gap) => Some(gap.newest_available.clone()),
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub type AppEventSender = tokio::sync::broadcast::Sender<AppEventEnvelope>;

pub fn publish_app_event(
    sender: &Option<AppEventSender>,
    event_name: &str,
    payload: &serde_json::Value,
) {
    if let Some(sender) = sender {
        if let Some(bus) = bus_for_sender(sender) {
            let _ = bus.try_emit(AppEvent::new(
                event_name,
                payload.clone(),
                legacy_delivery_class(event_name),
                legacy_ordering_key(event_name, payload),
            ));
            return;
        }

        let _ = sender.send(AppEventEnvelope {
            id: None,
            event_name: event_name.to_string(),
            payload: payload.clone(),
            meta: None,
        });
    }
}

pub fn publish_app_event_to_runtime(
    app: Option<&crate::backend_runtime::AppHandle>,
    sender: &Option<AppEventSender>,
    event_name: &str,
    payload: &serde_json::Value,
) {
    if let Some(app) = app {
        if app.has_app_event_adapter() && app.emit(event_name, payload.clone()).is_ok() {
            return;
        }
    }
    publish_app_event(sender, event_name, payload);
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

    #[tokio::test]
    async fn test_publish_app_event_uses_bus_metadata_when_sender_belongs_to_bus() {
        let bus = AppEventBus::new(16, 8);
        let mut subscription = bus.subscribe(None).expect("subscribe should work");
        let sender = bus.sender();

        publish_app_event(
            &Some(sender),
            "agent-status-changed",
            &serde_json::json!({ "task_id": "T-1", "status": "running" }),
        );

        let AppEventFrame::Event(received) =
            subscription.recv().await.expect("event should arrive")
        else {
            panic!("expected event frame");
        };
        assert_eq!(received.event_name, "agent-status-changed");
        assert_eq!(received.id.as_ref().expect("id should be present").seq, 1);
        assert_eq!(
            received
                .meta
                .as_ref()
                .expect("meta should be present")
                .ordering_key
                .as_deref(),
            Some("task:T-1")
        );
    }

    #[tokio::test]
    async fn test_app_event_bus_assigns_sequence_metadata_and_preserves_legacy_shape() {
        let bus = AppEventBus::new(16, 8);
        let mut subscription = bus.subscribe(None).expect("subscribe should work");

        let receipt = bus
            .tasks()
            .updated("T-1009", Some("P-4"))
            .expect("event should publish");

        let AppEventFrame::Event(received) =
            subscription.recv().await.expect("event should arrive")
        else {
            panic!("expected event frame");
        };

        assert_eq!(receipt.id.seq, 1);
        assert_eq!(received.event_name, "task-changed");
        assert_eq!(received.payload["action"], "updated");
        assert_eq!(received.payload["task_id"], "T-1009");
        assert_eq!(received.payload["project_id"], "P-4");
        assert_eq!(received.id.as_ref().expect("id should be present").seq, 1);
        let meta = received.meta.as_ref().expect("meta should be present");
        assert_eq!(meta.sequence, 1);
        assert_eq!(meta.ordering_key.as_deref(), Some("task:T-1009"));
        assert_eq!(meta.delivery, DeliveryClass::StateInvalidation);
    }

    #[tokio::test]
    async fn test_app_handle_emit_through_in_memory_adapter_is_replayed_to_late_subscribers() {
        let bus = AppEventBus::new(16, 8);
        let app = crate::backend_runtime::AppHandle::new();
        app.set_app_event_adapter(std::sync::Arc::new(InMemoryAppEventAdapter::new(
            bus.clone(),
        )));

        app.emit(
            "pty-output-T-boot-shell-0",
            serde_json::json!({ "data": "stale boot output" }),
        )
        .expect("non-lifecycle event should publish through adapter");

        app.emit(
            "server-resumed",
            serde_json::json!({
                "task_id": "T-boot",
                "port": 17642,
                "workspace_path": "/tmp/openforge/T-boot"
            }),
        )
        .expect("app handle emit should publish through adapter");

        let mut subscription = bus.subscribe(None).expect("subscribe should work");
        let AppEventFrame::Event(received) = subscription
            .recv()
            .await
            .expect("boot-time event should replay to late subscribers")
        else {
            panic!("expected replayed lifecycle event");
        };

        assert_eq!(received.event_name, "server-resumed");
        assert_eq!(received.payload["task_id"], "T-boot");
        assert_eq!(received.id.as_ref().expect("id should be assigned").seq, 2);
        let meta = received.meta.as_ref().expect("meta should be assigned");
        assert_eq!(meta.delivery, DeliveryClass::Lifecycle);
        assert_eq!(
            meta.ordering_key.as_deref(),
            Some("lifecycle:server-resumed")
        );
    }

    #[tokio::test]
    async fn test_app_event_bus_replays_events_after_cursor() {
        let bus = AppEventBus::new(16, 8);
        let first = bus
            .github()
            .sync_complete(&serde_json::json!({ "new_comments": 1 }))
            .expect("first event should publish");
        bus.github()
            .rate_limited(Some(123))
            .expect("second event should publish");

        let mut subscription = bus
            .subscribe(Some(AppEventCursor::after(first.id.clone())))
            .expect("subscribe after cursor should work");

        let AppEventFrame::Event(received) = subscription
            .recv()
            .await
            .expect("replayed event should arrive")
        else {
            panic!("expected event frame");
        };
        assert_eq!(received.event_name, "github-rate-limited");
        assert_eq!(received.id.as_ref().expect("id should be present").seq, 2);
    }

    #[tokio::test]
    async fn test_app_event_bus_skips_live_duplicates_after_replay() {
        let bus = AppEventBus::new(16, 8);
        let first = bus
            .tasks()
            .updated("T-1", None)
            .expect("first event should publish");
        bus.tasks()
            .updated("T-2", None)
            .expect("second event should publish");

        let mut subscription = bus
            .subscribe(Some(AppEventCursor::after(first.id.clone())))
            .expect("subscribe after cursor should work");

        let AppEventFrame::Event(replayed) = subscription
            .recv()
            .await
            .expect("replayed event should arrive")
        else {
            panic!("expected replayed event frame");
        };
        bus.sender()
            .send(replayed)
            .expect("test duplicate should publish to live receiver");
        bus.tasks()
            .updated("T-3", None)
            .expect("third event should publish");

        let AppEventFrame::Event(received) = subscription
            .recv()
            .await
            .expect("next unique event should arrive")
        else {
            panic!("expected unique event frame");
        };
        assert_eq!(received.payload["task_id"], "T-3");
    }

    #[tokio::test]
    async fn test_app_event_bus_reports_gap_when_live_subscriber_lags() {
        let bus = AppEventBus::new(1, 8);
        let mut subscription = bus.subscribe(None).expect("subscribe should work");
        bus.tasks()
            .updated("T-1", None)
            .expect("first event should publish");
        bus.tasks()
            .updated("T-2", None)
            .expect("second event should publish");
        bus.tasks()
            .updated("T-3", None)
            .expect("third event should publish");

        let AppEventFrame::Gap(gap) = subscription.recv().await.expect("lag gap should arrive")
        else {
            panic!("expected gap frame");
        };
        assert_eq!(gap.oldest_available.seq, 1);
        assert_eq!(gap.newest_available.seq, 3);
    }

    #[tokio::test]
    async fn test_app_event_bus_reports_gap_when_cursor_is_older_than_replay() {
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

        let mut subscription = bus
            .subscribe(Some(AppEventCursor::after(first.id.clone())))
            .expect("subscribe after expired cursor should still return a gap frame");

        let AppEventFrame::Gap(gap) = subscription.recv().await.expect("gap should arrive") else {
            panic!("expected gap frame");
        };
        assert_eq!(gap.requested_after.seq, 1);
        assert_eq!(gap.oldest_available.seq, 3);
        assert_eq!(gap.newest_available.seq, 3);
    }
}
