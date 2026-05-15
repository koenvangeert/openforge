use once_cell::sync::Lazy;
use serde::Deserialize;
use std::path::{Path, PathBuf};

const BUILTIN_INSTALL_PREFIX: &str = "builtin:";
const BUILTIN_PLUGIN_CATALOG_JSON: &str = include_str!("../../builtin-plugins.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuiltinPluginCatalog {
    plugins: Vec<BuiltinPlugin>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BuiltinPlugin {
    pub(crate) id: String,
    pub(crate) directory_name: String,
}

impl BuiltinPlugin {
    pub(crate) fn sentinel_install_path(&self) -> String {
        sentinel_install_path(&self.id)
    }
}

static BUILTIN_PLUGINS: Lazy<Vec<BuiltinPlugin>> = Lazy::new(|| {
    let catalog: BuiltinPluginCatalog = serde_json::from_str(BUILTIN_PLUGIN_CATALOG_JSON)
        .expect("shared builtin plugin catalog should be valid JSON");
    catalog.plugins
});

pub(crate) fn catalog() -> &'static [BuiltinPlugin] {
    &BUILTIN_PLUGINS
}

pub(crate) fn find(plugin_id: &str) -> Option<&'static BuiltinPlugin> {
    catalog().iter().find(|plugin| plugin.id == plugin_id)
}

pub(crate) fn sentinel_install_path(plugin_id: &str) -> String {
    format!("{BUILTIN_INSTALL_PREFIX}{plugin_id}")
}

pub(crate) fn has_sentinel_install_path(plugin_id: &str, install_path: &str) -> bool {
    find(plugin_id).is_some_and(|plugin| install_path == plugin.sentinel_install_path())
}

pub(crate) fn install_path(plugin_id: &str) -> Result<PathBuf, String> {
    let workspace_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let current_exe = std::env::current_exe().ok();
    install_path_from_runtime(&workspace_root, current_exe.as_deref(), plugin_id)
}

fn install_path_from_runtime(
    workspace_root: &Path,
    current_exe: Option<&Path>,
    plugin_id: &str,
) -> Result<PathBuf, String> {
    let plugin = find(plugin_id).ok_or_else(|| format!("Unknown builtin plugin: {plugin_id}"))?;
    if let Some(path) = packaged_app_plugin_path(current_exe, plugin) {
        if path.is_dir() {
            return Ok(path);
        }
    }

    Ok(install_path_from_workspace_root_for_plugin(
        workspace_root,
        plugin,
    ))
}

#[cfg(test)]
fn install_path_from_workspace_root(
    workspace_root: &Path,
    plugin_id: &str,
) -> Result<PathBuf, String> {
    let plugin = find(plugin_id).ok_or_else(|| format!("Unknown builtin plugin: {plugin_id}"))?;
    Ok(install_path_from_workspace_root_for_plugin(
        workspace_root,
        plugin,
    ))
}

fn install_path_from_workspace_root_for_plugin(
    workspace_root: &Path,
    plugin: &BuiltinPlugin,
) -> PathBuf {
    workspace_root.join("plugins").join(&plugin.directory_name)
}

fn packaged_app_plugin_path(current_exe: Option<&Path>, plugin: &BuiltinPlugin) -> Option<PathBuf> {
    let macos_dir = current_exe?.parent()?;
    if macos_dir.file_name()? != "MacOS" {
        return None;
    }

    let contents_dir = macos_dir.parent()?;
    if contents_dir.file_name()? != "Contents" {
        return None;
    }

    Some(
        contents_dir
            .join("Resources")
            .join("app")
            .join("plugins")
            .join(&plugin.directory_name),
    )
}

#[cfg(test)]
mod tests {
    use super::{
        catalog, find, has_sentinel_install_path, install_path_from_runtime,
        install_path_from_workspace_root,
    };
    use std::path::Path;

    #[test]
    fn resolver_catalog_matches_shared_builtin_plugin_catalog() {
        let shared_catalog: serde_json::Value =
            serde_json::from_str(include_str!("../../builtin-plugins.json"))
                .expect("shared builtin plugin catalog should parse");
        let cases: Vec<(String, String)> = shared_catalog["plugins"]
            .as_array()
            .expect("shared builtin plugin catalog should contain plugins")
            .iter()
            .map(|plugin| {
                (
                    plugin["id"]
                        .as_str()
                        .expect("builtin plugin should have id")
                        .to_string(),
                    plugin["directoryName"]
                        .as_str()
                        .expect("builtin plugin should have directoryName")
                        .to_string(),
                )
            })
            .collect();

        assert_eq!(catalog().len(), cases.len());

        for (id, directory_name) in cases {
            let plugin = find(&id).expect("builtin plugin should be in catalog");
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

    #[test]
    fn install_path_prefers_packaged_app_resources_when_sidecar_runs_from_macos_dir() {
        let app = tempfile::tempdir().expect("app tempdir");
        let workspace = tempfile::tempdir().expect("workspace tempdir");
        let packaged_plugin = app
            .path()
            .join("Open Forge.app")
            .join("Contents")
            .join("Resources")
            .join("app")
            .join("plugins")
            .join("file-viewer");
        std::fs::create_dir_all(packaged_plugin.join("dist")).expect("packaged plugin dist");
        std::fs::write(packaged_plugin.join("package.json"), "{}")
            .expect("packaged plugin package");
        std::fs::write(packaged_plugin.join("dist").join("frontend.js"), "")
            .expect("packaged plugin frontend");

        let exe_path = app
            .path()
            .join("Open Forge.app")
            .join("Contents")
            .join("MacOS")
            .join("openforge-sidecar");
        let path = install_path_from_runtime(
            workspace.path(),
            Some(exe_path.as_path()),
            "com.openforge.file-viewer",
        )
        .expect("builtin plugin path should resolve");

        assert_eq!(path, packaged_plugin);
    }

    #[test]
    fn install_path_falls_back_to_workspace_plugins_outside_packaged_app() {
        let workspace = tempfile::tempdir().expect("workspace tempdir");
        let exe_path = workspace
            .path()
            .join("target")
            .join("release")
            .join("openforge");
        let path = install_path_from_runtime(
            workspace.path(),
            Some(exe_path.as_path()),
            "com.openforge.terminal",
        )
        .expect("builtin plugin path should resolve");

        assert_eq!(path, workspace.path().join("plugins").join("terminal"));
    }
}
