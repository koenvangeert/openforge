use crate::db;
use regex::Regex;
use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::process::Command;

const NPM_PATH_ENV: &str = "OPENFORGE_NPM_PATH";
const CONTRIBUTION_SCHEMA_JSON: &str =
    include_str!("../../packages/plugin-sdk/src/manifestContributionSchema.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestContributionSchema {
    allowed_icon_keys: Vec<String>,
    shortcut_pattern: String,
    contribution_points: BTreeMap<String, ContributionPointSpec>,
}

#[derive(Debug, Deserialize)]
struct ContributionPointSpec {
    fields: BTreeMap<String, ContributionFieldSpec>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContributionFieldSpec {
    kind: ContributionFieldKind,
    required: Option<bool>,
    values: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
enum ContributionFieldKind {
    NonEmptyString,
    Icon,
    Number,
    Shortcut,
    Enum,
}

fn contribution_schema() -> &'static ManifestContributionSchema {
    static CONTRIBUTION_SCHEMA: std::sync::OnceLock<ManifestContributionSchema> =
        std::sync::OnceLock::new();
    CONTRIBUTION_SCHEMA.get_or_init(|| {
        serde_json::from_str(CONTRIBUTION_SCHEMA_JSON)
            .expect("shared plugin contribution schema should parse")
    })
}

fn shortcut_pattern() -> &'static Regex {
    static SHORTCUT_PATTERN: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    SHORTCUT_PATTERN.get_or_init(|| {
        Regex::new(&contribution_schema().shortcut_pattern)
            .expect("shared plugin contribution shortcut regex should compile")
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginManifestFile {
    id: String,
    name: String,
    version: String,
    api_version: i64,
    description: String,
    permissions: Value,
    contributes: Value,
    frontend: String,
    backend: Option<String>,
}

pub fn managed_plugins_dir(base_dir: &Path) -> PathBuf {
    base_dir.join("plugins")
}

pub fn managed_plugin_dir(base_dir: &Path, plugin_id: &str) -> PathBuf {
    managed_plugins_dir(base_dir).join(plugin_id)
}

pub fn install_local_plugin_bundle(
    source_path: &Path,
    managed_base_dir: &Path,
) -> Result<db::PluginRow, String> {
    if !source_path.is_dir() {
        return Err(format!(
            "plugin source path is not a directory: {}",
            source_path.display()
        ));
    }

    let manifest = load_manifest_from_dir(source_path)?;
    let destination = managed_plugin_dir(managed_base_dir, &manifest.id);
    replace_directory(source_path, &destination)?;
    build_plugin_row(&manifest, &destination, false)
}

pub async fn install_npm_plugin_bundle(
    package_name: &str,
    managed_base_dir: &Path,
) -> Result<db::PluginRow, String> {
    let npm_path = resolve_npm_binary()?;
    install_npm_plugin_bundle_with_npm(package_name, managed_base_dir, &npm_path).await
}

async fn install_npm_plugin_bundle_with_npm(
    package_name: &str,
    managed_base_dir: &Path,
    npm_path: &Path,
) -> Result<db::PluginRow, String> {
    let package_name = package_name.trim();
    if package_name.is_empty() {
        return Err("package name cannot be empty".to_string());
    }

    let staging_root = unique_staging_dir(managed_base_dir)?;
    let install_root = staging_root.join("install-root");
    fs::create_dir_all(&install_root)
        .map_err(|error| format!("failed to create npm install root: {error}"))?;
    fs::write(
        install_root.join("package.json"),
        r#"{"name":"openforge-plugin-staging","version":"1.0.0","private":true}"#,
    )
    .map_err(|error| format!("failed to create npm staging package.json: {error}"))?;

    let output = Command::new(npm_path)
        .arg("install")
        .arg("--prefix")
        .arg(&install_root)
        .arg("--ignore-scripts")
        .arg("--omit=dev")
        .arg("--no-save")
        .arg(package_name)
        .output()
        .await
        .map_err(|error| format!("failed to run npm install: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let details = if !stderr.is_empty() { stderr } else { stdout };
        let _ = fs::remove_dir_all(&staging_root);
        return Err(format!("npm install failed: {details}"));
    }

    let package_dir = install_root
        .join("node_modules")
        .join(resolve_requested_package_dir_name(package_name)?);
    let manifest = load_manifest_from_dir(&package_dir)?;
    let destination = managed_plugin_dir(managed_base_dir, &manifest.id);
    let copy_result = replace_directory(&package_dir, &destination);
    let _ = fs::remove_dir_all(&staging_root);
    copy_result?;
    build_plugin_row(&manifest, &destination, false)
}

pub fn uninstall_managed_plugin(
    plugin: &db::PluginRow,
    managed_base_dir: &Path,
) -> Result<(), String> {
    if plugin.is_builtin {
        return Ok(());
    }

    let managed_root = managed_plugins_dir(managed_base_dir);
    let install_path = PathBuf::from(&plugin.install_path);
    if !install_path.starts_with(&managed_root) {
        return Ok(());
    }

    if install_path.exists() {
        fs::remove_dir_all(&install_path).map_err(|error| {
            format!(
                "failed to remove managed plugin directory {}: {error}",
                install_path.display()
            )
        })?;
    }

    Ok(())
}

fn load_manifest_from_dir(dir: &Path) -> Result<PluginManifestFile, String> {
    let manifest_path = dir.join("manifest.json");
    let raw = fs::read_to_string(&manifest_path).map_err(|error| {
        format!(
            "failed to read manifest {}: {error}",
            manifest_path.display()
        )
    })?;
    let manifest: PluginManifestFile = serde_json::from_str(&raw).map_err(|error| {
        format!(
            "failed to parse manifest {}: {error}",
            manifest_path.display()
        )
    })?;
    validate_manifest(&manifest, dir)?;
    Ok(manifest)
}

fn validate_manifest(manifest: &PluginManifestFile, dir: &Path) -> Result<(), String> {
    if manifest.id.trim().is_empty() {
        return Err("plugin manifest id cannot be empty".to_string());
    }
    if manifest.id.contains('/') || manifest.id.contains('\\') {
        return Err("plugin manifest id cannot contain path separators".to_string());
    }
    let mut components = Path::new(&manifest.id).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(_)), None) => {}
        _ => return Err("plugin manifest id is invalid".to_string()),
    }
    if manifest.name.trim().is_empty() {
        return Err("plugin manifest name cannot be empty".to_string());
    }
    if manifest.version.trim().is_empty() {
        return Err("plugin manifest version cannot be empty".to_string());
    }
    if manifest.description.trim().is_empty() {
        return Err("plugin manifest description cannot be empty".to_string());
    }
    if manifest.frontend.trim().is_empty() {
        return Err("plugin manifest frontend entry cannot be empty".to_string());
    }

    validate_relative_entry_path(dir, &manifest.frontend, "frontend")?;

    if let Some(backend) = &manifest.backend {
        if backend.trim().is_empty() {
            return Err("plugin manifest backend entry cannot be empty when provided".to_string());
        }

        validate_relative_entry_path(dir, backend, "backend")?;
    }

    validate_contributions(&manifest.contributes)?;

    Ok(())
}

fn validate_relative_entry_path(dir: &Path, entry: &str, field_name: &str) -> Result<(), String> {
    let entry_path = Path::new(entry);
    if entry_path.is_absolute() {
        return Err(format!(
            "plugin manifest {field_name} entry must stay within the plugin directory"
        ));
    }

    if entry_path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(format!(
            "plugin manifest {field_name} entry must stay within the plugin directory"
        ));
    }

    let candidate = dir.join(entry_path);
    if !candidate.is_file() {
        return Err(format!(
            "plugin {field_name} entry does not exist: {}",
            candidate.display()
        ));
    }

    let canonical_dir = dir.canonicalize().map_err(|error| {
        format!(
            "failed to canonicalize plugin directory {}: {error}",
            dir.display()
        )
    })?;
    let canonical_candidate = candidate.canonicalize().map_err(|error| {
        format!(
            "failed to canonicalize plugin {field_name} entry {}: {error}",
            candidate.display()
        )
    })?;

    if !canonical_candidate.starts_with(&canonical_dir) {
        return Err(format!(
            "plugin manifest {field_name} entry must stay within the plugin directory"
        ));
    }

    Ok(())
}

fn validate_string_field(
    value: Option<&Value>,
    path: &str,
    required: bool,
) -> Result<Option<String>, String> {
    match value {
        Some(value) => {
            let value = value
                .as_str()
                .ok_or_else(|| format!("plugin manifest {path} must be a string"))?
                .trim();
            if value.is_empty() {
                Err(format!("plugin manifest {path} must be a non-empty string"))
            } else {
                Ok(Some(value.to_string()))
            }
        }
        None if required => Err(format!("plugin manifest {path} must be a non-empty string")),
        None => Ok(None),
    }
}

fn validate_number_field(value: Option<&Value>, path: &str, required: bool) -> Result<(), String> {
    match value {
        Some(value) if value.is_number() => Ok(()),
        Some(_) => Err(format!("plugin manifest {path} must be a number")),
        None if required => Err(format!("plugin manifest {path} must be a number")),
        None => Ok(()),
    }
}

fn validate_shortcut_field(
    value: Option<&Value>,
    path: &str,
    required: bool,
) -> Result<(), String> {
    let Some(shortcut) = validate_string_field(value, path, required)? else {
        return Ok(());
    };

    if !shortcut_pattern().is_match(&shortcut) {
        return Err(format!(
            "plugin manifest {path} has invalid shortcut format"
        ));
    }

    Ok(())
}

fn validate_icon_field(value: Option<&Value>, path: &str, required: bool) -> Result<(), String> {
    let Some(icon) = validate_string_field(value, path, required)? else {
        return Ok(());
    };

    if !contribution_schema().allowed_icon_keys.contains(&icon) {
        return Err(format!(
            "plugin manifest {path} icon key \"{icon}\" is not allowed"
        ));
    }

    Ok(())
}

fn validate_enum_field(
    value: Option<&Value>,
    path: &str,
    required: bool,
    values: Option<&[String]>,
) -> Result<(), String> {
    let Some(value) = validate_string_field(value, path, required)? else {
        return Ok(());
    };
    let allowed_values =
        values.ok_or_else(|| format!("plugin manifest {path} enum has no values"))?;

    if !allowed_values.contains(&value) {
        return Err(format!(
            "plugin manifest {path} must be one of {}",
            allowed_values.join(", ")
        ));
    }

    Ok(())
}

fn validate_array<'a>(
    value: Option<&'a Value>,
    path: &'a str,
) -> Result<Vec<&'a serde_json::Map<String, Value>>, String> {
    let entries = value
        .ok_or_else(|| format!("plugin manifest {path} must be an array"))?
        .as_array()
        .ok_or_else(|| format!("plugin manifest {path} must be an array"))?;

    entries
        .iter()
        .enumerate()
        .map(|(index, item)| {
            item.as_object()
                .ok_or_else(|| format!("plugin manifest {path}[{index}] must be an object"))
        })
        .collect()
}

fn validate_contribution_field(
    value: Option<&Value>,
    path: &str,
    spec: &ContributionFieldSpec,
) -> Result<(), String> {
    let required = spec.required.unwrap_or(false);

    match spec.kind {
        ContributionFieldKind::NonEmptyString => {
            validate_string_field(value, path, required).map(|_| ())
        }
        ContributionFieldKind::Icon => validate_icon_field(value, path, required),
        ContributionFieldKind::Number => validate_number_field(value, path, required),
        ContributionFieldKind::Shortcut => validate_shortcut_field(value, path, required),
        ContributionFieldKind::Enum => {
            validate_enum_field(value, path, required, spec.values.as_deref())
        }
    }
}

fn validate_contributions(contributes: &Value) -> Result<(), String> {
    let contributes = contributes
        .as_object()
        .ok_or_else(|| "plugin manifest contributes must be an object".to_string())?;

    for (contribution_name, contribution_spec) in &contribution_schema().contribution_points {
        let Some(entries) = contributes.get(contribution_name) else {
            continue;
        };
        let contribution_path = format!("contributes.{contribution_name}");

        for (index, entry) in validate_array(Some(entries), &contribution_path)?
            .into_iter()
            .enumerate()
        {
            for (field_name, field_spec) in &contribution_spec.fields {
                validate_contribution_field(
                    entry.get(field_name),
                    &format!("{contribution_path}[{index}].{field_name}"),
                    field_spec,
                )?;
            }
        }
    }

    Ok(())
}

fn build_plugin_row(
    manifest: &PluginManifestFile,
    install_path: &Path,
    is_builtin: bool,
) -> Result<db::PluginRow, String> {
    Ok(db::PluginRow {
        id: manifest.id.clone(),
        name: manifest.name.clone(),
        version: manifest.version.clone(),
        api_version: manifest.api_version,
        description: manifest.description.clone(),
        permissions: serde_json::to_string(&manifest.permissions)
            .map_err(|error| format!("failed to serialize plugin permissions: {error}"))?,
        contributes: serde_json::to_string(&manifest.contributes)
            .map_err(|error| format!("failed to serialize plugin contributions: {error}"))?,
        frontend_entry: manifest.frontend.clone(),
        backend_entry: manifest.backend.clone(),
        install_path: install_path.to_string_lossy().into_owned(),
        installed_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| format!("failed to compute install timestamp: {error}"))?
            .as_millis() as i64,
        is_builtin,
    })
}

fn replace_directory(source: &Path, destination: &Path) -> Result<(), String> {
    if destination.exists() {
        fs::remove_dir_all(destination).map_err(|error| {
            format!(
                "failed to clear existing plugin directory {}: {error}",
                destination.display()
            )
        })?;
    }

    copy_directory_recursive(source, destination)
}

fn copy_directory_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|error| {
        format!(
            "failed to create destination directory {}: {error}",
            destination.display()
        )
    })?;

    for entry in fs::read_dir(source)
        .map_err(|error| format!("failed to read directory {}: {error}", source.display()))?
    {
        let entry = entry.map_err(|error| format!("failed to inspect directory entry: {error}"))?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let file_type = entry.file_type().map_err(|error| {
            format!(
                "failed to read file type {}: {error}",
                source_path.display()
            )
        })?;

        if file_type.is_dir() {
            copy_directory_recursive(&source_path, &destination_path)?;
        } else if file_type.is_file() {
            fs::copy(&source_path, &destination_path).map_err(|error| {
                format!(
                    "failed to copy {} to {}: {error}",
                    source_path.display(),
                    destination_path.display()
                )
            })?;
        }
    }

    Ok(())
}

fn resolve_npm_binary() -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var(NPM_PATH_ENV) {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }

    which::which("npm").map_err(|error| format!("failed to locate npm in PATH: {error}"))
}

fn unique_staging_dir(managed_base_dir: &Path) -> Result<PathBuf, String> {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("failed to create staging directory nonce: {error}"))?
        .as_nanos();
    let path = managed_base_dir
        .join(".staging")
        .join(format!("npm-{nonce}"));
    fs::create_dir_all(&path).map_err(|error| {
        format!(
            "failed to create staging directory {}: {error}",
            path.display()
        )
    })?;
    Ok(path)
}

fn resolve_requested_package_dir_name(package_spec: &str) -> Result<String, String> {
    let package_spec = package_spec.trim();
    if package_spec.is_empty() {
        return Err("package name cannot be empty".to_string());
    }

    if let Some((alias, _)) = package_spec.split_once("@npm:") {
        return if alias.is_empty() {
            Err(format!("invalid npm alias package spec: {package_spec}"))
        } else {
            Ok(alias.to_string())
        };
    }

    if let Some(stripped) = package_spec.strip_prefix('@') {
        let slash_index = stripped
            .find('/')
            .ok_or_else(|| format!("invalid scoped package spec: {package_spec}"))?;
        let after_scope = &stripped[slash_index + 1..];
        if let Some(version_sep) = after_scope.find('@') {
            return Ok(format!(
                "@{}/{}",
                &stripped[..slash_index],
                &after_scope[..version_sep]
            ));
        }

        return Ok(package_spec.to_string());
    }

    match package_spec.find('@') {
        Some(index) => Ok(package_spec[..index].to_string()),
        None => Ok(package_spec.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    fn write_manifest(dir: &Path, manifest: &str) {
        fs::write(dir.join("manifest.json"), manifest).expect("manifest should write");
    }

    #[test]
    fn install_local_plugin_bundle_copies_into_managed_directory() {
        let source = tempdir().expect("source tempdir should create");
        let managed = tempdir().expect("managed tempdir should create");
        fs::create_dir_all(source.path().join("dist")).expect("dist dir should create");
        fs::write(source.path().join("dist/index.js"), "export const x = 1;")
            .expect("frontend should write");
        fs::write(
            source.path().join("backend.js"),
            "export async function ping() { return 'pong' }",
        )
        .expect("backend should write");
        write_manifest(
            source.path(),
            r#"{
                "id": "com.example.local",
                "name": "Local Plugin",
                "version": "1.0.0",
                "apiVersion": 1,
                "description": "A local plugin",
                "permissions": [],
                "contributes": {},
                "frontend": "dist/index.js",
                "backend": "backend.js"
            }"#,
        );

        let row = install_local_plugin_bundle(source.path(), managed.path())
            .expect("local install should succeed");

        let install_path = PathBuf::from(&row.install_path);
        assert_eq!(row.id, "com.example.local");
        assert!(install_path.starts_with(managed_plugins_dir(managed.path())));
        assert!(install_path.join("manifest.json").exists());
        assert!(install_path.join("dist/index.js").exists());
        assert!(install_path.join("backend.js").exists());
    }

    #[test]
    fn install_local_plugin_bundle_rejects_missing_frontend_entry() {
        let source = tempdir().expect("source tempdir should create");
        let managed = tempdir().expect("managed tempdir should create");
        write_manifest(
            source.path(),
            r#"{
                "id": "com.example.invalid",
                "name": "Broken Plugin",
                "version": "1.0.0",
                "apiVersion": 1,
                "description": "Broken plugin",
                "permissions": [],
                "contributes": {},
                "frontend": "dist/index.js",
                "backend": null
            }"#,
        );

        let result = install_local_plugin_bundle(source.path(), managed.path());

        assert!(result.is_err());
        assert!(result
            .expect_err("install should fail")
            .contains("plugin frontend entry does not exist"));
    }

    #[test]
    fn install_local_plugin_bundle_rejects_frontend_path_traversal() {
        let source = tempdir().expect("source tempdir should create");
        let managed = tempdir().expect("managed tempdir should create");
        fs::create_dir_all(source.path().join("dist")).expect("dist dir should create");
        fs::write(source.path().join("dist/index.js"), "export const x = 1;")
            .expect("frontend should write");
        write_manifest(
            source.path(),
            r#"{
                "id": "com.example.invalid-path",
                "name": "Broken Path Plugin",
                "version": "1.0.0",
                "apiVersion": 1,
                "description": "Broken plugin",
                "permissions": [],
                "contributes": {},
                "frontend": "../dist/index.js",
                "backend": null
            }"#,
        );

        let result = install_local_plugin_bundle(source.path(), managed.path());

        assert!(result.is_err());
        assert!(result
            .expect_err("install should fail")
            .contains("must stay within the plugin directory"));
    }

    #[test]
    fn install_local_plugin_bundle_rejects_absolute_frontend_path() {
        let source = tempdir().expect("source tempdir should create");
        let managed = tempdir().expect("managed tempdir should create");
        fs::create_dir_all(source.path().join("dist")).expect("dist dir should create");
        fs::write(source.path().join("dist/index.js"), "export const x = 1;")
            .expect("frontend should write");
        write_manifest(
            source.path(),
            r#"{
                "id": "com.example.absolute-frontend",
                "name": "Broken Absolute Frontend Plugin",
                "version": "1.0.0",
                "apiVersion": 1,
                "description": "Broken plugin",
                "permissions": [],
                "contributes": {},
                "frontend": "/tmp/index.js",
                "backend": null
            }"#,
        );

        let result = install_local_plugin_bundle(source.path(), managed.path());

        assert!(result.is_err());
        assert!(result
            .expect_err("install should fail")
            .contains("must stay within the plugin directory"));
    }

    #[test]
    fn install_local_plugin_bundle_rejects_backend_path_traversal() {
        let source = tempdir().expect("source tempdir should create");
        let managed = tempdir().expect("managed tempdir should create");
        fs::create_dir_all(source.path().join("dist")).expect("dist dir should create");
        fs::write(source.path().join("dist/index.js"), "export const x = 1;")
            .expect("frontend should write");
        fs::write(
            source.path().join("backend.js"),
            "export async function run() {}",
        )
        .expect("backend should write");
        write_manifest(
            source.path(),
            r#"{
                "id": "com.example.invalid-backend-path",
                "name": "Broken Backend Path Plugin",
                "version": "1.0.0",
                "apiVersion": 1,
                "description": "Broken plugin",
                "permissions": [],
                "contributes": {},
                "frontend": "dist/index.js",
                "backend": "../backend.js"
            }"#,
        );

        let result = install_local_plugin_bundle(source.path(), managed.path());

        assert!(result.is_err());
        assert!(result
            .expect_err("install should fail")
            .contains("must stay within the plugin directory"));
    }

    #[test]
    fn install_local_plugin_bundle_rejects_invalid_sidebar_panel_contribution() {
        let source = tempdir().expect("source tempdir should create");
        let managed = tempdir().expect("managed tempdir should create");
        fs::create_dir_all(source.path().join("dist")).expect("dist dir should create");
        fs::write(source.path().join("dist/index.js"), "export const x = 1;")
            .expect("frontend should write");
        write_manifest(
            source.path(),
            r#"{
                "id": "com.example.invalid-sidebar",
                "name": "Broken Sidebar Plugin",
                "version": "1.0.0",
                "apiVersion": 1,
                "description": "Broken plugin",
                "permissions": [],
                "contributes": {
                    "sidebarPanels": [{ "id": "inspector", "title": "Inspector", "side": "center" }]
                },
                "frontend": "dist/index.js",
                "backend": null
            }"#,
        );

        let result = install_local_plugin_bundle(source.path(), managed.path());

        assert!(result.is_err());
        assert!(result
            .expect_err("install should fail")
            .contains("sidebarPanels[0].side"));
    }

    #[test]
    fn install_local_plugin_bundle_rejects_invalid_task_pane_icon_key() {
        let source = tempdir().expect("source tempdir should create");
        let managed = tempdir().expect("managed tempdir should create");
        fs::create_dir_all(source.path().join("dist")).expect("dist dir should create");
        fs::write(source.path().join("dist/index.js"), "export const x = 1;")
            .expect("frontend should write");
        write_manifest(
            source.path(),
            r#"{
                "id": "com.example.invalid-icon",
                "name": "Broken Icon Plugin",
                "version": "1.0.0",
                "apiVersion": 1,
                "description": "Broken plugin",
                "permissions": [],
                "contributes": {
                    "taskPaneTabs": [{ "id": "terminal", "title": "Terminal", "icon": "bad-icon" }]
                },
                "frontend": "dist/index.js",
                "backend": null
            }"#,
        );

        let result = install_local_plugin_bundle(source.path(), managed.path());

        assert!(result.is_err());
        assert!(result
            .expect_err("install should fail")
            .contains("taskPaneTabs[0].icon"));
    }

    #[test]
    fn install_local_plugin_bundle_rejects_invalid_command_shortcut() {
        let source = tempdir().expect("source tempdir should create");
        let managed = tempdir().expect("managed tempdir should create");
        fs::create_dir_all(source.path().join("dist")).expect("dist dir should create");
        fs::write(source.path().join("dist/index.js"), "export const x = 1;")
            .expect("frontend should write");
        write_manifest(
            source.path(),
            r#"{
                "id": "com.example.invalid-command",
                "name": "Broken Command Plugin",
                "version": "1.0.0",
                "apiVersion": 1,
                "description": "Broken plugin",
                "permissions": [],
                "contributes": {
                    "commands": [{ "id": "run", "title": "Run", "shortcut": "BAD+FORMAT+!!!" }]
                },
                "frontend": "dist/index.js",
                "backend": null
            }"#,
        );

        let result = install_local_plugin_bundle(source.path(), managed.path());

        assert!(result.is_err());
        assert!(result
            .expect_err("install should fail")
            .contains("commands[0].shortcut"));
    }

    #[test]
    fn uninstall_managed_plugin_removes_managed_directory() {
        let managed = tempdir().expect("managed tempdir should create");
        let plugin_dir = managed_plugin_dir(managed.path(), "com.example.local");
        fs::create_dir_all(&plugin_dir).expect("plugin dir should create");
        fs::write(plugin_dir.join("manifest.json"), "{}").expect("manifest should write");

        let row = db::PluginRow {
            id: "com.example.local".to_string(),
            name: "Local Plugin".to_string(),
            version: "1.0.0".to_string(),
            api_version: 1,
            description: "plugin".to_string(),
            permissions: "[]".to_string(),
            contributes: "{}".to_string(),
            frontend_entry: "dist/index.js".to_string(),
            backend_entry: None,
            install_path: plugin_dir.to_string_lossy().into_owned(),
            installed_at: 0,
            is_builtin: false,
        };

        uninstall_managed_plugin(&row, managed.path()).expect("uninstall should succeed");

        assert!(!plugin_dir.exists());
    }

    #[test]
    fn uninstall_managed_plugin_is_noop_for_unmanaged_paths() {
        let managed = tempdir().expect("managed tempdir should create");
        let external = tempdir().expect("external tempdir should create");
        let external_manifest = external.path().join("manifest.json");
        fs::write(&external_manifest, "{}").expect("manifest should write");

        let row = db::PluginRow {
            id: "com.example.legacy".to_string(),
            name: "Legacy Plugin".to_string(),
            version: "1.0.0".to_string(),
            api_version: 1,
            description: "plugin".to_string(),
            permissions: "[]".to_string(),
            contributes: "{}".to_string(),
            frontend_entry: "dist/index.js".to_string(),
            backend_entry: None,
            install_path: external.path().to_string_lossy().into_owned(),
            installed_at: 0,
            is_builtin: false,
        };

        uninstall_managed_plugin(&row, managed.path()).expect("unmanaged uninstall should succeed");

        assert!(external_manifest.exists());
    }

    #[test]
    fn resolve_requested_package_dir_name_handles_version_and_alias_specs() {
        assert_eq!(
            resolve_requested_package_dir_name("example-plugin@1.2.3")
                .expect("version spec should resolve"),
            "example-plugin"
        );
        assert_eq!(
            resolve_requested_package_dir_name("example-plugin@latest")
                .expect("tag spec should resolve"),
            "example-plugin"
        );
        assert_eq!(
            resolve_requested_package_dir_name("@openforge/example-plugin@1.2.3")
                .expect("scoped version spec should resolve"),
            "@openforge/example-plugin"
        );
        assert_eq!(
            resolve_requested_package_dir_name("plugin-alias@npm:@openforge/example-plugin@1.2.3")
                .expect("alias spec should resolve"),
            "plugin-alias"
        );
    }

    #[tokio::test]
    async fn install_npm_plugin_bundle_uses_staging_install_and_copies_package_root() {
        let managed = tempdir().expect("managed tempdir should create");
        let fake_npm_dir = tempdir().expect("fake npm dir should create");
        let fake_npm = fake_npm_dir.path().join("npm");
        let script = r#"#!/bin/sh
prefix=""
while [ $# -gt 0 ]; do
  case "$1" in
    --prefix)
      shift
      prefix="$1"
      ;;
  esac
  shift
done
mkdir -p "$prefix/node_modules/fake-package/dist"
cat > "$prefix/node_modules/fake-package/manifest.json" <<'EOF'
{
  "id": "com.example.npm",
  "name": "Npm Plugin",
  "version": "1.2.3",
  "apiVersion": 1,
  "description": "Installed from npm",
  "permissions": [],
  "contributes": {},
  "frontend": "dist/index.js",
  "backend": null
}
EOF
echo "export const ok = true;" > "$prefix/node_modules/fake-package/dist/index.js"
"#;
        fs::write(&fake_npm, script).expect("fake npm should write");
        #[cfg(unix)]
        {
            let mut permissions = fs::metadata(&fake_npm)
                .expect("metadata should read")
                .permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&fake_npm, permissions).expect("permissions should set");
        }

        let row = install_npm_plugin_bundle_with_npm("fake-package", managed.path(), &fake_npm)
            .await
            .expect("npm install should succeed");

        let install_path = PathBuf::from(&row.install_path);
        assert_eq!(row.id, "com.example.npm");
        assert!(install_path.starts_with(managed_plugins_dir(managed.path())));
        assert!(install_path.join("manifest.json").exists());
        assert!(install_path.join("dist/index.js").exists());
    }

    #[tokio::test]
    async fn install_npm_plugin_bundle_resolves_versioned_package_specs() {
        let managed = tempdir().expect("managed tempdir should create");
        let fake_npm_dir = tempdir().expect("fake npm dir should create");
        let fake_npm = fake_npm_dir.path().join("npm");
        let script = r#"#!/bin/sh
prefix=""
while [ $# -gt 0 ]; do
  case "$1" in
    --prefix)
      shift
      prefix="$1"
      ;;
  esac
  shift
done
mkdir -p "$prefix/node_modules/example-plugin/dist"
cat > "$prefix/node_modules/example-plugin/manifest.json" <<'EOF'
{
  "id": "com.example.versioned",
  "name": "Versioned Plugin",
  "version": "1.2.3",
  "apiVersion": 1,
  "description": "Installed from npm",
  "permissions": [],
  "contributes": {},
  "frontend": "dist/index.js",
  "backend": null
}
EOF
echo "export const ok = true;" > "$prefix/node_modules/example-plugin/dist/index.js"
"#;
        fs::write(&fake_npm, script).expect("fake npm should write");
        #[cfg(unix)]
        {
            let mut permissions = fs::metadata(&fake_npm)
                .expect("metadata should read")
                .permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&fake_npm, permissions).expect("permissions should set");
        }

        let row =
            install_npm_plugin_bundle_with_npm("example-plugin@1.2.3", managed.path(), &fake_npm)
                .await
                .expect("versioned npm install should succeed");

        let install_path = PathBuf::from(&row.install_path);
        assert_eq!(row.id, "com.example.versioned");
        assert!(install_path.join("manifest.json").exists());
        assert!(install_path.join("dist/index.js").exists());
    }
}
