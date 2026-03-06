use std::sync::{Mutex, Arc};
use tauri::State;
use serde::Serialize;
use crate::db;

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

#[tauri::command]
pub async fn check_opencode_installed() -> Result<OpenCodeInstallStatus, String> {
    let output = std::process::Command::new("which")
        .arg("opencode")
        .output();

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

#[tauri::command]
pub async fn check_claude_installed() -> Result<ClaudeInstallStatus, String> {
    let output = std::process::Command::new("which")
        .arg("claude")
        .output();

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

#[tauri::command]
pub async fn get_config(
    db: State<'_, Arc<Mutex<db::Database>>>,
    key: String,
) -> Result<Option<String>, String> {
    if crate::secure_store::is_secret(&key) {
        return crate::secure_store::get_secret(&key);
    }
    let db_lock = crate::db::acquire_db(&db);
    db_lock.get_config(&key)
        .map_err(|e| format!("Failed to get config: {}", e))
}

#[tauri::command]
pub async fn set_config(
    db: State<'_, Arc<Mutex<db::Database>>>,

    key: String,
    value: String,
) -> Result<(), String> {
    if crate::secure_store::is_secret(&key) {
        return crate::secure_store::set_secret(&key, &value);
    }
    let db_lock = crate::db::acquire_db(&db);
    db_lock.set_config(&key, &value)
        .map_err(|e| format!("Failed to set config: {}", e))
}

#[tauri::command]
pub async fn get_app_mode() -> Result<String, String> {
    if cfg!(debug_assertions) {
        Ok("dev".to_string())
    } else {
        Ok("prod".to_string())
    }
}
