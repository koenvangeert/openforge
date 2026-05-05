use crate::user_environment::{find_tool_on_path, user_tool_path};
use serde::Serialize;

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
    Ok(check_opencode_installed_with_path(&user_tool_path()))
}

fn check_opencode_installed_with_path(path: &str) -> OpenCodeInstallStatus {
    let Some(executable) = find_tool_on_path("opencode", path) else {
        return OpenCodeInstallStatus {
            installed: false,
            path: None,
            version: None,
        };
    };

    let version = std::process::Command::new(&executable)
        .arg("--version")
        .env("PATH", path)
        .output()
        .ok()
        .and_then(version_from_output);

    OpenCodeInstallStatus {
        installed: true,
        path: Some(executable.to_string_lossy().to_string()),
        version,
    }
}

pub async fn check_claude_installed() -> Result<ClaudeInstallStatus, String> {
    Ok(check_claude_installed_with_path(&user_tool_path()))
}

fn check_claude_installed_with_path(path: &str) -> ClaudeInstallStatus {
    let Some(executable) = find_tool_on_path("claude", path) else {
        return ClaudeInstallStatus {
            installed: false,
            path: None,
            version: None,
            authenticated: false,
        };
    };

    let version = std::process::Command::new(&executable)
        .arg("--version")
        .env("PATH", path)
        .output()
        .ok()
        .and_then(version_from_output);
    let authenticated = std::process::Command::new(&executable)
        .args(["auth", "status"])
        .env("PATH", path)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false);

    ClaudeInstallStatus {
        installed: true,
        path: Some(executable.to_string_lossy().to_string()),
        version,
        authenticated,
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
    Ok(check_pi_installed_with_path(&user_tool_path()))
}

fn check_pi_installed_with_path(path: &str) -> PiInstallStatus {
    let Some(executable) = find_tool_on_path("pi", path) else {
        return PiInstallStatus {
            installed: false,
            path: None,
            version: None,
        };
    };

    let version = std::process::Command::new(&executable)
        .arg("--version")
        .env("PATH", path)
        .output()
        .ok()
        .and_then(version_from_output);

    PiInstallStatus {
        installed: true,
        path: Some(executable.to_string_lossy().to_string()),
        version,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
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

    #[test]
    fn check_opencode_installed_with_path_finds_tool_outside_process_path() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let executable = temp_dir.path().join("opencode");
        std::fs::write(&executable, "#!/bin/sh\nprintf 'opencode 1.2.3\\n'\n")
            .expect("write fake opencode");
        let mut permissions = std::fs::metadata(&executable)
            .expect("metadata")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&executable, permissions).expect("chmod executable");

        let status = check_opencode_installed_with_path(&temp_dir.path().to_string_lossy());

        assert!(status.installed);
        assert_eq!(
            status.path.as_deref(),
            Some(executable.to_string_lossy().as_ref())
        );
        assert_eq!(status.version.as_deref(), Some("opencode 1.2.3"));
    }

    #[test]
    fn check_opencode_installed_with_path_reports_missing_when_not_on_effective_path() {
        let status = check_opencode_installed_with_path("/definitely/missing");

        assert!(!status.installed);
        assert_eq!(status.path, None);
        assert_eq!(status.version, None);
    }

    #[test]
    fn check_claude_installed_with_path_finds_tool_outside_process_path() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let executable = temp_dir.path().join("claude");
        std::fs::write(
            &executable,
            "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then printf 'claude 2.3.4\\n'; exit 0; fi\nif [ \"$1\" = \"auth\" ] && [ \"$2\" = \"status\" ]; then exit 0; fi\nexit 1\n",
        )
        .expect("write fake claude");
        let mut permissions = std::fs::metadata(&executable)
            .expect("metadata")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&executable, permissions).expect("chmod executable");

        let status = check_claude_installed_with_path(&temp_dir.path().to_string_lossy());

        assert!(status.installed);
        assert_eq!(
            status.path.as_deref(),
            Some(executable.to_string_lossy().as_ref())
        );
        assert_eq!(status.version.as_deref(), Some("claude 2.3.4"));
        assert!(status.authenticated);
    }

    #[test]
    fn check_pi_installed_with_path_finds_tool_outside_process_path() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let executable = temp_dir.path().join("pi");
        std::fs::write(&executable, "#!/bin/sh\nprintf 'pi version 3.4.5\\n'\n")
            .expect("write fake pi");
        let mut permissions = std::fs::metadata(&executable)
            .expect("metadata")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&executable, permissions).expect("chmod executable");

        let status = check_pi_installed_with_path(&temp_dir.path().to_string_lossy());

        assert!(status.installed);
        assert_eq!(
            status.path.as_deref(),
            Some(executable.to_string_lossy().as_ref())
        );
        assert_eq!(status.version.as_deref(), Some("pi version 3.4.5"));
    }
}
