use crate::db;
use regex::Regex;
use serde::Deserialize;
use serde_json::{Map, Value};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::process::Command;

const NPM_PATH_ENV: &str = "OPENFORGE_NPM_PATH";
const GIT_PATH_ENV: &str = "OPENFORGE_GIT_PATH";
const OPENFORGE_PACKAGE_METADATA_SCHEMA_JSON: &str =
    include_str!("../../packages/plugin-sdk/src/openforgePackageMetadataSchema.json");

#[derive(Debug, Clone, PartialEq, Eq)]
enum PackageSourceSpec {
    Local {
        path: PathBuf,
        spec: String,
    },
    Npm {
        package_spec: String,
        spec: String,
    },
    Git {
        repo: String,
        reference: Option<String>,
        spec: String,
    },
}

impl PackageSourceSpec {
    fn parse(raw_spec: &str) -> Result<Self, String> {
        let spec = raw_spec.trim();
        if spec.is_empty() {
            return Err("plugin package source spec cannot be empty".to_string());
        }

        if let Some(package_spec) = spec.strip_prefix("npm:") {
            let package_spec = package_spec.trim();
            if package_spec.is_empty() {
                return Err("npm plugin package source spec cannot be empty".to_string());
            }
            return Ok(Self::Npm {
                package_spec: package_spec.to_string(),
                spec: spec.to_string(),
            });
        }

        if let Some(git_spec) = spec.strip_prefix("git:") {
            let (repo, reference) = parse_git_source(git_spec)?;
            return Ok(Self::Git {
                repo,
                reference,
                spec: spec.to_string(),
            });
        }

        let path = if let Some(path) = spec.strip_prefix("local:") {
            PathBuf::from(path)
        } else {
            PathBuf::from(spec)
        };

        Ok(Self::Local {
            path,
            spec: spec.to_string(),
        })
    }

    fn kind(&self) -> &'static str {
        match self {
            Self::Local { .. } => "local",
            Self::Npm { .. } => "npm",
            Self::Git { .. } => "git",
        }
    }

    fn spec(&self) -> &str {
        match self {
            Self::Local { spec, .. } | Self::Npm { spec, .. } | Self::Git { spec, .. } => spec,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackageJsonFile {
    #[serde(rename = "name")]
    _name: String,
    version: String,
    #[serde(default, rename = "peerDependencies")]
    _peer_dependencies: Option<Value>,
    openforge: OpenForgePackageMetadata,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenForgePackageMetadata {
    id: String,
    api_version: i64,
    display_name: String,
    description: String,
    #[serde(default, rename = "icon")]
    _icon: Option<String>,
    #[serde(default)]
    frontend: Option<String>,
    #[serde(default)]
    backend: Option<String>,
    #[serde(default, rename = "requires")]
    _requires: Option<Vec<String>>,
}

#[derive(Debug)]
struct LoadedPluginPackage {
    package_json: PackageJsonFile,
    package_metadata_json: String,
}

#[derive(Debug)]
struct PackageMetadataSchemaRules {
    allowed_metadata_fields: Vec<String>,
    required_metadata_fields: Vec<String>,
    string_metadata_fields: Vec<String>,
    supported_api_versions: Vec<i64>,
    id_pattern: Regex,
    allowed_capabilities: Vec<String>,
}

impl PackageMetadataSchemaRules {
    fn allows_metadata_field(&self, field: &str) -> bool {
        self.allowed_metadata_fields
            .iter()
            .any(|allowed_field| allowed_field == field)
    }

    fn requires_metadata_field(&self, field: &str) -> bool {
        self.required_metadata_fields
            .iter()
            .any(|required_field| required_field == field)
    }

    fn supports_api_version(&self, api_version: i64) -> bool {
        self.supported_api_versions
            .iter()
            .any(|supported_version| *supported_version == api_version)
    }

    fn supports_capability(&self, capability: &str) -> bool {
        self.allowed_capabilities
            .iter()
            .any(|allowed_capability| allowed_capability == capability)
    }

    fn supported_api_versions_label(&self) -> String {
        self.supported_api_versions
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(", ")
    }
}

#[derive(Debug)]
struct AcquiredPackage {
    source: PackageSourceSpec,
    package_dir: PathBuf,
    install_path: PathBuf,
    staging_root: Option<PathBuf>,
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
    install_plugin_package_from_source_spec(&source_path.to_string_lossy(), managed_base_dir)
}

pub async fn install_npm_plugin_bundle(
    package_name: &str,
    managed_base_dir: &Path,
) -> Result<db::PluginRow, String> {
    install_plugin_package_from_source_spec_async(
        &format!("npm:{}", package_name.trim()),
        managed_base_dir,
    )
    .await
}

pub async fn install_git_plugin_bundle(
    git_spec: &str,
    managed_base_dir: &Path,
) -> Result<db::PluginRow, String> {
    let source_spec = if git_spec.trim().starts_with("git:") {
        git_spec.trim().to_string()
    } else {
        format!("git:{}", git_spec.trim())
    };
    install_plugin_package_from_source_spec_async(&source_spec, managed_base_dir).await
}

pub fn install_plugin_package_from_source_spec(
    source_spec: &str,
    managed_base_dir: &Path,
) -> Result<db::PluginRow, String> {
    let source = PackageSourceSpec::parse(source_spec)?;
    match source {
        PackageSourceSpec::Local { .. } => {
            let acquired = acquire_local_package(source)?;
            install_acquired_package(acquired, managed_base_dir)
        }
        PackageSourceSpec::Npm { .. } | PackageSourceSpec::Git { .. } => Err(
            "npm and git plugin package sources require the async package installer".to_string(),
        ),
    }
}

pub async fn install_plugin_package_from_source_spec_async(
    source_spec: &str,
    managed_base_dir: &Path,
) -> Result<db::PluginRow, String> {
    let source = PackageSourceSpec::parse(source_spec)?;
    let acquired = match source {
        PackageSourceSpec::Local { .. } => acquire_local_package(source)?,
        PackageSourceSpec::Npm { .. } => acquire_npm_package(source, managed_base_dir).await?,
        PackageSourceSpec::Git { .. } => acquire_git_package(source, managed_base_dir).await?,
    };

    install_acquired_package(acquired, managed_base_dir)
}

pub fn uninstall_managed_plugin(
    plugin: &db::PluginRow,
    managed_base_dir: &Path,
) -> Result<(), String> {
    if plugin.is_builtin || plugin.source_kind == "local" {
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

fn install_acquired_package(
    mut acquired: AcquiredPackage,
    managed_base_dir: &Path,
) -> Result<db::PluginRow, String> {
    let result = (|| {
        let loaded = load_package_from_dir(&acquired.package_dir)?;
        validate_package(&loaded.package_json, &acquired.package_dir)?;

        if acquired.source.kind() != "local" {
            let destination =
                managed_plugin_dir(managed_base_dir, &loaded.package_json.openforge.id);
            replace_directory(&acquired.package_dir, &destination)?;
            acquired.install_path = destination;
        }

        build_plugin_row(&loaded, &acquired.install_path, &acquired.source, false)
    })();

    if let Some(staging_root) = acquired.staging_root {
        let _ = fs::remove_dir_all(staging_root);
    }

    result
}

fn acquire_local_package(source: PackageSourceSpec) -> Result<AcquiredPackage, String> {
    let PackageSourceSpec::Local { path, .. } = &source else {
        return Err("expected a local plugin package source".to_string());
    };

    if !path.is_dir() {
        return Err(format!(
            "local plugin package source is not a directory: {}",
            path.display()
        ));
    }

    let canonical = path.canonicalize().map_err(|error| {
        format!(
            "failed to resolve local plugin package source {}: {error}",
            path.display()
        )
    })?;

    Ok(AcquiredPackage {
        source,
        package_dir: canonical.clone(),
        install_path: canonical,
        staging_root: None,
    })
}

async fn acquire_npm_package(
    source: PackageSourceSpec,
    managed_base_dir: &Path,
) -> Result<AcquiredPackage, String> {
    let PackageSourceSpec::Npm { package_spec, .. } = &source else {
        return Err("expected an npm plugin package source".to_string());
    };

    let npm_path = resolve_binary(NPM_PATH_ENV, "npm")?;
    let staging_root = unique_staging_dir(managed_base_dir, "npm")?;
    let install_root = staging_root.join("install-root");
    fs::create_dir_all(&install_root)
        .map_err(|error| format!("failed to create npm install root: {error}"))?;
    fs::write(
        install_root.join("package.json"),
        r#"{"name":"openforge-plugin-staging","version":"1.0.0","private":true}"#,
    )
    .map_err(|error| format!("failed to create npm staging package.json: {error}"))?;

    let output = Command::new(&npm_path)
        .arg("install")
        .arg("--prefix")
        .arg(&install_root)
        .arg("--ignore-scripts")
        .arg("--omit=dev")
        .arg("--no-save")
        .arg(package_spec)
        .output()
        .await
        .map_err(|error| format!("failed to run npm install: {error}"))?;

    if !output.status.success() {
        let details = command_output_details(&output.stdout, &output.stderr);
        let _ = fs::remove_dir_all(&staging_root);
        return Err(format!("npm install failed for {package_spec}: {details}"));
    }

    let package_dir = install_root
        .join("node_modules")
        .join(resolve_requested_package_dir_name(package_spec)?);

    Ok(AcquiredPackage {
        source,
        package_dir,
        install_path: PathBuf::new(),
        staging_root: Some(staging_root),
    })
}

async fn acquire_git_package(
    source: PackageSourceSpec,
    managed_base_dir: &Path,
) -> Result<AcquiredPackage, String> {
    let PackageSourceSpec::Git {
        repo, reference, ..
    } = &source
    else {
        return Err("expected a git plugin package source".to_string());
    };

    let git_path = resolve_binary(GIT_PATH_ENV, "git")?;
    let staging_root = unique_staging_dir(managed_base_dir, "git")?;
    let checkout_dir = staging_root.join("checkout");
    let repo_url = normalize_git_repo_url(repo);

    let mut command = Command::new(&git_path);
    command.arg("clone").arg("--depth").arg("1");
    if let Some(reference) = reference {
        command.arg("--branch").arg(reference);
    }
    let output = command
        .arg(&repo_url)
        .arg(&checkout_dir)
        .output()
        .await
        .map_err(|error| format!("failed to run git clone: {error}"))?;

    if !output.status.success() {
        let details = command_output_details(&output.stdout, &output.stderr);
        let _ = fs::remove_dir_all(&staging_root);
        return Err(format!("git clone failed for {repo}: {details}"));
    }

    Ok(AcquiredPackage {
        source,
        package_dir: checkout_dir,
        install_path: PathBuf::new(),
        staging_root: Some(staging_root),
    })
}

fn load_package_from_dir(dir: &Path) -> Result<LoadedPluginPackage, String> {
    let package_json_path = dir.join("package.json");
    let raw = fs::read_to_string(&package_json_path).map_err(|error| {
        format!(
            "failed to read OpenForge plugin package.json {}: {error}",
            package_json_path.display()
        )
    })?;
    let raw_value: Value = serde_json::from_str(&raw).map_err(|error| {
        format!(
            "failed to parse OpenForge plugin package.json {}: {error}",
            package_json_path.display()
        )
    })?;
    validate_package_json_shape(&raw_value)?;

    let package_json: PackageJsonFile =
        serde_json::from_value(raw_value.clone()).map_err(|error| {
            format!(
                "failed to parse OpenForge plugin package metadata {}: {error}",
                package_json_path.display()
            )
        })?;

    let package_metadata_json = package_metadata_json(&raw_value)?;

    Ok(LoadedPluginPackage {
        package_json,
        package_metadata_json,
    })
}

fn validate_package_json_shape(value: &Value) -> Result<(), String> {
    let object = value
        .as_object()
        .ok_or_else(|| "OpenForge plugin package.json must be an object".to_string())?;

    validate_non_empty_json_string(object, "name", "package.json name")?;
    validate_non_empty_json_string(object, "version", "package.json version")?;

    let openforge = object
        .get("openforge")
        .ok_or_else(|| "OpenForge plugin package.json must include openforge metadata".to_string())?
        .as_object()
        .ok_or_else(|| "package.json openforge metadata must be an object".to_string())?;

    if openforge.contains_key("contributes") {
        return Err("package.json openforge.contributes is not supported; register contributions at runtime".to_string());
    }

    let schema_rules = package_metadata_schema_rules()?;

    for key in openforge.keys() {
        if !schema_rules.allows_metadata_field(key) {
            return Err(format!(
                "package.json openforge.{key} is not supported by the OpenForge package metadata schema"
            ));
        }
    }

    for key in &schema_rules.required_metadata_fields {
        if key == "apiVersion" {
            continue;
        }
        if !openforge.contains_key(key) {
            return Err(format!(
                "package.json openforge.{key} is required by the OpenForge package metadata schema"
            ));
        }
    }

    for key in &schema_rules.string_metadata_fields {
        if openforge.get(key).is_some() {
            validate_non_empty_json_string(
                openforge,
                key,
                &format!("package.json openforge.{key}"),
            )?;
        }
    }

    match openforge.get("apiVersion").and_then(Value::as_i64) {
        Some(version) if schema_rules.supports_api_version(version) => {}
        Some(version) => {
            return Err(format!(
                "package.json openforge.apiVersion {version} is not supported (supported: {})",
                schema_rules.supported_api_versions_label()
            ));
        }
        None if schema_rules.requires_metadata_field("apiVersion") => {
            return Err(format!(
                "package.json openforge.apiVersion must be {}",
                schema_rules.supported_api_versions_label()
            ));
        }
        None => {}
    }

    if let Some(requires) = openforge.get("requires") {
        let requires = requires
            .as_array()
            .ok_or_else(|| "package.json openforge.requires must be an array".to_string())?;
        for (index, capability) in requires.iter().enumerate() {
            let capability = capability.as_str().ok_or_else(|| {
                format!("package.json openforge.requires[{index}] must be a string")
            })?;
            if !schema_rules.supports_capability(capability) {
                return Err(format!(
                    "package.json openforge.requires[{index}] has unknown capability \"{capability}\""
                ));
            }
        }
    }

    Ok(())
}

fn validate_package(package: &PackageJsonFile, dir: &Path) -> Result<(), String> {
    let schema_rules = package_metadata_schema_rules()?;

    if !schema_rules.id_pattern.is_match(&package.openforge.id) {
        return Err(format!(
            "package.json openforge.id \"{}\" must match the OpenForge package metadata schema",
            package.openforge.id
        ));
    }

    if !schema_rules.supports_api_version(package.openforge.api_version) {
        return Err(format!(
            "package.json openforge.apiVersion {} is not supported (supported: {})",
            package.openforge.api_version,
            schema_rules.supported_api_versions_label()
        ));
    }

    if package.openforge.frontend.is_none() && package.openforge.backend.is_none() {
        return Err(
            "package.json openforge metadata requires a frontend or backend built JavaScript entry"
                .to_string(),
        );
    }

    if let Some(frontend) = package.openforge.frontend.as_deref() {
        validate_relative_js_entry_path(dir, frontend, "frontend")?;
    }
    if let Some(backend) = package.openforge.backend.as_deref() {
        validate_relative_js_entry_path(dir, backend, "backend")?;
    }

    Ok(())
}

fn validate_relative_js_entry_path(
    dir: &Path,
    entry: &str,
    field_name: &str,
) -> Result<(), String> {
    let entry_path = Path::new(entry);
    if entry_path.is_absolute()
        || entry_path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(format!(
            "package.json openforge.{field_name} entry must stay within the plugin package directory"
        ));
    }

    let candidate = dir.join(entry_path);
    if !candidate.is_file() {
        return Err(format!(
            "OpenForge plugin {field_name} entry is missing at {}; run the package build first",
            candidate.display()
        ));
    }

    let extension = candidate
        .extension()
        .and_then(|extension| extension.to_str());
    if !matches!(extension, Some("js" | "mjs" | "cjs")) {
        return Err(format!(
            "package.json openforge.{field_name} must point to a built JavaScript artifact (.js, .mjs, or .cjs)"
        ));
    }

    let canonical_dir = dir.canonicalize().map_err(|error| {
        format!(
            "failed to canonicalize plugin package directory {}: {error}",
            dir.display()
        )
    })?;
    let canonical_candidate = candidate.canonicalize().map_err(|error| {
        format!(
            "failed to canonicalize OpenForge plugin {field_name} entry {}: {error}",
            candidate.display()
        )
    })?;

    if !canonical_candidate.starts_with(&canonical_dir) {
        return Err(format!(
            "package.json openforge.{field_name} entry must stay within the plugin package directory"
        ));
    }

    Ok(())
}

fn build_plugin_row(
    loaded: &LoadedPluginPackage,
    install_path: &Path,
    source: &PackageSourceSpec,
    is_builtin: bool,
) -> Result<db::PluginRow, String> {
    let openforge = &loaded.package_json.openforge;
    Ok(db::PluginRow {
        id: openforge.id.clone(),
        name: openforge.display_name.clone(),
        version: loaded.package_json.version.clone(),
        api_version: openforge.api_version,
        description: openforge.description.clone(),
        permissions: "[]".to_string(),
        contributes: "{}".to_string(),
        frontend_entry: openforge.frontend.clone().unwrap_or_default(),
        backend_entry: openforge.backend.clone(),
        install_path: install_path.to_string_lossy().into_owned(),
        source_kind: source.kind().to_string(),
        source_spec: source.spec().to_string(),
        package_metadata: loaded.package_metadata_json.clone(),
        installed_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| format!("failed to compute install timestamp: {error}"))?
            .as_millis() as i64,
        is_builtin,
    })
}

fn package_metadata_json(value: &Value) -> Result<String, String> {
    let object = value
        .as_object()
        .ok_or_else(|| "OpenForge plugin package.json must be an object".to_string())?;
    let mut metadata = Map::new();
    for key in ["name", "version", "peerDependencies", "openforge"] {
        if let Some(value) = object.get(key) {
            metadata.insert(key.to_string(), value.clone());
        }
    }
    serde_json::to_string(&Value::Object(metadata))
        .map_err(|error| format!("failed to serialize OpenForge package metadata: {error}"))
}

fn validate_non_empty_json_string(
    object: &Map<String, Value>,
    key: &str,
    label: &str,
) -> Result<(), String> {
    match object.get(key).and_then(Value::as_str) {
        Some(value) if !value.trim().is_empty() => Ok(()),
        _ => Err(format!("{label} must be a non-empty string")),
    }
}

fn package_metadata_schema_rules() -> Result<&'static PackageMetadataSchemaRules, String> {
    static RULES: OnceLock<Result<PackageMetadataSchemaRules, String>> = OnceLock::new();
    match RULES.get_or_init(parse_package_metadata_schema_rules) {
        Ok(rules) => Ok(rules),
        Err(error) => Err(error.clone()),
    }
}

fn parse_package_metadata_schema_rules() -> Result<PackageMetadataSchemaRules, String> {
    let schema: Value = serde_json::from_str(OPENFORGE_PACKAGE_METADATA_SCHEMA_JSON)
        .map_err(|error| format!("failed to parse OpenForge package metadata schema: {error}"))?;
    let schema = schema
        .as_object()
        .ok_or_else(|| "OpenForge package metadata schema must be an object".to_string())?;
    let properties = schema_object_field(
        schema,
        "properties",
        "OpenForge package metadata schema.properties",
    )?;

    let allowed_metadata_fields = properties.keys().cloned().collect::<Vec<_>>();
    let required_metadata_fields = schema_string_array_field(
        schema,
        "required",
        "OpenForge package metadata schema.required",
    )?;
    let string_metadata_fields = properties
        .iter()
        .filter_map(|(key, property)| {
            if property.get("type").and_then(Value::as_str) == Some("string") {
                Some(key.clone())
            } else {
                None
            }
        })
        .collect::<Vec<_>>();

    let id_schema = schema_property(properties, "id")?;
    let id_pattern = id_schema
        .get("pattern")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            "OpenForge package metadata schema.properties.id.pattern must be a string".to_string()
        })?;
    let id_pattern = Regex::new(id_pattern).map_err(|error| {
        format!("failed to compile OpenForge package id schema pattern: {error}")
    })?;

    let api_version_schema = schema_property(properties, "apiVersion")?;
    let supported_api_versions = schema_i64_array_field(
        api_version_schema,
        "enum",
        "OpenForge package metadata schema.properties.apiVersion.enum",
    )?;

    let requires_schema = schema_property(properties, "requires")?;
    let requires_items_schema = schema_object_field(
        requires_schema,
        "items",
        "OpenForge package metadata schema.properties.requires.items",
    )?;
    let allowed_capabilities = schema_string_array_field(
        requires_items_schema,
        "enum",
        "OpenForge package metadata schema.properties.requires.items.enum",
    )?;

    Ok(PackageMetadataSchemaRules {
        allowed_metadata_fields,
        required_metadata_fields,
        string_metadata_fields,
        supported_api_versions,
        id_pattern,
        allowed_capabilities,
    })
}

fn schema_property<'a>(
    properties: &'a Map<String, Value>,
    property_name: &str,
) -> Result<&'a Map<String, Value>, String> {
    properties
        .get(property_name)
        .and_then(Value::as_object)
        .ok_or_else(|| {
            format!(
                "OpenForge package metadata schema.properties.{property_name} must be an object"
            )
        })
}

fn schema_object_field<'a>(
    object: &'a Map<String, Value>,
    field_name: &str,
    label: &str,
) -> Result<&'a Map<String, Value>, String> {
    object
        .get(field_name)
        .and_then(Value::as_object)
        .ok_or_else(|| format!("{label} must be an object"))
}

fn schema_string_array_field(
    object: &Map<String, Value>,
    field_name: &str,
    label: &str,
) -> Result<Vec<String>, String> {
    object
        .get(field_name)
        .and_then(Value::as_array)
        .ok_or_else(|| format!("{label} must be an array"))?
        .iter()
        .map(|value| {
            value
                .as_str()
                .map(str::to_string)
                .ok_or_else(|| format!("{label} entries must be strings"))
        })
        .collect()
}

fn schema_i64_array_field(
    object: &Map<String, Value>,
    field_name: &str,
    label: &str,
) -> Result<Vec<i64>, String> {
    object
        .get(field_name)
        .and_then(Value::as_array)
        .ok_or_else(|| format!("{label} must be an array"))?
        .iter()
        .map(|value| {
            value
                .as_i64()
                .ok_or_else(|| format!("{label} entries must be integers"))
        })
        .collect()
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

fn resolve_binary(env_name: &str, binary_name: &str) -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var(env_name) {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }

    which::which(binary_name)
        .map_err(|error| format!("failed to locate {binary_name} in PATH: {error}"))
}

fn unique_staging_dir(managed_base_dir: &Path, prefix: &str) -> Result<PathBuf, String> {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("failed to create staging directory nonce: {error}"))?
        .as_nanos();
    let path = managed_base_dir
        .join(".staging")
        .join(format!("{prefix}-{nonce}"));
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
        return Err("npm package source spec cannot be empty".to_string());
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

fn parse_git_source(git_spec: &str) -> Result<(String, Option<String>), String> {
    let git_spec = git_spec.trim();
    if git_spec.is_empty() {
        return Err("git plugin package source spec cannot be empty".to_string());
    }

    if git_spec.starts_with("git@") {
        return Ok((git_spec.to_string(), None));
    }

    match git_spec.rsplit_once('@') {
        Some((repo, reference)) if !repo.is_empty() && !reference.is_empty() => {
            Ok((repo.to_string(), Some(reference.to_string())))
        }
        Some(_) => Err(format!(
            "invalid git plugin package source spec: git:{git_spec}"
        )),
        None => Ok((git_spec.to_string(), None)),
    }
}

fn normalize_git_repo_url(repo: &str) -> String {
    if repo.starts_with("http://")
        || repo.starts_with("https://")
        || repo.starts_with("ssh://")
        || repo.starts_with("git@")
        || repo.starts_with("file://")
    {
        repo.to_string()
    } else {
        format!("https://{repo}")
    }
}

fn command_output_details(stdout: &[u8], stderr: &[u8]) -> String {
    let stderr = String::from_utf8_lossy(stderr).trim().to_string();
    if !stderr.is_empty() {
        return stderr;
    }

    let stdout = String::from_utf8_lossy(stdout).trim().to_string();
    if stdout.is_empty() {
        "command exited without details".to_string()
    } else {
        stdout
    }
}

#[allow(dead_code)]
fn _package_metadata_schema_json() -> &'static str {
    OPENFORGE_PACKAGE_METADATA_SCHEMA_JSON
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    fn write_package_json(dir: &Path, openforge: &str) {
        fs::write(
            dir.join("package.json"),
            format!(r#"{{"name":"@acme/plugin","version":"1.2.3","openforge":{openforge}}}"#),
        )
        .expect("package.json should write");
    }

    fn make_executable(path: &Path) {
        #[cfg(unix)]
        {
            let mut permissions = fs::metadata(path)
                .expect("metadata should read")
                .permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(path, permissions).expect("permissions should set");
        }
    }

    #[test]
    fn package_metadata_schema_rules_match_embedded_schema() {
        let rules = package_metadata_schema_rules().expect("schema rules should parse");
        let schema: Value = serde_json::from_str(OPENFORGE_PACKAGE_METADATA_SCHEMA_JSON)
            .expect("embedded schema should parse in test");
        let properties = schema
            .get("properties")
            .and_then(Value::as_object)
            .expect("schema properties should be an object");
        let mut expected_fields: Vec<String> = properties.keys().cloned().collect();
        expected_fields.sort();

        let mut actual_fields = rules.allowed_metadata_fields.clone();
        actual_fields.sort();
        assert_eq!(actual_fields, expected_fields);

        let expected_required: Vec<String> = schema
            .get("required")
            .and_then(Value::as_array)
            .expect("schema required should be an array")
            .iter()
            .map(|field| {
                field
                    .as_str()
                    .expect("required field should be a string")
                    .to_string()
            })
            .collect();
        assert_eq!(rules.required_metadata_fields, expected_required);

        assert_eq!(
            rules.id_pattern.as_str(),
            properties
                .get("id")
                .and_then(|schema| schema.get("pattern"))
                .and_then(Value::as_str)
                .expect("id pattern should be in schema")
        );
        assert_eq!(
            rules.supported_api_versions,
            properties
                .get("apiVersion")
                .and_then(|schema| schema.get("enum"))
                .and_then(Value::as_array)
                .expect("apiVersion enum should be in schema")
                .iter()
                .map(|version| version.as_i64().expect("apiVersion enum must be integers"))
                .collect::<Vec<_>>()
        );
        assert_eq!(
            rules.allowed_capabilities,
            properties
                .get("requires")
                .and_then(|schema| schema.get("items"))
                .and_then(|schema| schema.get("enum"))
                .and_then(Value::as_array)
                .expect("requires enum should be in schema")
                .iter()
                .map(|capability| {
                    capability
                        .as_str()
                        .expect("requires enum values should be strings")
                        .to_string()
                })
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn install_package_source_accepts_schema_declared_capabilities() {
        for (index, capability) in package_metadata_schema_rules()
            .expect("schema rules should parse")
            .allowed_capabilities
            .iter()
            .enumerate()
        {
            let source = tempdir().expect("source tempdir should create");
            let managed = tempdir().expect("managed tempdir should create");
            fs::create_dir_all(source.path().join("dist")).expect("dist dir should create");
            fs::write(source.path().join("dist/frontend.js"), "export default {};")
                .expect("frontend should write");
            write_package_json(
                source.path(),
                &format!(
                    r#"{{"id":"acme.capability.{index}","apiVersion":1,"displayName":"Capability","description":"Capability","frontend":"dist/frontend.js","requires":["{capability}"]}}"#
                ),
            );

            install_plugin_package_from_source_spec(
                &source.path().to_string_lossy(),
                managed.path(),
            )
            .unwrap_or_else(|error| panic!("capability {capability} should install: {error}"));
        }
    }

    #[test]
    fn install_package_source_rejects_unknown_openforge_property() {
        let source = tempdir().expect("source tempdir should create");
        let managed = tempdir().expect("managed tempdir should create");
        fs::create_dir_all(source.path().join("dist")).expect("dist dir should create");
        fs::write(source.path().join("dist/frontend.js"), "export default {};")
            .expect("frontend should write");
        write_package_json(
            source.path(),
            r#"{"id":"acme.unknown","apiVersion":1,"displayName":"Unknown","description":"Unknown","frontend":"dist/frontend.js","unexpected":true}"#,
        );

        let result = install_plugin_package_from_source_spec(
            &source.path().to_string_lossy(),
            managed.path(),
        );

        assert!(result.is_err());
        assert!(result
            .expect_err("install should fail")
            .contains("openforge.unexpected is not supported"));
    }

    #[test]
    fn install_package_source_rejects_id_not_matching_schema_pattern() {
        let source = tempdir().expect("source tempdir should create");
        let managed = tempdir().expect("managed tempdir should create");
        fs::create_dir_all(source.path().join("dist")).expect("dist dir should create");
        fs::write(source.path().join("dist/frontend.js"), "export default {};")
            .expect("frontend should write");
        write_package_json(
            source.path(),
            r#"{"id":"Acme Invalid","apiVersion":1,"displayName":"Invalid","description":"Invalid","frontend":"dist/frontend.js"}"#,
        );

        let result = install_plugin_package_from_source_spec(
            &source.path().to_string_lossy(),
            managed.path(),
        );

        assert!(result.is_err());
        assert!(result
            .expect_err("install should fail")
            .contains("must match the OpenForge package metadata schema"));
    }

    #[test]
    fn install_local_package_source_references_source_path_directly() {
        let source = tempdir().expect("source tempdir should create");
        let managed = tempdir().expect("managed tempdir should create");
        fs::create_dir_all(source.path().join("dist")).expect("dist dir should create");
        fs::write(source.path().join("dist/frontend.js"), "export default {};")
            .expect("frontend should write");
        write_package_json(
            source.path(),
            r#"{"id":"acme.local","apiVersion":1,"displayName":"Local Plugin","description":"A local plugin","frontend":"dist/frontend.js","requires":["views"]}"#,
        );

        let row = install_plugin_package_from_source_spec(
            &source.path().to_string_lossy(),
            managed.path(),
        )
        .expect("local package install should succeed");

        assert_eq!(row.id, "acme.local");
        assert_eq!(row.name, "Local Plugin");
        assert_eq!(row.source_kind, "local");
        assert_eq!(row.source_spec, source.path().to_string_lossy());
        assert_eq!(
            row.install_path,
            source.path().canonicalize().unwrap().to_string_lossy()
        );
        assert!(!managed_plugin_dir(managed.path(), "acme.local").exists());
        assert!(row
            .package_metadata
            .contains("\"displayName\":\"Local Plugin\""));
    }

    #[test]
    fn install_package_source_rejects_missing_built_js_entry_with_clear_error() {
        let source = tempdir().expect("source tempdir should create");
        let managed = tempdir().expect("managed tempdir should create");
        write_package_json(
            source.path(),
            r#"{"id":"acme.missing","apiVersion":1,"displayName":"Missing Build","description":"Needs build","frontend":"dist/frontend.js"}"#,
        );

        let result = install_plugin_package_from_source_spec(
            &source.path().to_string_lossy(),
            managed.path(),
        );

        assert!(result.is_err());
        assert!(result
            .expect_err("install should fail")
            .contains("run the package build first"));
    }

    #[test]
    fn install_package_source_rejects_legacy_contributes_metadata() {
        let source = tempdir().expect("source tempdir should create");
        let managed = tempdir().expect("managed tempdir should create");
        fs::create_dir_all(source.path().join("dist")).expect("dist dir should create");
        fs::write(source.path().join("dist/frontend.js"), "export default {};")
            .expect("frontend should write");
        write_package_json(
            source.path(),
            r#"{"id":"acme.legacy","apiVersion":1,"displayName":"Legacy","description":"Legacy","frontend":"dist/frontend.js","contributes":{}}"#,
        );

        let result = install_plugin_package_from_source_spec(
            &source.path().to_string_lossy(),
            managed.path(),
        );

        assert!(result.is_err());
        assert!(result
            .expect_err("install should fail")
            .contains("register contributions at runtime"));
    }

    #[test]
    fn install_package_source_rejects_path_traversal_entry() {
        let source = tempdir().expect("source tempdir should create");
        let managed = tempdir().expect("managed tempdir should create");
        write_package_json(
            source.path(),
            r#"{"id":"acme.traversal","apiVersion":1,"displayName":"Traversal","description":"Traversal","frontend":"../frontend.js"}"#,
        );

        let result = install_plugin_package_from_source_spec(
            &source.path().to_string_lossy(),
            managed.path(),
        );

        assert!(result.is_err());
        assert!(result
            .expect_err("install should fail")
            .contains("must stay within the plugin package directory"));
    }

    #[test]
    fn install_package_source_rejects_non_js_entry() {
        let source = tempdir().expect("source tempdir should create");
        let managed = tempdir().expect("managed tempdir should create");
        fs::create_dir_all(source.path().join("dist")).expect("dist dir should create");
        fs::write(source.path().join("dist/frontend.ts"), "export default {};")
            .expect("frontend should write");
        write_package_json(
            source.path(),
            r#"{"id":"acme.typescript","apiVersion":1,"displayName":"Typescript","description":"Typescript","frontend":"dist/frontend.ts"}"#,
        );

        let result = install_plugin_package_from_source_spec(
            &source.path().to_string_lossy(),
            managed.path(),
        );

        assert!(result.is_err());
        assert!(result
            .expect_err("install should fail")
            .contains("built JavaScript artifact"));
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
    async fn install_npm_package_source_uses_managed_directory_and_records_source() {
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
cat > "$prefix/node_modules/fake-package/package.json" <<'EOF'
{"name":"fake-package","version":"2.0.0","openforge":{"id":"acme.npm","apiVersion":1,"displayName":"Npm Plugin","description":"Installed from npm","frontend":"dist/index.js"}}
EOF
echo "export const ok = true;" > "$prefix/node_modules/fake-package/dist/index.js"
"#;
        fs::write(&fake_npm, script).expect("fake npm should write");
        make_executable(&fake_npm);

        let previous = std::env::var(NPM_PATH_ENV).ok();
        std::env::set_var(NPM_PATH_ENV, &fake_npm);
        let row =
            install_plugin_package_from_source_spec_async("npm:fake-package@2.0.0", managed.path())
                .await
                .expect("npm install should succeed");
        match previous {
            Some(value) => std::env::set_var(NPM_PATH_ENV, value),
            None => std::env::remove_var(NPM_PATH_ENV),
        }

        let install_path = PathBuf::from(&row.install_path);
        assert_eq!(row.id, "acme.npm");
        assert_eq!(row.version, "2.0.0");
        assert_eq!(row.source_kind, "npm");
        assert_eq!(row.source_spec, "npm:fake-package@2.0.0");
        assert!(install_path.starts_with(managed_plugins_dir(managed.path())));
        assert!(install_path.join("package.json").exists());
        assert!(install_path.join("dist/index.js").exists());
    }

    #[tokio::test]
    async fn install_git_package_source_uses_external_git_and_records_source() {
        let managed = tempdir().expect("managed tempdir should create");
        let fake_git_dir = tempdir().expect("fake git dir should create");
        let fake_git = fake_git_dir.path().join("git");
        let script = r#"#!/bin/sh
for last do :; done
dest="$last"
mkdir -p "$dest/dist"
cat > "$dest/package.json" <<'EOF'
{"name":"git-package","version":"3.0.0","openforge":{"id":"acme.git","apiVersion":1,"displayName":"Git Plugin","description":"Installed from git","frontend":"dist/index.js"}}
EOF
echo "export const ok = true;" > "$dest/dist/index.js"
"#;
        fs::write(&fake_git, script).expect("fake git should write");
        make_executable(&fake_git);

        let previous = std::env::var(GIT_PATH_ENV).ok();
        std::env::set_var(GIT_PATH_ENV, &fake_git);
        let row = install_plugin_package_from_source_spec_async(
            "git:github.com/acme/plugin@main",
            managed.path(),
        )
        .await
        .expect("git install should succeed");
        match previous {
            Some(value) => std::env::set_var(GIT_PATH_ENV, value),
            None => std::env::remove_var(GIT_PATH_ENV),
        }

        let install_path = PathBuf::from(&row.install_path);
        assert_eq!(row.id, "acme.git");
        assert_eq!(row.source_kind, "git");
        assert_eq!(row.source_spec, "git:github.com/acme/plugin@main");
        assert!(install_path.starts_with(managed_plugins_dir(managed.path())));
        assert!(install_path.join("package.json").exists());
    }
}
