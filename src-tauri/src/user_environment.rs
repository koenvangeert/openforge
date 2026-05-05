use log::warn;
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::io;
use std::path::Path;
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

const LOGIN_SHELL_ENV_TIMEOUT: Duration = Duration::from_secs(2);
const DEFAULT_TOOL_PATH: &str = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
const DEFAULT_LANG: &str = "en_US.UTF-8";

static USER_ENVIRONMENT: Lazy<HashMap<String, String>> = Lazy::new(resolve_user_environment);

pub(crate) fn user_environment() -> HashMap<String, String> {
    USER_ENVIRONMENT.clone()
}

pub(crate) fn user_tool_path() -> String {
    USER_ENVIRONMENT
        .get("PATH")
        .cloned()
        .unwrap_or_else(|| DEFAULT_TOOL_PATH.to_string())
}

pub(crate) fn find_tool_on_path(tool_name: &str, path: &str) -> Option<std::path::PathBuf> {
    std::env::split_paths(path)
        .map(|dir| dir.join(tool_name))
        .find(|candidate| is_executable_file(candidate))
}

#[cfg(unix)]
fn is_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;

    path.metadata()
        .map(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}

fn resolve_user_environment() -> HashMap<String, String> {
    let current_env: HashMap<String, String> = std::env::vars().collect();
    let shell = current_env
        .get("SHELL")
        .map(String::as_str)
        .unwrap_or("/bin/zsh");
    let shell_env = read_login_shell_environment(shell, LOGIN_SHELL_ENV_TIMEOUT);
    let home_dir = dirs::home_dir();

    build_user_environment(shell_env.as_ref(), &current_env, home_dir.as_deref())
}

fn build_user_environment(
    login_shell_env: Option<&HashMap<String, String>>,
    current_env: &HashMap<String, String>,
    home_dir: Option<&Path>,
) -> HashMap<String, String> {
    let mut env_map = login_shell_env.cloned().unwrap_or_default();

    for key in ["HOME", "USER", "SHELL"] {
        if !env_map.contains_key(key) {
            if let Some(value) = current_env.get(key) {
                env_map.insert(key.to_string(), value.clone());
            }
        }
    }

    if !env_map.contains_key("HOME") {
        if let Some(home_dir) = home_dir {
            env_map.insert("HOME".to_string(), home_dir.to_string_lossy().to_string());
        }
    }

    let path = merge_user_tool_path(
        current_env.get("PATH").map(String::as_str),
        login_shell_env
            .and_then(|env| env.get("PATH"))
            .map(String::as_str),
        home_dir,
    );
    env_map.insert("PATH".to_string(), path);

    if !env_map.contains_key("LANG") {
        env_map.insert(
            "LANG".to_string(),
            current_env
                .get("LANG")
                .cloned()
                .unwrap_or_else(|| DEFAULT_LANG.to_string()),
        );
    }

    env_map
}

fn read_login_shell_environment(shell: &str, timeout: Duration) -> Option<HashMap<String, String>> {
    match run_login_shell_script_with_timeout(shell, "env", timeout) {
        Ok(Some(output)) if output.status.success() => Some(parse_environment(&output.stdout)),
        Ok(Some(output)) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            warn!(
                "Failed to get login shell environment from {}: {}",
                shell, stderr
            );
            None
        }
        Ok(None) => {
            warn!(
                "Timed out after {:?} while getting login shell environment from {}",
                timeout, shell
            );
            None
        }
        Err(err) => {
            warn!(
                "Failed to run login shell {} for environment: {}",
                shell, err
            );
            None
        }
    }
}

fn run_login_shell_script_with_timeout(
    shell: &str,
    script: &str,
    timeout: Duration,
) -> io::Result<Option<Output>> {
    let mut child = Command::new(shell)
        .arg("-ilc")
        .arg(script)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let started = Instant::now();
    loop {
        if child.try_wait()?.is_some() {
            return child.wait_with_output().map(Some);
        }

        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Ok(None);
        }

        std::thread::sleep(Duration::from_millis(10));
    }
}

fn parse_environment(stdout: &[u8]) -> HashMap<String, String> {
    let env_str = String::from_utf8_lossy(stdout);
    env_str
        .lines()
        .filter_map(|line| {
            let (key, value) = line.split_once('=')?;
            (!key.is_empty()).then(|| (key.to_string(), value.to_string()))
        })
        .collect()
}

fn add_path_entries(entries: &mut Vec<String>, path: Option<&str>) {
    for entry in path.unwrap_or_default().split(':') {
        let trimmed = entry.trim();
        if !trimmed.is_empty() && !entries.iter().any(|existing| existing == trimmed) {
            entries.push(trimmed.to_string());
        }
    }
}

fn merge_user_tool_path(
    current_path: Option<&str>,
    login_shell_path: Option<&str>,
    home_dir: Option<&Path>,
) -> String {
    let mut entries = Vec::new();
    add_path_entries(&mut entries, current_path);
    add_path_entries(&mut entries, login_shell_path);

    if let Some(home_dir) = home_dir {
        add_user_managed_tool_paths(&mut entries, home_dir);
    }

    add_path_entries(&mut entries, Some(DEFAULT_TOOL_PATH));

    entries.join(":")
}

fn add_user_managed_tool_paths(entries: &mut Vec<String>, home_dir: &Path) {
    for relative in [
        ".local/bin",
        ".cargo/bin",
        ".bun/bin",
        ".claude/local",
        ".claude/local/bin",
        ".opencode/bin",
        ".npm-global/bin",
        ".volta/bin",
        ".asdf/shims",
        "Library/pnpm",
        ".local/share/pnpm",
        ".config/yarn/global/node_modules/.bin",
    ] {
        let entry = home_dir.join(relative).to_string_lossy().to_string();
        add_path_entries(entries, Some(&entry));
    }

    add_existing_node_version_bin_dirs(entries, &home_dir.join(".nvm/versions/node"));
    add_existing_node_version_bin_dirs(entries, &home_dir.join(".fnm/node-versions"));
}

fn add_existing_node_version_bin_dirs(entries: &mut Vec<String>, parent_dir: &Path) {
    let Ok(read_dir) = std::fs::read_dir(parent_dir) else {
        return;
    };

    let mut bin_dirs: Vec<String> = read_dir
        .filter_map(Result::ok)
        .flat_map(|entry| {
            [
                entry.path().join("bin"),
                entry.path().join("installation/bin"),
            ]
        })
        .filter(|path| path.is_dir())
        .map(|path| path.to_string_lossy().to_string())
        .collect();
    bin_dirs.sort();

    for bin_dir in bin_dirs {
        add_path_entries(entries, Some(&bin_dir));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::time::Instant;

    #[test]
    fn merge_user_tool_path_preserves_order_and_deduplicates_tool_bins() {
        let path = merge_user_tool_path(
            Some("/usr/bin:/bin"),
            Some("/Users/test/.bun/bin:/opt/homebrew/bin:/usr/bin"),
            Some(Path::new("/Users/test")),
        );

        let entries: Vec<&str> = path.split(':').collect();
        assert_eq!(entries[0], "/usr/bin");
        assert_eq!(entries[1], "/bin");
        assert!(entries.contains(&"/Users/test/.local/bin"));
        assert!(entries.contains(&"/Users/test/.cargo/bin"));
        assert!(entries.contains(&"/Users/test/.bun/bin"));
        assert!(entries.contains(&"/opt/homebrew/bin"));
        assert_eq!(
            entries.iter().filter(|entry| **entry == "/usr/bin").count(),
            1
        );
    }

    #[test]
    fn user_environment_falls_back_without_login_shell_values() {
        let env = build_user_environment(None, &HashMap::new(), Some(Path::new("/Users/test")));

        assert_eq!(env.get("HOME").map(String::as_str), Some("/Users/test"));
        assert!(env
            .get("PATH")
            .is_some_and(|path| path.contains("/usr/bin")));
        assert_eq!(env.get("LANG").map(String::as_str), Some(DEFAULT_LANG));
    }

    #[test]
    fn user_environment_includes_node_manager_bins_when_shell_path_is_unavailable() {
        let home_dir = tempfile::tempdir().expect("temp home");
        let nvm_bin = home_dir.path().join(".nvm/versions/node/v24.14.0/bin");
        std::fs::create_dir_all(&nvm_bin).expect("create nvm bin");
        let npm_global_bin = home_dir.path().join(".npm-global/bin");
        std::fs::create_dir_all(&npm_global_bin).expect("create npm global bin");
        let fnm_bin = home_dir
            .path()
            .join(".fnm/node-versions/v24.14.0/installation/bin");
        std::fs::create_dir_all(&fnm_bin).expect("create fnm bin");
        let opencode_bin = home_dir.path().join(".opencode/bin");
        std::fs::create_dir_all(&opencode_bin).expect("create opencode bin");
        let pi_executable = nvm_bin.join("pi");
        std::fs::write(&pi_executable, "#!/bin/sh\n").expect("write pi executable");
        let opencode_executable = opencode_bin.join("opencode");
        std::fs::write(&opencode_executable, "#!/bin/sh\n").expect("write opencode executable");
        for executable in [&pi_executable, &opencode_executable] {
            let mut permissions = std::fs::metadata(executable)
                .expect("metadata")
                .permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(executable, permissions).expect("chmod executable");
        }

        let env = build_user_environment(None, &HashMap::new(), Some(home_dir.path()));
        let path = env.get("PATH").expect("PATH should be populated");
        let entries: Vec<&str> = path.split(':').collect();

        assert!(entries.contains(&nvm_bin.to_string_lossy().as_ref()));
        assert!(entries.contains(&npm_global_bin.to_string_lossy().as_ref()));
        assert!(entries.contains(&fnm_bin.to_string_lossy().as_ref()));
        assert!(entries.contains(&opencode_bin.to_string_lossy().as_ref()));
        assert_eq!(
            find_tool_on_path("pi", path).as_deref(),
            Some(pi_executable.as_path())
        );
        assert_eq!(
            find_tool_on_path("opencode", path).as_deref(),
            Some(opencode_executable.as_path())
        );
    }

    #[test]
    fn user_environment_merges_login_shell_path_with_current_path() {
        let mut current_env = HashMap::new();
        current_env.insert("PATH".to_string(), "/usr/bin:/bin".to_string());
        current_env.insert("USER".to_string(), "test".to_string());

        let mut login_env = HashMap::new();
        login_env.insert(
            "PATH".to_string(),
            "/Users/test/.cargo/bin:/opt/homebrew/bin".to_string(),
        );
        login_env.insert("SHELL_ONLY".to_string(), "present".to_string());

        let env = build_user_environment(
            Some(&login_env),
            &current_env,
            Some(Path::new("/Users/test")),
        );
        let path = env.get("PATH").expect("PATH should be populated");
        let entries: Vec<&str> = path.split(':').collect();

        assert_eq!(entries[0], "/usr/bin");
        assert_eq!(entries[1], "/bin");
        assert!(entries.contains(&"/Users/test/.cargo/bin"));
        assert_eq!(env.get("SHELL_ONLY").map(String::as_str), Some("present"));
        assert_eq!(env.get("USER").map(String::as_str), Some("test"));
    }

    #[test]
    fn find_tool_on_path_resolves_executable_from_effective_user_path() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let executable = temp_dir.path().join("opencode");
        std::fs::write(&executable, "#!/bin/sh\n").expect("write executable");
        let mut permissions = std::fs::metadata(&executable)
            .expect("metadata")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&executable, permissions).expect("chmod executable");

        let path = format!("/not/here:{}", temp_dir.path().display());

        assert_eq!(find_tool_on_path("opencode", &path), Some(executable));
    }

    #[test]
    fn find_tool_on_path_ignores_non_executable_files() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        std::fs::write(temp_dir.path().join("opencode"), "not executable").expect("write file");

        assert_eq!(
            find_tool_on_path("opencode", &temp_dir.path().to_string_lossy()),
            None
        );
    }

    #[test]
    fn login_shell_command_times_out() {
        let start = Instant::now();
        let output = run_login_shell_script_with_timeout(
            "/bin/sh",
            "sleep 1; printf 'SHOULD_NOT_FINISH=1\\n'",
            Duration::from_millis(50),
        )
        .expect("shell command should start");

        assert!(output.is_none());
        assert!(
            start.elapsed() < Duration::from_millis(500),
            "login shell resolution should be bounded"
        );
    }

    #[test]
    fn login_shell_environment_parses_values_containing_equals() {
        let env = parse_environment(b"PATH=/usr/bin:/bin\nTOKEN=a=b=c\n");

        assert_eq!(env.get("PATH").map(String::as_str), Some("/usr/bin:/bin"));
        assert_eq!(env.get("TOKEN").map(String::as_str), Some("a=b=c"));
    }
}
