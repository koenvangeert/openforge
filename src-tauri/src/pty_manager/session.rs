use crate::app_events::AppEventSender;
use crate::user_environment::user_environment;
use log::{error, info};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex;

use super::commands::{build_claude_args, build_opencode_tui_args, build_pi_args, get_shell_path};
use super::events::{
    spawn_batched_pty_event_emitter, spawn_pty_output_reader, PtyEventEmitterConfig, PtyExitAction,
    RingBuffer, SharedRingBuffer, CLAUDE_BUFFER_CAPACITY,
};
use super::pids::{shell_pid_file_name, shell_session_key};
use super::{PtyError, PtyManager};

pub(super) type PtySessions = Arc<Mutex<HashMap<String, PtySession>>>;
pub(super) type LastOutputTimes = Arc<Mutex<HashMap<String, Arc<AtomicU64>>>>;
pub(super) type PtyOutputBuffers = Arc<Mutex<HashMap<String, SharedRingBuffer>>>;
pub(super) type AgentSpawnGenerations = Arc<Mutex<HashMap<String, u64>>>;

// ============================================================================
// Instance ID Generator
// ============================================================================

pub(super) static NEXT_INSTANCE_ID: AtomicU64 = AtomicU64::new(1);
static NEXT_AGENT_SPAWN_GENERATION: AtomicU64 = AtomicU64::new(1);

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

trait AgentPtyProviderAdapter {
    fn label(&self) -> &'static str;
    fn command_name(&self) -> &'static str;
    fn command_args(&self) -> Vec<String>;
    fn prepare(&mut self, cwd: &Path) -> Result<(), PtyError>;
    fn extra_env(&self, task_id: &str, instance_id: u64) -> HashMap<String, String>;
    fn pid_file_name(&self, task_id: &str) -> String;
    fn track_last_output(&self) -> bool;

    fn stale_pid_file_names(&self, task_id: &str) -> Vec<String> {
        vec![self.pid_file_name(task_id)]
    }
}

struct ClaudeCodePtyAdapter {
    prompt: String,
    resume_session_id: Option<String>,
    continue_session: bool,
    hooks_settings_path: PathBuf,
    permission_mode: Option<String>,
}

impl ClaudeCodePtyAdapter {
    fn new(
        prompt: &str,
        resume_session_id: Option<&str>,
        continue_session: bool,
        hooks_settings_path: &Path,
        permission_mode: Option<&str>,
    ) -> Self {
        Self {
            prompt: prompt.to_string(),
            resume_session_id: resume_session_id.map(str::to_string),
            continue_session,
            hooks_settings_path: hooks_settings_path.to_path_buf(),
            permission_mode: permission_mode.map(str::to_string),
        }
    }
}

impl AgentPtyProviderAdapter for ClaudeCodePtyAdapter {
    fn label(&self) -> &'static str {
        "Claude"
    }

    fn command_name(&self) -> &'static str {
        "claude"
    }

    fn command_args(&self) -> Vec<String> {
        build_claude_args(
            &self.prompt,
            self.resume_session_id.as_deref(),
            self.continue_session,
            &self.hooks_settings_path,
            self.permission_mode.as_deref(),
        )
    }

    fn prepare(&mut self, cwd: &Path) -> Result<(), PtyError> {
        // Pre-approve workspace trust so the "Do you trust this folder?" dialog is skipped.
        if let Err(e) = crate::claude_hooks::ensure_workspace_trusted(cwd) {
            info!(
                "[PTY] Warning: Failed to pre-approve workspace trust: {}",
                e
            );
            // Non-fatal — Claude will just show the trust dialog.
        }
        Ok(())
    }

    fn extra_env(&self, task_id: &str, instance_id: u64) -> HashMap<String, String> {
        HashMap::from([
            ("CLAUDE_TASK_ID".to_string(), task_id.to_string()),
            (
                "OPENFORGE_PTY_INSTANCE_ID".to_string(),
                instance_id.to_string(),
            ),
        ])
    }

    fn pid_file_name(&self, task_id: &str) -> String {
        format!("{}-claude.pid", task_id)
    }

    fn stale_pid_file_names(&self, task_id: &str) -> Vec<String> {
        vec![format!("{}-pty.pid", task_id), self.pid_file_name(task_id)]
    }

    fn track_last_output(&self) -> bool {
        true
    }
}

struct OpenCodePtyAdapter {
    prompt: String,
    resume_session_id: Option<String>,
    continue_session: bool,
    agent: Option<String>,
    model: Option<String>,
}

impl OpenCodePtyAdapter {
    fn new(
        prompt: &str,
        resume_session_id: Option<&str>,
        continue_session: bool,
        agent: Option<&str>,
        model: Option<&str>,
    ) -> Self {
        Self {
            prompt: prompt.to_string(),
            resume_session_id: resume_session_id.map(str::to_string),
            continue_session,
            agent: agent.map(str::to_string),
            model: model.map(str::to_string),
        }
    }
}

impl AgentPtyProviderAdapter for OpenCodePtyAdapter {
    fn label(&self) -> &'static str {
        "OpenCode"
    }

    fn command_name(&self) -> &'static str {
        "opencode"
    }

    fn command_args(&self) -> Vec<String> {
        build_opencode_tui_args(
            &self.prompt,
            self.resume_session_id.as_deref(),
            self.continue_session,
            self.agent.as_deref(),
            self.model.as_deref(),
        )
    }

    fn prepare(&mut self, _cwd: &Path) -> Result<(), PtyError> {
        crate::opencode_plugin::ensure_opencode_plugin_installed()
            .map(|_| ())
            .map_err(|e| PtyError::SpawnFailed(format!("Failed to install OpenCode plugin: {}", e)))
    }

    fn extra_env(&self, task_id: &str, instance_id: u64) -> HashMap<String, String> {
        openforge_agent_env(task_id, instance_id)
    }

    fn pid_file_name(&self, task_id: &str) -> String {
        format!("{}-pty.pid", task_id)
    }

    fn track_last_output(&self) -> bool {
        true
    }
}

struct PiPtyAdapter {
    prompt: String,
    resume_session_id: Option<String>,
    continue_session: bool,
    extension_path: Option<PathBuf>,
}

impl PiPtyAdapter {
    fn new(
        prompt: &str,
        resume_session_id: Option<&str>,
        continue_session: bool,
        extension_path: Option<PathBuf>,
    ) -> Self {
        Self {
            prompt: prompt.to_string(),
            resume_session_id: resume_session_id.map(str::to_string),
            continue_session,
            extension_path,
        }
    }
}

impl AgentPtyProviderAdapter for PiPtyAdapter {
    fn label(&self) -> &'static str {
        "Pi"
    }

    fn command_name(&self) -> &'static str {
        "pi"
    }

    fn command_args(&self) -> Vec<String> {
        build_pi_args(
            &self.prompt,
            self.resume_session_id.as_deref(),
            self.continue_session,
            self.extension_path.as_deref(),
        )
    }

    fn prepare(&mut self, _cwd: &Path) -> Result<(), PtyError> {
        if self.extension_path.is_none() {
            self.extension_path = Some(
                crate::pi_extension::ensure_pi_extension_installed().map_err(|e| {
                    PtyError::SpawnFailed(format!("Failed to install Pi extension: {}", e))
                })?,
            );
        }
        Ok(())
    }

    fn extra_env(&self, task_id: &str, instance_id: u64) -> HashMap<String, String> {
        openforge_agent_env(task_id, instance_id)
    }

    fn pid_file_name(&self, task_id: &str) -> String {
        format!("{}-pty.pid", task_id)
    }

    fn track_last_output(&self) -> bool {
        false
    }
}

fn openforge_agent_env(task_id: &str, instance_id: u64) -> HashMap<String, String> {
    HashMap::from([
        ("OPENFORGE_TASK_ID".to_string(), task_id.to_string()),
        (
            "OPENFORGE_PTY_INSTANCE_ID".to_string(),
            instance_id.to_string(),
        ),
        (
            "OPENFORGE_HTTP_PORT".to_string(),
            crate::claude_hooks::get_http_server_port().to_string(),
        ),
    ])
}

impl PtyManager {
    #[allow(clippy::too_many_arguments)]
    pub async fn spawn_opencode_run_pty(
        &self,
        task_id: &str,
        cwd: &Path,
        prompt: &str,
        resume_session_id: Option<&str>,
        continue_session: bool,
        agent: Option<&str>,
        model: Option<&crate::opencode_client::PromptModel>,
        cols: u16,
        rows: u16,
        app_handle: Option<crate::backend_runtime::AppHandle>,
        app_event_tx: Option<AppEventSender>,
    ) -> Result<u64, PtyError> {
        let model_name = model.map(|model| format!("{}/{}", model.provider_id, model.model_id));
        self.spawn_agent_pty(
            OpenCodePtyAdapter::new(
                prompt,
                resume_session_id,
                continue_session,
                agent,
                model_name.as_deref(),
            ),
            task_id,
            cwd,
            cols,
            rows,
            app_handle,
            app_event_tx,
        )
        .await
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
        app_handle: Option<crate::backend_runtime::AppHandle>,
        app_event_tx: Option<AppEventSender>,
    ) -> Result<u64, PtyError> {
        self.spawn_agent_pty(
            ClaudeCodePtyAdapter::new(
                prompt,
                resume_session_id,
                continue_session,
                hooks_settings_path,
                permission_mode,
            ),
            task_id,
            cwd,
            cols,
            rows,
            app_handle,
            app_event_tx,
        )
        .await
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
        app_handle: Option<crate::backend_runtime::AppHandle>,
        app_event_tx: Option<AppEventSender>,
    ) -> Result<u64, PtyError> {
        self.spawn_agent_pty(
            PiPtyAdapter::new(prompt, resume_session_id, continue_session, None),
            task_id,
            cwd,
            cols,
            rows,
            app_handle,
            app_event_tx,
        )
        .await
    }

    async fn is_current_agent_spawn(&self, task_id: &str, generation: u64) -> bool {
        let generations = self.agent_spawn_generations.lock().await;
        generations
            .get(task_id)
            .map(|current| *current == generation)
            .unwrap_or(false)
    }

    async fn is_current_agent_session(&self, task_id: &str, instance_id: u64) -> bool {
        let sessions = self.sessions.lock().await;
        sessions
            .get(task_id)
            .map(|session| session.instance_id == instance_id)
            .unwrap_or(false)
    }

    async fn is_current_agent_spawn_and_session(
        &self,
        task_id: &str,
        generation: u64,
        instance_id: u64,
    ) -> bool {
        self.is_current_agent_spawn(task_id, generation).await
            && self.is_current_agent_session(task_id, instance_id).await
    }

    async fn spawn_agent_pty<A: AgentPtyProviderAdapter>(
        &self,
        mut adapter: A,
        task_id: &str,
        cwd: &Path,
        cols: u16,
        rows: u16,
        app_handle: Option<crate::backend_runtime::AppHandle>,
        app_event_tx: Option<AppEventSender>,
    ) -> Result<u64, PtyError> {
        let spawn_generation = NEXT_AGENT_SPAWN_GENERATION.fetch_add(1, Ordering::Relaxed);
        {
            let mut generations = self.agent_spawn_generations.lock().await;
            generations.insert(task_id.to_string(), spawn_generation);
        }

        let old_session = {
            let mut sessions = self.sessions.lock().await;
            sessions.remove(task_id)
        };

        if let Some(mut old_session) = old_session {
            info!(
                "[PTY] Replacing existing {} PTY for task {}",
                adapter.label(),
                task_id
            );
            let _ = old_session.child.kill();
            if let Ok(pid_dir) = self.get_pid_dir() {
                for file_name in adapter.stale_pid_file_names(task_id) {
                    let _ = std::fs::remove_file(pid_dir.join(file_name));
                }
            }
            {
                let mut times = self.last_output.lock().await;
                times.remove(task_id);
            }
            {
                let mut buffers = self.output_buffers.lock().await;
                buffers.remove(task_id);
            }
        }

        adapter.prepare(cwd)?;

        info!(
            "Spawning {} PTY for task {} ({}x{})",
            adapter.label(),
            task_id,
            cols,
            rows
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

        let instance_id = NEXT_INSTANCE_ID.fetch_add(1, Ordering::Relaxed);
        let mut cmd = CommandBuilder::new(adapter.command_name());
        for arg in adapter.command_args() {
            cmd.arg(arg);
        }
        cmd.cwd(cwd);

        for (key, value) in user_environment() {
            cmd.env(key, value);
        }

        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("TERM_PROGRAM", "vscode");
        for (key, value) in adapter.extra_env(task_id, instance_id) {
            cmd.env(key, value);
        }

        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| PtyError::SpawnFailed(format!("Failed to spawn command: {}", e)))?;

        drop(pair.slave);

        let pid = child.process_id().unwrap_or(0);
        info!(
            "{} PTY for task {} started (PID: {})",
            adapter.label(),
            task_id,
            pid
        );

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| PtyError::SpawnFailed(format!("Failed to clone reader: {}", e)))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| PtyError::SpawnFailed(format!("Failed to take writer: {}", e)))?;

        let replaced_session = {
            let generations = self.agent_spawn_generations.lock().await;
            if generations
                .get(task_id)
                .map(|current| *current != spawn_generation)
                .unwrap_or(true)
            {
                let _ = child.kill();
                return Err(PtyError::SpawnFailed(format!(
                    "{} PTY for task {} was replaced before session registration completed",
                    adapter.label(),
                    task_id
                )));
            }

            let mut sessions = self.sessions.lock().await;
            let replaced_session = sessions.insert(
                task_id.to_string(),
                PtySession {
                    child,
                    master: pair.master,
                    writer,
                    instance_id,
                },
            );
            drop(sessions);
            drop(generations);
            replaced_session
        };

        if let Some(mut replaced_session) = replaced_session {
            info!(
                "[PTY] Replacing existing {} PTY for task {}",
                adapter.label(),
                task_id
            );
            let _ = replaced_session.child.kill();
            if let Ok(pid_dir) = self.get_pid_dir() {
                for file_name in adapter.stale_pid_file_names(task_id) {
                    let _ = std::fs::remove_file(pid_dir.join(file_name));
                }
            }
            {
                let mut times = self.last_output.lock().await;
                times.remove(task_id);
            }
            {
                let mut buffers = self.output_buffers.lock().await;
                buffers.remove(task_id);
            }
        }

        #[cfg(target_os = "macos")]
        {
            tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
        }

        if !self
            .is_current_agent_spawn_and_session(task_id, spawn_generation, instance_id)
            .await
        {
            return Err(PtyError::SpawnFailed(format!(
                "{} PTY for task {} was replaced before setup completed",
                adapter.label(),
                task_id
            )));
        }

        let pid_dir = self.get_pid_dir()?;
        std::fs::create_dir_all(&pid_dir)?;
        let pid_file = pid_dir.join(adapter.pid_file_name(task_id));
        let pid_string = pid.to_string();
        std::fs::write(&pid_file, &pid_string)?;
        if !self
            .is_current_agent_spawn_and_session(task_id, spawn_generation, instance_id)
            .await
        {
            if std::fs::read_to_string(&pid_file).ok().as_deref() == Some(pid_string.as_str()) {
                let _ = std::fs::remove_file(&pid_file);
            }
            return Err(PtyError::SpawnFailed(format!(
                "{} PTY for task {} was replaced before PID registration completed",
                adapter.label(),
                task_id
            )));
        }

        let last_output_time = adapter
            .track_last_output()
            .then(|| Arc::new(AtomicU64::new(0)));
        if let Some(last_output_time) = &last_output_time {
            let mut times = self.last_output.lock().await;
            times.insert(task_id.to_string(), Arc::clone(last_output_time));
        }
        if !self
            .is_current_agent_spawn_and_session(task_id, spawn_generation, instance_id)
            .await
        {
            if let Some(last_output_time) = &last_output_time {
                let mut times = self.last_output.lock().await;
                if times
                    .get(task_id)
                    .map(|stored| Arc::ptr_eq(stored, last_output_time))
                    .unwrap_or(false)
                {
                    times.remove(task_id);
                }
            }
            return Err(PtyError::SpawnFailed(format!(
                "{} PTY for task {} was replaced before output tracking completed",
                adapter.label(),
                task_id
            )));
        }

        let ring_buffer = Arc::new(std::sync::Mutex::new(RingBuffer::new(
            CLAUDE_BUFFER_CAPACITY,
        )));
        {
            let mut buffers = self.output_buffers.lock().await;
            buffers.insert(task_id.to_string(), Arc::clone(&ring_buffer));
        }
        if !self
            .is_current_agent_spawn_and_session(task_id, spawn_generation, instance_id)
            .await
        {
            let mut buffers = self.output_buffers.lock().await;
            if buffers
                .get(task_id)
                .map(|stored| Arc::ptr_eq(stored, &ring_buffer))
                .unwrap_or(false)
            {
                buffers.remove(task_id);
            }
            return Err(PtyError::SpawnFailed(format!(
                "{} PTY for task {} was replaced before output buffer registration completed",
                adapter.label(),
                task_id
            )));
        }
        let ring_buffer_emitter = Arc::clone(&ring_buffer);

        if !self
            .is_current_agent_spawn_and_session(task_id, spawn_generation, instance_id)
            .await
        {
            return Err(PtyError::SpawnFailed(format!(
                "{} PTY for task {} was replaced before event streaming started",
                adapter.label(),
                task_id
            )));
        }

        let rx = spawn_pty_output_reader(
            reader,
            task_id.to_string(),
            last_output_time.as_ref().map(Arc::clone),
        );
        spawn_batched_pty_event_emitter(
            rx,
            PtyEventEmitterConfig {
                session_key: task_id.to_string(),
                instance_id,
                app_handle,
                app_event_tx,
                ring_buffer: ring_buffer_emitter,
                exit_action: PtyExitAction::Cleanup {
                    sessions: Arc::clone(&self.sessions),
                    last_output: Arc::clone(&self.last_output),
                    output_buffers: Arc::clone(&self.output_buffers),
                    pid_file,
                    emit_agent_exit: true,
                },
            },
        );

        {
            let mut generations = self.agent_spawn_generations.lock().await;
            if generations
                .get(task_id)
                .map(|current| *current == spawn_generation)
                .unwrap_or(false)
            {
                generations.remove(task_id);
            } else {
                return Err(PtyError::SpawnFailed(format!(
                    "{} PTY for task {} was replaced before setup finished",
                    adapter.label(),
                    task_id
                )));
            }
        }

        Ok(instance_id)
    }

    pub async fn spawn_shell_pty(
        &self,
        task_id: &str,
        cwd: &Path,
        cols: u16,
        rows: u16,
        terminal_index: Option<u32>,
        app_handle: Option<crate::backend_runtime::AppHandle>,
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
                exit_action: PtyExitAction::Cleanup {
                    sessions: Arc::clone(&self.sessions),
                    last_output: Arc::clone(&self.last_output),
                    output_buffers: Arc::clone(&self.output_buffers),
                    pid_file,
                    emit_agent_exit: false,
                },
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
        {
            let mut generations = self.agent_spawn_generations.lock().await;
            generations.remove(task_id);
        }

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

            if let Ok(pid_dir) = self.get_pid_dir() {
                let _ = std::fs::remove_file(pid_dir.join(format!("{}.pid", key)));
            }

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};
    use std::sync::mpsc;
    use std::time::Duration;

    struct LockCheckingAgentAdapter {
        sessions: PtySessions,
        prepared_tx: Option<mpsc::Sender<()>>,
        command_delay: Duration,
        output: &'static str,
        check_lock: bool,
    }

    impl LockCheckingAgentAdapter {
        fn assert_sessions_unlocked(&self, phase: &str) {
            if self.check_lock {
                assert!(
                    self.sessions.try_lock().is_ok(),
                    "sessions mutex should not be held during {phase}"
                );
            }
        }
    }

    impl AgentPtyProviderAdapter for LockCheckingAgentAdapter {
        fn label(&self) -> &'static str {
            "LockChecking"
        }

        fn command_name(&self) -> &'static str {
            "/bin/sh"
        }

        fn command_args(&self) -> Vec<String> {
            self.assert_sessions_unlocked("command argument construction");
            if !self.command_delay.is_zero() {
                std::thread::sleep(self.command_delay);
            }
            vec![
                "-lc".to_string(),
                format!("printf {}; sleep 5", self.output),
            ]
        }

        fn prepare(&mut self, _cwd: &Path) -> Result<(), PtyError> {
            self.assert_sessions_unlocked("provider preparation");
            if let Some(prepared_tx) = self.prepared_tx.take() {
                let _ = prepared_tx.send(());
            }
            Ok(())
        }

        fn extra_env(&self, _task_id: &str, _instance_id: u64) -> HashMap<String, String> {
            self.assert_sessions_unlocked("provider environment construction");
            HashMap::new()
        }

        fn pid_file_name(&self, task_id: &str) -> String {
            format!("{}-pty.pid", task_id)
        }

        fn track_last_output(&self) -> bool {
            true
        }
    }

    #[tokio::test]
    async fn agent_spawn_keeps_session_mutex_out_of_provider_and_command_work() {
        let mut manager = PtyManager::new();
        let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
        manager.set_pid_dir(tmp_dir.path().to_path_buf());
        let task_id = "lock-free-agent-spawn";
        let adapter = LockCheckingAgentAdapter {
            sessions: Arc::clone(&manager.sessions),
            prepared_tx: None,
            command_delay: Duration::ZERO,
            output: "lock-free-agent",
            check_lock: true,
        };

        manager
            .spawn_agent_pty(adapter, task_id, tmp_dir.path(), 80, 24, None, None)
            .await
            .expect("agent PTY should spawn without holding sessions lock during slow setup");

        assert!(
            tmp_dir.path().join(format!("{task_id}-pty.pid")).exists(),
            "PID file should still be written after spawn"
        );
        assert!(
            manager.output_buffers.lock().await.contains_key(task_id),
            "output buffer should still be registered for replay"
        );
        assert!(
            manager.last_output.lock().await.contains_key(task_id),
            "last-output tracking should still be registered for frozen detection"
        );

        manager
            .kill_pty(task_id)
            .await
            .expect("test PTY should be cleaned up");
        assert!(
            !tmp_dir.path().join(format!("{task_id}-pty.pid")).exists(),
            "PID file should be removed on cleanup"
        );
        assert!(
            !manager.output_buffers.lock().await.contains_key(task_id),
            "output buffer should be removed on explicit kill"
        );
        assert!(
            !manager.last_output.lock().await.contains_key(task_id),
            "last-output tracking should be removed on explicit kill"
        );
    }

    #[tokio::test]
    async fn newer_agent_spawn_wins_when_older_spawn_finishes_setup_late() {
        let mut manager = PtyManager::new();
        let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
        manager.set_pid_dir(tmp_dir.path().to_path_buf());
        let task_id = "concurrent-agent-spawn";
        let (old_prepared_tx, old_prepared_rx) = mpsc::channel();

        let old_manager = manager.clone();
        let old_cwd = tmp_dir.path().to_path_buf();
        let old_task_id = task_id.to_string();
        let old_adapter = LockCheckingAgentAdapter {
            sessions: Arc::clone(&manager.sessions),
            prepared_tx: Some(old_prepared_tx),
            command_delay: Duration::from_millis(150),
            output: "old-agent",
            check_lock: false,
        };
        let old_spawn = std::thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("test runtime should build");
            runtime.block_on(old_manager.spawn_agent_pty(
                old_adapter,
                &old_task_id,
                &old_cwd,
                80,
                24,
                None,
                None,
            ))
        });

        old_prepared_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("older spawn should reach provider preparation");

        let new_adapter = LockCheckingAgentAdapter {
            sessions: Arc::clone(&manager.sessions),
            prepared_tx: None,
            command_delay: Duration::ZERO,
            output: "new-agent",
            check_lock: false,
        };
        let new_instance_id = manager
            .spawn_agent_pty(new_adapter, task_id, tmp_dir.path(), 80, 24, None, None)
            .await
            .expect("newer spawn should become current");

        let old_result = old_spawn.join().expect("older spawn task should join");
        assert!(
            matches!(old_result, Err(PtyError::SpawnFailed(ref message)) if message.contains("replaced before session registration")),
            "older spawn should abort instead of replacing the newer session: {old_result:?}"
        );

        {
            let sessions = manager.sessions.lock().await;
            let session = sessions
                .get(task_id)
                .expect("newer session should remain registered");
            assert_eq!(session.instance_id, new_instance_id);
        }
        assert!(
            manager.output_buffers.lock().await.contains_key(task_id),
            "newer spawn should keep output buffer registration"
        );
        assert!(
            manager.last_output.lock().await.contains_key(task_id),
            "newer spawn should keep last-output registration"
        );

        manager
            .kill_pty(task_id)
            .await
            .expect("newer test PTY should be cleaned up");
    }

    #[tokio::test]
    async fn kill_pty_cancels_agent_spawn_before_session_insert() {
        let mut manager = PtyManager::new();
        let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
        manager.set_pid_dir(tmp_dir.path().to_path_buf());
        let task_id = "kill-pending-agent-spawn";
        let (prepared_tx, prepared_rx) = mpsc::channel();

        let spawn_manager = manager.clone();
        let spawn_cwd = tmp_dir.path().to_path_buf();
        let spawn_task_id = task_id.to_string();
        let adapter = LockCheckingAgentAdapter {
            sessions: Arc::clone(&manager.sessions),
            prepared_tx: Some(prepared_tx),
            command_delay: Duration::from_millis(150),
            output: "killed-agent",
            check_lock: false,
        };
        let pending_spawn = std::thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("test runtime should build");
            runtime.block_on(spawn_manager.spawn_agent_pty(
                adapter,
                &spawn_task_id,
                &spawn_cwd,
                80,
                24,
                None,
                None,
            ))
        });

        prepared_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("spawn should reach provider preparation");
        manager
            .kill_pty(task_id)
            .await
            .expect("kill during pending spawn should be accepted");

        let spawn_result = pending_spawn
            .join()
            .expect("pending spawn thread should join");
        assert!(
            matches!(spawn_result, Err(PtyError::SpawnFailed(ref message)) if message.contains("replaced before session registration")),
            "pending spawn should abort after kill_pty invalidates it: {spawn_result:?}"
        );
        assert!(
            !manager.sessions.lock().await.contains_key(task_id),
            "killed pending spawn must not insert a session"
        );
        assert!(
            !tmp_dir.path().join(format!("{task_id}-pty.pid")).exists(),
            "killed pending spawn must not leave a PID file"
        );
        assert!(
            !manager.output_buffers.lock().await.contains_key(task_id),
            "killed pending spawn must not register an output buffer"
        );
        assert!(
            !manager.last_output.lock().await.contains_key(task_id),
            "killed pending spawn must not register last-output tracking"
        );
    }

    #[test]
    fn claude_adapter_owns_provider_specific_spawn_details() {
        let adapter = ClaudeCodePtyAdapter::new(
            "implement this",
            Some("claude-session"),
            true,
            Path::new("/tmp/claude-settings.json"),
            Some("plan"),
        );

        assert_eq!(adapter.label(), "Claude");
        assert_eq!(adapter.command_name(), "claude");
        assert_eq!(
            adapter.command_args(),
            vec![
                "--resume",
                "claude-session",
                "implement this",
                "--permission-mode",
                "plan",
                "--settings",
                "/tmp/claude-settings.json",
            ]
        );
        assert_eq!(adapter.pid_file_name("task-1"), "task-1-claude.pid");
        assert_eq!(
            adapter.stale_pid_file_names("task-1"),
            vec!["task-1-pty.pid", "task-1-claude.pid"]
        );
        assert!(adapter.track_last_output());

        let env = adapter.extra_env("task-1", 42);
        assert_eq!(env.get("CLAUDE_TASK_ID"), Some(&"task-1".to_string()));
        assert_eq!(
            env.get("OPENFORGE_PTY_INSTANCE_ID"),
            Some(&"42".to_string())
        );
        assert!(!env.contains_key("OPENFORGE_TASK_ID"));
        assert!(!env.contains_key("OPENFORGE_HTTP_PORT"));
    }

    #[test]
    fn opencode_adapter_owns_provider_specific_spawn_details() {
        let adapter = OpenCodePtyAdapter::new(
            "fix it",
            Some("opencode-session"),
            false,
            Some("build"),
            Some("anthropic/claude-sonnet-4"),
        );

        assert_eq!(adapter.label(), "OpenCode");
        assert_eq!(adapter.command_name(), "opencode");
        assert_eq!(
            adapter.command_args(),
            vec![
                "--session",
                "opencode-session",
                "--agent",
                "build",
                "--model",
                "anthropic/claude-sonnet-4",
                "--prompt",
                "fix it",
            ]
        );
        assert_eq!(adapter.pid_file_name("task-1"), "task-1-pty.pid");
        assert_eq!(
            adapter.stale_pid_file_names("task-1"),
            vec!["task-1-pty.pid"]
        );
        assert!(adapter.track_last_output());

        let env = adapter.extra_env("task-1", 7);
        assert_eq!(env.get("OPENFORGE_TASK_ID"), Some(&"task-1".to_string()));
        assert_eq!(env.get("OPENFORGE_PTY_INSTANCE_ID"), Some(&"7".to_string()));
        assert!(env.contains_key("OPENFORGE_HTTP_PORT"));
        assert!(!env.contains_key("CLAUDE_TASK_ID"));
    }

    #[test]
    fn pi_adapter_owns_provider_specific_spawn_details() {
        let adapter = PiPtyAdapter::new(
            "continue work",
            Some("pi-session"),
            true,
            Some(PathBuf::from("/tmp/openforge-pi-extension")),
        );

        assert_eq!(adapter.label(), "Pi");
        assert_eq!(adapter.command_name(), "pi");
        assert_eq!(
            adapter.command_args(),
            vec![
                "-e",
                "/tmp/openforge-pi-extension",
                "--session",
                "pi-session",
                "continue work",
            ]
        );
        assert_eq!(adapter.pid_file_name("task-1"), "task-1-pty.pid");
        assert_eq!(
            adapter.stale_pid_file_names("task-1"),
            vec!["task-1-pty.pid"]
        );
        assert!(!adapter.track_last_output());

        let env = adapter.extra_env("task-1", 9);
        assert_eq!(env.get("OPENFORGE_TASK_ID"), Some(&"task-1".to_string()));
        assert_eq!(env.get("OPENFORGE_PTY_INSTANCE_ID"), Some(&"9".to_string()));
        assert!(env.contains_key("OPENFORGE_HTTP_PORT"));
        assert!(!env.contains_key("CLAUDE_TASK_ID"));
    }
}
