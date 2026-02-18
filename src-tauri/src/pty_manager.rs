use std::collections::HashMap;
use std::fmt;
use std::io::{self, Read, Write};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;
use portable_pty::{CommandBuilder, PtySize, native_pty_system};
use tauri::Emitter;

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
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
}

impl PtyManager {
    /// Creates a new PtyManager with an empty session map
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
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
    pub async fn spawn_pty(
        &self,
        task_id: &str,
        server_port: u16,
        opencode_session_id: &str,
        cols: u16,
        rows: u16,
        app_handle: tauri::AppHandle,
    ) -> Result<(), PtyError> {
        let mut sessions = self.sessions.lock().await;

        if sessions.contains_key(task_id) {
            println!("PTY already running for task {}", task_id);
            return Ok(());
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

        // Spawn the command
        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| PtyError::SpawnFailed(format!("Failed to spawn command: {}", e)))?;

        // Drop the slave handle after spawn (important!)
        drop(pair.slave);

        let pid = child.process_id().unwrap_or(0);
        println!("PTY for task {} started (PID: {})", task_id, pid);

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

        // Async emitter task: receives from channel, emits Tauri events
        let task_id_emitter = task_id.to_string();
        tokio::spawn(async move {
            while let Some(msg) = rx.recv().await {
                match msg {
                    Some(text) => {
                        let event_name = format!("pty-output-{}", task_id_emitter);
                        let payload = serde_json::json!({ "task_id": &task_id_emitter, "data": text });
                        if let Err(e) = app_handle.emit(&event_name, &payload) {
                            eprintln!("[PTY] Failed to emit {}: {}", event_name, e);
                        }
                    }
                    None => {
                        println!("[PTY] task={} emitter received exit signal", task_id_emitter);
                        let _ = app_handle.emit(&format!("pty-exit-{}", task_id_emitter), ());
                        break;
                    }
                }
            }
        });

        Ok(())
    }

    /// Writes data to the PTY for the given task_id
    ///
    /// # Arguments
    /// * `task_id` - Unique identifier for the task
    /// * `data` - Bytes to write to the PTY
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
            .map_err(|e| PtyError::IoError(io::Error::new(io::ErrorKind::Other, e.to_string())))?;

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

            // Best effort kill
            let _ = session.child.kill();

            // Remove PID file
            let pid_file = self.get_pid_dir()?.join(format!("{}-pty.pid", task_id));
            let _ = std::fs::remove_file(pid_file);

            println!("PTY for task {} killed", task_id);
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

    /// Cleans up stale PID files for processes that are no longer running
    pub fn cleanup_stale_pids(&self) -> Result<(), PtyError> {
        let pid_dir = self.get_pid_dir()?;

        if !pid_dir.exists() {
            return Ok(());
        }

        for entry in std::fs::read_dir(&pid_dir)? {
            let entry = entry?;
            let path = entry.path();

            // Only process files ending with -pty.pid
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if !name.ends_with("-pty.pid") {
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
                println!("Removing stale PTY PID file: {:?}", path);
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
        let home = dirs::home_dir().ok_or_else(|| {
            PtyError::IoError(io::Error::new(
                io::ErrorKind::NotFound,
                "Home directory not found",
            ))
        })?;
        Ok(home.join(".ai-command-center").join("pids"))
    }
}

impl Default for PtyManager {
    fn default() -> Self {
        Self::new()
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
