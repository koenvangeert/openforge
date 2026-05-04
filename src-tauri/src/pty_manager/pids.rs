use log::info;
use std::io;
use std::path::PathBuf;

use super::{PtyError, PtyManager};

impl PtyManager {
    /// Cleans up stale PID files for processes that are no longer running
    pub fn cleanup_stale_pids(&self) -> Result<(), PtyError> {
        let pid_dir = self.get_pid_dir()?;

        if !pid_dir.exists() {
            return Ok(());
        }

        for entry in std::fs::read_dir(&pid_dir)? {
            let entry = entry?;
            let path = entry.path();

            // Process PTY PID files, including legacy task-scoped shell PIDs
            // and indexed shell PIDs like task-shell-0.pid.
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if !is_pty_pid_file_name(name) {
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
                info!(
                    "[cleanup] Removing stale PTY PID file (process dead): {:?}",
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
                        "[cleanup] Killing orphaned opencode PTY process (PID: {})",
                        pid
                    );
                    unsafe {
                        libc::kill(pid, libc::SIGTERM);
                    }
                    // Brief wait for graceful shutdown
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    // Check if still running, force kill if needed
                    let still_running = unsafe { libc::kill(pid, 0) == 0 };
                    if still_running {
                        info!("[cleanup] Force killing PTY process (PID: {})", pid);
                        unsafe {
                            libc::kill(pid, libc::SIGKILL);
                        }
                    }
                } else {
                    info!("[cleanup] PID {} is not opencode (PID reuse), removing stale PTY file: {:?}", pid, path);
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
    pub(super) fn get_pid_dir(&self) -> Result<PathBuf, PtyError> {
        if let Some(ref dir) = self.pid_dir_override {
            return Ok(dir.clone());
        }
        let home = dirs::home_dir().ok_or_else(|| {
            PtyError::IoError(io::Error::new(
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
}

pub(super) fn shell_session_key(task_id: &str, terminal_index: Option<u32>) -> String {
    if let Some(idx) = terminal_index {
        format!("{}-shell-{}", task_id, idx)
    } else {
        format!("{}-shell-0", task_id)
    }
}

pub(super) fn shell_pid_file_name(task_id: &str, terminal_index: Option<u32>) -> String {
    format!("{}.pid", shell_session_key(task_id, terminal_index))
}

fn is_pty_pid_file_name(name: &str) -> bool {
    name.ends_with("-pty.pid")
        || name.ends_with("-claude.pid")
        || name.ends_with("-shell.pid")
        || is_indexed_shell_pid_file_name(name)
}

fn is_indexed_shell_pid_file_name(name: &str) -> bool {
    let Some(stem) = name.strip_suffix(".pid") else {
        return false;
    };
    let Some((_task_id, shell_index)) = stem.rsplit_once("-shell-") else {
        return false;
    };

    !shell_index.is_empty() && shell_index.chars().all(|ch| ch.is_ascii_digit())
}
