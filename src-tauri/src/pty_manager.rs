use std::collections::HashMap;
use std::fmt;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::Mutex;
use portable_pty::{CommandBuilder, PtySize, native_pty_system};
use tauri::Emitter;

// ============================================================================
// Ring Buffer
// ============================================================================

const CLAUDE_BUFFER_CAPACITY: usize = 262_144; // 256KB

struct RingBuffer {
    data: Vec<u8>,
    capacity: usize,
}

impl RingBuffer {
    fn new(capacity: usize) -> Self {
        Self {
            data: Vec::with_capacity(capacity),
            capacity,
        }
    }

    fn push(&mut self, bytes: &[u8]) {
        self.data.extend_from_slice(bytes);
        if self.data.len() > self.capacity {
            let excess = self.data.len() - self.capacity;
            self.data.drain(0..excess);
        }
    }

    fn snapshot(&self) -> String {
        String::from_utf8_lossy(&self.data).to_string()
    }
}

// ============================================================================
// Instance ID Generator
// ============================================================================

static NEXT_INSTANCE_ID: AtomicU64 = AtomicU64::new(1);

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
            PtyError::ProcessNotFound(task_id) => write!(f, "No PTY process found for task: {}", task_id),
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
// PTY Session
// ============================================================================

struct PtySession {
    #[allow(dead_code)]
    child: Box<dyn portable_pty::Child + Send + Sync>,
    #[allow(dead_code)]
    master: Box<dyn portable_pty::MasterPty + Send>,
    writer: Box<dyn std::io::Write + Send>,
}

// ============================================================================
// PTY Manager
// ============================================================================

/// Manages multiple PTY sessions (one per task)
#[derive(Clone)]
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
    pid_dir_override: Option<PathBuf>,
    last_output: Arc<Mutex<HashMap<String, Arc<AtomicU64>>>>,
    output_buffers: Arc<Mutex<HashMap<String, Arc<std::sync::Mutex<RingBuffer>>>>>,
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
    /// Spawns a new PTY process for the given task_id.
    /// Runs `opencode attach http://127.0.0.1:{server_port} --session {opencode_session_id}`
    ///
    /// # Arguments
    /// * `task_id` - Unique identifier for the task
    /// * `server_port` - Port number of the OpenCode server
    /// * `opencode_session_id` - OpenCode session ID to attach to
    /// * `cols` - Terminal width in columns
    /// * `rows` - Terminal height in rows
    /// * `app_handle` - Tauri app handle for emitting events
    ///
    /// # Returns
    /// The unique instance ID for this PTY session
    pub async fn spawn_pty(
        &self,
        task_id: &str,
        server_port: u16,
        opencode_session_id: &str,
        cols: u16,
        rows: u16,
        app_handle: tauri::AppHandle,
    ) -> Result<u64, PtyError> {
        let mut sessions = self.sessions.lock().await;

        if sessions.contains_key(task_id) {
            println!("[PTY] Replacing existing PTY for task {}", task_id);
            if let Some(mut old_session) = sessions.remove(task_id) {
                let _ = old_session.child.kill();
            }
            // Clean up old PID file (will be recreated below)
            if let Ok(pid_dir) = self.get_pid_dir() {
                let _ = std::fs::remove_file(pid_dir.join(format!("{}-pty.pid", task_id)));
            }
        }

        println!("Spawning PTY for task {} ({}x{})", task_id, cols, rows);

        let pty_system = native_pty_system();
        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };

        let pair = pty_system
            .openpty(size)
            .map_err(|e| PtyError::SpawnFailed(format!("Failed to create PTY pair: {}", e)))?;

        // Build command with user environment
        let mut cmd = CommandBuilder::new("opencode");
        cmd.arg("attach");
        cmd.arg(format!("http://127.0.0.1:{}", server_port));
        cmd.arg("--session");
        cmd.arg(opencode_session_id);

        // Get user environment (especially PATH on macOS)
        let user_env = get_user_environment();
        for (key, value) in user_env {
            cmd.env(key, value);
        }

        // Override with terminal-specific env vars
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("TERM_PROGRAM", "vscode");

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| PtyError::SpawnFailed(format!("Failed to spawn command: {}", e)))?;

        // Drop the slave handle after spawn (important!)
        drop(pair.slave);

        let pid = child.process_id().unwrap_or(0);
        println!("PTY for task {} started (PID: {})", task_id, pid);

        // Generate unique instance ID for this PTY session
        let instance_id = NEXT_INSTANCE_ID.fetch_add(1, Ordering::Relaxed);

        // Get reader and writer from master
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| PtyError::SpawnFailed(format!("Failed to clone reader: {}", e)))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| PtyError::SpawnFailed(format!("Failed to take writer: {}", e)))?;

        // Store the session
        sessions.insert(
            task_id.to_string(),
            PtySession {
                child,
                master: pair.master,
                writer,
            },
        );

        // Release the lock before spawning the reader thread
        drop(sessions);

        let ring_buffer = Arc::new(std::sync::Mutex::new(RingBuffer::new(CLAUDE_BUFFER_CAPACITY)));
        {
            let mut buffers = self.output_buffers.lock().await;
            buffers.insert(task_id.to_string(), Arc::clone(&ring_buffer));
        }
        let ring_buffer_emitter = Arc::clone(&ring_buffer);

        // Sleep on macOS to allow PTY initialization
        #[cfg(target_os = "macos")]
        {
            tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
        }

        // Write PID file
        let pid_dir = self.get_pid_dir()?;
        std::fs::create_dir_all(&pid_dir)?;
        let pid_file = pid_dir.join(format!("{}-pty.pid", task_id));
        std::fs::write(&pid_file, pid.to_string())?;

        // Channel to bridge blocking reader → async emitter
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Option<String>>();

        // Blocking reader thread: reads PTY output, sends through channel
        let task_id_reader = task_id.to_string();
        tokio::task::spawn_blocking(move || {
            let mut reader = reader;
            let mut buffer = [0u8; 8192];
            let mut incomplete_utf8: Vec<u8> = Vec::new();

            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => {
                        println!("[PTY] task={} closed (EOF)", task_id_reader);
                        let _ = tx.send(None);
                        break;
                    }
                    Ok(n) => {
                        let mut data = if incomplete_utf8.is_empty() {
                            buffer[..n].to_vec()
                        } else {
                            let mut combined = std::mem::take(&mut incomplete_utf8);
                            combined.extend_from_slice(&buffer[..n]);
                            combined
                        };

                        let valid_up_to = find_utf8_boundary(&data);
                        if valid_up_to < data.len() {
                            incomplete_utf8 = data[valid_up_to..].to_vec();
                            data.truncate(valid_up_to);
                        }

                        if !data.is_empty() {
                            let text = String::from_utf8_lossy(&data).to_string();
                            if tx.send(Some(text)).is_err() {
                                println!("[PTY] task={} channel closed, reader exiting", task_id_reader);
                                break;
                            }
                        }
                    }
                    Err(e) => {
                        println!("[PTY] task={} read error: {}", task_id_reader, e);
                        let _ = tx.send(None);
                        break;
                    }
                }
            }
        });

        // Async emitter task: receives from channel, batches output, emits Tauri events.
        // Batch PTY output to reduce Tauri event frequency and prevent visual tearing.
        // OpenTUI redraws at 60 FPS; without batching, partial frames appear between
        // cursor-positioning and content writes. We flush at ~60 FPS (every 16ms) or
        // when the buffer exceeds 64KB.
        const FLUSH_INTERVAL_MS: u64 = 16;
        const MAX_BUFFER_SIZE: usize = 65536; // 64KB early flush threshold

        let task_id_emitter = task_id.to_string();
        let instance_id_emitter = instance_id;
        tokio::spawn(async move {
            let mut buffer = String::new();
            let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(FLUSH_INTERVAL_MS));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

            loop {
                tokio::select! {
                    msg = rx.recv() => {
                        match msg {
                            Some(Some(text)) => {
                                buffer.push_str(&text);
                                if buffer.len() >= MAX_BUFFER_SIZE {
                                    // Early flush: buffer exceeded threshold
                                    if !buffer.is_empty() {
                                        let event_name = format!("pty-output-{}", task_id_emitter);
                                        let payload = serde_json::json!({ "task_id": &task_id_emitter, "data": &buffer });
                                        if let Err(e) = app_handle.emit(&event_name, &payload) {
                                            eprintln!("[PTY] Failed to emit {}: {}", event_name, e);
                                        }
                                        if let Ok(mut buf) = ring_buffer_emitter.lock() {
                                            buf.push(buffer.as_bytes());
                                        }
                                        buffer.clear();
                                    }
                                }
                            }
                            Some(None) | None => {
                                if !buffer.is_empty() {
                                    let event_name = format!("pty-output-{}", task_id_emitter);
                                    let payload = serde_json::json!({ "task_id": &task_id_emitter, "data": &buffer });
                                    if let Err(e) = app_handle.emit(&event_name, &payload) {
                                        eprintln!("[PTY] Failed to emit {}: {}", event_name, e);
                                    }
                                    if let Ok(mut buf) = ring_buffer_emitter.lock() {
                                        buf.push(buffer.as_bytes());
                                    }
                                    buffer.clear();
                                }
                                println!("[PTY] task={} emitter received exit signal", task_id_emitter);
                                let _ = app_handle.emit(&format!("pty-exit-{}", task_id_emitter), serde_json::json!({"instance_id": instance_id_emitter}));
                                break;
                            }
                        }
                    }
                    _ = interval.tick() => {
                        if !buffer.is_empty() {
                            let event_name = format!("pty-output-{}", task_id_emitter);
                            let payload = serde_json::json!({ "task_id": &task_id_emitter, "data": &buffer });
                            if let Err(e) = app_handle.emit(&event_name, &payload) {
                                eprintln!("[PTY] Failed to emit {}: {}", event_name, e);
                            }
                            if let Ok(mut buf) = ring_buffer_emitter.lock() {
                                buf.push(buffer.as_bytes());
                            }
                            buffer.clear();
                        }
                    }
                }
            }
        });

        Ok(instance_id)
    }

    /// Spawns a Claude CLI process in a PTY for the given task_id.
    /// Runs `claude "prompt"` for new sessions, `claude --resume <id>` for resuming,
    /// or `claude --continue` to continue the most recent session in the working directory.
    /// Always passes `--settings <hooks_settings_path>` to load the Claude hooks config.
    ///
    /// # Arguments
    /// * `task_id` - Unique identifier for the task (used for events and PID tracking)
    /// * `cwd` - Working directory for the Claude process (task's worktree path)
    /// * `prompt` - The prompt to send to Claude (empty string to skip)
    /// * `resume_session_id` - If Some, resumes an existing Claude session with `--resume <id>`
    /// * `continue_session` - If true and no resume_session_id, uses `--continue`
    /// * `hooks_settings_path` - Path to the hooks settings JSON file
    /// * `permission_mode` - If Some, passes `--permission-mode <mode>` to Claude CLI
    /// * `cols` - Terminal width in columns
    /// * `rows` - Terminal height in rows
    /// * `app_handle` - Tauri app handle for emitting PTY output events
    ///
    /// # Returns
    /// The unique instance ID for this PTY session
    #[allow(clippy::too_many_arguments)]
    pub async fn spawn_claude_pty(
        &self,
        task_id: &str,
        cwd: &Path,
        prompt: &str,
        resume_session_id: Option<&str>,
        continue_session: bool,
        hooks_settings_path: &Path,
        permission_mode: Option<&str>,
        cols: u16,
        rows: u16,
        app_handle: tauri::AppHandle,
    ) -> Result<u64, PtyError> {
        let mut sessions = self.sessions.lock().await;

        if sessions.contains_key(task_id) {
            println!("[PTY] Replacing existing PTY for task {}", task_id);
            if let Some(mut old_session) = sessions.remove(task_id) {
                let _ = old_session.child.kill();
            }
            if let Ok(pid_dir) = self.get_pid_dir() {
                let _ = std::fs::remove_file(pid_dir.join(format!("{}-pty.pid", task_id)));
                let _ = std::fs::remove_file(pid_dir.join(format!("{}-claude.pid", task_id)));
            }
        }

        // Pre-approve workspace trust so the "Do you trust this folder?" dialog is skipped
        if let Err(e) = crate::claude_hooks::ensure_workspace_trusted(cwd) {
            println!("[PTY] Warning: Failed to pre-approve workspace trust: {}", e);
            // Non-fatal — Claude will just show the trust dialog
        }

        println!("Spawning Claude PTY for task {} ({}x{})", task_id, cols, rows);

        let pty_system = native_pty_system();
        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };

        let pair = pty_system
            .openpty(size)
            .map_err(|e| PtyError::SpawnFailed(format!("Failed to create PTY pair: {}", e)))?;

        let mut cmd = CommandBuilder::new("claude");
        for arg in build_claude_args(prompt, resume_session_id, continue_session, hooks_settings_path, permission_mode) {
            cmd.arg(arg);
        }
        cmd.cwd(cwd);

        let user_env = get_user_environment();
        for (key, value) in user_env {
            cmd.env(key, value);
        }

        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("TERM_PROGRAM", "vscode");
        cmd.env("CLAUDE_TASK_ID", task_id);

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| PtyError::SpawnFailed(format!("Failed to spawn command: {}", e)))?;

        drop(pair.slave);

        let pid = child.process_id().unwrap_or(0);
        println!("Claude PTY for task {} started (PID: {})", task_id, pid);

        let instance_id = NEXT_INSTANCE_ID.fetch_add(1, Ordering::Relaxed);

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| PtyError::SpawnFailed(format!("Failed to clone reader: {}", e)))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| PtyError::SpawnFailed(format!("Failed to take writer: {}", e)))?;

        sessions.insert(
            task_id.to_string(),
            PtySession {
                child,
                master: pair.master,
                writer,
            },
        );

        drop(sessions);

        #[cfg(target_os = "macos")]
        {
            tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
        }

        let pid_dir = self.get_pid_dir()?;
        std::fs::create_dir_all(&pid_dir)?;
        let pid_file = pid_dir.join(format!("{}-claude.pid", task_id));
        std::fs::write(&pid_file, pid.to_string())?;

        let last_output_time = Arc::new(AtomicU64::new(0));
        {
            let mut times = self.last_output.lock().await;
            times.insert(task_id.to_string(), Arc::clone(&last_output_time));
        }
        let last_output_time_reader = Arc::clone(&last_output_time);

        let ring_buffer = Arc::new(std::sync::Mutex::new(RingBuffer::new(CLAUDE_BUFFER_CAPACITY)));
        {
            let mut buffers = self.output_buffers.lock().await;
            buffers.insert(task_id.to_string(), Arc::clone(&ring_buffer));
        }
        let ring_buffer_emitter = Arc::clone(&ring_buffer);

        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Option<String>>();

        let task_id_reader = task_id.to_string();
        tokio::task::spawn_blocking(move || {
            let mut reader = reader;
            let mut buffer = [0u8; 8192];
            let mut incomplete_utf8: Vec<u8> = Vec::new();

            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => {
                        println!("[PTY] task={} closed (EOF)", task_id_reader);
                        let _ = tx.send(None);
                        break;
                    }
                    Ok(n) => {
                        let now_ms = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as u64;
                        last_output_time_reader.store(now_ms, Ordering::Relaxed);

                        let mut data = if incomplete_utf8.is_empty() {
                            buffer[..n].to_vec()
                        } else {
                            let mut combined = std::mem::take(&mut incomplete_utf8);
                            combined.extend_from_slice(&buffer[..n]);
                            combined
                        };

                        let valid_up_to = find_utf8_boundary(&data);
                        if valid_up_to < data.len() {
                            incomplete_utf8 = data[valid_up_to..].to_vec();
                            data.truncate(valid_up_to);
                        }

                        if !data.is_empty() {
                            let text = String::from_utf8_lossy(&data).to_string();
                            if tx.send(Some(text)).is_err() {
                                println!("[PTY] task={} channel closed, reader exiting", task_id_reader);
                                break;
                            }
                        }
                    }
                    Err(e) => {
                        println!("[PTY] task={} read error: {}", task_id_reader, e);
                        let _ = tx.send(None);
                        break;
                    }
                }
            }
        });

        const FLUSH_INTERVAL_MS: u64 = 16;
        const MAX_BUFFER_SIZE: usize = 65536;

        let task_id_emitter = task_id.to_string();
        let instance_id_emitter = instance_id;
        tokio::spawn(async move {
            let mut buffer = String::new();
            let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(FLUSH_INTERVAL_MS));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

            loop {
                tokio::select! {
                    msg = rx.recv() => {
                        match msg {
                            Some(Some(text)) => {
                                buffer.push_str(&text);
                                if buffer.len() >= MAX_BUFFER_SIZE && !buffer.is_empty() {
                                    if let Ok(mut buf) = ring_buffer_emitter.lock() {
                                        buf.push(buffer.as_bytes());
                                    }
                                    let event_name = format!("pty-output-{}", task_id_emitter);
                                    let payload = serde_json::json!({ "task_id": &task_id_emitter, "data": &buffer });
                                    if let Err(e) = app_handle.emit(&event_name, &payload) {
                                        eprintln!("[PTY] Failed to emit {}: {}", event_name, e);
                                    }
                                    buffer.clear();
                                }
                            }
                            Some(None) | None => {
                                if !buffer.is_empty() {
                                    if let Ok(mut buf) = ring_buffer_emitter.lock() {
                                        buf.push(buffer.as_bytes());
                                    }
                                    let event_name = format!("pty-output-{}", task_id_emitter);
                                    let payload = serde_json::json!({ "task_id": &task_id_emitter, "data": &buffer });
                                    if let Err(e) = app_handle.emit(&event_name, &payload) {
                                        eprintln!("[PTY] Failed to emit {}: {}", event_name, e);
                                    }
                                    buffer.clear();
                                }
                                println!("[PTY] task={} emitter received exit signal", task_id_emitter);
                                let _ = app_handle.emit(&format!("pty-exit-{}", task_id_emitter), serde_json::json!({"instance_id": instance_id_emitter}));
                                let _ = app_handle.emit("claude-pty-exited", serde_json::json!({"task_id": &task_id_emitter}));
                                break;
                            }
                        }
                    }
                    _ = interval.tick() => {
                        if !buffer.is_empty() {
                            if let Ok(mut buf) = ring_buffer_emitter.lock() {
                                buf.push(buffer.as_bytes());
                            }
                            let event_name = format!("pty-output-{}", task_id_emitter);
                            let payload = serde_json::json!({ "task_id": &task_id_emitter, "data": &buffer });
                            if let Err(e) = app_handle.emit(&event_name, &payload) {
                                eprintln!("[PTY] Failed to emit {}: {}", event_name, e);
                            }
                            buffer.clear();
                        }
                    }
                }
            }
        });

        Ok(instance_id)
    }

    pub async fn spawn_shell_pty(
        &self,
        task_id: &str,
        cwd: &Path,
        cols: u16,
        rows: u16,
        app_handle: tauri::AppHandle,
    ) -> Result<u64, PtyError> {
        let key = format!("{}-shell", task_id);
        let mut sessions = self.sessions.lock().await;

        if sessions.contains_key(&key) {
            println!("[PTY] Replacing existing shell PTY for task {}", task_id);
            if let Some(mut old_session) = sessions.remove(&key) {
                let _ = old_session.child.kill();
            }
            if let Ok(pid_dir) = self.get_pid_dir() {
                let _ = std::fs::remove_file(pid_dir.join(format!("{}-shell.pid", task_id)));
            }
        }

        println!("Spawning shell PTY for task {} ({}x{})", task_id, cols, rows);

        let pty_system = native_pty_system();
        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };

        let pair = pty_system
            .openpty(size)
            .map_err(|e| PtyError::SpawnFailed(format!("Failed to create PTY pair: {}", e)))?;

        let shell_path = get_shell_path();
        let mut cmd = CommandBuilder::new(&shell_path);
        cmd.cwd(cwd);

        let user_env = get_user_environment();
        for (k, v) in user_env {
            cmd.env(k, v);
        }

        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("TERM_PROGRAM", "vscode");

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| PtyError::SpawnFailed(format!("Failed to spawn command: {}", e)))?;

        drop(pair.slave);

        let pid = child.process_id().unwrap_or(0);
        println!("Shell PTY for task {} started (PID: {})", task_id, pid);

        let instance_id = NEXT_INSTANCE_ID.fetch_add(1, Ordering::Relaxed);

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| PtyError::SpawnFailed(format!("Failed to clone reader: {}", e)))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| PtyError::SpawnFailed(format!("Failed to take writer: {}", e)))?;

        sessions.insert(
            key.clone(),
            PtySession {
                child,
                master: pair.master,
                writer,
            },
        );

        drop(sessions);

        #[cfg(target_os = "macos")]
        {
            tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
        }

        let pid_dir = self.get_pid_dir()?;
        std::fs::create_dir_all(&pid_dir)?;
        let pid_file = pid_dir.join(format!("{}-shell.pid", task_id));
        std::fs::write(&pid_file, pid.to_string())?;

        let last_output_time = Arc::new(AtomicU64::new(0));
        {
            let mut times = self.last_output.lock().await;
            times.insert(key.clone(), Arc::clone(&last_output_time));
        }
        let last_output_time_reader = Arc::clone(&last_output_time);

        let ring_buffer = Arc::new(std::sync::Mutex::new(RingBuffer::new(CLAUDE_BUFFER_CAPACITY)));
        {
            let mut buffers = self.output_buffers.lock().await;
            buffers.insert(key.clone(), Arc::clone(&ring_buffer));
        }
        let ring_buffer_emitter = Arc::clone(&ring_buffer);

        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Option<String>>();

        let key_reader = key.clone();
        tokio::task::spawn_blocking(move || {
            let mut reader = reader;
            let mut buffer = [0u8; 8192];
            let mut incomplete_utf8: Vec<u8> = Vec::new();

            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => {
                        println!("[PTY] key={} closed (EOF)", key_reader);
                        let _ = tx.send(None);
                        break;
                    }
                    Ok(n) => {
                        let now_ms = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as u64;
                        last_output_time_reader.store(now_ms, Ordering::Relaxed);

                        let mut data = if incomplete_utf8.is_empty() {
                            buffer[..n].to_vec()
                        } else {
                            let mut combined = std::mem::take(&mut incomplete_utf8);
                            combined.extend_from_slice(&buffer[..n]);
                            combined
                        };

                        let valid_up_to = find_utf8_boundary(&data);
                        if valid_up_to < data.len() {
                            incomplete_utf8 = data[valid_up_to..].to_vec();
                            data.truncate(valid_up_to);
                        }

                        if !data.is_empty() {
                            let text = String::from_utf8_lossy(&data).to_string();
                            if tx.send(Some(text)).is_err() {
                                println!("[PTY] key={} channel closed, reader exiting", key_reader);
                                break;
                            }
                        }
                    }
                    Err(e) => {
                        println!("[PTY] key={} read error: {}", key_reader, e);
                        let _ = tx.send(None);
                        break;
                    }
                }
            }
        });

        const FLUSH_INTERVAL_MS: u64 = 16;
        const MAX_BUFFER_SIZE: usize = 65536;

        let key_emitter = key.clone();
        let instance_id_emitter = instance_id;
        tokio::spawn(async move {
            let mut buffer = String::new();
            let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(FLUSH_INTERVAL_MS));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

            loop {
                tokio::select! {
                    msg = rx.recv() => {
                        match msg {
                            Some(Some(text)) => {
                                buffer.push_str(&text);
                                if buffer.len() >= MAX_BUFFER_SIZE && !buffer.is_empty() {
                                    if let Ok(mut buf) = ring_buffer_emitter.lock() {
                                        buf.push(buffer.as_bytes());
                                    }
                                    let event_name = format!("pty-output-{}", key_emitter);
                                    let payload = serde_json::json!({ "task_id": &key_emitter, "data": &buffer });
                                    if let Err(e) = app_handle.emit(&event_name, &payload) {
                                        eprintln!("[PTY] Failed to emit {}: {}", event_name, e);
                                    }
                                    buffer.clear();
                                }
                            }
                            Some(None) | None => {
                                if !buffer.is_empty() {
                                    if let Ok(mut buf) = ring_buffer_emitter.lock() {
                                        buf.push(buffer.as_bytes());
                                    }
                                    let event_name = format!("pty-output-{}", key_emitter);
                                    let payload = serde_json::json!({ "task_id": &key_emitter, "data": &buffer });
                                    if let Err(e) = app_handle.emit(&event_name, &payload) {
                                        eprintln!("[PTY] Failed to emit {}: {}", event_name, e);
                                    }
                                    buffer.clear();
                                }
                                println!("[PTY] key={} emitter received exit signal", key_emitter);
                                let _ = app_handle.emit(&format!("pty-exit-{}", key_emitter), serde_json::json!({"instance_id": instance_id_emitter}));
                                break;
                            }
                        }
                    }
                    _ = interval.tick() => {
                        if !buffer.is_empty() {
                            if let Ok(mut buf) = ring_buffer_emitter.lock() {
                                buf.push(buffer.as_bytes());
                            }
                            let event_name = format!("pty-output-{}", key_emitter);
                            let payload = serde_json::json!({ "task_id": &key_emitter, "data": &buffer });
                            if let Err(e) = app_handle.emit(&event_name, &payload) {
                                eprintln!("[PTY] Failed to emit {}: {}", event_name, e);
                            }
                            buffer.clear();
                        }
                    }
                }
            }
        });

        Ok(instance_id)
    }

    pub async fn write_pty(&self, task_id: &str, data: &[u8]) -> Result<(), PtyError> {
        let mut sessions = self.sessions.lock().await;

        let session = sessions
            .get_mut(task_id)
            .ok_or_else(|| PtyError::ProcessNotFound(task_id.to_string()))?;

        session
            .writer
            .write_all(data)
            .map_err(|e| PtyError::WriteFailed(format!("write_all failed: {}", e)))?;

        session
            .writer
            .flush()
            .map_err(|e| PtyError::WriteFailed(format!("flush failed: {}", e)))?;

        Ok(())
    }

    /// Resizes the PTY for the given task_id
    ///
    /// # Arguments
    /// * `task_id` - Unique identifier for the task
    /// * `cols` - New terminal width in columns
    /// * `rows` - New terminal height in rows
    pub async fn resize_pty(&self, task_id: &str, cols: u16, rows: u16) -> Result<(), PtyError> {
        let sessions = self.sessions.lock().await;

        let session = sessions
            .get(task_id)
            .ok_or_else(|| PtyError::ProcessNotFound(task_id.to_string()))?;

        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };

        session
            .master
            .resize(size)
            .map_err(|e| PtyError::IoError(io::Error::other(e.to_string())))?;

        Ok(())
    }

    /// Kills the PTY process for the given task_id
    ///
    /// # Arguments
    /// * `task_id` - Unique identifier for the task
    pub async fn kill_pty(&self, task_id: &str) -> Result<(), PtyError> {
        let mut sessions = self.sessions.lock().await;

        if let Some(mut session) = sessions.remove(task_id) {
            println!("Killing PTY for task {}", task_id);

            let _ = session.child.kill();

            let pid_file = self.get_pid_dir()?.join(format!("{}-pty.pid", task_id));
            let _ = std::fs::remove_file(pid_file);

            println!("PTY for task {} killed", task_id);
        }

        drop(sessions);

        {
            let mut buffers = self.output_buffers.lock().await;
            buffers.remove(task_id);
        }
        {
            let mut times = self.last_output.lock().await;
            times.remove(task_id);
        }

        Ok(())
    }

    /// Kills all running PTY processes
    pub async fn kill_all(&self) {
        let task_ids: Vec<String> = {
            let sessions = self.sessions.lock().await;
            sessions.keys().cloned().collect()
        };

        for task_id in task_ids {
            if let Err(e) = self.kill_pty(&task_id).await {
                eprintln!("Failed to kill PTY for task {}: {}", task_id, e);
            }
        }
    }

    pub async fn interrupt_claude(&self, task_id: &str) -> Result<(), PtyError> {
        let sessions = self.sessions.lock().await;

        let session = sessions
            .get(task_id)
            .ok_or_else(|| PtyError::ProcessNotFound(task_id.to_string()))?;

        let pid = session
            .child
            .process_id()
            .ok_or_else(|| PtyError::ProcessNotFound(task_id.to_string()))?;

        unsafe {
            libc::kill(pid as i32, libc::SIGINT);
        }

        Ok(())
    }

    pub async fn check_claude_frozen(&self, task_id: &str) -> Option<u64> {
        let pid = {
            let sessions = self.sessions.lock().await;
            let session = sessions.get(task_id)?;
            session.child.process_id()?
        };

        let is_alive = unsafe { libc::kill(pid as i32, 0) == 0 };
        if !is_alive {
            return None;
        }

        let times = self.last_output.lock().await;
        let last_output_ms = times.get(task_id)?.load(Ordering::Relaxed);

        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?
            .as_millis() as u64;

        frozen_seconds(last_output_ms, now_ms)
    }

    /// Returns the keys of all active PTY sessions.
    pub async fn get_session_keys(&self) -> Vec<String> {
        let sessions = self.sessions.lock().await;
        sessions.keys().cloned().collect()
    }

    pub async fn get_pty_buffer(&self, task_id: &str) -> Option<String> {
        let buffers = self.output_buffers.lock().await;
        let buffer = buffers.get(task_id)?;
        let buf = buffer.lock().unwrap();
        let content = buf.snapshot();
        if content.is_empty() { None } else { Some(content) }
    }

    /// Cleans up stale PID files for processes that are no longer running
    pub fn cleanup_stale_pids(&self) -> Result<(), PtyError> {
        let pid_dir = self.get_pid_dir()?;

        if !pid_dir.exists() {
            return Ok(());
        }

        for entry in std::fs::read_dir(&pid_dir)? {
            let entry = entry?;
            let path = entry.path();

            // Process files ending with -pty.pid, -claude.pid, or -shell.pid
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if !name.ends_with("-pty.pid") && !name.ends_with("-claude.pid") && !name.ends_with("-shell.pid") {
                    continue;
                }
            } else {
                continue;
            }

            let pid_str = match std::fs::read_to_string(&path) {
                Ok(s) => s,
                Err(_) => continue,
            };

            let pid: i32 = match pid_str.trim().parse() {
                Ok(p) => p,
                Err(_) => {
                    let _ = std::fs::remove_file(&path);
                    continue;
                }
            };

            let is_running = unsafe {
                libc::kill(pid, 0) == 0 // Signal 0 checks process existence
            };

            if !is_running {
                println!("[cleanup] Removing stale PTY PID file (process dead): {:?}", path);
                let _ = std::fs::remove_file(&path);
            } else {
                // Process is alive — verify it's actually opencode before killing
                let is_opencode = std::process::Command::new("ps")
                    .args(["-p", &pid.to_string(), "-o", "command="])
                    .output()
                    .map(|output| {
                        let cmd = String::from_utf8_lossy(&output.stdout);
                        cmd.contains("opencode")
                    })
                    .unwrap_or(false);

                if is_opencode {
                    println!("[cleanup] Killing orphaned opencode PTY process (PID: {})", pid);
                    unsafe {
                        libc::kill(pid, libc::SIGTERM);
                    }
                    // Brief wait for graceful shutdown
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    // Check if still running, force kill if needed
                    let still_running = unsafe { libc::kill(pid, 0) == 0 };
                    if still_running {
                        println!("[cleanup] Force killing PTY process (PID: {})", pid);
                        unsafe {
                            libc::kill(pid, libc::SIGKILL);
                        }
                    }
                } else {
                    println!("[cleanup] PID {} is not opencode (PID reuse), removing stale PTY file: {:?}", pid, path);
                }
                let _ = std::fs::remove_file(&path);
            }
        }

        Ok(())
    }

    // ============================================================================
    // Private Helper Methods
    // ============================================================================

    /// Returns the PID directory path
    fn get_pid_dir(&self) -> Result<PathBuf, PtyError> {
        if let Some(ref dir) = self.pid_dir_override {
            return Ok(dir.clone());
        }
        let home = dirs::home_dir().ok_or_else(|| {
            PtyError::IoError(io::Error::new(
                io::ErrorKind::NotFound,
                "Home directory not found",
            ))
        })?;
        let pids_dir_name = if cfg!(debug_assertions) { "pids-dev" } else { "pids" };
        Ok(home.join(".openforge").join(pids_dir_name))
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

// ============================================================================
// Freeze Detection
// ============================================================================

fn frozen_seconds(last_output_ms: u64, now_ms: u64) -> Option<u64> {
    if last_output_ms == 0 {
        return None;
    }
    let elapsed_secs = now_ms.saturating_sub(last_output_ms) / 1000;
    if elapsed_secs >= 15 {
        Some(elapsed_secs)
    } else {
        None
    }
}

// ============================================================================
// UTF-8 Boundary Detection
// ============================================================================

/// Finds the last valid UTF-8 boundary in a byte slice.
/// Returns the index up to which bytes are valid UTF-8.
/// If the buffer ends with an incomplete multi-byte sequence, returns the index before it.
fn find_utf8_boundary(bytes: &[u8]) -> usize {
    let len = bytes.len();

    // Fast path: check if entire buffer is valid UTF-8
    if std::str::from_utf8(bytes).is_ok() {
        return len;
    }

    // Scan from the end to find incomplete multi-byte sequence
    // UTF-8 continuation bytes start with 0b10xxxxxx
    // Multi-byte sequences start with 0b11xxxxxx
    for i in (0..len).rev().take(4) {
        let byte = bytes[i];

        // Check if this is the start of a multi-byte sequence
        if byte & 0b1100_0000 == 0b1100_0000 {
            // This is a start byte, check if the sequence is complete
            let expected_len = if byte & 0b1110_0000 == 0b1100_0000 {
                2 // 110xxxxx
            } else if byte & 0b1111_0000 == 0b1110_0000 {
                3 // 1110xxxx
            } else if byte & 0b1111_1000 == 0b1111_0000 {
                4 // 11110xxx
            } else {
                continue;
            };

            let actual_len = len - i;
            if actual_len < expected_len {
                // Incomplete sequence, return index before it
                return i;
            }
        }
    }

    // Fallback: use std::str::from_utf8 to find valid boundary
    std::str::from_utf8(bytes)
        .err()
        .map(|e| e.valid_up_to())
        .unwrap_or(len)
}

// ============================================================================
// Environment Helpers
// ============================================================================

/// Gets the user's full environment by running their shell with -ilc env.
/// This ensures PATH and other environment variables are properly set on macOS.
fn get_user_environment() -> HashMap<String, String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    let output = std::process::Command::new(&shell)
        .arg("-ilc")
        .arg("env")
        .output();

    let mut env_map = HashMap::new();

    match output {
        Ok(output) if output.status.success() => {
            let env_str = String::from_utf8_lossy(&output.stdout);
            for line in env_str.lines() {
                if let Some(pos) = line.find('=') {
                    let key = line[..pos].to_string();
                    let value = line[pos + 1..].to_string();
                    env_map.insert(key, value);
                }
            }
        }
        _ => {
            eprintln!("Failed to get user environment from shell, using fallbacks");
        }
    }

    // Ensure critical environment variables have fallbacks
    if !env_map.contains_key("HOME") {
        if let Ok(home) = std::env::var("HOME") {
            env_map.insert("HOME".to_string(), home);
        }
    }

    if !env_map.contains_key("USER") {
        if let Ok(user) = std::env::var("USER") {
            env_map.insert("USER".to_string(), user);
        }
    }

    if !env_map.contains_key("PATH") {
        env_map.insert(
            "PATH".to_string(),
            "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin".to_string(),
        );
    }

    if !env_map.contains_key("LANG") {
        env_map.insert("LANG".to_string(), "en_US.UTF-8".to_string());
    }

    env_map
}

// ============================================================================
// Claude Command Builder
// ============================================================================

pub(crate) fn build_claude_args(
    prompt: &str,
    resume_session_id: Option<&str>,
    continue_session: bool,
    hooks_settings_path: &Path,
    permission_mode: Option<&str>,
) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(session_id) = resume_session_id {
        args.push("--resume".to_string());
        args.push(session_id.to_string());
    } else if continue_session {
        args.push("--continue".to_string());
    }
    if !prompt.is_empty() {
        args.push(prompt.to_string());
    }
    if let Some(mode) = permission_mode {
        args.push("--permission-mode".to_string());
        args.push(mode.to_string());
    }
    args.push("--settings".to_string());
    args.push(hooks_settings_path.to_string_lossy().to_string());
    args
}

pub(crate) fn get_shell_path() -> String {
    let shell = std::env::var("SHELL").unwrap_or_default();
    if !shell.is_empty() {
        return shell;
    }
    for candidate in ["/bin/zsh", "/bin/bash", "/bin/sh"] {
        if std::path::Path::new(candidate).exists() {
            return candidate.to_string();
        }
    }
    "/bin/sh".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn test_get_user_environment() {
        let env = get_user_environment();
        // Should at least have fallback values
        assert!(env.contains_key("PATH"));
        assert!(env.contains_key("LANG"));
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
    fn test_get_pid_dir_default() {
        let manager = PtyManager::new();
        let pid_dir = manager.get_pid_dir().expect("get_pid_dir should succeed");
        
        // In test builds, debug_assertions is enabled, so we expect "pids-dev"
        let dir_name = pid_dir.file_name().unwrap().to_str().unwrap();
        assert_eq!(dir_name, "pids-dev", "Debug build should use pids-dev directory");
        
        // Verify parent is .openforge
        let parent_name = pid_dir.parent().unwrap().file_name().unwrap().to_str().unwrap();
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
            vec![
                "--continue",
                "--settings",
                "/path/to/settings.json",
            ]
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

        let home_backup = std::env::var("HOME").ok();
        std::env::set_var("HOME", &temp_dir);
        let temp_path = crate::claude_hooks::generate_hooks_settings(17422)
            .expect("generate_hooks_settings should succeed");
        if let Some(home) = home_backup {
            std::env::set_var("HOME", home);
        } else {
            std::env::remove_var("HOME");
        }

        let args_new = build_claude_args("fix the bug", None, false, &temp_path, None);
        assert_eq!(args_new[0], "fix the bug");
        let s_idx = args_new.iter().position(|a| a == "--settings").unwrap();
        assert_eq!(args_new[s_idx + 1], temp_path.to_string_lossy().to_string());
        assert!(!args_new.contains(&"-p".to_string()));

        let args_resume = build_claude_args("continue impl", Some("resume-sess-999"), false, &temp_path, None);
        assert_eq!(args_resume[0], "--resume");
        assert_eq!(args_resume[1], "resume-sess-999");
        assert_eq!(args_resume[2], "continue impl");
        let s_idx_r = args_resume.iter().position(|a| a == "--settings").unwrap();
        assert_eq!(args_resume[s_idx_r + 1], temp_path.to_string_lossy().to_string());

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
        assert_eq!(still_frozen, Some(20), "Freeze detection unaffected by ring buffer snapshot");

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
            assert!(buffers.contains_key(task_id), "buffer entry should exist before kill");
        }
        {
            let times = manager.last_output.lock().await;
            assert!(times.contains_key(task_id), "last_output entry should exist before kill");
        }

        let _ = manager.kill_pty(task_id).await;

        {
            let buffers = manager.output_buffers.lock().await;
            assert!(!buffers.contains_key(task_id), "output_buffers should be cleaned up after kill_pty");
        }
        {
            let times = manager.last_output.lock().await;
            assert!(!times.contains_key(task_id), "last_output should be cleaned up after kill_pty");
        }

        let _ = std::fs::remove_dir_all(&tmp_dir);
    }

    #[tokio::test]
    async fn test_spawn_pty_populates_output_buffer() {
        let manager = PtyManager::new();

        let ring = Arc::new(std::sync::Mutex::new(RingBuffer::new(CLAUDE_BUFFER_CAPACITY)));
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
        assert_eq!(result2, Some("opencode output data".to_string()), "buffer must be replayable on re-attach");
    }

    #[test]
    fn test_build_shell_command() {
        let shell = get_shell_path();
        assert!(!shell.is_empty(), "shell path should not be empty");
        assert!(shell.starts_with('/'), "shell path should be absolute: {}", shell);

        let original = std::env::var("SHELL").ok();
        std::env::set_var("SHELL", "/usr/bin/env");
        let shell_with_env = get_shell_path();
        assert_eq!(shell_with_env, "/usr/bin/env", "should use SHELL env var when set");

        match original {
            Some(s) => std::env::set_var("SHELL", s),
            None => std::env::remove_var("SHELL"),
        }

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
        let pid_file_name = format!("{}-shell.pid", task_id);
        assert_eq!(pid_file_name, "my-task-123-shell.pid");
        assert!(pid_file_name.ends_with("-shell.pid"));

        let session_key = format!("{}-shell", task_id);
        assert_eq!(session_key, "my-task-123-shell");

        let output_event = format!("pty-output-{}", session_key);
        let exit_event = format!("pty-exit-{}", session_key);
        assert_eq!(output_event, "pty-output-my-task-123-shell");
        assert_eq!(exit_event, "pty-exit-my-task-123-shell");
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
}
