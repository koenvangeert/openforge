use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;

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
}
