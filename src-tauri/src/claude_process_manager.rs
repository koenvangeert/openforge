use std::collections::HashMap;
use std::fmt;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);

// ============================================================================
// Error Types
// ============================================================================

#[derive(Debug)]
pub enum ClaudeProcessError {
    SpawnFailed(String),
    AlreadyRunning(String),
    ProcessNotFound(String),
    IoError(io::Error),
}

impl fmt::Display for ClaudeProcessError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ClaudeProcessError::SpawnFailed(msg) => write!(f, "Failed to spawn Claude process: {}", msg),
            ClaudeProcessError::AlreadyRunning(task_id) => write!(f, "Claude process already running for task: {}", task_id),
            ClaudeProcessError::ProcessNotFound(task_id) => write!(f, "No Claude process found for task: {}", task_id),
            ClaudeProcessError::IoError(e) => write!(f, "IO error: {}", e),
        }
    }
}

impl std::error::Error for ClaudeProcessError {}

impl From<io::Error> for ClaudeProcessError {
    fn from(err: io::Error) -> Self {
        ClaudeProcessError::IoError(err)
    }
}

// ============================================================================
// Managed Claude Process
// ============================================================================

struct ManagedClaudeProcess {
    child: Child,
    pid: u32,
    worktree_path: PathBuf,
    task_id: String,
}

// ============================================================================
// Claude Process Manager
// ============================================================================

/// Manages multiple Claude Code CLI subprocesses (one per task/worktree)
pub struct ClaudeProcessManager {
    processes: Arc<Mutex<HashMap<String, ManagedClaudeProcess>>>,
    pid_dir_override: Option<PathBuf>,
}

impl ClaudeProcessManager {
    /// Creates a new ClaudeProcessManager with an empty process map
    pub fn new() -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
            pid_dir_override: None,
        }
    }

    /// Spawns a new Claude Code CLI process for the given task_id and worktree_path.
    /// Returns the PID and the stdout handle for reading NDJSON events.
    ///
    /// # Arguments
    /// * `task_id` - Unique identifier for the task
    /// * `worktree_path` - Working directory for the Claude process
    /// * `prompt` - The prompt to pass to Claude via `-p`
    pub async fn spawn_claude(
        &self,
        task_id: &str,
        worktree_path: &Path,
        prompt: &str,
    ) -> Result<(u32, tokio::process::ChildStdout), ClaudeProcessError> {
        {
            let processes = self.processes.lock().await;
            if processes.contains_key(task_id) {
                return Err(ClaudeProcessError::AlreadyRunning(task_id.to_string()));
            }
        }

        println!("Spawning Claude process for task {} in {:?}", task_id, worktree_path);

        let pid_dir = self.get_pid_dir()?;
        std::fs::create_dir_all(&pid_dir)?;

        let mut cmd = Command::new("claude");
        cmd.arg("-p")
            .arg(prompt)
            .arg("--output-format")
            .arg("stream-json")
            .arg("--verbose")
            .arg("--permission-mode")
            .arg("acceptEdits")
            .current_dir(worktree_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        // Get user environment (especially PATH on macOS where GUI apps don't inherit shell PATH)
        let user_env = get_user_environment();
        for (key, value) in user_env {
            cmd.env(key, value);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| ClaudeProcessError::SpawnFailed(e.to_string()))?;

        let pid = child
            .id()
            .ok_or_else(|| ClaudeProcessError::SpawnFailed("Failed to get PID".to_string()))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| ClaudeProcessError::SpawnFailed("Failed to capture stdout".to_string()))?;

        println!("Claude process for task {} started (PID: {})", task_id, pid);

        let pid_file = pid_dir.join(format!("{}-claude.pid", task_id));
        std::fs::write(&pid_file, pid.to_string())?;

        let mut processes = self.processes.lock().await;
        processes.insert(
            task_id.to_string(),
            ManagedClaudeProcess {
                child,
                pid,
                worktree_path: worktree_path.to_path_buf(),
                task_id: task_id.to_string(),
            },
        );

        Ok((pid, stdout))
    }

    /// Spawns a new Claude Code CLI process resuming an existing Claude session.
    /// Returns the PID and the stdout handle for reading NDJSON events.
    ///
    /// # Arguments
    /// * `task_id` - Unique identifier for the task
    /// * `worktree_path` - Working directory for the Claude process
    /// * `claude_session_id` - The Claude session ID to resume
    /// * `prompt` - The prompt to pass to Claude via `-p`
    pub async fn spawn_claude_resume(
        &self,
        task_id: &str,
        worktree_path: &Path,
        claude_session_id: &str,
        prompt: &str,
    ) -> Result<(u32, tokio::process::ChildStdout), ClaudeProcessError> {
        {
            let processes = self.processes.lock().await;
            if processes.contains_key(task_id) {
                return Err(ClaudeProcessError::AlreadyRunning(task_id.to_string()));
            }
        }

        println!(
            "Spawning Claude resume process for task {} (session: {}) in {:?}",
            task_id, claude_session_id, worktree_path
        );

        let pid_dir = self.get_pid_dir()?;
        std::fs::create_dir_all(&pid_dir)?;

        let mut cmd = Command::new("claude");
        cmd.arg("--resume")
            .arg(claude_session_id)
            .arg("-p")
            .arg(prompt)
            .arg("--output-format")
            .arg("stream-json")
            .arg("--verbose")
            .arg("--permission-mode")
            .arg("acceptEdits")
            .current_dir(worktree_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        // Get user environment (especially PATH on macOS where GUI apps don't inherit shell PATH)
        let user_env = get_user_environment();
        for (key, value) in user_env {
            cmd.env(key, value);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| ClaudeProcessError::SpawnFailed(e.to_string()))?;

        let pid = child
            .id()
            .ok_or_else(|| ClaudeProcessError::SpawnFailed("Failed to get PID".to_string()))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| ClaudeProcessError::SpawnFailed("Failed to capture stdout".to_string()))?;

        println!(
            "Claude resume process for task {} started (PID: {})",
            task_id, pid
        );

        let pid_file = pid_dir.join(format!("{}-claude.pid", task_id));
        std::fs::write(&pid_file, pid.to_string())?;

        let mut processes = self.processes.lock().await;
        processes.insert(
            task_id.to_string(),
            ManagedClaudeProcess {
                child,
                pid,
                worktree_path: worktree_path.to_path_buf(),
                task_id: task_id.to_string(),
            },
        );

        Ok((pid, stdout))
    }

    /// Kills the Claude process for the given task_id.
    /// Performs graceful shutdown (SIGTERM) followed by force kill if needed.
    ///
    /// # Arguments
    /// * `task_id` - Unique identifier for the task
    pub async fn kill_process(&self, task_id: &str) -> Result<(), ClaudeProcessError> {
        let mut processes = self.processes.lock().await;

        let mut process = processes.remove(task_id).ok_or_else(|| {
            ClaudeProcessError::ProcessNotFound(task_id.to_string())
        })?;

        println!("Killing Claude process for task {} (PID: {})", task_id, process.pid);

        #[cfg(unix)]
        {
            use nix::sys::signal::{kill, Signal};
            use nix::unistd::Pid;

            let pid = Pid::from_raw(process.pid as i32);
            let _ = kill(pid, Signal::SIGTERM);

            let wait_result = tokio::time::timeout(SHUTDOWN_TIMEOUT, process.child.wait()).await;

            match wait_result {
                Ok(Ok(status)) => {
                    println!("Claude process for task {} exited gracefully: {:?}", task_id, status);
                }
                _ => {
                    println!("Graceful shutdown timed out for task {}, forcing kill...", task_id);
                    process.child.kill().await?;
                    let _ = process.child.wait().await;
                }
            }
        }

        #[cfg(not(unix))]
        {
            process.child.kill().await?;
            let _ = process.child.wait().await;
        }

        let pid_file = self.get_pid_dir()?.join(format!("{}-claude.pid", task_id));
        let _ = std::fs::remove_file(pid_file);

        println!("Claude process for task {} stopped", task_id);

        Ok(())
    }

    /// Kills all running Claude processes
    pub async fn kill_all(&self) -> Result<(), ClaudeProcessError> {
        let task_ids: Vec<String> = {
            let processes = self.processes.lock().await;
            processes.keys().cloned().collect()
        };

        for task_id in task_ids {
            if let Err(e) = self.kill_process(&task_id).await {
                eprintln!("Failed to kill Claude process for task {}: {}", task_id, e);
            }
        }

        Ok(())
    }

    /// Cleans up stale PID files for Claude processes that are no longer running
    pub fn cleanup_stale_pids(&self) -> Result<(), ClaudeProcessError> {
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

            // Only process Claude PID files (those ending in "-claude.pid")
            let filename = path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("");
            if !filename.ends_with("-claude.pid") {
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
                println!("[cleanup] Removing stale Claude PID file (process dead): {:?}", path);
                let _ = std::fs::remove_file(&path);
            } else {
                // Process is alive — verify it's actually claude before killing
                let is_claude = std::process::Command::new("ps")
                    .args(["-p", &pid.to_string(), "-o", "command="])
                    .output()
                    .map(|output| {
                        let cmd = String::from_utf8_lossy(&output.stdout);
                        cmd.contains("claude")
                    })
                    .unwrap_or(false);

                if is_claude {
                    println!("[cleanup] Killing orphaned claude process (PID: {})", pid);
                    unsafe {
                        libc::kill(pid, libc::SIGTERM);
                    }
                    // Brief wait for graceful shutdown
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    // Check if still running, force kill if needed
                    let still_running = unsafe { libc::kill(pid, 0) == 0 };
                    if still_running {
                        println!("[cleanup] Force killing Claude process (PID: {})", pid);
                        unsafe {
                            libc::kill(pid, libc::SIGKILL);
                        }
                    }
                } else {
                    println!(
                        "[cleanup] PID {} is not claude (PID reuse), removing stale file: {:?}",
                        pid, path
                    );
                }
                let _ = std::fs::remove_file(&path);
            }
        }

        Ok(())
    }

    /// Returns true if a Claude process is currently running for the given task_id
    pub async fn is_running(&self, task_id: &str) -> bool {
        let processes = self.processes.lock().await;
        processes.contains_key(task_id)
    }

    // ============================================================================
    // Private Helper Methods
    // ============================================================================

    /// Returns the PID directory path
    fn get_pid_dir(&self) -> Result<PathBuf, ClaudeProcessError> {
        if let Some(ref dir) = self.pid_dir_override {
            return Ok(dir.clone());
        }
        let home = dirs::home_dir().ok_or_else(|| {
            ClaudeProcessError::IoError(io::Error::new(
                io::ErrorKind::NotFound,
                "Home directory not found",
            ))
        })?;
        Ok(home.join(".ai-command-center").join("pids"))
    }
}

impl Default for ClaudeProcessManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
impl ClaudeProcessManager {
    pub fn set_pid_dir(&mut self, dir: PathBuf) {
        self.pid_dir_override = Some(dir);
    }
}

// ============================================================================
// User Environment Helper
// ============================================================================

/// Gets the user's shell environment, especially important on macOS where
/// GUI apps don't inherit the user's shell PATH.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_claude_process_error_display() {
        let err = ClaudeProcessError::SpawnFailed("test error".to_string());
        assert_eq!(err.to_string(), "Failed to spawn Claude process: test error");

        let err = ClaudeProcessError::AlreadyRunning("task123".to_string());
        assert_eq!(err.to_string(), "Claude process already running for task: task123");

        let err = ClaudeProcessError::ProcessNotFound("task123".to_string());
        assert_eq!(err.to_string(), "No Claude process found for task: task123");
    }

    #[test]
    fn test_claude_process_manager_new() {
        let manager = ClaudeProcessManager::new();
        assert!(manager.processes.try_lock().is_ok());
    }

    #[tokio::test]
    async fn test_is_running_returns_false_when_no_process() {
        let manager = ClaudeProcessManager::new();
        assert!(!manager.is_running("nonexistent_task").await);
    }

    #[test]
    fn test_cleanup_stale_pids_empty_dir() {
        let mut manager = ClaudeProcessManager::new();
        let tmp_dir = std::env::temp_dir().join("test_claude_cleanup_empty");
        std::fs::create_dir_all(&tmp_dir).unwrap();
        manager.set_pid_dir(tmp_dir.clone());

        let result = manager.cleanup_stale_pids();
        assert!(result.is_ok());

        let _ = std::fs::remove_dir_all(&tmp_dir);
    }

    #[test]
    fn test_cleanup_stale_pids_invalid_content() {
        let mut manager = ClaudeProcessManager::new();
        let tmp_dir = std::env::temp_dir().join("test_claude_cleanup_invalid");
        std::fs::create_dir_all(&tmp_dir).unwrap();
        manager.set_pid_dir(tmp_dir.clone());

        let pid_file = tmp_dir.join("task123-claude.pid");
        std::fs::write(&pid_file, "not_a_number").unwrap();
        assert!(pid_file.exists());

        let result = manager.cleanup_stale_pids();
        assert!(result.is_ok());
        assert!(!pid_file.exists(), "Invalid PID file should be removed");

        let _ = std::fs::remove_dir_all(&tmp_dir);
    }

    #[test]
    fn test_cleanup_stale_pids_dead_process() {
        let mut manager = ClaudeProcessManager::new();
        let tmp_dir = std::env::temp_dir().join("test_claude_cleanup_dead");
        std::fs::create_dir_all(&tmp_dir).unwrap();
        manager.set_pid_dir(tmp_dir.clone());

        // PID 999999 is virtually guaranteed to not be running
        let pid_file = tmp_dir.join("dead_task-claude.pid");
        std::fs::write(&pid_file, "999999").unwrap();
        assert!(pid_file.exists());

        let result = manager.cleanup_stale_pids();
        assert!(result.is_ok());
        assert!(!pid_file.exists(), "Stale PID file for dead process should be removed");

        let _ = std::fs::remove_dir_all(&tmp_dir);
    }

    #[test]
    fn test_cleanup_stale_pids_non_claude_files_ignored() {
        let mut manager = ClaudeProcessManager::new();
        let tmp_dir = std::env::temp_dir().join("test_claude_cleanup_nonpid");
        std::fs::create_dir_all(&tmp_dir).unwrap();
        manager.set_pid_dir(tmp_dir.clone());

        // Non-claude PID file (like server_manager ones) should be ignored
        let other_pid_file = tmp_dir.join("task123.pid");
        std::fs::write(&other_pid_file, "999999").unwrap();

        let result = manager.cleanup_stale_pids();
        assert!(result.is_ok());
        assert!(other_pid_file.exists(), "Non-claude PID files should not be touched");

        let _ = std::fs::remove_dir_all(&tmp_dir);
    }

    #[test]
    fn test_cleanup_stale_pids_non_pid_files_ignored() {
        let mut manager = ClaudeProcessManager::new();
        let tmp_dir = std::env::temp_dir().join("test_claude_cleanup_txt");
        std::fs::create_dir_all(&tmp_dir).unwrap();
        manager.set_pid_dir(tmp_dir.clone());

        let non_pid_file = tmp_dir.join("README.txt");
        std::fs::write(&non_pid_file, "not a pid file").unwrap();

        let result = manager.cleanup_stale_pids();
        assert!(result.is_ok());
        assert!(non_pid_file.exists(), "Non-.pid files should not be removed");

        let _ = std::fs::remove_dir_all(&tmp_dir);
    }
}
