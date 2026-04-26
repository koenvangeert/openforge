use std::fs;
use std::path::PathBuf;

const PI_EXTENSION_SOURCE: &str = include_str!("pi-extension/openforge.ts");

pub fn get_pi_extension_install_dir() -> Option<PathBuf> {
    dirs::config_dir().map(|config| config.join("openforge").join("pi-extension"))
}

pub fn ensure_pi_extension_installed() -> Result<PathBuf, Box<dyn std::error::Error>> {
    let install_dir =
        get_pi_extension_install_dir().ok_or("Could not determine config directory")?;
    fs::create_dir_all(&install_dir)?;
    let extension_path = install_dir.join("openforge.ts");
    fs::write(&extension_path, PI_EXTENSION_SOURCE)?;
    Ok(extension_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pi_extension_reports_agent_end_to_openforge_hook() {
        assert!(PI_EXTENSION_SOURCE.contains("agent_end"));
        assert!(PI_EXTENSION_SOURCE.contains("OPENFORGE_TASK_ID"));
        assert!(PI_EXTENSION_SOURCE.contains("OPENFORGE_PTY_INSTANCE_ID"));
        assert!(PI_EXTENSION_SOURCE.contains("pty_instance_id"));
        assert!(PI_EXTENSION_SOURCE.contains("/hooks/pi-agent-end"));
    }

    #[test]
    fn pi_extension_install_dir_uses_openforge_config() {
        let dir = get_pi_extension_install_dir().expect("config dir should resolve");
        assert!(dir.ends_with("openforge/pi-extension"));
    }
}
