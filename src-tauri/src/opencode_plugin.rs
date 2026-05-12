use std::fs;
use std::path::PathBuf;

const OPENCODE_PLUGIN_SOURCE: &str = include_str!("opencode-plugin/openforge.ts");

fn opencode_config_dir() -> Option<PathBuf> {
    std::env::var_os("XDG_CONFIG_HOME")
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".config")))
        .or_else(dirs::config_dir)
        .map(|config| config.join("opencode"))
}

pub fn get_opencode_plugin_install_dir() -> Option<PathBuf> {
    opencode_config_dir().map(|config| config.join("plugins"))
}

pub fn ensure_opencode_plugin_installed() -> Result<PathBuf, Box<dyn std::error::Error>> {
    let install_dir =
        get_opencode_plugin_install_dir().ok_or("could not determine config directory")?;
    fs::create_dir_all(&install_dir)?;
    let plugin_path = install_dir.join("openforge.ts");
    fs::write(&plugin_path, OPENCODE_PLUGIN_SOURCE)?;
    Ok(plugin_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opencode_plugin_reports_lifecycle_events_to_openforge_hook() {
        assert!(OPENCODE_PLUGIN_SOURCE.contains("event: async"));
        assert!(OPENCODE_PLUGIN_SOURCE.contains("OPENFORGE_TASK_ID"));
        assert!(OPENCODE_PLUGIN_SOURCE.contains("OPENFORGE_PTY_INSTANCE_ID"));
        assert!(OPENCODE_PLUGIN_SOURCE.contains("OPENFORGE_HTTP_PORT"));
        assert!(OPENCODE_PLUGIN_SOURCE.contains("/hooks/agent-lifecycle"));
        assert!(OPENCODE_PLUGIN_SOURCE.contains("provider: \"opencode\""));
        assert!(OPENCODE_PLUGIN_SOURCE.contains("session.created"));
        assert!(OPENCODE_PLUGIN_SOURCE.contains("session.idle"));
        assert!(OPENCODE_PLUGIN_SOURCE.contains("session.error"));
        assert!(OPENCODE_PLUGIN_SOURCE.contains("provider_session_id"));
        assert!(OPENCODE_PLUGIN_SOURCE.contains("status_type"));
    }

    #[test]
    fn opencode_plugin_install_dir_uses_opencode_config_directory() {
        let dir = get_opencode_plugin_install_dir().expect("config dir should resolve");
        assert!(dir.ends_with(".config/opencode/plugins"));
    }

    #[test]
    fn opencode_plugin_prefers_session_id_over_message_id() {
        let session_id = evaluate_session_id_from_event(
            r#"{
                type: "message.updated",
                properties: {
                    info: { id: "msg_bad123" },
                    session: { id: "ses_good123" },
                    sessionID: "ses_good456",
                    sessionId: "ses_good789"
                }
            }"#,
        );

        assert_eq!(session_id.as_deref(), Some("ses_good123"));
    }

    #[test]
    fn opencode_plugin_rejects_message_id_without_session_id() {
        let session_id = evaluate_session_id_from_event(
            r#"{
                type: "message.updated",
                properties: {
                    info: { id: "msg_bad123" }
                }
            }"#,
        );

        assert_eq!(session_id, None);
    }

    fn evaluate_session_id_from_event(event_js: &str) -> Option<String> {
        let source =
            OPENCODE_PLUGIN_SOURCE.replace("export const OpenForgePlugin", "const OpenForgePlugin");
        let script = format!(
            r#"{source}
const result = sessionIdFromEvent({event_js});
process.stdout.write(result === null || result === undefined ? "null" : String(result));
"#
        );
        let path = std::env::temp_dir().join(format!(
            "openforge-opencode-plugin-test-{}.mjs",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after epoch")
                .as_nanos()
        ));
        std::fs::write(&path, script).expect("write plugin test script");
        let output = std::process::Command::new("node")
            .arg(&path)
            .output()
            .expect("run node for opencode plugin test");
        let _ = std::fs::remove_file(&path);

        assert!(
            output.status.success(),
            "node failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        let stdout = String::from_utf8(output.stdout).expect("node output should be utf8");
        if stdout == "null" {
            None
        } else {
            Some(stdout)
        }
    }
}
