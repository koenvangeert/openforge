use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

/// Get the HTTP server port from the AI_COMMAND_CENTER_PORT environment variable.
/// Defaults to 17422 if not set or invalid.
pub fn get_http_server_port() -> u16 {
    std::env::var("AI_COMMAND_CENTER_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(17422)
}

pub fn generate_hooks_settings(port: u16) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    let settings_dir = home.join(".ai-command-center");
    let settings_path = settings_dir.join("claude-hooks-settings.json");

    fs::create_dir_all(&settings_dir)?;

    let hooks_json = build_hooks_json(port);
    let json_string = serde_json::to_string_pretty(&hooks_json)?;

    fs::write(&settings_path, json_string)?;

    Ok(settings_path)
}

/// Pre-approve workspace trust for a directory in ~/.claude.json.
/// This sets `hasTrustDialogAccepted: true` for the given path,
/// which is the same thing Claude does when the user clicks "Yes, proceed"
/// on the workspace trust dialog. Tool permissions are NOT affected —
/// the user still approves file edits and bash commands in the terminal.
pub fn ensure_workspace_trusted(cwd: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    let claude_json_path = home.join(".claude.json");

    // Read existing ~/.claude.json or start with empty object
    let mut root: Value = if claude_json_path.exists() {
        let contents = std::fs::read_to_string(&claude_json_path)?;
        serde_json::from_str(&contents).unwrap_or_else(|_| json!({}))
    } else {
        json!({})
    };

    let cwd_str = cwd.to_string_lossy().to_string();

    // Check if already trusted
    if let Some(project) = root.get(&cwd_str) {
        if project.get("hasTrustDialogAccepted") == Some(&json!(true)) {
            return Ok(()); // Already trusted, nothing to do
        }
    }

    // Ensure the project entry exists and set trust flag
    let projects = root.as_object_mut().ok_or("Invalid .claude.json format")?;
    if let Some(project) = projects.get_mut(&cwd_str) {
        if let Some(obj) = project.as_object_mut() {
            obj.insert("hasTrustDialogAccepted".to_string(), json!(true));
        }
    } else {
        projects.insert(
            cwd_str,
            json!({
                "hasTrustDialogAccepted": true
            }),
        );
    }

    std::fs::write(&claude_json_path, serde_json::to_string_pretty(&root)?)?;
    Ok(())
}

fn build_hooks_json(port: u16) -> Value {
    let pre_tool_use_cmd = format!(
        "curl -s -X POST http://127.0.0.1:{}/hooks/pre-tool-use -H 'Content-Type: application/json' -d '{{\"session_id\":\"'\"$CLAUDE_SESSION_ID\"'\",\"tool_name\":\"'\"$CLAUDE_TOOL_NAME\"'\",\"CLAUDE_TASK_ID\":\"'\"$CLAUDE_TASK_ID\"'\"}}' ",
        port
    );

    let post_tool_use_cmd = format!(
        "curl -s -X POST http://127.0.0.1:{}/hooks/post-tool-use -H 'Content-Type: application/json' -d '{{\"session_id\":\"'\"$CLAUDE_SESSION_ID\"'\",\"tool_name\":\"'\"$CLAUDE_TOOL_NAME\"'\",\"CLAUDE_TASK_ID\":\"'\"$CLAUDE_TASK_ID\"'\"}}' ",
        port
    );

    let stop_cmd = format!(
        "curl -s -X POST http://127.0.0.1:{}/hooks/stop -H 'Content-Type: application/json' -d '{{\"session_id\":\"'\"$CLAUDE_SESSION_ID\"'\",\"CLAUDE_TASK_ID\":\"'\"$CLAUDE_TASK_ID\"'\"}}' ",
        port
    );

    let session_end_cmd = format!(
        "curl -s -X POST http://127.0.0.1:{}/hooks/session-end -H 'Content-Type: application/json' -d '{{\"session_id\":\"'\"$CLAUDE_SESSION_ID\"'\",\"CLAUDE_TASK_ID\":\"'\"$CLAUDE_TASK_ID\"'\"}}' ",
        port
    );

    let notification_permission_cmd = format!(
        "curl -s -X POST http://127.0.0.1:{}/hooks/notification-permission -H 'Content-Type: application/json' -d '{{\"session_id\":\"'\"$CLAUDE_SESSION_ID\"'\",\"CLAUDE_TASK_ID\":\"'\"$CLAUDE_TASK_ID\"'\"}}' ",
        port
    );

    let notification_cmd = format!(
        "curl -s -X POST http://127.0.0.1:{}/hooks/notification -H 'Content-Type: application/json' -d '{{\"session_id\":\"'\"$CLAUDE_SESSION_ID\"'\",\"CLAUDE_TASK_ID\":\"'\"$CLAUDE_TASK_ID\"'\"}}' ",
        port
    );

    json!({
        "hooks": {
            "PreToolUse": [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": pre_tool_use_cmd
                        }
                    ]
                }
            ],
            "PostToolUse": [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": post_tool_use_cmd
                        }
                    ]
                }
            ],
            "Stop": [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": stop_cmd
                        }
                    ]
                }
            ],
            "SessionEnd": [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": session_end_cmd
                        }
                    ]
                }
            ],
            "Notification": [
                {
                    "matcher": {
                        "message": "permission"
                    },
                    "hooks": [
                        {
                            "type": "command",
                            "command": notification_permission_cmd
                        }
                    ]
                },
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": notification_cmd
                        }
                    ]
                }
            ]
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_hooks_json_structure() {
        let json = build_hooks_json(17422);
        assert!(json.get("hooks").is_some());
        assert!(json["hooks"].get("PreToolUse").is_some());
        assert!(json["hooks"].get("PostToolUse").is_some());
        assert!(json["hooks"].get("Stop").is_some());
        assert!(json["hooks"].get("SessionEnd").is_some());
        assert!(json["hooks"].get("Notification").is_some());
        // Notification should have two entries: permission matcher + catch-all
        let notification = &json["hooks"]["Notification"];
        assert_eq!(notification.as_array().unwrap().len(), 2, "Notification should have 2 entries");
        assert!(notification[0].get("matcher").is_some(), "First entry should have a matcher");
        assert!(notification[1].get("matcher").is_none(), "Second entry should be catch-all (no matcher)");
    }

    #[test]
    fn test_hook_command_type() {
        let json = build_hooks_json(17422);
        let pre_tool_use = &json["hooks"]["PreToolUse"][0]["hooks"][0];
        assert_eq!(pre_tool_use["type"], "command");
    }

    #[test]
    fn test_port_substitution() {
        let json = build_hooks_json(9999);
        let pre_tool_use_cmd = &json["hooks"]["PreToolUse"][0]["hooks"][0]["command"];
        assert!(pre_tool_use_cmd
            .as_str()
            .unwrap()
            .contains("127.0.0.1:9999"));
    }

    #[test]
    fn test_curl_commands_contain_env_vars() {
        let json = build_hooks_json(17422);
        let pre_tool_use_cmd = json["hooks"]["PreToolUse"][0]["hooks"][0]["command"]
            .as_str()
            .unwrap();
        assert!(pre_tool_use_cmd.contains("$CLAUDE_SESSION_ID"));
        assert!(pre_tool_use_cmd.contains("$CLAUDE_TOOL_NAME"));
        assert!(pre_tool_use_cmd.contains("$CLAUDE_TASK_ID"));
    }

    #[test]
    fn test_file_creation() {
        let temp_dir = std::env::temp_dir().join("claude_hooks_test");
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();

        let settings_dir = temp_dir.join(".ai-command-center");
        let _settings_path = settings_dir.join("claude-hooks-settings.json");

        let home_backup = std::env::var("HOME").ok();
        std::env::set_var("HOME", &temp_dir);

        let result = generate_hooks_settings(17422);

        if let Some(home) = home_backup {
            std::env::set_var("HOME", home);
        }

        assert!(result.is_ok());
        let path = result.unwrap();
        assert!(path.exists());
        assert!(path
            .to_string_lossy()
            .contains("claude-hooks-settings.json"));

        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("\"hooks\""));
        assert!(content.contains("PreToolUse"));

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_file_overwrite() {
        let temp_dir = std::env::temp_dir().join("claude_hooks_overwrite_test");
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();

        let home_backup = std::env::var("HOME").ok();
        std::env::set_var("HOME", &temp_dir);

        let result1 = generate_hooks_settings(17422);
        let result2 = generate_hooks_settings(9999);

        if let Some(home) = home_backup {
            std::env::set_var("HOME", home);
        }

        assert!(result1.is_ok());
        assert!(result2.is_ok());

        let path = result2.unwrap();
        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("127.0.0.1:9999"));
        assert!(!content.contains("127.0.0.1:17422"));

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_json_valid() {
        let json = build_hooks_json(17422);
        let json_string = serde_json::to_string_pretty(&json).unwrap();
        let parsed: Value = serde_json::from_str(&json_string).unwrap();
        assert!(parsed.is_object());
    }

    #[test]
    fn test_get_http_server_port_variants() {
        // Backup the original env var once
        let backup = std::env::var("AI_COMMAND_CENTER_PORT").ok();

        // Test 1: Default (env var not set)
        std::env::remove_var("AI_COMMAND_CENTER_PORT");
        let port = get_http_server_port();
        assert_eq!(
            port, 17422,
            "Should return default 17422 when env var is not set"
        );

        // Test 2: Valid value from env
        std::env::set_var("AI_COMMAND_CENTER_PORT", "9999");
        let port = get_http_server_port();
        assert_eq!(port, 9999, "Should return 9999 when env var is set to 9999");

        // Test 3: Invalid value in env
        std::env::set_var("AI_COMMAND_CENTER_PORT", "invalid");
        let port = get_http_server_port();
        assert_eq!(
            port, 17422,
            "Should return default 17422 when env var is invalid"
        );

        // Restore the original env var
        if let Some(val) = backup {
            std::env::set_var("AI_COMMAND_CENTER_PORT", val);
        } else {
            std::env::remove_var("AI_COMMAND_CENTER_PORT");
        }
    }

    #[test]
    fn test_hooks_settings_urls_match_http_server_port() {
        let port = 54321u16;
        let json = build_hooks_json(port);

        // Single-entry hooks (index 0)
        let hook_entries = [
            ("PreToolUse", 0, "/hooks/pre-tool-use"),
            ("PostToolUse", 0, "/hooks/post-tool-use"),
            ("Stop", 0, "/hooks/stop"),
            ("SessionEnd", 0, "/hooks/session-end"),
            // Notification[0] = permission matcher, Notification[1] = catch-all
            ("Notification", 0, "/hooks/notification-permission"),
            ("Notification", 1, "/hooks/notification"),
        ];

        for (hook_key, idx, expected_route) in &hook_entries {
            let cmd = json["hooks"][hook_key][idx]["hooks"][0]["command"]
                .as_str()
                .unwrap_or_else(|| panic!("Missing command for {}[{}]", hook_key, idx));

            assert!(
                cmd.contains(&format!("127.0.0.1:{}", port)),
                "{}[{}] command should use port {}, got: {}",
                hook_key,
                idx,
                port,
                cmd
            );
            assert!(
                cmd.contains(expected_route),
                "{}[{}] command should POST to {}, got: {}",
                hook_key,
                idx,
                expected_route,
                cmd
            );
            assert!(cmd.contains("curl"), "{}[{}] command should use curl", hook_key, idx);
            assert!(
                cmd.contains("-X POST"),
                "{}[{}] command should be a POST",
                hook_key,
                idx
            );
        }
    }

    #[test]
    fn test_notification_permission_matcher() {
        let json = build_hooks_json(17422);
        let matcher = &json["hooks"]["Notification"][0]["matcher"];
        assert_eq!(matcher["message"], "permission");
    }

    #[test]
    fn test_hooks_settings_and_claude_args_integration() {
        let hooks_json = build_hooks_json(17422);
        let json_string = serde_json::to_string_pretty(&hooks_json).unwrap();

        let temp_path =
            std::env::temp_dir().join("test_hooks_settings_claude_args_integration.json");
        fs::write(&temp_path, &json_string).unwrap();

        let args = crate::pty_manager::build_claude_args("implement feature", None, &temp_path);

        let settings_idx = args
            .iter()
            .position(|a| a == "--settings")
            .expect("--settings flag should be present in claude args");
        assert_eq!(
            args[settings_idx + 1],
            temp_path.to_string_lossy().to_string(),
        );

        let content = fs::read_to_string(&temp_path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert!(parsed.get("hooks").is_some());

        let _ = fs::remove_file(&temp_path);
    }

    #[test]
    fn test_ensure_workspace_trusted_new_file() {
        let mut root = json!({});
        let cwd_str = "/tmp/test-workspace";

        let projects = root.as_object_mut().unwrap();
        projects.insert(
            cwd_str.to_string(),
            json!({
                "hasTrustDialogAccepted": true
            }),
        );

        assert_eq!(root[cwd_str]["hasTrustDialogAccepted"], json!(true));
    }

    #[test]
    fn test_ensure_workspace_trusted_existing_entry() {
        let mut root = json!({
            "/tmp/existing": {
                "allowedTools": [],
                "hasTrustDialogAccepted": false
            }
        });

        let cwd_str = "/tmp/existing";
        let projects = root.as_object_mut().unwrap();
        if let Some(project) = projects.get_mut(cwd_str) {
            if let Some(obj) = project.as_object_mut() {
                obj.insert("hasTrustDialogAccepted".to_string(), json!(true));
            }
        }

        assert_eq!(root[cwd_str]["hasTrustDialogAccepted"], json!(true));
        assert_eq!(root[cwd_str]["allowedTools"], json!([]));
    }
}
