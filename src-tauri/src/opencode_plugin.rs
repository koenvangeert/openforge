use std::fs;
use std::path::PathBuf;

const OPENCODE_PLUGIN_SOURCE: &str = include_str!("opencode-plugin/openforge.ts");

pub fn get_opencode_plugin_install_dir() -> Option<PathBuf> {
    dirs::config_dir().map(|config| config.join("opencode").join("plugins"))
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
    fn opencode_plugin_install_dir_uses_opencode_plugin_directory() {
        let dir = get_opencode_plugin_install_dir().expect("config dir should resolve");
        assert!(dir.ends_with("opencode/plugins"));
    }
}
