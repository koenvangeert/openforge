use crate::user_environment::{find_tool_on_path, user_tool_path};
use serde::Serialize;
use std::path::Path;
use std::process::Output;

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

#[derive(Clone, Debug, PartialEq, Eq)]
struct VersionedExecutableInstallStatus {
    installed: bool,
    path: Option<String>,
    version: Option<String>,
}

impl From<VersionedExecutableInstallStatus> for OpenCodeInstallStatus {
    fn from(status: VersionedExecutableInstallStatus) -> Self {
        Self {
            installed: status.installed,
            path: status.path,
            version: status.version,
        }
    }
}

impl From<VersionedExecutableInstallStatus> for PiInstallStatus {
    fn from(status: VersionedExecutableInstallStatus) -> Self {
        Self {
            installed: status.installed,
            path: status.path,
            version: status.version,
        }
    }
}

impl ClaudeInstallStatus {
    fn from_versioned_install(
        status: VersionedExecutableInstallStatus,
        authenticated: bool,
    ) -> Self {
        Self {
            installed: status.installed,
            path: status.path,
            version: status.version,
            authenticated,
        }
    }
}

pub async fn check_opencode_installed() -> Result<OpenCodeInstallStatus, String> {
    Ok(check_opencode_installed_with_path(&user_tool_path()))
}

fn check_opencode_installed_with_path(path: &str) -> OpenCodeInstallStatus {
    check_versioned_executable_installed("opencode", path).into()
}

pub async fn check_claude_installed() -> Result<ClaudeInstallStatus, String> {
    Ok(check_claude_installed_with_path(&user_tool_path()))
}

fn check_claude_installed_with_path(path: &str) -> ClaudeInstallStatus {
    let install_status = check_versioned_executable_installed("claude", path);
    let authenticated = install_status
        .path
        .as_deref()
        .map(|executable| claude_is_authenticated(executable, path))
        .unwrap_or(false);

    ClaudeInstallStatus::from_versioned_install(install_status, authenticated)
}

fn check_versioned_executable_installed(
    executable_name: &str,
    path: &str,
) -> VersionedExecutableInstallStatus {
    let Some(executable) = find_tool_on_path(executable_name, path) else {
        return VersionedExecutableInstallStatus {
            installed: false,
            path: None,
            version: None,
        };
    };

    VersionedExecutableInstallStatus {
        installed: true,
        path: Some(executable.to_string_lossy().to_string()),
        version: version_for_executable(&executable, path),
    }
}

fn version_for_executable(executable: &Path, path: &str) -> Option<String> {
    run_executable_with_effective_path(executable, path, &["--version"])
        .and_then(version_from_output)
}

fn claude_is_authenticated(executable: &str, path: &str) -> bool {
    run_executable_with_effective_path(Path::new(executable), path, &["auth", "status"])
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn run_executable_with_effective_path(
    executable: &Path,
    path: &str,
    args: &[&str],
) -> Option<Output> {
    std::process::Command::new(executable)
        .args(args)
        .env("PATH", path)
        .output()
        .ok()
}

fn version_from_output(output: Output) -> Option<String> {
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
    check_versioned_executable_installed("pi", path).into()
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

    fn write_executable(path: &std::path::Path, contents: &str) {
        std::fs::write(path, contents).expect("write fake executable");
        let mut permissions = std::fs::metadata(path).expect("metadata").permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(path, permissions).expect("chmod executable");
    }

    #[test]
    fn check_versioned_executable_installed_uses_effective_path_for_lookup_and_version() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let executable = temp_dir.path().join("sharedtool");
        let effective_path = temp_dir.path().to_string_lossy();
        write_executable(
            &executable,
            &format!(
                "#!/bin/sh\nif [ \"$1\" = \"--version\" ] && [ \"$PATH\" = '{}' ]; then printf 'sharedtool 9.8.7\\n'; exit 0; fi\nexit 42\n",
                effective_path
            ),
        );

        let status = check_versioned_executable_installed("sharedtool", &effective_path);

        assert!(status.installed);
        assert_eq!(
            status.path.as_deref(),
            Some(executable.to_string_lossy().as_ref())
        );
        assert_eq!(status.version.as_deref(), Some("sharedtool 9.8.7"));
    }

    #[test]
    fn provider_statuses_map_shared_install_fields_and_preserve_claude_authentication() {
        let shared_status = VersionedExecutableInstallStatus {
            installed: true,
            path: Some("/usr/local/bin/tool".to_string()),
            version: Some("tool 1.2.3".to_string()),
        };

        let opencode_status = OpenCodeInstallStatus::from(shared_status.clone());
        assert!(opencode_status.installed);
        assert_eq!(opencode_status.path.as_deref(), Some("/usr/local/bin/tool"));
        assert_eq!(opencode_status.version.as_deref(), Some("tool 1.2.3"));

        let pi_status = PiInstallStatus::from(shared_status.clone());
        assert!(pi_status.installed);
        assert_eq!(pi_status.path.as_deref(), Some("/usr/local/bin/tool"));
        assert_eq!(pi_status.version.as_deref(), Some("tool 1.2.3"));

        let claude_status = ClaudeInstallStatus::from_versioned_install(shared_status, true);
        assert!(claude_status.installed);
        assert_eq!(claude_status.path.as_deref(), Some("/usr/local/bin/tool"));
        assert_eq!(claude_status.version.as_deref(), Some("tool 1.2.3"));
        assert!(claude_status.authenticated);
    }

    #[test]
    fn test_check_pi_installed_not_found() {
        let status = check_pi_installed_with_path("/definitely/missing");

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
        write_executable(&executable, "#!/bin/sh\nprintf 'opencode 1.2.3\\n'\n");

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
        write_executable(
            &executable,
            "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then printf 'claude 2.3.4\\n'; exit 0; fi\nif [ \"$1\" = \"auth\" ] && [ \"$2\" = \"status\" ]; then exit 0; fi\nexit 1\n",
        );

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
    fn check_claude_installed_with_path_reports_missing_without_authentication() {
        let status = check_claude_installed_with_path("/definitely/missing");

        assert!(!status.installed);
        assert_eq!(status.path, None);
        assert_eq!(status.version, None);
        assert!(!status.authenticated);
    }

    #[test]
    fn check_pi_installed_with_path_finds_tool_outside_process_path() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let executable = temp_dir.path().join("pi");
        write_executable(&executable, "#!/bin/sh\nprintf 'pi version 3.4.5\\n'\n");

        let status = check_pi_installed_with_path(&temp_dir.path().to_string_lossy());

        assert!(status.installed);
        assert_eq!(
            status.path.as_deref(),
            Some(executable.to_string_lossy().as_ref())
        );
        assert_eq!(status.version.as_deref(), Some("pi version 3.4.5"));
    }
}
