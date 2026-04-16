use log::{error, info, warn};
use serde::Serialize;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::process::{Child, Command};
use tokio::sync::Notify;
use tokio::time::{sleep, timeout};

const MAX_RESTART_RETRIES: u32 = 3;
const RESTART_BACKOFFS: [Duration; 3] = [
    Duration::from_secs(1),
    Duration::from_secs(2),
    Duration::from_secs(4),
];
const STOP_TIMEOUT: Duration = Duration::from_secs(5);
const FORCE_KILL_TIMEOUT: Duration = Duration::from_secs(1);
const SIDECAR_EXITED_EVENT: &str = "plugin:sidecar-exited";
const SIDECAR_FAILED_EVENT: &str = "plugin:sidecar-failed";
const BUN_PATH_ENV: &str = "OPENFORGE_BUN_PATH";
const ENTRYPOINT_ENV: &str = "OPENFORGE_PLUGIN_HOST_ENTRYPOINT";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SidecarState {
    Starting,
    Running,
    Stopping,
    Stopped,
    Crashed,
}

#[derive(Debug, Clone, Serialize)]
struct SidecarExitPayload {
    code: Option<i32>,
    signal: Option<i32>,
    pid: Option<u32>,
    retry_attempts: u32,
}

#[derive(Debug, Clone, Serialize)]
struct SidecarFailurePayload {
    error: Option<String>,
    retry_attempts: u32,
}

#[derive(Debug)]
struct HostRuntime {
    state: SidecarState,
    pid: Option<u32>,
    desired_running: bool,
    retry_attempts: u32,
    session_id: u64,
    process_token: u64,
}

impl Default for HostRuntime {
    fn default() -> Self {
        Self {
            state: SidecarState::Stopped,
            pid: None,
            desired_running: false,
            retry_attempts: 0,
            session_id: 0,
            process_token: 0,
        }
    }
}

impl HostRuntime {
    fn next_restart_delay(&mut self) -> Option<Duration> {
        let delay = RESTART_BACKOFFS.get(self.retry_attempts as usize).copied()?;
        self.retry_attempts += 1;
        Some(delay)
    }

    fn mark_running(&mut self, pid: u32) {
        self.state = SidecarState::Running;
        self.pid = Some(pid);
        self.retry_attempts = 0;
    }
}

pub struct PluginHost<R: Runtime = tauri::Wry> {
    runtime: Arc<Mutex<HostRuntime>>,
    state_change: Arc<Notify>,
    app_handle: AppHandle<R>,
}

impl<R: Runtime> Clone for PluginHost<R> {
    fn clone(&self) -> Self {
        Self {
            runtime: Arc::clone(&self.runtime),
            state_change: Arc::clone(&self.state_change),
            app_handle: self.app_handle.clone(),
        }
    }
}

impl<R: Runtime + 'static> PluginHost<R> {
    pub fn new(app_handle: AppHandle<R>) -> Self {
        Self {
            runtime: Arc::new(Mutex::new(HostRuntime::default())),
            state_change: Arc::new(Notify::new()),
            app_handle,
        }
    }

    pub async fn start_sidecar(&self) -> Result<(), String> {
        let session_id = {
            let mut runtime = self.runtime_lock()?;

            match runtime.state {
                SidecarState::Running | SidecarState::Starting if runtime.desired_running => {
                    return Ok(());
                }
                SidecarState::Stopping => {
                    return Err("plugin sidecar is stopping".to_string());
                }
                _ => {}
            }

            runtime.desired_running = true;
            runtime.retry_attempts = 0;
            runtime.pid = None;
            runtime.session_id += 1;
            runtime.state = SidecarState::Starting;
            runtime.session_id
        };

        self.state_change.notify_waiters();
        self.spawn_sidecar_for_session(session_id).await
    }

    pub async fn stop_sidecar(&self) -> Result<(), String> {
        let pid = {
            let mut runtime = self.runtime_lock()?;
            runtime.desired_running = false;
            runtime.retry_attempts = 0;

            match runtime.state {
                SidecarState::Stopped => return Ok(()),
                SidecarState::Crashed if runtime.pid.is_none() => {
                    runtime.state = SidecarState::Stopped;
                    runtime.pid = None;
                    self.state_change.notify_waiters();
                    return Ok(());
                }
                _ => {
                    runtime.state = SidecarState::Stopping;
                    runtime.pid
                }
            }
        };

        self.state_change.notify_waiters();

        if let Some(pid) = pid {
            send_terminate_signal(pid)?;
        }

        if timeout(STOP_TIMEOUT, self.wait_for_stopped()).await.is_ok() {
            return Ok(());
        }

        let pid = self.runtime_lock()?.pid;
        if let Some(pid) = pid {
            warn!("[plugin_host] sidecar PID {} did not stop gracefully, force killing", pid);
            force_kill_process(pid)?;
        }

        if timeout(FORCE_KILL_TIMEOUT, self.wait_for_stopped()).await.is_ok() {
            return Ok(());
        }

        let mut runtime = self.runtime_lock()?;
        runtime.pid = None;
        runtime.state = SidecarState::Stopped;
        self.state_change.notify_waiters();
        Ok(())
    }

    pub async fn restart_sidecar(&self) -> Result<(), String> {
        self.stop_sidecar().await?;
        self.start_sidecar().await
    }

    pub fn is_sidecar_running(&self) -> bool {
        matches!(self.get_state(), SidecarState::Running)
    }

    pub fn get_state(&self) -> SidecarState {
        match self.runtime.lock() {
            Ok(runtime) => runtime.state.clone(),
            Err(_) => SidecarState::Crashed,
        }
    }

    async fn spawn_sidecar_for_session(&self, session_id: u64) -> Result<(), String> {
        let bun_path = resolve_bun_binary()?;
        let entrypoint = resolve_entrypoint(&self.app_handle)?;

        info!(
            "[plugin_host] starting plugin sidecar with bun={} entrypoint={}",
            bun_path.display(),
            entrypoint.display()
        );

        let mut command = Command::new(&bun_path);
        command
            .arg("run")
            .arg(&entrypoint)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(false);

        if let Some(parent) = entrypoint.parent() {
            command.current_dir(parent);
        }

        let child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                let message = format!("failed to spawn plugin sidecar: {error}");
                self.mark_crashed_if_current(session_id)?;
                return Err(message);
            }
        };

        let pid = child
            .id()
            .ok_or_else(|| "failed to read plugin sidecar pid".to_string())?;

        let process_token = {
            let mut runtime = self.runtime_lock()?;
            if session_id != runtime.session_id || !runtime.desired_running {
                drop(runtime);
                send_terminate_signal(pid)?;
                return Ok(());
            }

            runtime.process_token += 1;
            runtime.mark_running(pid);
            runtime.process_token
        };

        self.state_change.notify_waiters();

        let host = (*self).clone();
        tokio::spawn(async move {
            host.monitor_sidecar(child, session_id, process_token).await;
        });

        Ok(())
    }

    async fn monitor_sidecar(&self, mut child: Child, session_id: u64, process_token: u64) {
        let status = match child.wait().await {
            Ok(status) => status,
            Err(error) => {
                error!("[plugin_host] failed waiting for sidecar exit: {}", error);
                let retry = match self.record_crash_and_plan_restart(session_id, process_token) {
                    Ok(retry) => retry,
                    Err(lock_error) => {
                        error!("[plugin_host] failed to record crash state: {}", lock_error);
                        None
                    }
                };

                self.emit_sidecar_exited(None, None, None);
                self.schedule_restart_or_emit_failure(session_id, retry, Some(error.to_string()));
                return;
            }
        };

        let code = status.code();
        let signal = exit_status_signal(&status);
        let retry = match self.record_exit_state(session_id, process_token) {
            Ok(retry) => retry,
            Err(error) => {
                error!("[plugin_host] failed to update sidecar exit state: {}", error);
                None
            }
        };

        if retry.is_none() && !matches!(self.get_state(), SidecarState::Crashed) {
            return;
        }

        self.emit_sidecar_exited(code, signal, child.id());
        self.schedule_restart_or_emit_failure(session_id, retry, None);
    }

    fn record_exit_state(
        &self,
        session_id: u64,
        process_token: u64,
    ) -> Result<Option<Duration>, String> {
        let mut runtime = self.runtime_lock()?;

        if runtime.session_id != session_id || runtime.process_token != process_token {
            return Ok(None);
        }

        runtime.pid = None;

        if !runtime.desired_running || matches!(runtime.state, SidecarState::Stopping) {
            runtime.state = SidecarState::Stopped;
            runtime.retry_attempts = 0;
            self.state_change.notify_waiters();
            return Ok(None);
        }

        runtime.state = SidecarState::Crashed;
        let retry = runtime.next_restart_delay();
        self.state_change.notify_waiters();
        Ok(retry)
    }

    fn record_crash_and_plan_restart(
        &self,
        session_id: u64,
        process_token: u64,
    ) -> Result<Option<Duration>, String> {
        let mut runtime = self.runtime_lock()?;

        if runtime.session_id != session_id || runtime.process_token != process_token {
            return Ok(None);
        }

        runtime.pid = None;
        runtime.state = SidecarState::Crashed;
        let retry = runtime.next_restart_delay();
        self.state_change.notify_waiters();
        Ok(retry)
    }

    fn mark_crashed_if_current(&self, session_id: u64) -> Result<(), String> {
        let mut runtime = self.runtime_lock()?;
        if runtime.session_id == session_id && runtime.desired_running {
            runtime.pid = None;
            runtime.state = SidecarState::Crashed;
            self.state_change.notify_waiters();
        }
        Ok(())
    }

    fn schedule_restart_or_emit_failure(
        &self,
        session_id: u64,
        retry: Option<Duration>,
        error: Option<String>,
    ) {
        if let Some(delay) = retry {
            let host = (*self).clone();
            tokio::spawn(async move {
                host.restart_after_delay(session_id, delay).await;
            });
            return;
        }

        self.emit_sidecar_failed(error);
    }

    async fn restart_after_delay(&self, session_id: u64, delay: Duration) {
        sleep(delay).await;

        let should_restart = match self.runtime_lock() {
            Ok(runtime) => {
                runtime.session_id == session_id
                    && runtime.desired_running
                    && matches!(runtime.state, SidecarState::Crashed)
            }
            Err(error) => {
                error!("[plugin_host] failed to inspect restart state: {}", error);
                false
            }
        };

        if !should_restart {
            return;
        }

        if let Ok(mut runtime) = self.runtime_lock() {
            if runtime.session_id == session_id && runtime.desired_running {
                runtime.state = SidecarState::Starting;
                self.state_change.notify_waiters();
            }
        }

        if let Err(error) = self.spawn_sidecar_for_session(session_id).await {
            warn!("[plugin_host] restart attempt failed: {}", error);

            let next_retry = match self.runtime_lock() {
                Ok(mut runtime) => {
                    if runtime.session_id != session_id || !runtime.desired_running {
                        None
                    } else {
                        runtime.state = SidecarState::Crashed;
                        self.state_change.notify_waiters();
                        runtime.next_restart_delay()
                    }
                }
                Err(lock_error) => {
                    error!("[plugin_host] failed to update restart state: {}", lock_error);
                    None
                }
            };

            self.schedule_restart_or_emit_failure(session_id, next_retry, Some(error));
        }
    }

    async fn wait_for_stopped(&self) {
        loop {
            if matches!(self.get_state(), SidecarState::Stopped) {
                return;
            }

            self.state_change.notified().await;
        }
    }

    fn emit_sidecar_exited(&self, code: Option<i32>, signal: Option<i32>, pid: Option<u32>) {
        let retry_attempts = self
            .runtime
            .lock()
            .ok()
            .map(|runtime| runtime.retry_attempts)
            .unwrap_or(MAX_RESTART_RETRIES);

        let payload = SidecarExitPayload {
            code,
            signal,
            pid,
            retry_attempts,
        };

        if let Err(error) = self.app_handle.emit(SIDECAR_EXITED_EVENT, payload) {
            warn!("[plugin_host] failed to emit sidecar exit event: {}", error);
        }
    }

    fn emit_sidecar_failed(&self, error: Option<String>) {
        let retry_attempts = self
            .runtime
            .lock()
            .ok()
            .map(|runtime| runtime.retry_attempts)
            .unwrap_or(MAX_RESTART_RETRIES);

        let payload = SidecarFailurePayload {
            error,
            retry_attempts,
        };

        if let Err(emit_error) = self.app_handle.emit(SIDECAR_FAILED_EVENT, payload) {
            warn!("[plugin_host] failed to emit sidecar failure event: {}", emit_error);
        }
    }

    fn runtime_lock(&self) -> Result<std::sync::MutexGuard<'_, HostRuntime>, String> {
        self.runtime
            .lock()
            .map_err(|_| "plugin host state lock poisoned".to_string())
    }

    #[cfg(test)]
    fn mark_running_for_test(&self, pid: u32) {
        if let Ok(mut runtime) = self.runtime.lock() {
            runtime.desired_running = true;
            runtime.mark_running(pid);
        }
    }

    #[cfg(test)]
    fn mark_stopping_for_test(&self) {
        if let Ok(mut runtime) = self.runtime.lock() {
            runtime.state = SidecarState::Stopping;
        }
    }

    #[cfg(test)]
    fn complete_stop_for_test(&self) {
        if let Ok(mut runtime) = self.runtime.lock() {
            runtime.state = SidecarState::Stopped;
            runtime.pid = None;
            runtime.desired_running = false;
        }
    }

    #[cfg(test)]
    fn handle_unexpected_exit_for_test(&self) -> Option<Duration> {
        match self.runtime.lock() {
            Ok(mut runtime) => {
                runtime.state = SidecarState::Crashed;
                runtime.pid = None;
                runtime.desired_running = true;
                runtime.next_restart_delay()
            }
            Err(_) => None,
        }
    }
}

fn resolve_bun_binary() -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var(BUN_PATH_ENV) {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }

    which::which("bun").map_err(|error| format!("failed to locate bun in PATH: {error}"))
}

fn resolve_entrypoint<R: Runtime>(app_handle: &AppHandle<R>) -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var(ENTRYPOINT_ENV) {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }

    app_handle
        .path()
        .app_data_dir()
        .map(|path| path.join("plugin-host").join("index.ts"))
        .map_err(|error| format!("failed to resolve plugin host entrypoint: {error}"))
}

#[cfg(unix)]
fn send_terminate_signal(pid: u32) -> Result<(), String> {
    let raw_pid = i32::try_from(pid).map_err(|_| format!("invalid pid: {pid}"))?;
    let result = unsafe {
        // SAFETY: sending a signal to a PID obtained from `tokio::process::Child::id`.
        libc::kill(raw_pid, libc::SIGTERM)
    };

    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error().to_string())
    }
}

#[cfg(windows)]
fn send_terminate_signal(pid: u32) -> Result<(), String> {
    std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string()])
        .status()
        .map_err(|error| format!("failed to terminate process {pid}: {error}"))?
        .success()
        .then_some(())
        .ok_or_else(|| format!("taskkill failed for PID {pid}"))
}

#[cfg(unix)]
fn force_kill_process(pid: u32) -> Result<(), String> {
    let raw_pid = i32::try_from(pid).map_err(|_| format!("invalid pid: {pid}"))?;
    let result = unsafe {
        // SAFETY: sending a signal to a PID obtained from `tokio::process::Child::id`.
        libc::kill(raw_pid, libc::SIGKILL)
    };

    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error().to_string())
    }
}

#[cfg(windows)]
fn force_kill_process(pid: u32) -> Result<(), String> {
    std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/F"])
        .status()
        .map_err(|error| format!("failed to force kill process {pid}: {error}"))?
        .success()
        .then_some(())
        .ok_or_else(|| format!("taskkill /F failed for PID {pid}"))
}

#[cfg(unix)]
fn exit_status_signal(status: &std::process::ExitStatus) -> Option<i32> {
    use std::os::unix::process::ExitStatusExt;

    status.signal()
}

#[cfg(not(unix))]
fn exit_status_signal(_status: &std::process::ExitStatus) -> Option<i32> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::test::{mock_builder, mock_context, noop_assets};

    fn build_plugin_host() -> PluginHost<tauri::test::MockRuntime> {
        let app = mock_builder()
            .build(mock_context(noop_assets()))
            .expect("mock app should build");
        PluginHost::new(app.handle().clone())
    }

    #[test]
    fn new_host_starts_stopped() {
        let host = build_plugin_host();

        assert_eq!(host.get_state(), SidecarState::Stopped);
        assert!(!host.is_sidecar_running());
    }

    #[test]
    fn stop_transition_reaches_stopped() {
        let host = build_plugin_host();

        host.mark_running_for_test(1234);
        host.mark_stopping_for_test();
        assert_eq!(host.get_state(), SidecarState::Stopping);

        host.complete_stop_for_test();
        assert_eq!(host.get_state(), SidecarState::Stopped);
        assert!(!host.is_sidecar_running());
    }

    #[test]
    fn unexpected_exit_marks_host_crashed() {
        let host = build_plugin_host();

        host.mark_running_for_test(1234);

        let delay = host.handle_unexpected_exit_for_test();

        assert_eq!(host.get_state(), SidecarState::Crashed);
        assert_eq!(delay, Some(Duration::from_secs(1)));
    }

    #[test]
    fn retries_use_exponential_backoff_then_stop() {
        let host = build_plugin_host();

        host.mark_running_for_test(1234);

        assert_eq!(host.handle_unexpected_exit_for_test(), Some(Duration::from_secs(1)));
        assert_eq!(host.handle_unexpected_exit_for_test(), Some(Duration::from_secs(2)));
        assert_eq!(host.handle_unexpected_exit_for_test(), Some(Duration::from_secs(4)));
        assert_eq!(host.handle_unexpected_exit_for_test(), None);
        assert_eq!(host.get_state(), SidecarState::Crashed);
    }

    #[test]
    fn health_check_depends_on_running_state() {
        let host = build_plugin_host();

        assert!(!host.is_sidecar_running());

        host.mark_running_for_test(1234);

        assert!(host.is_sidecar_running());
    }

    #[test]
    fn restart_method_is_part_of_public_api() {
        let _restart = PluginHost::<tauri::test::MockRuntime>::restart_sidecar;
    }
}
