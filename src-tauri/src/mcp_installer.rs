use log::{error, info, warn};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

const MCP_SERVER_INDEX_JS: &str = include_str!("mcp-server/index.js");
const MCP_SERVER_PACKAGE_JSON: &str = include_str!("mcp-server/package.json");

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

fn write_mcp_server_files(install_dir: &PathBuf) -> Result<(), Box<dyn std::error::Error>> {
    fs::create_dir_all(install_dir)?;
    fs::write(install_dir.join("index.js"), MCP_SERVER_INDEX_JS)?;
    fs::write(install_dir.join("package.json"), MCP_SERVER_PACKAGE_JSON)?;
    info!(
        "[mcp_installer] MCP server files written to: {}",
        install_dir.display()
    );
    Ok(())
}

pub fn install_mcp_server() -> Result<(), Box<dyn std::error::Error>> {
    let install_dir = get_mcp_install_dir().ok_or("Could not determine config directory")?;
    write_mcp_server_files(&install_dir)?;

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
        assert_eq!(openforge["args"][0], "/opt/openforge/mcp-server/index.js");
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
        assert_eq!(openforge["args"][0], "/new/path/mcp-server/index.js");
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
        let package_json = tmp_dir.join("package.json");
        assert!(index_js.exists(), "index.js should exist at {:?}", index_js);
        assert!(
            package_json.exists(),
            "package.json should exist at {:?}",
            package_json
        );

        let index_content = std::fs::read_to_string(&index_js).unwrap();
        assert!(index_content.contains("McpServer"));

        let pkg_content = std::fs::read_to_string(&package_json).unwrap();
        assert!(pkg_content.contains("openforge-mcp-server"));

        let _ = std::fs::remove_dir_all(&tmp_dir);
    }
}
