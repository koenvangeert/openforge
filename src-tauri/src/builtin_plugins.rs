use std::path::{Path, PathBuf};

const BUILTIN_INSTALL_PREFIX: &str = "builtin:";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct BuiltinPlugin {
    pub(crate) id: &'static str,
    pub(crate) directory_name: &'static str,
}

impl BuiltinPlugin {
    pub(crate) fn sentinel_install_path(&self) -> String {
        sentinel_install_path(self.id)
    }
}

const BUILTIN_PLUGINS: &[BuiltinPlugin] = &[
    BuiltinPlugin {
        id: "com.openforge.file-viewer",
        directory_name: "file-viewer",
    },
    BuiltinPlugin {
        id: "com.openforge.github-sync",
        directory_name: "github-sync",
    },
    BuiltinPlugin {
        id: "com.openforge.skills-viewer",
        directory_name: "skills-viewer",
    },
    BuiltinPlugin {
        id: "com.openforge.terminal",
        directory_name: "terminal",
    },
];

pub(crate) fn find(plugin_id: &str) -> Option<&'static BuiltinPlugin> {
    BUILTIN_PLUGINS.iter().find(|plugin| plugin.id == plugin_id)
}

pub(crate) fn sentinel_install_path(plugin_id: &str) -> String {
    format!("{BUILTIN_INSTALL_PREFIX}{plugin_id}")
}

pub(crate) fn has_sentinel_install_path(plugin_id: &str, install_path: &str) -> bool {
    find(plugin_id).is_some_and(|plugin| install_path == plugin.sentinel_install_path())
}

pub(crate) fn install_path(plugin_id: &str) -> Result<PathBuf, String> {
    let workspace_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    install_path_from_workspace_root(&workspace_root, plugin_id)
}

fn install_path_from_workspace_root(
    workspace_root: &Path,
    plugin_id: &str,
) -> Result<PathBuf, String> {
    let plugin = find(plugin_id).ok_or_else(|| format!("Unknown builtin plugin: {plugin_id}"))?;
    Ok(workspace_root.join("plugins").join(plugin.directory_name))
}

#[cfg(test)]
mod tests {
    use super::{find, has_sentinel_install_path, install_path_from_workspace_root};
    use std::path::Path;

    #[test]
    fn catalog_maps_builtin_ids_to_directory_names() {
        let cases = [
            ("com.openforge.file-viewer", "file-viewer"),
            ("com.openforge.github-sync", "github-sync"),
            ("com.openforge.skills-viewer", "skills-viewer"),
            ("com.openforge.terminal", "terminal"),
        ];

        for (id, directory_name) in cases {
            let plugin = find(id).expect("builtin plugin should be in catalog");
            assert_eq!(plugin.id, id);
            assert_eq!(plugin.directory_name, directory_name);
            assert_eq!(plugin.sentinel_install_path(), format!("builtin:{id}"));
        }
    }

    #[test]
    fn builtin_detection_requires_known_id_and_exact_sentinel() {
        assert!(has_sentinel_install_path(
            "com.openforge.github-sync",
            "builtin:com.openforge.github-sync"
        ));
        assert!(!has_sentinel_install_path(
            "com.openforge.github-sync",
            "builtin:com.openforge.file-viewer"
        ));
        assert!(!has_sentinel_install_path(
            "com.example.custom",
            "builtin:com.example.custom"
        ));
    }

    #[test]
    fn install_path_uses_catalog_directory_name() {
        let path = install_path_from_workspace_root(
            Path::new("/workspace/openforge"),
            "com.openforge.skills-viewer",
        )
        .expect("builtin plugin path should resolve");

        assert_eq!(
            path,
            Path::new("/workspace/openforge/plugins/skills-viewer")
        );
    }
}
