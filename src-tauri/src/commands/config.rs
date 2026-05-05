use crate::backend_runtime::State;
use crate::db;
use serde::Serialize;
use std::sync::{Arc, Mutex};

#[derive(Serialize)]
pub struct OpenCodeInstallStatus {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

#[derive(Serialize)]
pub struct ClaudeInstallStatus {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub authenticated: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct PiInstallStatus {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

pub async fn check_opencode_installed() -> Result<OpenCodeInstallStatus, String> {
    let output = std::process::Command::new("which").arg("opencode").output();

    match output {
        Ok(out) if out.status.success() => {
            let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let version = std::process::Command::new("opencode")
                .arg("--version")
                .output()
                .ok()
                .and_then(|v| {
                    if v.status.success() {
                        Some(String::from_utf8_lossy(&v.stdout).trim().to_string())
                    } else {
                        None
                    }
                });
            Ok(OpenCodeInstallStatus {
                installed: true,
                path: Some(path),
                version,
            })
        }
        _ => Ok(OpenCodeInstallStatus {
            installed: false,
            path: None,
            version: None,
        }),
    }
}

pub async fn check_claude_installed() -> Result<ClaudeInstallStatus, String> {
    let output = std::process::Command::new("which").arg("claude").output();

    match output {
        Ok(out) if out.status.success() => {
            let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let version = std::process::Command::new("claude")
                .arg("--version")
                .output()
                .ok()
                .and_then(|v| {
                    if v.status.success() {
                        Some(String::from_utf8_lossy(&v.stdout).trim().to_string())
                    } else {
                        None
                    }
                });
            let authenticated = std::process::Command::new("claude")
                .args(["auth", "status"])
                .output()
                .map(|v| v.status.success())
                .unwrap_or(false);
            Ok(ClaudeInstallStatus {
                installed: true,
                path: Some(path),
                version,
                authenticated,
            })
        }
        _ => Ok(ClaudeInstallStatus {
            installed: false,
            path: None,
            version: None,
            authenticated: false,
        }),
    }
}

fn version_from_output(output: std::process::Output) -> Option<String> {
    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

pub async fn check_pi_installed() -> Result<PiInstallStatus, String> {
    let output = std::process::Command::new("which").arg("pi").output();

    match output {
        Ok(out) if out.status.success() => {
            let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let version = std::process::Command::new("pi")
                .arg("--version")
                .output()
                .ok()
                .and_then(version_from_output);
            Ok(PiInstallStatus {
                installed: true,
                path: Some(path),
                version,
            })
        }
        _ => Ok(PiInstallStatus {
            installed: false,
            path: None,
            version: None,
        }),
    }
}

pub async fn get_config(
    db: State<'_, Arc<Mutex<db::Database>>>,
    key: String,
) -> Result<Option<String>, String> {
    if crate::secure_store::is_secret(&key) {
        return crate::secure_store::get_secret(&key);
    }
    let db_lock = crate::db::acquire_db(&db);
    db_lock
        .get_config(&key)
        .map_err(|e| format!("Failed to get config: {}", e))
}

pub async fn set_config(
    db: State<'_, Arc<Mutex<db::Database>>>,

    key: String,
    value: String,
) -> Result<(), String> {
    if crate::secure_store::is_secret(&key) {
        return crate::secure_store::set_secret(&key, &value);
    }
    let db_lock = crate::db::acquire_db(&db);
    db_lock
        .set_config(&key, &value)
        .map_err(|e| format!("Failed to set config: {}", e))
}

pub async fn get_app_mode() -> Result<String, String> {
    if cfg!(debug_assertions) {
        Ok("dev".to_string())
    } else {
        Ok("prod".to_string())
    }
}

pub async fn get_git_branch() -> Result<String, String> {
    let output = std::process::Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err("Not a git repository".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::process::ExitStatusExt;
    use std::process::Output;

    fn success_output(stdout: &[u8]) -> Output {
        Output {
            status: std::process::ExitStatus::from_raw(0),
            stdout: stdout.to_vec(),
            stderr: Vec::new(),
        }
    }

    #[test]
    fn test_check_pi_installed_not_found() {
        let status = PiInstallStatus {
            installed: false,
            path: None,
            version: None,
        };

        assert!(!status.installed);
        assert_eq!(status.path, None);
        assert_eq!(status.version, None);
    }

    #[test]
    fn test_check_pi_installed_found() {
        let status = PiInstallStatus {
            installed: true,
            path: Some("/usr/local/bin/pi".to_string()),
            version: version_from_output(success_output(b"pi version 1.2.3\n")),
        };

        assert!(status.installed);
        assert_eq!(status.path.as_deref(), Some("/usr/local/bin/pi"));
        assert_eq!(status.version.as_deref(), Some("pi version 1.2.3"));
    }
}
