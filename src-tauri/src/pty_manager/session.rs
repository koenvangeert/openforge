use crate::app_events::AppEventSender;
use crate::user_environment::user_environment;
use log::{error, info};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::{self, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex;

use super::commands::{build_claude_args, build_pi_args, get_shell_path};
use super::events::{
    spawn_batched_pty_event_emitter, spawn_pty_output_reader, PtyEventEmitterConfig, PtyExitAction,
    RingBuffer, SharedRingBuffer, CLAUDE_BUFFER_CAPACITY,
};
use super::pids::{shell_pid_file_name, shell_session_key};
use super::{PtyError, PtyManager};

pub(super) type PtySessions = Arc<Mutex<HashMap<String, PtySession>>>;
pub(super) type LastOutputTimes = Arc<Mutex<HashMap<String, Arc<AtomicU64>>>>;
pub(super) type PtyOutputBuffers = Arc<Mutex<HashMap<String, SharedRingBuffer>>>;

// ============================================================================
// Instance ID Generator
// ============================================================================

pub(super) static NEXT_INSTANCE_ID: AtomicU64 = AtomicU64::new(1);

// ============================================================================
// PTY Session
// ============================================================================

pub(super) struct PtySession {
    #[allow(dead_code)]
    pub(super) child: Box<dyn portable_pty::Child + Send + Sync>,
    #[allow(dead_code)]
    pub(super) master: Box<dyn portable_pty::MasterPty + Send>,
    pub(super) writer: Box<dyn std::io::Write + Send>,
    pub(super) instance_id: u64,
}

impl PtyManager {
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
        app_handle: Option<tauri::AppHandle>,
        app_event_tx: Option<AppEventSender>,
    ) -> Result<u64, PtyError> {
        let mut sessions = self.sessions.lock().await;

        if sessions.contains_key(task_id) {
            info!("[PTY] Replacing existing PTY for task {}", task_id);
            if let Some(mut old_session) = sessions.remove(task_id) {
                let _ = old_session.child.kill();
            }
            // Clean up old PID file (will be recreated below)
            if let Ok(pid_dir) = self.get_pid_dir() {
                let _ = std::fs::remove_file(pid_dir.join(format!("{}-pty.pid", task_id)));
            }
        }

        info!("Spawning PTY for task {} ({}x{})", task_id, cols, rows);

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
        for (key, value) in user_environment() {
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
        info!("PTY for task {} started (PID: {})", task_id, pid);

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
                instance_id,
            },
        );

        // Release the lock before spawning the reader thread
        drop(sessions);

        let ring_buffer = Arc::new(std::sync::Mutex::new(RingBuffer::new(
            CLAUDE_BUFFER_CAPACITY,
        )));
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

        let rx = spawn_pty_output_reader(reader, task_id.to_string(), None);
        spawn_batched_pty_event_emitter(
            rx,
            PtyEventEmitterConfig {
                session_key: task_id.to_string(),
                instance_id,
                app_handle,
                app_event_tx,
                ring_buffer: ring_buffer_emitter,
                exit_action: PtyExitAction::EmitOnly,
            },
        );

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
        app_handle: Option<tauri::AppHandle>,
        app_event_tx: Option<AppEventSender>,
    ) -> Result<u64, PtyError> {
        let mut sessions = self.sessions.lock().await;

        if sessions.contains_key(task_id) {
            info!("[PTY] Replacing existing PTY for task {}", task_id);
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
            info!(
                "[PTY] Warning: Failed to pre-approve workspace trust: {}",
                e
            );
            // Non-fatal — Claude will just show the trust dialog
        }

        info!(
            "Spawning Claude PTY for task {} ({}x{})",
            task_id, cols, rows
        );

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
        for arg in build_claude_args(
            prompt,
            resume_session_id,
            continue_session,
            hooks_settings_path,
            permission_mode,
        ) {
            cmd.arg(arg);
        }
        cmd.cwd(cwd);

        for (key, value) in user_environment() {
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
        info!("Claude PTY for task {} started (PID: {})", task_id, pid);

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
                instance_id,
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
        let ring_buffer = Arc::new(std::sync::Mutex::new(RingBuffer::new(
            CLAUDE_BUFFER_CAPACITY,
        )));
        {
            let mut buffers = self.output_buffers.lock().await;
            buffers.insert(task_id.to_string(), Arc::clone(&ring_buffer));
        }
        let ring_buffer_emitter = Arc::clone(&ring_buffer);

        let rx = spawn_pty_output_reader(
            reader,
            task_id.to_string(),
            Some(Arc::clone(&last_output_time)),
        );
        spawn_batched_pty_event_emitter(
            rx,
            PtyEventEmitterConfig {
                session_key: task_id.to_string(),
                instance_id,
                app_handle,
                app_event_tx,
                ring_buffer: ring_buffer_emitter,
                exit_action: PtyExitAction::FinalizeAgent {
                    sessions: Arc::clone(&self.sessions),
                    last_output: Arc::clone(&self.last_output),
                    output_buffers: Arc::clone(&self.output_buffers),
                    pid_file,
                },
            },
        );

        Ok(instance_id)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn spawn_pi_pty(
        &self,
        task_id: &str,
        cwd: &Path,
        prompt: &str,
        resume_session_id: Option<&str>,
        continue_session: bool,
        cols: u16,
        rows: u16,
        app_handle: Option<tauri::AppHandle>,
        app_event_tx: Option<AppEventSender>,
    ) -> Result<u64, PtyError> {
        let mut sessions = self.sessions.lock().await;

        if sessions.contains_key(task_id) {
            info!("[PTY] Replacing existing Pi PTY for task {}", task_id);
            if let Some(mut old_session) = sessions.remove(task_id) {
                let _ = old_session.child.kill();
            }
            if let Ok(pid_dir) = self.get_pid_dir() {
                let _ = std::fs::remove_file(pid_dir.join(format!("{}-pty.pid", task_id)));
            }
        }

        info!("Spawning Pi PTY for task {} ({}x{})", task_id, cols, rows);

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

        let pi_extension_path = crate::pi_extension::ensure_pi_extension_installed()
            .map_err(|e| PtyError::SpawnFailed(format!("Failed to install Pi extension: {}", e)))?;
        let instance_id = NEXT_INSTANCE_ID.fetch_add(1, Ordering::Relaxed);

        let mut cmd = CommandBuilder::new("pi");
        for arg in build_pi_args(
            prompt,
            resume_session_id,
            continue_session,
            Some(pi_extension_path.as_path()),
        ) {
            cmd.arg(arg);
        }
        cmd.cwd(cwd);

        for (key, value) in user_environment() {
            cmd.env(key, value);
        }

        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("TERM_PROGRAM", "vscode");
        cmd.env("OPENFORGE_TASK_ID", task_id);
        cmd.env("OPENFORGE_PTY_INSTANCE_ID", instance_id.to_string());
        cmd.env(
            "OPENFORGE_HTTP_PORT",
            crate::claude_hooks::get_http_server_port().to_string(),
        );

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| PtyError::SpawnFailed(format!("Failed to spawn command: {}", e)))?;

        drop(pair.slave);

        let pid = child.process_id().unwrap_or(0);
        info!("Pi PTY for task {} started (PID: {})", task_id, pid);

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
                instance_id,
            },
        );

        drop(sessions);

        #[cfg(target_os = "macos")]
        {
            tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
        }

        let pid_dir = self.get_pid_dir()?;
        std::fs::create_dir_all(&pid_dir)?;
        let pid_file = pid_dir.join(format!("{}-pty.pid", task_id));
        std::fs::write(&pid_file, pid.to_string())?;

        let ring_buffer = Arc::new(std::sync::Mutex::new(RingBuffer::new(
            CLAUDE_BUFFER_CAPACITY,
        )));
        {
            let mut buffers = self.output_buffers.lock().await;
            buffers.insert(task_id.to_string(), Arc::clone(&ring_buffer));
        }
        let ring_buffer_emitter = Arc::clone(&ring_buffer);

        let rx = spawn_pty_output_reader(reader, task_id.to_string(), None);
        spawn_batched_pty_event_emitter(
            rx,
            PtyEventEmitterConfig {
                session_key: task_id.to_string(),
                instance_id,
                app_handle,
                app_event_tx,
                ring_buffer: ring_buffer_emitter,
                exit_action: PtyExitAction::FinalizeAgent {
                    sessions: Arc::clone(&self.sessions),
                    last_output: Arc::clone(&self.last_output),
                    output_buffers: Arc::clone(&self.output_buffers),
                    pid_file,
                },
            },
        );

        Ok(instance_id)
    }

    pub async fn spawn_shell_pty(
        &self,
        task_id: &str,
        cwd: &Path,
        cols: u16,
        rows: u16,
        terminal_index: Option<u32>,
        app_handle: Option<tauri::AppHandle>,
        app_event_tx: Option<AppEventSender>,
    ) -> Result<u64, PtyError> {
        let key = shell_session_key(task_id, terminal_index);
        let mut sessions = self.sessions.lock().await;

        if sessions.contains_key(&key) {
            info!("[PTY] Replacing existing shell PTY for task {}", task_id);
            if let Some(mut old_session) = sessions.remove(&key) {
                let _ = old_session.child.kill();
            }
            if let Ok(pid_dir) = self.get_pid_dir() {
                let _ = std::fs::remove_file(
                    pid_dir.join(shell_pid_file_name(task_id, terminal_index)),
                );
            }
        }

        info!(
            "Spawning shell PTY for task {} ({}x{})",
            task_id, cols, rows
        );

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

        for (key, value) in user_environment() {
            cmd.env(key, value);
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
        info!("Shell PTY for task {} started (PID: {})", task_id, pid);

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
                instance_id,
            },
        );

        drop(sessions);

        #[cfg(target_os = "macos")]
        {
            tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
        }

        let pid_dir = self.get_pid_dir()?;
        std::fs::create_dir_all(&pid_dir)?;
        let pid_file = pid_dir.join(shell_pid_file_name(task_id, terminal_index));
        std::fs::write(&pid_file, pid.to_string())?;

        let last_output_time = Arc::new(AtomicU64::new(0));
        {
            let mut times = self.last_output.lock().await;
            times.insert(key.clone(), Arc::clone(&last_output_time));
        }
        let ring_buffer = Arc::new(std::sync::Mutex::new(RingBuffer::new(
            CLAUDE_BUFFER_CAPACITY,
        )));
        {
            let mut buffers = self.output_buffers.lock().await;
            buffers.insert(key.clone(), Arc::clone(&ring_buffer));
        }
        let ring_buffer_emitter = Arc::clone(&ring_buffer);

        let rx = spawn_pty_output_reader(reader, key.clone(), Some(Arc::clone(&last_output_time)));
        spawn_batched_pty_event_emitter(
            rx,
            PtyEventEmitterConfig {
                session_key: key.clone(),
                instance_id,
                app_handle,
                app_event_tx,
                ring_buffer: ring_buffer_emitter,
                exit_action: PtyExitAction::EmitOnly,
            },
        );

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
            info!("Killing PTY for task {}", task_id);

            let _ = session.child.kill();

            let pid_file = self.get_pid_dir()?.join(format!("{}-pty.pid", task_id));
            let _ = std::fs::remove_file(pid_file);

            info!("PTY for task {} killed", task_id);
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

    pub async fn kill_shells_for_task(&self, task_id: &str) {
        let keys_to_kill: Vec<String> = {
            let sessions = self.sessions.lock().await;
            sessions
                .keys()
                .filter(|k| k.starts_with(&format!("{}-shell-", task_id)))
                .cloned()
                .collect()
        };

        for key in keys_to_kill {
            let mut sessions = self.sessions.lock().await;
            if let Some(mut session) = sessions.remove(&key) {
                info!("Killing shell PTY for key {}", key);
                let _ = session.child.kill();
            }
            drop(sessions);

            {
                let mut buffers = self.output_buffers.lock().await;
                buffers.remove(&key);
            }
            {
                let mut times = self.last_output.lock().await;
                times.remove(&key);
            }
        }
    }

    /// Kills all running PTY processes
    pub async fn kill_all(&self) {
        let task_ids: Vec<String> = {
            let sessions = self.sessions.lock().await;
            sessions.keys().cloned().collect()
        };

        for task_id in task_ids {
            if let Err(e) = self.kill_pty(&task_id).await {
                error!("Failed to kill PTY for task {}: {}", task_id, e);
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
        if content.is_empty() {
            None
        } else {
            Some(content)
        }
    }
}

// ============================================================================
// Freeze Detection
// ============================================================================

pub(super) fn frozen_seconds(last_output_ms: u64, now_ms: u64) -> Option<u64> {
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
