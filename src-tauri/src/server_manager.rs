use log::{debug, error, info};
use regex::Regex;
use std::collections::HashMap;
use std::fmt;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::time::{sleep, timeout};

const HEALTH_CHECK_RETRIES: u32 = 10;
const HEALTH_CHECK_INTERVAL: Duration = Duration::from_millis(500);
const PORT_DETECTION_TIMEOUT: Duration = Duration::from_secs(30);

// ============================================================================
// Error Types
// ============================================================================

#[derive(Debug)]
pub enum ServerError {
    SpawnFailed(String),
    PortDetectionTimeout,
    HealthCheckFailed(String),
    ProcessNotFound(String),
    IoError(io::Error),
}

impl fmt::Display for ServerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ServerError::SpawnFailed(msg) => write!(f, "Failed to spawn server: {}", msg),
            ServerError::PortDetectionTimeout => {
                write!(
                    f,
                    "Port detection timed out after {} seconds",
                    PORT_DETECTION_TIMEOUT.as_secs()
                )
            }
            ServerError::HealthCheckFailed(msg) => write!(f, "Health check failed: {}", msg),
            ServerError::ProcessNotFound(task_id) => {
                write!(f, "No server process found for task: {}", task_id)
            }
            ServerError::IoError(e) => write!(f, "IO error: {}", e),
        }
    }
}

impl std::error::Error for ServerError {}

impl From<io::Error> for ServerError {
    fn from(err: io::Error) -> Self {
        ServerError::IoError(err)
    }
}

// ============================================================================
// Managed Server
// ============================================================================

struct ManagedServer {
    child: Child,
    port: u16,
    pid: u32,
}

// ============================================================================
// Server Manager
// ============================================================================

/// Manages multiple OpenCode servers (one per task/worktree)
#[derive(Clone)]
pub struct ServerManager {
    servers: Arc<Mutex<HashMap<String, ManagedServer>>>,
    pid_dir_override: Option<PathBuf>,
}

pub fn discovery_server_task_id(project_id: &str) -> String {
    format!("opencode-discovery-{}", project_id)
}

impl ServerManager {
    /// Creates a new ServerManager with an empty server map
    pub fn new() -> Self {
        Self {
            servers: Arc::new(Mutex::new(HashMap::new())),
            pid_dir_override: None,
        }
    }
    /// Spawns a new OpenCode server for the given task_id and worktree_path.
    /// Returns the dynamically assigned port number.
    /// If a server is already running for this task_id, returns its existing port.
    ///
    /// # Arguments
    /// * `task_id` - Unique identifier for the task
    /// * `worktree_path` - Working directory for the OpenCode server
    pub async fn spawn_server(
        &self,
        task_id: &str,
        worktree_path: &Path,
    ) -> Result<u16, ServerError> {
        let mut servers = self.servers.lock().await;

        if let Some(server) = servers.get(task_id) {
            info!(
                "Server already running for task {}: port {}",
                task_id, server.port
            );
            return Ok(server.port);
        }

        info!(
            "Spawning OpenCode server for task {} in {:?}",
            task_id, worktree_path
        );
        debug!("Spawning command: opencode");
        debug!(
            "OpenCode server working directory: {}",
            worktree_path.display()
        );

        let pid_dir = self.get_pid_dir()?;
        std::fs::create_dir_all(&pid_dir)?;

        let mut child = Command::new("opencode")
            .arg("serve")
            .arg("--port")
            .arg("0") // Dynamic port allocation
            .current_dir(worktree_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| ServerError::SpawnFailed(e.to_string()))?;

        let pid = child
            .id()
            .ok_or_else(|| ServerError::SpawnFailed("Failed to get PID".to_string()))?;

        let port = self.detect_port(&mut child).await?;

        info!(
            "Server for task {} started on port {} (PID: {})",
            task_id, port, pid
        );

        self.wait_for_health(port).await?;

        info!("Server for task {} is healthy", task_id);

        let pid_file = pid_dir.join(format!("{}.pid", task_id));
        std::fs::write(&pid_file, pid.to_string())?;

        servers.insert(task_id.to_string(), ManagedServer { child, port, pid });

        Ok(port)
    }

    /// Stops the server for the given task_id via force kill.
    /// OpenCode servers don't respond to SIGTERM, so we skip graceful shutdown.
    ///
    /// # Arguments
    /// * `task_id` - Unique identifier for the task
    pub async fn stop_server(&self, task_id: &str) -> Result<(), ServerError> {
        let mut servers = self.servers.lock().await;

        let mut server = servers
            .remove(task_id)
            .ok_or_else(|| ServerError::ProcessNotFound(task_id.to_string()))?;

        info!(
            "Stopping server for task {} (PID: {}) — force killing",
            task_id, server.pid
        );

        server.child.kill().await?;
        let _ = server.child.wait().await;

        let pid_file = self.get_pid_dir()?.join(format!("{}.pid", task_id));
        let _ = std::fs::remove_file(pid_file);

        info!("Server for task {} stopped", task_id);

        Ok(())
    }

    /// Stops all running servers
    pub async fn stop_all(&self) -> Result<(), ServerError> {
        let task_ids: Vec<String> = {
            let servers = self.servers.lock().await;
            servers.keys().cloned().collect()
        };

        for task_id in task_ids {
            if let Err(e) = self.stop_server(&task_id).await {
                error!("Failed to stop server for task {}: {}", task_id, e);
            }
        }

        Ok(())
    }

    /// Returns the port number for the given task_id, or None if no server is running
    ///
    /// # Arguments
    /// * `task_id` - Unique identifier for the task
    pub async fn get_server_port(&self, task_id: &str) -> Option<u16> {
        let servers = self.servers.lock().await;
        servers.get(task_id).map(|s| s.port)
    }

    /// Returns the port of any running server for the given project's tasks, or None if no server is running
    ///
    /// # Arguments
    /// * `task_ids` - Slice of task identifiers to check for running servers
    pub async fn get_any_server_port_for_project(&self, task_ids: &[String]) -> Option<u16> {
        let servers = self.servers.lock().await;
        for task_id in task_ids {
            if let Some(server) = servers.get(task_id) {
                return Some(server.port);
            }
        }
        None
    }

    /// Cleans up stale PID files for processes that are no longer running
    pub fn cleanup_stale_pids(&self) -> Result<(), ServerError> {
        let pid_dir = self.get_pid_dir()?;

        if !pid_dir.exists() {
            return Ok(());
        }

        for entry in std::fs::read_dir(&pid_dir)? {
            let entry = entry?;
            let path = entry.path();

            if path.extension().and_then(|s| s.to_str()) != Some("pid") {
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
                info!(
                    "[cleanup] Removing stale PID file (process dead): {:?}",
                    path
                );
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
                    info!(
                        "[cleanup] Force killing orphaned opencode process (PID: {})",
                        pid
                    );
                    unsafe {
                        libc::kill(pid, libc::SIGKILL);
                    }
                } else {
                    info!(
                        "[cleanup] PID {} is not opencode (PID reuse), removing stale file: {:?}",
                        pid, path
                    );
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
    fn get_pid_dir(&self) -> Result<PathBuf, ServerError> {
        if let Some(ref dir) = self.pid_dir_override {
            return Ok(dir.clone());
        }
        let home = dirs::home_dir().ok_or_else(|| {
            ServerError::IoError(io::Error::new(
                io::ErrorKind::NotFound,
                "Home directory not found",
            ))
        })?;
        let pids_dir_name = if cfg!(debug_assertions) {
            "pids-dev"
        } else {
            "pids"
        };
        Ok(home.join(".openforge").join(pids_dir_name))
    }

    /// Detects the dynamically assigned port by parsing stdout and stderr for "127.0.0.1:(\d+)"
    async fn detect_port(&self, child: &mut Child) -> Result<u16, ServerError> {
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| ServerError::SpawnFailed("Failed to capture stdout".to_string()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| ServerError::SpawnFailed("Failed to capture stderr".to_string()))?;

        let port_regex = Regex::new(r"127\.0\.0\.1:(\d+)")
            .map_err(|e| ServerError::SpawnFailed(format!("Regex error: {}", e)))?;

        let detect_task = async {
            let mut stdout_lines = BufReader::new(stdout).lines();
            let mut stderr_lines = BufReader::new(stderr).lines();
            let mut stdout_open = true;
            let mut stderr_open = true;

            while stdout_open || stderr_open {
                tokio::select! {
                    line = stdout_lines.next_line(), if stdout_open => {
                        match line.map_err(ServerError::IoError)? {
                            Some(line) => {
                                debug!("opencode stdout: {}", line);
                                if let Some(captures) = port_regex.captures(&line) {
                                    if let Some(port_match) = captures.get(1) {
                                        if let Ok(port) = port_match.as_str().parse::<u16>() {
                                            return Ok(port);
                                        }
                                    }
                                }
                            }
                            None => {
                                stdout_open = false;
                            }
                        }
                    }
                    line = stderr_lines.next_line(), if stderr_open => {
                        match line.map_err(ServerError::IoError)? {
                            Some(line) => {
                                debug!("opencode stderr: {}", line);
                                if let Some(captures) = port_regex.captures(&line) {
                                    if let Some(port_match) = captures.get(1) {
                                        if let Ok(port) = port_match.as_str().parse::<u16>() {
                                            return Ok(port);
                                        }
                                    }
                                }
                            }
                            None => {
                                stderr_open = false;
                            }
                        }
                    }
                }
            }

            Err(ServerError::PortDetectionTimeout)
        };

        timeout(PORT_DETECTION_TIMEOUT, detect_task)
            .await
            .map_err(|_| ServerError::PortDetectionTimeout)?
    }

    /// Polls the health endpoint until the server responds or max retries is reached
    async fn wait_for_health(&self, port: u16) -> Result<(), ServerError> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .map_err(|e| ServerError::HealthCheckFailed(e.to_string()))?;

        let health_url = format!("http://127.0.0.1:{}/global/health", port);

        for attempt in 1..=HEALTH_CHECK_RETRIES {
            match client.get(&health_url).send().await {
                Ok(response) if response.status().is_success() => {
                    debug!(
                        "Health check passed for port {}: {}",
                        port,
                        response.status()
                    );
                    return Ok(());
                }
                Ok(_response) => {}
                Err(_) => {}
            }

            if attempt < HEALTH_CHECK_RETRIES {
                sleep(HEALTH_CHECK_INTERVAL).await;
            }
        }

        Err(ServerError::HealthCheckFailed(format!(
            "Failed after {} retries",
            HEALTH_CHECK_RETRIES
        )))
    }
}

impl Default for ServerManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
impl ServerManager {
    pub fn set_pid_dir(&mut self, dir: PathBuf) {
        self.pid_dir_override = Some(dir);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_server_error_display() {
        let err = ServerError::SpawnFailed("test error".to_string());
        assert_eq!(err.to_string(), "Failed to spawn server: test error");

        let err = ServerError::PortDetectionTimeout;
        assert!(err.to_string().contains("Port detection timed out"));

        let err = ServerError::ProcessNotFound("task123".to_string());
        assert_eq!(err.to_string(), "No server process found for task: task123");
    }

    #[test]
    fn test_server_manager_new() {
        let manager = ServerManager::new();
        assert!(manager.servers.try_lock().is_ok());
    }

    #[test]
    fn test_discovery_server_task_id() {
        assert_eq!(discovery_server_task_id("P-1"), "opencode-discovery-P-1");
    }

    #[tokio::test]
    async fn test_get_any_server_port_for_project() {
        let manager = ServerManager::new();
        let task_ids = vec!["task1".to_string(), "task2".to_string()];

        // Should return None when no servers are running
        let port = manager.get_any_server_port_for_project(&task_ids).await;
        assert_eq!(port, None);
    }

    #[tokio::test]
    async fn test_detect_port_from_stderr() {
        let manager = ServerManager::new();

        let mut child = Command::new("sh")
            .arg("-c")
            .arg("echo \"127.0.0.1:12345\" >&2")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("should spawn stderr writer process");

        let port = manager
            .detect_port(&mut child)
            .await
            .expect("should detect port from stderr output");

        assert_eq!(port, 12345);

        let _ = child.wait().await;
    }

    #[test]
    fn test_cleanup_stale_pids_empty_dir() {
        let mut manager = ServerManager::new();
        let tmp_dir = std::env::temp_dir().join("test_srv_cleanup_empty");
        std::fs::create_dir_all(&tmp_dir).unwrap();
        manager.set_pid_dir(tmp_dir.clone());

        let result = manager.cleanup_stale_pids();
        assert!(result.is_ok());

        let _ = std::fs::remove_dir_all(&tmp_dir);
    }

    #[test]
    fn test_cleanup_stale_pids_invalid_content() {
        let mut manager = ServerManager::new();
        let tmp_dir = std::env::temp_dir().join("test_srv_cleanup_invalid");
        std::fs::create_dir_all(&tmp_dir).unwrap();
        manager.set_pid_dir(tmp_dir.clone());

        let pid_file = tmp_dir.join("task123.pid");
        std::fs::write(&pid_file, "not_a_number").unwrap();
        assert!(pid_file.exists());

        let result = manager.cleanup_stale_pids();
        assert!(result.is_ok());
        assert!(!pid_file.exists(), "Invalid PID file should be removed");

        let _ = std::fs::remove_dir_all(&tmp_dir);
    }

    #[test]
    fn test_cleanup_stale_pids_dead_process() {
        let mut manager = ServerManager::new();
        let tmp_dir = std::env::temp_dir().join("test_srv_cleanup_dead");
        std::fs::create_dir_all(&tmp_dir).unwrap();
        manager.set_pid_dir(tmp_dir.clone());

        // PID 999999 is virtually guaranteed to not be running
        let pid_file = tmp_dir.join("dead_task.pid");
        std::fs::write(&pid_file, "999999").unwrap();
        assert!(pid_file.exists());

        let result = manager.cleanup_stale_pids();
        assert!(result.is_ok());
        assert!(
            !pid_file.exists(),
            "Stale PID file for dead process should be removed"
        );

        let _ = std::fs::remove_dir_all(&tmp_dir);
    }

    #[test]
    fn test_get_pid_dir_default() {
        let manager = ServerManager::new();
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
    fn test_cleanup_stale_pids_non_pid_files_ignored() {
        let mut manager = ServerManager::new();
        let tmp_dir = std::env::temp_dir().join("test_srv_cleanup_nonpid");
        std::fs::create_dir_all(&tmp_dir).unwrap();
        manager.set_pid_dir(tmp_dir.clone());

        let non_pid_file = tmp_dir.join("README.txt");
        std::fs::write(&non_pid_file, "not a pid file").unwrap();

        let result = manager.cleanup_stale_pids();
        assert!(result.is_ok());
        assert!(
            non_pid_file.exists(),
            "Non-.pid files should not be removed"
        );

        let _ = std::fs::remove_dir_all(&tmp_dir);
    }
}
