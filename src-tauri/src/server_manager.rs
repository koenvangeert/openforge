use crate::user_environment::{find_tool_on_path, user_environment};
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
// Legacy Server Manager
// ============================================================================

/// Quarantined compatibility wrapper for pre-plugin-hook OpenCode servers.
///
/// OpenForge no longer starts `opencode serve` for normal OpenCode execution or
/// discovery. Active sessions use provider-owned OpenCode TUI PTYs plus the
/// installed OpenCode plugin hook. This manager remains only for explicitly
/// legacy managed-server compatibility: if an old server is still registered,
/// `get_session_output` may read its session messages; current tasks should not
/// create new OpenCode server, SSE, or attach paths.
#[derive(Clone)]
pub struct ServerManager {
    servers: Arc<Mutex<HashMap<String, ManagedServer>>>,
}

pub fn discovery_server_task_id(project_id: &str) -> String {
    format!("opencode-discovery-{}", project_id)
}

fn opencode_executable_from_environment(
    environment: &HashMap<String, String>,
) -> Result<PathBuf, ServerError> {
    let path = environment
        .get("PATH")
        .map(String::as_str)
        .unwrap_or_default();
    find_tool_on_path("opencode", path).ok_or_else(|| {
        ServerError::SpawnFailed(format!(
            "opencode executable not found on effective PATH: {}",
            path
        ))
    })
}

fn opencode_serve_command(
    executable: &Path,
    environment: HashMap<String, String>,
    worktree_path: &Path,
) -> Command {
    let mut command = Command::new(executable);
    command
        .arg("serve")
        .arg("--port")
        .arg("0")
        .current_dir(worktree_path)
        .envs(environment)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    command
}

impl ServerManager {
    /// Creates a new ServerManager with an empty server map
    pub fn new() -> Self {
        Self {
            servers: Arc::new(Mutex::new(HashMap::new())),
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

        if !worktree_path.is_dir() {
            return Err(ServerError::SpawnFailed(format!(
                "working directory does not exist: {}",
                worktree_path.display()
            )));
        }

        info!(
            "Spawning OpenCode server for task {} in {:?}",
            task_id, worktree_path
        );
        let environment = user_environment();
        let opencode_executable = opencode_executable_from_environment(&environment)?;

        debug!("Spawning command: {}", opencode_executable.display());
        debug!(
            "OpenCode server working directory: {}",
            worktree_path.display()
        );

        let pid_dir = self.get_pid_dir()?;
        std::fs::create_dir_all(&pid_dir)?;

        let mut child = opencode_serve_command(&opencode_executable, environment, worktree_path)
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

    // ============================================================================
    // Private Helper Methods
    // ============================================================================

    /// Returns the PID directory path
    fn get_pid_dir(&self) -> Result<std::path::PathBuf, ServerError> {
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
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

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

    #[test]
    fn opencode_executable_from_environment_uses_effective_user_path() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let executable = temp_dir.path().join("opencode");
        std::fs::write(&executable, "#!/bin/sh\n").expect("write fake opencode");
        let mut permissions = std::fs::metadata(&executable)
            .expect("metadata")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&executable, permissions).expect("chmod executable");

        let mut environment = HashMap::new();
        environment.insert(
            "PATH".to_string(),
            format!("/missing:{}", temp_dir.path().display()),
        );

        assert_eq!(
            opencode_executable_from_environment(&environment).expect("resolve opencode"),
            executable
        );
    }

    #[test]
    fn opencode_executable_from_environment_reports_missing_effective_path() {
        let mut environment = HashMap::new();
        environment.insert("PATH".to_string(), "/definitely/missing".to_string());

        let error =
            opencode_executable_from_environment(&environment).expect_err("missing opencode");

        assert!(error
            .to_string()
            .contains("opencode executable not found on effective PATH"));
    }

    #[tokio::test]
    async fn spawn_server_reports_missing_worktree_before_spawning_opencode() {
        let manager = ServerManager::new();
        let missing_worktree = tempfile::tempdir()
            .expect("temp dir")
            .path()
            .join("missing");

        let error = manager
            .spawn_server("missing-worktree", &missing_worktree)
            .await
            .expect_err("missing worktree should fail before spawn");

        assert!(error
            .to_string()
            .contains("working directory does not exist"));
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
}
