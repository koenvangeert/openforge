use log::{error, info, warn};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

const MCP_SERVER_INDEX_JS: &str = include_str!("mcp-server/index.js");
const MCP_SERVER_CLI_JS: &str = include_str!("mcp-server/cli.js");
const MCP_SERVER_PACKAGE_JSON: &str = include_str!("mcp-server/package.json");
const OPENFORGE_SKILL_TEMPLATE: &str = include_str!("mcp-server/openforge-skill.md");

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderSkillInstallTarget {
    pub provider: &'static str,
    pub path: PathBuf,
}

fn get_mcp_install_dir() -> Option<PathBuf> {
    dirs::config_dir().map(|config| config.join("openforge").join("mcp-server"))
}

fn read_json_file_opt(path: &PathBuf) -> Option<Value> {
    let contents = fs::read_to_string(path).ok()?;
    match serde_json::from_str::<Value>(&contents) {
        Ok(v) => Some(v),
        Err(e) => {
            warn!(
                "[mcp_installer] Warning: Invalid JSON in {}: {}. Starting fresh.",
                path.display(),
                e
            );
            None
        }
    }
}

fn build_mcp_entry(port: &str, install_path: &str) -> Value {
    serde_json::json!({
        "type": "stdio",
        "command": "node",
        "args": [format!("{}/index.js", install_path)],
        "env": {
            "OPENFORGE_HTTP_PORT": port
        }
    })
}

pub fn merge_mcp_config(existing: Option<Value>, port: &str, install_path: &str) -> Value {
    let mut config = match existing {
        Some(Value::Object(map)) => Value::Object(map),
        _ => serde_json::json!({}),
    };

    if !matches!(config.get("mcpServers"), Some(Value::Object(_))) {
        config["mcpServers"] = serde_json::json!({});
    }

    config["mcpServers"]["openforge"] = build_mcp_entry(port, install_path);
    config
}

fn write_mcp_server_files(install_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    fs::create_dir_all(install_dir)?;
    fs::write(install_dir.join("index.js"), MCP_SERVER_INDEX_JS)?;
    fs::write(install_dir.join("cli.js"), MCP_SERVER_CLI_JS)?;
    fs::write(
        install_dir.join("openforge-skill.md"),
        build_openforge_skill(&install_dir.join("cli.js")),
    )?;
    fs::write(install_dir.join("package.json"), MCP_SERVER_PACKAGE_JSON)?;
    info!(
        "[mcp_installer] MCP server and CLI files written to: {}",
        install_dir.display()
    );
    Ok(())
}

fn build_openforge_skill(cli_path: &Path) -> String {
    OPENFORGE_SKILL_TEMPLATE.replace("{{OPENFORGE_CLI_PATH}}", &cli_path.to_string_lossy())
}

fn openforge_cli_path(config_dir: &Path) -> PathBuf {
    config_dir
        .join("openforge")
        .join("mcp-server")
        .join("cli.js")
}

fn openforge_bin_dir(home_dir: &Path) -> PathBuf {
    home_dir.join(".openforge").join("bin")
}

fn build_cli_launcher(cli_path: &Path) -> String {
    format!(
        "#!/bin/sh\nexec node \"{}\" \"$@\"\n",
        cli_path.to_string_lossy()
    )
}

pub fn install_cli_launcher(
    home_dir: &Path,
    config_dir: &Path,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let bin_dir = openforge_bin_dir(home_dir);
    fs::create_dir_all(&bin_dir)?;

    let launcher = bin_dir.join("openforge");
    fs::write(
        &launcher,
        build_cli_launcher(&openforge_cli_path(config_dir)),
    )?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(&launcher)?.permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&launcher, permissions)?;
    }

    info!(
        "[mcp_installer] OpenForge CLI launcher installed at {}",
        launcher.display()
    );
    Ok(launcher)
}

pub fn ensure_zshrc_path(
    home_dir: &Path,
    bin_dir: &Path,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    fs::create_dir_all(home_dir)?;
    let zshrc = home_dir.join(".zshrc");
    let existing = fs::read_to_string(&zshrc).unwrap_or_default();
    let marker = "# OpenForge CLI";

    let has_openforge_path = existing.contains(&bin_dir.to_string_lossy().to_string())
        || existing.contains("$HOME/.openforge/bin")
        || existing.contains("${HOME}/.openforge/bin");

    if !existing.contains(marker) && !has_openforge_path {
        let mut updated = existing;
        if !updated.is_empty() && !updated.ends_with('\n') {
            updated.push('\n');
        }
        updated.push_str("\n# OpenForge CLI\nexport PATH=\"$HOME/.openforge/bin:$PATH\"\n");
        fs::write(&zshrc, updated)?;
        info!(
            "[mcp_installer] Added OpenForge CLI path to {}",
            zshrc.display()
        );
    }

    Ok(zshrc)
}

pub fn provider_skill_install_targets(
    home_dir: &Path,
    config_dir: &Path,
) -> Vec<ProviderSkillInstallTarget> {
    vec![
        ProviderSkillInstallTarget {
            provider: "generic",
            path: home_dir
                .join(".agents")
                .join("skills")
                .join("openforge")
                .join("SKILL.md"),
        },
        ProviderSkillInstallTarget {
            provider: "claude-code",
            path: home_dir
                .join(".claude")
                .join("skills")
                .join("openforge")
                .join("SKILL.md"),
        },
        ProviderSkillInstallTarget {
            provider: "pi",
            path: home_dir
                .join(".pi")
                .join("agent")
                .join("skills")
                .join("openforge")
                .join("SKILL.md"),
        },
        ProviderSkillInstallTarget {
            provider: "opencode",
            path: config_dir
                .join("opencode")
                .join("skills")
                .join("openforge")
                .join("SKILL.md"),
        },
    ]
}

pub fn write_provider_skill_files(
    home_dir: &Path,
    config_dir: &Path,
) -> Result<Vec<ProviderSkillInstallTarget>, Box<dyn std::error::Error>> {
    let skill = build_openforge_skill(&openforge_cli_path(config_dir));
    let targets = provider_skill_install_targets(home_dir, config_dir);

    for target in &targets {
        if let Some(parent) = target.path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&target.path, &skill)?;
        info!(
            "[mcp_installer] OpenForge skill installed for {} at {}",
            target.provider,
            target.path.display()
        );
    }

    Ok(targets)
}

pub fn install_mcp_server() -> Result<(), Box<dyn std::error::Error>> {
    let config_dir = dirs::config_dir().ok_or("Could not determine config directory")?;
    let install_dir = get_mcp_install_dir().ok_or("Could not determine config directory")?;
    write_mcp_server_files(&install_dir)?;

    if let Some(home_dir) = dirs::home_dir() {
        write_provider_skill_files(&home_dir, &config_dir)?;
        install_cli_launcher(&home_dir, &config_dir)?;
        ensure_zshrc_path(&home_dir, &openforge_bin_dir(&home_dir))?;
    } else {
        warn!(
            "[mcp_installer] Could not determine home directory; skipping provider skill install"
        );
    }

    let output = std::process::Command::new("npm")
        .args(["install", "--omit=dev"])
        .current_dir(&install_dir)
        .output();

    match output {
        Ok(out) if out.status.success() => {
            info!("[mcp_installer] npm install completed successfully");
        }
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            error!("[mcp_installer] npm install failed: {}", stderr);
        }
        Err(e) => {
            error!("[mcp_installer] Failed to run npm install: {}", e);
        }
    }

    Ok(())
}

pub fn configure_opencode_mcp(port: &str) -> Result<(), Box<dyn std::error::Error>> {
    let config_dir = dirs::config_dir().ok_or("Could not determine config directory")?;
    let config_path = config_dir.join("opencode").join("config.json");
    let install_dir = get_mcp_install_dir().ok_or("Could not determine config directory")?;
    let install_path = install_dir.to_string_lossy().to_string();

    let existing = read_json_file_opt(&config_path);
    let merged = merge_mcp_config(existing, port, &install_path);

    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::write(&config_path, serde_json::to_string_pretty(&merged)?)?;
    info!(
        "[mcp_installer] OpenCode MCP config written to: {}",
        config_path.display()
    );
    Ok(())
}

pub fn configure_claude_mcp(port: &str) -> Result<(), Box<dyn std::error::Error>> {
    let config_path = dirs::home_dir()
        .ok_or("Could not determine home directory")?
        .join(".claude.json");
    let install_dir = get_mcp_install_dir().ok_or("Could not determine config directory")?;
    let install_path = install_dir.to_string_lossy().to_string();

    let existing = read_json_file_opt(&config_path);
    let merged = merge_mcp_config(existing, port, &install_path);

    fs::write(&config_path, serde_json::to_string_pretty(&merged)?)?;
    info!(
        "[mcp_installer] Claude MCP config written to: {}",
        config_path.display()
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_merge_mcp_config_creates_new() {
        let result = merge_mcp_config(None, "17422", "/opt/openforge/mcp-server");

        assert!(result.is_object());
        assert!(result["mcpServers"].is_object());

        let openforge = &result["mcpServers"]["openforge"];
        assert_eq!(openforge["type"], "stdio");
        assert_eq!(openforge["command"], "node");
        assert_eq!(openforge["args"], json!(["/opt/openforge/mcp-server/index.js"]));
        assert_eq!(openforge["env"]["OPENFORGE_HTTP_PORT"], "17422");
    }

    #[test]
    fn test_merge_mcp_config_preserves_existing() {
        let existing = json!({
            "theme": "dark",
            "mcpServers": {
                "other-server": {
                    "type": "stdio",
                    "command": "other-cmd"
                }
            }
        });

        let result = merge_mcp_config(Some(existing), "17422", "/path/to/mcp");

        assert_eq!(result["theme"], "dark");

        let other = &result["mcpServers"]["other-server"];
        assert_eq!(other["type"], "stdio");
        assert_eq!(other["command"], "other-cmd");

        let openforge = &result["mcpServers"]["openforge"];
        assert_eq!(openforge["type"], "stdio");
    }

    #[test]
    fn test_merge_mcp_config_updates_openforge() {
        let existing = json!({
            "mcpServers": {
                "openforge": {
                    "type": "stdio",
                    "command": "node",
                    "args": ["/old/path/index.js"],
                    "env": {
                        "OPENFORGE_HTTP_PORT": "9999"
                    }
                }
            }
        });

        let result = merge_mcp_config(Some(existing), "17422", "/new/path/mcp-server");

        let openforge = &result["mcpServers"]["openforge"];
        assert_eq!(openforge["args"], json!(["/new/path/mcp-server/index.js"]));
        assert_eq!(openforge["env"]["OPENFORGE_HTTP_PORT"], "17422");
    }

    #[test]
    fn test_merge_mcp_config_handles_invalid_json() {
        let result = merge_mcp_config(Some(json!("not-an-object")), "17422", "/some/path");

        assert!(result["mcpServers"]["openforge"].is_object());
        assert_eq!(
            result["mcpServers"]["openforge"]["env"]["OPENFORGE_HTTP_PORT"],
            "17422"
        );
    }

    #[test]
    fn test_install_mcp_server_writes_files() {
        let tmp_dir =
            std::env::temp_dir().join(format!("mcp_installer_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp_dir);

        let result = write_mcp_server_files(&tmp_dir);
        assert!(
            result.is_ok(),
            "write_mcp_server_files failed: {:?}",
            result
        );

        let index_js = tmp_dir.join("index.js");
        let cli_js = tmp_dir.join("cli.js");
        let skill_md = tmp_dir.join("openforge-skill.md");
        let package_json = tmp_dir.join("package.json");
        assert!(index_js.exists(), "index.js should exist at {:?}", index_js);
        assert!(cli_js.exists(), "cli.js should exist at {:?}", cli_js);
        assert!(
            skill_md.exists(),
            "openforge-skill.md should exist at {:?}",
            skill_md
        );
        assert!(
            package_json.exists(),
            "package.json should exist at {:?}",
            package_json
        );

        let index_content = std::fs::read_to_string(&index_js).unwrap();
        assert!(index_content.contains("McpServer"));

        let cli_content = std::fs::read_to_string(&cli_js).unwrap();
        assert!(cli_content.contains("create-task"));
        assert!(!cli_content.contains("'mcp'"));

        let skill_content = std::fs::read_to_string(&skill_md).unwrap();
        assert!(skill_content.contains("openforge"));
        assert!(skill_content.contains("cli.js"));

        let pkg_content = std::fs::read_to_string(&package_json).unwrap();
        assert!(pkg_content.contains("openforge-mcp-server"));

        let _ = std::fs::remove_dir_all(&tmp_dir);
    }

    #[test]
    fn test_provider_skill_install_targets_cover_supported_providers_and_generic_path() {
        let home = PathBuf::from("/home/tester");
        let config = PathBuf::from("/home/tester/.config");
        let targets = provider_skill_install_targets(&home, &config);
        let paths: Vec<_> = targets.iter().map(|target| target.path.as_path()).collect();

        assert!(paths.contains(&home.join(".agents/skills/openforge/SKILL.md").as_path()));
        assert!(paths.contains(&home.join(".claude/skills/openforge/SKILL.md").as_path()));
        assert!(paths.contains(&home.join(".pi/agent/skills/openforge/SKILL.md").as_path()));
        assert!(paths.contains(&config.join("opencode/skills/openforge/SKILL.md").as_path()));
    }

    #[test]
    fn test_write_provider_skill_files_installs_same_skill_for_each_provider() {
        let tmp_dir = tempfile::tempdir().unwrap();
        let home = tmp_dir.path().join("home");
        let config = tmp_dir.path().join("config");

        let targets = write_provider_skill_files(&home, &config).expect("write provider skills");

        assert_eq!(targets.len(), 4);
        for target in targets {
            let content = std::fs::read_to_string(&target.path).unwrap();
            assert!(content.contains("name: openforge"));
            assert!(content.contains("OPENFORGE_HTTP_PORT"));
            assert!(content.contains("cli.js"));
        }
    }

    #[test]
    fn test_install_cli_launcher_writes_openforge_command_wrapper() {
        let tmp_dir = tempfile::tempdir().unwrap();
        let home = tmp_dir.path().join("home");
        let config = tmp_dir.path().join("config");

        let launcher = install_cli_launcher(&home, &config).expect("install cli launcher");

        assert_eq!(launcher, home.join(".openforge/bin/openforge"));
        let content = std::fs::read_to_string(&launcher).unwrap();
        assert!(content.starts_with("#!/bin/sh"));
        assert!(content.contains("mcp-server/cli.js"));
        assert!(content.contains("exec node"));
    }

    #[test]
    fn test_ensure_zshrc_path_adds_openforge_bin_once() {
        let tmp_dir = tempfile::tempdir().unwrap();
        let home = tmp_dir.path().join("home");
        let bin_dir = home.join(".openforge").join("bin");
        std::fs::create_dir_all(&home).unwrap();

        ensure_zshrc_path(&home, &bin_dir).expect("write zshrc path");
        ensure_zshrc_path(&home, &bin_dir).expect("write zshrc path idempotently");

        let zshrc = std::fs::read_to_string(home.join(".zshrc")).unwrap();
        assert_eq!(zshrc.matches("# OpenForge CLI").count(), 1);
        assert!(zshrc.contains("export PATH=\"$HOME/.openforge/bin:$PATH\""));
    }

    #[test]
    fn test_ensure_zshrc_path_does_not_duplicate_existing_home_path() {
        let tmp_dir = tempfile::tempdir().unwrap();
        let home = tmp_dir.path().join("home");
        let bin_dir = home.join(".openforge").join("bin");
        std::fs::create_dir_all(&home).unwrap();
        std::fs::write(
            home.join(".zshrc"),
            "export PATH=\"$HOME/.openforge/bin:$PATH\"\n",
        )
        .unwrap();

        ensure_zshrc_path(&home, &bin_dir).expect("write zshrc path idempotently");

        let zshrc = std::fs::read_to_string(home.join(".zshrc")).unwrap();
        assert_eq!(zshrc.matches(".openforge/bin").count(), 1);
        assert!(!zshrc.contains("# OpenForge CLI"));
    }
}
