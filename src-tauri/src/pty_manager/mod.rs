mod commands;
mod events;
mod pids;
mod session;

use std::collections::HashMap;
use std::fmt;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

#[cfg(test)]
use commands::resolve_shell_path;
#[cfg(test)]
pub(crate) use commands::{build_claude_args, build_pi_args, get_shell_path};
#[cfg(test)]
use events::{
    finalize_pty_exit, find_utf8_boundary, read_pty_output_loop, spawn_batched_pty_event_emitter,
    PtyEventEmitterConfig, PtyExitAction, PtyOutputBatcher, RingBuffer, CLAUDE_BUFFER_CAPACITY,
};
#[cfg(test)]
use pids::{shell_pid_file_name, shell_session_key};
#[cfg(test)]
use session::{frozen_seconds, PtySession, NEXT_INSTANCE_ID};
use session::{LastOutputTimes, PtyOutputBuffers, PtySessions};

// ============================================================================
// Error Types
// ============================================================================

#[derive(Debug)]
pub enum PtyError {
    SpawnFailed(String),
    ProcessNotFound(String),
    IoError(std::io::Error),
    WriteFailed(String),
}

impl fmt::Display for PtyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PtyError::SpawnFailed(msg) => write!(f, "Failed to spawn PTY: {}", msg),
            PtyError::ProcessNotFound(task_id) => {
                write!(f, "No PTY process found for task: {}", task_id)
            }
            PtyError::IoError(e) => write!(f, "IO error: {}", e),
            PtyError::WriteFailed(msg) => write!(f, "Failed to write to PTY: {}", msg),
        }
    }
}

impl std::error::Error for PtyError {}

impl From<std::io::Error> for PtyError {
    fn from(err: std::io::Error) -> Self {
        PtyError::IoError(err)
    }
}

// ============================================================================
// PTY Manager
// ============================================================================

/// Manages multiple PTY sessions (one per task)
#[derive(Clone)]
pub struct PtyManager {
    sessions: PtySessions,
    pid_dir_override: Option<PathBuf>,
    last_output: LastOutputTimes,
    output_buffers: PtyOutputBuffers,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            pid_dir_override: None,
            last_output: Arc::new(Mutex::new(HashMap::new())),
            output_buffers: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl Default for PtyManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
impl PtyManager {
    pub fn set_pid_dir(&mut self, dir: PathBuf) {
        self.pid_dir_override = Some(dir);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::user_environment::user_environment;
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    use std::io::{self, Read};
    use std::path::Path;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;

    #[test]
    fn test_ring_buffer_push_within_capacity() {
        let mut buf = RingBuffer::new(100);
        buf.push(b"hello");
        buf.push(b" world");
        assert_eq!(buf.snapshot(), "hello world");
    }

    #[test]
    fn test_ring_buffer_push_exceeds_capacity() {
        let mut buf = RingBuffer::new(5);
        buf.push(b"hello");
        buf.push(b"world");
        let result = buf.snapshot();
        assert_eq!(result.len(), 5);
        assert_eq!(result, "world");
    }

    #[tokio::test]
    async fn test_get_pty_buffer_not_found() {
        let manager = PtyManager::new();
        let result = manager.get_pty_buffer("nonexistent-task").await;
        assert!(result.is_none());
    }

    #[test]
    fn test_pty_error_display() {
        let err = PtyError::SpawnFailed("test error".to_string());
        assert_eq!(err.to_string(), "Failed to spawn PTY: test error");

        let err = PtyError::ProcessNotFound("task123".to_string());
        assert_eq!(err.to_string(), "No PTY process found for task: task123");

        let err = PtyError::WriteFailed("write error".to_string());
        assert_eq!(err.to_string(), "Failed to write to PTY: write error");
    }

    #[test]
    fn test_pty_manager_new() {
        let manager = PtyManager::new();
        assert!(manager.sessions.try_lock().is_ok());
    }

    #[test]
    fn test_find_utf8_boundary_complete() {
        let data = b"Hello, world!";
        assert_eq!(find_utf8_boundary(data), data.len());
    }

    #[test]
    fn test_find_utf8_boundary_incomplete() {
        // UTF-8 sequence for "é" is [0xC3, 0xA9]
        // If we only have the first byte, it should be detected as incomplete
        let data = b"Hello\xC3";
        assert_eq!(find_utf8_boundary(data), 5); // Should stop before 0xC3

        // Complete sequence should be valid
        let data = b"Hello\xC3\xA9";
        assert_eq!(find_utf8_boundary(data), data.len());
    }

    #[test]
    fn test_find_utf8_boundary_three_byte() {
        // UTF-8 sequence for "€" is [0xE2, 0x82, 0xAC]
        let data = b"Price\xE2\x82"; // Incomplete 3-byte sequence
        assert_eq!(find_utf8_boundary(data), 5);

        let data = b"Price\xE2\x82\xAC"; // Complete
        assert_eq!(find_utf8_boundary(data), data.len());
    }

    #[test]
    fn test_user_environment_helper_has_fallbacks() {
        let env = user_environment();
        // Should at least have fallback values
        assert!(env.contains_key("PATH"));
        assert!(env.contains_key("LANG"));
    }

    struct ChunkedReader {
        chunks: std::collections::VecDeque<Vec<u8>>,
    }

    impl ChunkedReader {
        fn new(chunks: Vec<&[u8]>) -> Self {
            Self {
                chunks: chunks.into_iter().map(|chunk| chunk.to_vec()).collect(),
            }
        }
    }

    impl Read for ChunkedReader {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            let Some(chunk) = self.chunks.pop_front() else {
                return Ok(0);
            };
            let len = chunk.len().min(buf.len());
            buf[..len].copy_from_slice(&chunk[..len]);
            Ok(len)
        }
    }

    #[test]
    fn test_read_pty_output_loop_preserves_utf8_split_across_reads() {
        let mut reader = ChunkedReader::new(vec![b"hello \xC3", b"\xA9 world"]);
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();

        read_pty_output_loop(&mut reader, tx, "task-reader", None);

        assert_eq!(rx.blocking_recv(), Some(Some("hello ".to_string())));
        assert_eq!(rx.blocking_recv(), Some(Some("é world".to_string())));
        assert_eq!(rx.blocking_recv(), Some(None));
    }

    #[test]
    fn test_read_pty_output_loop_updates_last_output_time() {
        let mut reader = ChunkedReader::new(vec![b"output"]);
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let last_output = Arc::new(AtomicU64::new(0));

        read_pty_output_loop(
            &mut reader,
            tx,
            "task-reader",
            Some(Arc::clone(&last_output)),
        );

        assert_eq!(rx.blocking_recv(), Some(Some("output".to_string())));
        assert!(last_output.load(Ordering::Relaxed) > 0);
    }

    #[test]
    fn test_pty_output_batcher_flushes_at_threshold_to_event_and_ring_buffer() {
        let ring = Arc::new(std::sync::Mutex::new(RingBuffer::new(64)));
        let mut batcher = PtyOutputBatcher::new("task-batch".to_string(), 42, Arc::clone(&ring), 5);
        let mut emitted = Vec::new();

        batcher.push_output("he", &mut |event_name, payload| {
            emitted.push((event_name.to_string(), payload.clone()));
            Ok(())
        });
        assert!(
            emitted.is_empty(),
            "partial batch should not emit before threshold"
        );

        batcher.push_output("llo", &mut |event_name, payload| {
            emitted.push((event_name.to_string(), payload.clone()));
            Ok(())
        });

        assert_eq!(emitted.len(), 1);
        assert_eq!(emitted[0].0, "pty-output-task-batch");
        assert_eq!(emitted[0].1["task_id"], "task-batch");
        assert_eq!(emitted[0].1["data"], "hello");
        assert_eq!(emitted[0].1["instance_id"], 42);
        assert_eq!(ring.lock().unwrap().snapshot(), "hello");
    }

    #[test]
    fn test_pty_output_batcher_flush_pending_returns_false_for_empty_buffer() {
        let ring = Arc::new(std::sync::Mutex::new(RingBuffer::new(64)));
        let mut batcher = PtyOutputBatcher::new("task-empty".to_string(), 7, ring, 10);
        let mut emitted = Vec::new();

        assert!(!batcher.flush_pending(&mut |event_name, payload| {
            emitted.push((event_name.to_string(), payload.clone()));
            Ok(())
        }));
        assert!(emitted.is_empty());

        batcher.push_output("data", &mut |event_name, payload| {
            emitted.push((event_name.to_string(), payload.clone()));
            Ok(())
        });
        assert!(emitted.is_empty());
        assert!(batcher.flush_pending(&mut |event_name, payload| {
            emitted.push((event_name.to_string(), payload.clone()));
            Ok(())
        }));
        assert_eq!(emitted.len(), 1);
        assert_eq!(emitted[0].1["data"], "data");
    }

    #[test]
    fn test_instance_id_generation() {
        let id1 = NEXT_INSTANCE_ID.fetch_add(1, Ordering::Relaxed);
        let id2 = NEXT_INSTANCE_ID.fetch_add(1, Ordering::Relaxed);
        assert_ne!(id1, id2);
        assert!(id2 > id1);
    }

    #[tokio::test]
    async fn test_kill_all_empty_sessions() {
        let manager = PtyManager::new();
        // Should complete without panic or error on empty session map
        manager.kill_all().await;
        let sessions = manager.sessions.lock().await;
        assert_eq!(sessions.len(), 0);
    }

    #[test]
    fn test_cleanup_stale_pids_invalid_content() {
        let mut manager = PtyManager::new();
        let tmp_dir = std::env::temp_dir().join("test_pty_cleanup_invalid");
        std::fs::create_dir_all(&tmp_dir).unwrap();
        manager.set_pid_dir(tmp_dir.clone());

        // Only -pty.pid files are processed by pty cleanup
        let pid_file = tmp_dir.join("task123-pty.pid");
        std::fs::write(&pid_file, "not_a_number").unwrap();
        assert!(pid_file.exists());

        let result = manager.cleanup_stale_pids();
        assert!(result.is_ok());
        assert!(!pid_file.exists(), "Invalid PTY PID file should be removed");

        let _ = std::fs::remove_dir_all(&tmp_dir);
    }

    #[test]
    fn test_cleanup_stale_pids_invalid_indexed_shell_pid() {
        let mut manager = PtyManager::new();
        let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
        manager.set_pid_dir(tmp_dir.path().to_path_buf());

        let shell0_pid_file = tmp_dir.path().join("task123-shell-0.pid");
        let shell1_pid_file = tmp_dir.path().join("task123-shell-1.pid");
        std::fs::write(&shell0_pid_file, "not_a_number").unwrap();
        std::fs::write(&shell1_pid_file, "not_a_number").unwrap();

        let result = manager.cleanup_stale_pids();

        assert!(result.is_ok());
        assert!(
            !shell0_pid_file.exists(),
            "Indexed shell 0 PID file should be processed and removed"
        );
        assert!(
            !shell1_pid_file.exists(),
            "Indexed shell 1 PID file should be processed and removed"
        );
    }

    #[test]
    fn test_get_pid_dir_default() {
        let manager = PtyManager::new();
        let pid_dir = manager.get_pid_dir().expect("get_pid_dir should succeed");

        // In test builds, debug_assertions is enabled, so we expect "pids-dev"
        let dir_name = pid_dir.file_name().unwrap().to_str().unwrap();
        assert_eq!(
            dir_name, "pids-dev",
            "Debug build should use pids-dev directory"
        );

        // Verify parent is .openforge
        let parent_name = pid_dir
            .parent()
            .unwrap()
            .file_name()
            .unwrap()
            .to_str()
            .unwrap();
        assert_eq!(parent_name, ".openforge");
    }

    #[test]
    fn test_build_claude_args_new_session() {
        let settings = Path::new("/home/user/.openforge/claude-hooks-settings.json");
        let args = build_claude_args("implement the feature", None, false, settings, None);
        assert_eq!(
            args,
            vec![
                "implement the feature",
                "--settings",
                "/home/user/.openforge/claude-hooks-settings.json",
            ]
        );
    }

    #[test]
    fn test_build_claude_args_resume_session_with_prompt() {
        let settings = Path::new("/path/to/settings.json");
        let args = build_claude_args("continue work", Some("sess-abc-123"), false, settings, None);
        assert_eq!(
            args,
            vec![
                "--resume",
                "sess-abc-123",
                "continue work",
                "--settings",
                "/path/to/settings.json",
            ]
        );
    }

    #[test]
    fn test_build_claude_args_resume_session_without_prompt() {
        let settings = Path::new("/path/to/settings.json");
        let args = build_claude_args("", Some("sess-abc-123"), false, settings, None);
        assert_eq!(
            args,
            vec![
                "--resume",
                "sess-abc-123",
                "--settings",
                "/path/to/settings.json",
            ]
        );
    }

    #[test]
    fn test_build_claude_args_continue_session() {
        let settings = Path::new("/path/to/settings.json");
        let args = build_claude_args("", None, true, settings, None);
        assert_eq!(
            args,
            vec!["--continue", "--settings", "/path/to/settings.json",]
        );
    }

    #[test]
    fn test_build_claude_args_resume_takes_precedence_over_continue() {
        let settings = Path::new("/path/to/settings.json");
        // When both resume_session_id and continue_session are set, --resume wins
        let args = build_claude_args("", Some("sess-123"), true, settings, None);
        assert!(args.contains(&"--resume".to_string()));
        assert!(!args.contains(&"--continue".to_string()));
    }

    #[test]
    fn test_build_claude_args_settings_always_present() {
        let settings = Path::new("/config/hooks.json");
        let args_new = build_claude_args("prompt", None, false, settings, None);
        let args_resume = build_claude_args("prompt", Some("sid"), false, settings, None);
        let args_continue = build_claude_args("", None, true, settings, None);

        assert!(args_new.contains(&"--settings".to_string()));
        assert!(args_resume.contains(&"--settings".to_string()));
        assert!(args_continue.contains(&"--settings".to_string()));
    }

    #[test]
    fn test_build_claude_args_no_headless_flags() {
        let settings = Path::new("/config/hooks.json");
        let args = build_claude_args("prompt", None, false, settings, None);

        assert!(!args.contains(&"-p".to_string()));
        assert!(!args.contains(&"--output-format".to_string()));
        assert!(!args.contains(&"--input-format".to_string()));
    }

    #[test]
    fn test_build_claude_args_resume_flag_before_prompt() {
        let settings = Path::new("/config/hooks.json");
        let args = build_claude_args("my prompt", Some("session-xyz"), false, settings, None);

        let resume_pos = args.iter().position(|a| a == "--resume").unwrap();
        let session_pos = args.iter().position(|a| a == "session-xyz").unwrap();
        let prompt_pos = args.iter().position(|a| a == "my prompt").unwrap();

        assert_eq!(session_pos, resume_pos + 1);
        assert!(prompt_pos > session_pos);
    }

    #[test]
    fn test_claude_pty_args_with_real_hooks_path() {
        let temp_dir = std::env::temp_dir().join("test_pty_args_real_hooks_home");
        let _ = std::fs::remove_dir_all(&temp_dir);
        std::fs::create_dir_all(&temp_dir).unwrap();

        let temp_path = crate::claude_hooks::generate_hooks_settings_for_home(&temp_dir, 17422)
            .expect("generate_hooks_settings should succeed");

        let args_new = build_claude_args("fix the bug", None, false, &temp_path, None);
        assert_eq!(args_new[0], "fix the bug");
        let s_idx = args_new.iter().position(|a| a == "--settings").unwrap();
        assert_eq!(args_new[s_idx + 1], temp_path.to_string_lossy().to_string());
        assert!(!args_new.contains(&"-p".to_string()));

        let args_resume = build_claude_args(
            "continue impl",
            Some("resume-sess-999"),
            false,
            &temp_path,
            None,
        );
        assert_eq!(args_resume[0], "--resume");
        assert_eq!(args_resume[1], "resume-sess-999");
        assert_eq!(args_resume[2], "continue impl");
        let s_idx_r = args_resume.iter().position(|a| a == "--settings").unwrap();
        assert_eq!(
            args_resume[s_idx_r + 1],
            temp_path.to_string_lossy().to_string()
        );

        let content = std::fs::read_to_string(&temp_path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert!(parsed.get("hooks").is_some());

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_freeze_detection_with_ring_buffer() {
        let mut ring_buf = RingBuffer::new(512);
        ring_buf.push(b"Claude is processing...\n");
        ring_buf.push(b"Tool call: bash\n");

        let now_ms: u64 = 200_000_000;
        let last_output_ms = now_ms - 20_000;

        let frozen = frozen_seconds(last_output_ms, now_ms);
        assert_eq!(frozen, Some(20));

        let buffered = ring_buf.snapshot();
        assert!(buffered.contains("Claude is processing"));
        assert!(buffered.contains("Tool call: bash"));

        let still_frozen = frozen_seconds(last_output_ms, now_ms);
        assert_eq!(
            still_frozen,
            Some(20),
            "Freeze detection unaffected by ring buffer snapshot"
        );

        let recent_output = now_ms - 5_000;
        assert!(frozen_seconds(recent_output, now_ms).is_none());
    }

    #[tokio::test]
    async fn test_interrupt_claude_not_found() {
        let manager = PtyManager::new();
        let result = manager.interrupt_claude("nonexistent-task").await;
        assert!(matches!(result, Err(PtyError::ProcessNotFound(_))));
    }

    #[tokio::test]
    async fn test_check_claude_frozen_not_found() {
        let manager = PtyManager::new();
        let result = manager.check_claude_frozen("nonexistent-task").await;
        assert!(result.is_none());
    }

    #[test]
    fn test_frozen_seconds_no_output_yet() {
        assert!(frozen_seconds(0, 100_000_000).is_none());
    }

    #[test]
    fn test_frozen_seconds_below_threshold() {
        let now_ms: u64 = 100_000_000;
        assert!(frozen_seconds(now_ms - 14_999, now_ms).is_none());
    }

    #[test]
    fn test_frozen_seconds_at_threshold() {
        let now_ms: u64 = 100_000_000;
        assert_eq!(frozen_seconds(now_ms - 15_000, now_ms), Some(15));
    }

    #[test]
    fn test_frozen_seconds_above_threshold() {
        let now_ms: u64 = 100_000_000;
        assert_eq!(frozen_seconds(now_ms - 60_000, now_ms), Some(60));
    }

    #[test]
    fn test_ring_buffer_snapshot_does_not_clear() {
        let mut buf = RingBuffer::new(100);
        buf.push(b"hello world");
        let snap1 = buf.snapshot();
        assert_eq!(snap1, "hello world");
        let snap2 = buf.snapshot();
        assert_eq!(snap2, "hello world", "snapshot must not clear buffer");
    }

    #[test]
    fn test_ring_buffer_snapshot_with_overflow() {
        let mut buf = RingBuffer::new(10);
        buf.push(b"abcdefghijklmno"); // 15 bytes, capacity 10
        let snap = buf.snapshot();
        assert_eq!(snap, "fghijklmno");
        assert_eq!(snap.len(), 10);
        // Original buffer still intact
        let snap2 = buf.snapshot();
        assert_eq!(snap2, "fghijklmno");
    }

    #[tokio::test]
    async fn test_get_pty_buffer_returns_snapshot() {
        let manager = PtyManager::new();
        let ring = Arc::new(std::sync::Mutex::new(RingBuffer::new(1024)));
        {
            let mut buf = ring.lock().unwrap();
            buf.push(b"test output data");
        }
        {
            let mut buffers = manager.output_buffers.lock().await;
            buffers.insert("task-snap".to_string(), Arc::clone(&ring));
        }
        let first = manager.get_pty_buffer("task-snap").await;
        assert_eq!(first, Some("test output data".to_string()));
        let second = manager.get_pty_buffer("task-snap").await;
        assert_eq!(second, Some("test output data".to_string()));
    }

    #[tokio::test]
    async fn test_kill_pty_cleans_output_buffers() {
        let mut manager = PtyManager::new();
        let tmp_dir = std::env::temp_dir().join("test_kill_pty_cleanup_buffers");
        std::fs::create_dir_all(&tmp_dir).unwrap();
        manager.set_pid_dir(tmp_dir.clone());

        let task_id = "cleanup-test-task";

        let ring = Arc::new(std::sync::Mutex::new(RingBuffer::new(1024)));
        {
            let mut buf = ring.lock().unwrap();
            buf.push(b"some output");
        }
        {
            let mut buffers = manager.output_buffers.lock().await;
            buffers.insert(task_id.to_string(), Arc::clone(&ring));
        }
        {
            let mut times = manager.last_output.lock().await;
            times.insert(task_id.to_string(), Arc::new(AtomicU64::new(12345)));
        }

        {
            let buffers = manager.output_buffers.lock().await;
            assert!(
                buffers.contains_key(task_id),
                "buffer entry should exist before kill"
            );
        }
        {
            let times = manager.last_output.lock().await;
            assert!(
                times.contains_key(task_id),
                "last_output entry should exist before kill"
            );
        }

        let _ = manager.kill_pty(task_id).await;

        {
            let buffers = manager.output_buffers.lock().await;
            assert!(
                !buffers.contains_key(task_id),
                "output_buffers should be cleaned up after kill_pty"
            );
        }
        {
            let times = manager.last_output.lock().await;
            assert!(
                !times.contains_key(task_id),
                "last_output should be cleaned up after kill_pty"
            );
        }

        let _ = std::fs::remove_dir_all(&tmp_dir);
    }

    #[tokio::test]
    async fn test_spawn_pty_populates_output_buffer() {
        let manager = PtyManager::new();

        let ring = Arc::new(std::sync::Mutex::new(RingBuffer::new(
            CLAUDE_BUFFER_CAPACITY,
        )));
        {
            let mut buf = ring.lock().unwrap();
            buf.push(b"opencode output data");
        }
        {
            let mut buffers = manager.output_buffers.lock().await;
            buffers.insert("opencode-task-123".to_string(), Arc::clone(&ring));
        }

        let result = manager.get_pty_buffer("opencode-task-123").await;
        assert_eq!(result, Some("opencode output data".to_string()));

        let result2 = manager.get_pty_buffer("opencode-task-123").await;
        assert_eq!(
            result2,
            Some("opencode output data".to_string()),
            "buffer must be replayable on re-attach"
        );
    }

    #[tokio::test]
    async fn test_emitter_uses_runtime_app_event_adapter_once_when_app_and_sender_share_bus() {
        let manager = PtyManager::new();
        let bus = crate::app_events::AppEventBus::new(16, 16);
        let app = crate::backend_runtime::AppHandle::new();
        app.set_app_event_adapter(Arc::new(crate::app_events::InMemoryAppEventAdapter::new(
            bus.clone(),
        )));
        let mut events = bus.subscribe(None).expect("subscribe should work");
        let (output_tx, output_rx) = tokio::sync::mpsc::unbounded_channel();
        let ring = Arc::new(std::sync::Mutex::new(RingBuffer::new(128)));
        let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");

        spawn_batched_pty_event_emitter(
            output_rx,
            PtyEventEmitterConfig {
                session_key: "task-dedupe-shell-0".to_string(),
                instance_id: 7,
                app_handle: Some(app),
                app_event_tx: Some(bus.sender()),
                ring_buffer: ring,
                exit_action: PtyExitAction::Cleanup {
                    sessions: Arc::clone(&manager.sessions),
                    last_output: Arc::clone(&manager.last_output),
                    output_buffers: Arc::clone(&manager.output_buffers),
                    pid_file: tmp_dir.path().join("task-dedupe-shell-0.pid"),
                    emit_agent_exit: false,
                },
            },
        );

        output_tx
            .send(Some("deduped live output".to_string()))
            .expect("output should send");

        let crate::app_events::AppEventFrame::Event(received) =
            tokio::time::timeout(tokio::time::Duration::from_secs(1), events.recv())
                .await
                .expect("pty output should be emitted")
                .expect("pty output frame should be available")
        else {
            panic!("expected pty output event frame");
        };

        assert_eq!(received.event_name, "pty-output-task-dedupe-shell-0");
        assert_eq!(received.payload["data"], "deduped live output");
        assert_eq!(received.payload["instance_id"], 7);

        if let Ok(Some(crate::app_events::AppEventFrame::Event(duplicate))) =
            tokio::time::timeout(tokio::time::Duration::from_millis(50), events.recv()).await
        {
            assert_ne!(
                duplicate.event_name, "pty-output-task-dedupe-shell-0",
                "PTY output must not be published twice when the app handle is backed by the same app event bus as app_event_tx"
            );
        }

        drop(output_tx);
    }

    #[tokio::test]
    async fn test_cleanup_exit_action_cleans_shell_state_without_agent_event() {
        let manager = PtyManager::new();
        let pty_system = native_pty_system();
        let size = PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        };
        let pair = pty_system.openpty(size).expect("openpty should succeed");

        let shell = get_shell_path();
        let mut cmd = CommandBuilder::new(&shell);
        cmd.arg("-lc");
        cmd.arg("true");
        let child = pair
            .slave
            .spawn_command(cmd)
            .expect("spawn command should succeed");
        drop(pair.slave);

        let writer = pair
            .master
            .take_writer()
            .expect("take writer should succeed");

        let key = "task-1-shell-0";
        {
            let mut sessions = manager.sessions.lock().await;
            sessions.insert(
                key.to_string(),
                PtySession {
                    child,
                    master: pair.master,
                    writer,
                    instance_id: 1,
                },
            );
        }

        let ring = Arc::new(std::sync::Mutex::new(RingBuffer::new(128)));
        {
            let mut buffers = manager.output_buffers.lock().await;
            buffers.insert(key.to_string(), Arc::clone(&ring));
        }
        {
            let mut times = manager.last_output.lock().await;
            times.insert(key.to_string(), Arc::new(AtomicU64::new(123)));
        }

        let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
        let pid_file = tmp_dir.path().join("task-1-shell-0.pid");
        std::fs::write(&pid_file, "1234").expect("pid file should write");

        let (output_tx, output_rx) = tokio::sync::mpsc::unbounded_channel();
        let (app_event_tx, mut app_event_rx) = tokio::sync::broadcast::channel(8);
        spawn_batched_pty_event_emitter(
            output_rx,
            PtyEventEmitterConfig {
                session_key: key.to_string(),
                instance_id: 1,
                app_handle: None,
                app_event_tx: Some(app_event_tx),
                ring_buffer: ring,
                exit_action: PtyExitAction::Cleanup {
                    sessions: Arc::clone(&manager.sessions),
                    last_output: Arc::clone(&manager.last_output),
                    output_buffers: Arc::clone(&manager.output_buffers),
                    pid_file: pid_file.clone(),
                    emit_agent_exit: false,
                },
            },
        );

        output_tx.send(None).expect("exit signal should send");
        let exit_event =
            tokio::time::timeout(tokio::time::Duration::from_secs(1), app_event_rx.recv())
                .await
                .expect("pty-exit event should be emitted")
                .expect("pty-exit event should be received");

        assert_eq!(exit_event.event_name, "pty-exit-task-1-shell-0");
        assert_eq!(exit_event.payload["instance_id"], 1);
        if let Ok(Ok(event)) =
            tokio::time::timeout(tokio::time::Duration::from_millis(50), app_event_rx.recv()).await
        {
            assert_ne!(
                event.event_name, "agent-pty-exited",
                "cleanup-only PTYs must not emit agent-pty-exited"
            );
        }
        assert!(
            !manager.sessions.lock().await.contains_key(key),
            "session should be removed after EOF cleanup"
        );
        assert!(
            !manager.output_buffers.lock().await.contains_key(key),
            "output buffer should be removed after EOF cleanup"
        );
        assert!(
            !manager.last_output.lock().await.contains_key(key),
            "last_output should be removed after EOF cleanup"
        );
        assert!(
            !pid_file.exists(),
            "pid file should be removed after EOF cleanup"
        );
    }

    #[tokio::test]
    async fn test_finalize_pty_exit_ignores_stale_instance() {
        let manager = PtyManager::new();
        let pty_system = native_pty_system();
        let size = PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        };
        let pair = pty_system.openpty(size).expect("openpty should succeed");

        let shell = get_shell_path();
        let mut cmd = CommandBuilder::new(&shell);
        cmd.arg("-lc");
        cmd.arg("sleep 1");
        let child = pair
            .slave
            .spawn_command(cmd)
            .expect("spawn command should succeed");
        drop(pair.slave);

        let writer = pair
            .master
            .take_writer()
            .expect("take writer should succeed");

        {
            let mut sessions = manager.sessions.lock().await;
            sessions.insert(
                "task-1".to_string(),
                PtySession {
                    child,
                    master: pair.master,
                    writer,
                    instance_id: 2,
                },
            );
        }

        let ring = Arc::new(std::sync::Mutex::new(RingBuffer::new(128)));
        {
            let mut buf = ring.lock().expect("ring buffer should lock");
            buf.push(b"active output");
        }
        {
            let mut buffers = manager.output_buffers.lock().await;
            buffers.insert("task-1".to_string(), Arc::clone(&ring));
        }
        {
            let mut times = manager.last_output.lock().await;
            times.insert("task-1".to_string(), Arc::new(AtomicU64::new(123)));
        }

        let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
        let pid_file = tmp_dir.path().join("task-1-pty.pid");
        std::fs::write(&pid_file, "1234").expect("pid file should write");

        let success = finalize_pty_exit(
            &manager.sessions,
            &manager.last_output,
            &manager.output_buffers,
            &pid_file,
            "task-1",
            1,
        )
        .await;

        assert!(
            !success,
            "stale cleanup should not report a successful exit"
        );
        {
            let sessions = manager.sessions.lock().await;
            let session = sessions.get("task-1").expect("newer session should remain");
            assert_eq!(session.instance_id, 2);
        }
        {
            let buffers = manager.output_buffers.lock().await;
            assert!(
                buffers.contains_key("task-1"),
                "buffer should remain for active instance"
            );
        }
        {
            let times = manager.last_output.lock().await;
            assert!(
                times.contains_key("task-1"),
                "last_output should remain for active instance"
            );
        }
        assert!(
            pid_file.exists(),
            "stale cleanup must not remove the active pid file"
        );
    }

    #[test]
    fn test_get_shell_path_uses_env_without_mutating_process_env() {
        let shell = resolve_shell_path(Some("/usr/bin/env"), ["/bin/zsh", "/bin/bash", "/bin/sh"]);
        assert_eq!(
            shell, "/usr/bin/env",
            "should prefer the supplied SHELL value when set"
        );
    }

    #[test]
    fn test_get_shell_path_falls_back_to_existing_candidate() {
        let temp_dir = tempfile::tempdir().expect("tempdir should succeed");
        let missing_shell = temp_dir.path().join("missing-shell");
        let existing_shell = temp_dir.path().join("existing-shell");
        std::fs::write(&existing_shell, "#!/bin/sh\n").expect("shell fixture should write");

        let shell = resolve_shell_path(
            None,
            [
                missing_shell.to_string_lossy().as_ref(),
                existing_shell.to_string_lossy().as_ref(),
            ],
        );

        assert_eq!(shell, existing_shell.to_string_lossy());
    }

    #[test]
    fn test_build_shell_command() {
        let shell = get_shell_path();
        assert!(!shell.is_empty(), "shell path should not be empty");
        assert!(
            shell.starts_with('/'),
            "shell path should be absolute: {}",
            shell
        );

        let expected_term_vars: &[(&str, &str)] = &[
            ("TERM", "xterm-256color"),
            ("COLORTERM", "truecolor"),
            ("TERM_PROGRAM", "vscode"),
        ];
        assert_eq!(expected_term_vars[0], ("TERM", "xterm-256color"));
        assert_eq!(expected_term_vars[1], ("COLORTERM", "truecolor"));
        assert_eq!(expected_term_vars[2], ("TERM_PROGRAM", "vscode"));
    }

    #[tokio::test]
    async fn test_get_session_keys_empty() {
        let manager = PtyManager::new();
        let keys = manager.get_session_keys().await;
        assert!(keys.is_empty());
    }

    #[test]
    fn test_shell_pid_file_naming() {
        let task_id = "my-task-123";
        let shell0_key = shell_session_key(task_id, Some(0));
        let shell1_key = shell_session_key(task_id, Some(1));
        let shell0_pid_file = shell_pid_file_name(task_id, Some(0));
        let shell1_pid_file = shell_pid_file_name(task_id, Some(1));

        assert_eq!(shell0_key, "my-task-123-shell-0");
        assert_eq!(shell1_key, "my-task-123-shell-1");
        assert_eq!(shell0_pid_file, "my-task-123-shell-0.pid");
        assert_eq!(shell1_pid_file, "my-task-123-shell-1.pid");
        assert_ne!(shell0_pid_file, shell1_pid_file);

        let output_event = format!("pty-output-{}", shell1_key);
        let exit_event = format!("pty-exit-{}", shell1_key);
        assert_eq!(output_event, "pty-output-my-task-123-shell-1");
        assert_eq!(exit_event, "pty-exit-my-task-123-shell-1");
    }

    #[test]
    fn test_build_claude_args_with_permission_mode() {
        let settings = Path::new("/path/to/settings.json");
        let args = build_claude_args("my prompt", None, false, settings, Some("plan"));

        let pm_pos = args
            .iter()
            .position(|a| a == "--permission-mode")
            .expect("--permission-mode flag should be present");
        assert_eq!(args[pm_pos + 1], "plan");

        let settings_pos = args.iter().position(|a| a == "--settings").unwrap();
        assert!(
            pm_pos < settings_pos,
            "--permission-mode should appear before --settings"
        );
    }

    #[test]
    fn test_build_claude_args_without_permission_mode() {
        let settings = Path::new("/path/to/settings.json");
        let args = build_claude_args("my prompt", None, false, settings, None);

        assert!(
            !args.contains(&"--permission-mode".to_string()),
            "--permission-mode should not be present when None"
        );
    }

    #[test]
    fn test_build_pi_args_new_session_with_prompt() {
        let args = build_pi_args("implement the feature", None, false, None);
        assert_eq!(args, vec!["implement the feature"]);
    }

    #[test]
    fn test_build_pi_args_includes_openforge_extension_before_prompt() {
        let extension = Path::new("/tmp/openforge-pi-extension.ts");
        let args = build_pi_args("implement the feature", None, false, Some(extension));
        assert_eq!(
            args,
            vec![
                "-e",
                "/tmp/openforge-pi-extension.ts",
                "implement the feature",
            ]
        );
    }

    #[test]
    fn test_build_pi_args_resume_session_with_prompt() {
        let args = build_pi_args("continue work", Some("sess-abc-123"), false, None);
        assert_eq!(args, vec!["--session", "sess-abc-123", "continue work"]);
    }

    #[test]
    fn test_build_pi_args_resume_session_without_prompt() {
        let args = build_pi_args("", Some("sess-abc-123"), false, None);
        assert_eq!(args, vec!["--session", "sess-abc-123"]);
    }

    #[test]
    fn test_build_pi_args_continue_session() {
        let args = build_pi_args("", None, true, None);
        assert_eq!(args, vec!["--continue"]);
    }

    #[test]
    fn test_build_pi_args_continue_with_prompt() {
        let args = build_pi_args("what changed?", None, true, None);
        assert_eq!(args, vec!["--continue", "what changed?"]);
    }

    #[test]
    fn test_build_pi_args_resume_takes_precedence_over_continue() {
        let args = build_pi_args("", Some("sess-123"), true, None);
        assert!(args.contains(&"--session".to_string()));
        assert!(!args.contains(&"--continue".to_string()));
    }

    #[test]
    fn test_spawn_shell_with_index() {
        let task_id = "t1";
        let key_0 = format!("{}-shell-{}", task_id, 0);
        let key_1 = format!("{}-shell-{}", task_id, 1);
        let key_2 = format!("{}-shell-{}", task_id, 2);

        assert_eq!(key_0, "t1-shell-0");
        assert_eq!(key_1, "t1-shell-1");
        assert_eq!(key_2, "t1-shell-2");
    }

    fn test_pty_session() -> PtySession {
        let pty_system = native_pty_system();
        let size = PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        };
        let pair = pty_system.openpty(size).expect("openpty should succeed");

        let shell = get_shell_path();
        let mut cmd = CommandBuilder::new(&shell);
        cmd.arg("-lc");
        cmd.arg("true");
        let child = pair
            .slave
            .spawn_command(cmd)
            .expect("spawn command should succeed");
        drop(pair.slave);

        let writer = pair
            .master
            .take_writer()
            .expect("take writer should succeed");

        PtySession {
            child,
            master: pair.master,
            writer,
            instance_id: 1,
        }
    }

    #[tokio::test]
    async fn test_kill_shells_for_task_removes_indexed_shell_pid_files() {
        let mut manager = PtyManager::new();
        let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
        manager.set_pid_dir(tmp_dir.path().to_path_buf());

        let task_id = "task-1";
        let shell0_key = shell_session_key(task_id, Some(0));
        let shell1_key = shell_session_key(task_id, Some(1));
        let unrelated_key = shell_session_key("task-2", Some(0));

        {
            let mut sessions = manager.sessions.lock().await;
            sessions.insert(shell0_key.clone(), test_pty_session());
            sessions.insert(shell1_key.clone(), test_pty_session());
            sessions.insert(unrelated_key.clone(), test_pty_session());
        }

        let shell0_pid_file = tmp_dir.path().join(shell_pid_file_name(task_id, Some(0)));
        let shell1_pid_file = tmp_dir.path().join(shell_pid_file_name(task_id, Some(1)));
        let unrelated_pid_file = tmp_dir.path().join(shell_pid_file_name("task-2", Some(0)));
        std::fs::write(&shell0_pid_file, "1234").expect("shell 0 pid file should write");
        std::fs::write(&shell1_pid_file, "5678").expect("shell 1 pid file should write");
        std::fs::write(&unrelated_pid_file, "9012").expect("unrelated pid file should write");

        let ring = Arc::new(std::sync::Mutex::new(RingBuffer::new(128)));
        {
            let mut buffers = manager.output_buffers.lock().await;
            buffers.insert(shell0_key.clone(), Arc::clone(&ring));
            buffers.insert(shell1_key.clone(), Arc::clone(&ring));
            buffers.insert(unrelated_key.clone(), Arc::clone(&ring));
        }
        {
            let mut times = manager.last_output.lock().await;
            times.insert(shell0_key.clone(), Arc::new(AtomicU64::new(123)));
            times.insert(shell1_key.clone(), Arc::new(AtomicU64::new(456)));
            times.insert(unrelated_key.clone(), Arc::new(AtomicU64::new(789)));
        }

        manager.kill_shells_for_task(task_id).await;

        assert!(
            !shell0_pid_file.exists(),
            "shell 0 pid file should be removed"
        );
        assert!(
            !shell1_pid_file.exists(),
            "shell 1 pid file should be removed"
        );
        assert!(
            unrelated_pid_file.exists(),
            "unrelated shell pid file should not be removed"
        );

        let sessions = manager.sessions.lock().await;
        assert!(!sessions.contains_key(&shell0_key));
        assert!(!sessions.contains_key(&shell1_key));
        assert!(sessions.contains_key(&unrelated_key));
        drop(sessions);

        let buffers = manager.output_buffers.lock().await;
        assert!(!buffers.contains_key(&shell0_key));
        assert!(!buffers.contains_key(&shell1_key));
        assert!(buffers.contains_key(&unrelated_key));
        drop(buffers);

        let times = manager.last_output.lock().await;
        assert!(!times.contains_key(&shell0_key));
        assert!(!times.contains_key(&shell1_key));
        assert!(times.contains_key(&unrelated_key));
    }

    #[test]
    fn test_kill_shells_for_task_key_matching() {
        let task_id = "t1";
        let keys = ["t1-shell-0", "t1-shell-1", "t1", "t2-shell-0"];

        let prefix = format!("{}-shell-", task_id);
        let matching: Vec<_> = keys.iter().filter(|k| k.starts_with(&prefix)).collect();

        assert_eq!(matching.len(), 2);
        assert!(matching.contains(&&"t1-shell-0"));
        assert!(matching.contains(&&"t1-shell-1"));
        assert!(!matching.contains(&&"t1"));
        assert!(!matching.contains(&&"t2-shell-0"));
    }

    #[test]
    fn test_spawn_shell_no_index() {
        let task_id = "my-task";
        let terminal_index: Option<u32> = None;

        let key = if let Some(idx) = terminal_index {
            format!("{}-shell-{}", task_id, idx)
        } else {
            format!("{}-shell-0", task_id)
        };

        assert_eq!(key, "my-task-shell-0");
    }
}
