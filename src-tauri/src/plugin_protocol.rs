use crate::{builtin_plugins, db};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::Manager;

const HOST_RUNTIME_INDEX_HTML: &str = r#"<!doctype html>
<html lang=\"en\">
  <head>
    <meta charset=\"utf-8\" />
    <title>Open Forge Plugin Runtime</title>
  </head>
  <body>
    <script type=\"module\" src=\"plugin://host-runtime/runtime.js\"></script>
  </body>
</html>
"#;

const HOST_RUNTIME_RUNTIME_JS: &str =
    "globalThis.__OPENFORGE_PLUGIN_RUNTIME__ = true; export const runtimeReady = true;";
const HOST_RUNTIME_PLUGIN_SDK_INDEX_JS: &str = include_str!("../plugin-host/plugin-sdk/index.js");

const PLUGIN_PROTOCOL_CORS_HEADER: &str = "Access-Control-Allow-Origin";
const PLUGIN_PROTOCOL_CORS_ALLOW_ORIGIN: &str = "*";

type ProtocolResponse = tauri::http::Response<Vec<u8>>;
type HostRuntimeAsset = (Vec<u8>, &'static str);

trait PluginAssetResolver {
    fn resolve_asset_path(&self, plugin_id: &str, rel_path: &str) -> Result<PathBuf, String>;
}

struct AppPluginAssetResolver<'a, R: tauri::Runtime> {
    app_handle: &'a tauri::AppHandle<R>,
}

impl<R: tauri::Runtime> PluginAssetResolver for AppPluginAssetResolver<'_, R> {
    fn resolve_asset_path(&self, plugin_id: &str, rel_path: &str) -> Result<PathBuf, String> {
        resolve_plugin_asset_path_for_request(self.app_handle, plugin_id, rel_path)
    }
}

pub(crate) fn handle_plugin_uri<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
    uri: &str,
) -> ProtocolResponse {
    let resolver = AppPluginAssetResolver { app_handle };
    plugin_protocol_response_for_uri(uri, &resolver)
}

fn plugin_protocol_response_for_uri(
    uri: &str,
    resolver: &impl PluginAssetResolver,
) -> ProtocolResponse {
    let path = uri.strip_prefix("plugin://").unwrap_or(uri);

    if path.starts_with("host-runtime/") {
        let rel_path = path.trim_start_matches("host-runtime/");
        return host_runtime_response(rel_path);
    }

    let mut parts = path.splitn(2, '/');
    let plugin_id = parts.next().unwrap_or("");
    let rel_path = parts.next().unwrap_or("");

    plugin_asset_response(resolver, plugin_id, rel_path)
}

fn host_runtime_response(rel_path: &str) -> ProtocolResponse {
    if rel_path.contains("..") {
        return forbidden_response();
    }

    match host_runtime_asset(rel_path) {
        Some((content, mime_type)) => ok_response(mime_type, content),
        None => not_found_response(),
    }
}

fn plugin_asset_response(
    resolver: &impl PluginAssetResolver,
    plugin_id: &str,
    rel_path: &str,
) -> ProtocolResponse {
    let file_path = match resolver.resolve_asset_path(plugin_id, rel_path) {
        Ok(path) => path,
        Err(error) if error == "Forbidden" => return forbidden_response(),
        Err(error) => return plugin_protocol_response(403, None, error.into_bytes()),
    };

    match std::fs::read(&file_path) {
        Ok(content) => ok_response(mime_type_for_path(&file_path), content),
        Err(_) => not_found_response(),
    }
}

fn ok_response(content_type: &str, body: Vec<u8>) -> ProtocolResponse {
    plugin_protocol_response(200, Some(content_type), body)
}

fn forbidden_response() -> ProtocolResponse {
    plugin_protocol_response(403, None, b"Forbidden".to_vec())
}

fn not_found_response() -> ProtocolResponse {
    plugin_protocol_response(404, None, b"File not found".to_vec())
}

fn plugin_protocol_response(
    status: u16,
    content_type: Option<&str>,
    body: Vec<u8>,
) -> ProtocolResponse {
    let mut builder = tauri::http::Response::builder().status(status).header(
        PLUGIN_PROTOCOL_CORS_HEADER,
        PLUGIN_PROTOCOL_CORS_ALLOW_ORIGIN,
    );

    if let Some(content_type) = content_type {
        builder = builder.header("Content-Type", content_type);
    }

    builder
        .body(body)
        .expect("plugin protocol response uses valid static headers and status")
}

fn host_runtime_asset(rel_path: &str) -> Option<HostRuntimeAsset> {
    match rel_path {
        "index.html" => Some((
            HOST_RUNTIME_INDEX_HTML.as_bytes().to_vec(),
            "text/html; charset=utf-8",
        )),
        "runtime.js" => Some((
            HOST_RUNTIME_RUNTIME_JS.as_bytes().to_vec(),
            "application/javascript",
        )),
        "plugin-sdk/index.js" => Some((
            HOST_RUNTIME_PLUGIN_SDK_INDEX_JS.as_bytes().to_vec(),
            "application/javascript",
        )),
        "svelte/index.js" | "svelte/internal.js" | "svelte/store.js" => {
            resolve_host_runtime_passthrough_asset(rel_path)
        }
        _ => resolve_host_runtime_passthrough_asset(rel_path),
    }
}

fn resolve_host_runtime_passthrough_asset(rel_path: &str) -> Option<HostRuntimeAsset> {
    let workspace_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    resolve_host_runtime_passthrough_asset_from_root(&workspace_root, rel_path)
}

fn resolve_host_runtime_passthrough_asset_from_root(
    workspace_root: &Path,
    rel_path: &str,
) -> Option<HostRuntimeAsset> {
    let svelte_src_root = workspace_root
        .join("node_modules")
        .join("svelte")
        .join("src");

    let rel = rel_path.strip_prefix("svelte/")?;
    if rel.contains("..") {
        return None;
    }

    let candidate = svelte_src_root.join(rel);
    let content = std::fs::read(candidate).ok()?;
    Some((content, "application/javascript"))
}

fn validate_plugin_id(plugin_id: &str) -> Result<(), String> {
    if plugin_id.is_empty() {
        return Err("Invalid plugin id: empty".to_string());
    }

    if plugin_id.contains('/') || plugin_id.contains('\\') {
        return Err("Invalid plugin id: path separators are not allowed".to_string());
    }

    let mut components = Path::new(plugin_id).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(_)), None) => Ok(()),
        _ => Err("Invalid plugin id".to_string()),
    }
}

fn resolve_plugin_install_base_dir(
    install_path: &str,
    plugin_id: &str,
    is_builtin: bool,
) -> Result<PathBuf, String> {
    if is_builtin && install_path.starts_with("builtin:") {
        return builtin_plugins::install_path(plugin_id);
    }

    Ok(PathBuf::from(install_path))
}

fn resolve_plugin_asset_path(
    install_base_dir: &Path,
    plugin_id: &str,
    rel_path: &str,
) -> Result<PathBuf, String> {
    validate_plugin_id(plugin_id)?;

    let relative_path = Path::new(rel_path);
    if relative_path.is_absolute() || rel_path.contains("..") {
        return Err("Forbidden".to_string());
    }

    let candidate = install_base_dir.join(relative_path);
    let canonical_install_base_dir = install_base_dir
        .canonicalize()
        .map_err(|_| "Forbidden".to_string())?;
    let canonical_candidate = candidate
        .canonicalize()
        .map_err(|_| "Forbidden".to_string())?;

    if !canonical_candidate.starts_with(&canonical_install_base_dir) {
        return Err("Forbidden".to_string());
    }

    Ok(canonical_candidate)
}

fn resolve_plugin_asset_path_for_request<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
    plugin_id: &str,
    rel_path: &str,
) -> Result<PathBuf, String> {
    let db = app_handle.state::<Arc<Mutex<db::Database>>>();
    let db_lock = db
        .lock()
        .map_err(|_| "Failed to lock database".to_string())?;
    let plugin = db_lock
        .get_plugin(plugin_id)
        .map_err(|error| format!("Failed to read plugin metadata: {error}"))?
        .ok_or_else(|| format!("Unknown plugin: {plugin_id}"))?;
    let install_base_dir =
        resolve_plugin_install_base_dir(&plugin.install_path, &plugin.id, plugin.is_builtin)?;

    resolve_plugin_asset_path(&install_base_dir, plugin_id, rel_path)
}

fn mime_type_for_path(path: &Path) -> &'static str {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    match ext {
        "js" | "mjs" => "application/javascript",
        "json" => "application/json",
        "css" => "text/css",
        "html" => "text/html",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn forbidden_response_includes_cors_header() {
        let response = forbidden_response();

        assert_eq!(response.status(), 403);
        assert_eq!(
            response
                .headers()
                .get("Access-Control-Allow-Origin")
                .and_then(|value| value.to_str().ok()),
            Some("*")
        );
    }

    #[test]
    fn not_found_response_includes_cors_header() {
        let response = not_found_response();

        assert_eq!(response.status(), 404);
        assert_eq!(
            response
                .headers()
                .get("Access-Control-Allow-Origin")
                .and_then(|value| value.to_str().ok()),
            Some("*")
        );
    }

    #[test]
    fn host_runtime_asset_serves_runtime_js() {
        let (content, mime_type) =
            host_runtime_asset("runtime.js").expect("runtime.js should be served by host runtime");

        assert_eq!(mime_type, "application/javascript");
        assert!(String::from_utf8_lossy(&content).contains("runtimeReady"));
    }

    #[test]
    fn host_runtime_asset_serves_embedded_plugin_sdk() {
        let (content, mime_type) = host_runtime_asset("plugin-sdk/index.js")
            .expect("plugin-sdk runtime should be served by host runtime");

        assert_eq!(mime_type, "application/javascript");
        let source = String::from_utf8_lossy(&content);
        assert!(source.contains("PluginContextImpl"));
        assert!(source.contains("validatePluginManifest"));
    }

    #[test]
    fn resolve_plugin_asset_path_rejects_invalid_plugin_ids() {
        let install_base_dir = Path::new("/tmp/plugin");

        for plugin_id in ["", "..", "foo/bar", "foo\\bar"] {
            let err = resolve_plugin_asset_path(install_base_dir, plugin_id, "assets/index.js")
                .expect_err("invalid plugin id should be rejected");
            assert!(err.contains("plugin id"), "unexpected error: {err}");
        }
    }

    #[test]
    fn resolve_plugin_asset_path_uses_install_base_dir() {
        let temp = tempfile::tempdir().expect("tempdir should create");
        let install_base_dir = temp.path();
        fs::create_dir_all(install_base_dir.join("assets")).expect("assets dir should create");
        fs::write(
            install_base_dir.join("assets/index.js"),
            "export const ok = true;",
        )
        .expect("asset file should write");

        let path = resolve_plugin_asset_path(install_base_dir, "my-plugin", "assets/index.js")
            .expect("valid plugin id should be accepted");

        assert!(path.ends_with("assets/index.js"));
    }

    #[test]
    fn resolve_plugin_asset_path_rejects_absolute_and_traversal_paths() {
        let temp = tempfile::tempdir().expect("tempdir should create");
        let install_base_dir = temp.path();
        fs::create_dir_all(install_base_dir.join("assets")).expect("assets dir should create");
        fs::write(
            install_base_dir.join("assets/index.js"),
            "export const ok = true;",
        )
        .expect("asset file should write");

        for rel_path in ["/etc/passwd", "../outside.js"] {
            let err = resolve_plugin_asset_path(install_base_dir, "my-plugin", rel_path)
                .expect_err("invalid asset path should be rejected");
            assert_eq!(err, "Forbidden");
        }
    }

    #[test]
    fn resolve_plugin_asset_path_rejects_traversal_at_boundary() {
        let temp = tempfile::tempdir().expect("tempdir should create");
        fs::write(temp.path().join("index.js"), "export const ok = true;")
            .expect("asset should write");

        let err = resolve_plugin_asset_path(temp.path(), "my-plugin", "../index.js")
            .expect_err("traversal must be rejected before file read");

        assert_eq!(err, "Forbidden");
    }

    struct FakeResolver {
        result: Result<PathBuf, String>,
    }

    impl PluginAssetResolver for FakeResolver {
        fn resolve_asset_path(&self, _plugin_id: &str, _rel_path: &str) -> Result<PathBuf, String> {
            self.result.clone()
        }
    }

    #[test]
    fn plugin_asset_response_maps_unknown_plugin_to_forbidden_body() {
        let response = plugin_asset_response(
            &FakeResolver {
                result: Err("Unknown plugin: sample".to_string()),
            },
            "sample",
            "index.js",
        );

        assert_eq!(response.status(), 403);
        assert_eq!(response.body().as_slice(), b"Unknown plugin: sample");
    }

    #[test]
    fn plugin_asset_response_serves_known_asset_with_mime_type() {
        let temp = tempfile::tempdir().expect("tempdir should create");
        let asset = temp.path().join("index.js");
        fs::write(&asset, "export const ok = true;").expect("asset should write");

        let response =
            plugin_asset_response(&FakeResolver { result: Ok(asset) }, "sample", "index.js");

        assert_eq!(response.status(), 200);
        assert_eq!(
            response
                .headers()
                .get("Content-Type")
                .and_then(|value| value.to_str().ok()),
            Some("application/javascript")
        );
        assert_eq!(response.body().as_slice(), b"export const ok = true;");
    }

    #[test]
    fn plugin_protocol_response_for_uri_routes_host_runtime_assets() {
        let response = plugin_protocol_response_for_uri(
            "plugin://host-runtime/runtime.js",
            &FakeResolver {
                result: Err("resolver should not be used".to_string()),
            },
        );

        assert_eq!(response.status(), 200);
        assert_eq!(
            response
                .headers()
                .get("Content-Type")
                .and_then(|value| value.to_str().ok()),
            Some("application/javascript")
        );
        assert!(String::from_utf8_lossy(response.body()).contains("runtimeReady"));
    }

    #[test]
    fn plugin_protocol_response_for_uri_rejects_host_runtime_traversal() {
        let response = plugin_protocol_response_for_uri(
            "plugin://host-runtime/../runtime.js",
            &FakeResolver {
                result: Err("resolver should not be used".to_string()),
            },
        );

        assert_eq!(response.status(), 403);
        assert_eq!(response.body().as_slice(), b"Forbidden");
    }

    #[test]
    fn resolve_plugin_install_base_dir_maps_builtin_sentinel_from_catalog() {
        let plugin = builtin_plugins::find("com.openforge.file-viewer")
            .expect("file viewer should be in builtin catalog");
        let path =
            resolve_plugin_install_base_dir(&plugin.sentinel_install_path(), plugin.id, true)
                .expect("builtin plugin path should resolve");

        assert_eq!(plugin.directory_name, "file-viewer");
        assert!(path.ends_with("plugins/file-viewer"));
    }

    #[test]
    fn host_runtime_passthrough_stays_within_svelte_namespace() {
        let temp = tempfile::tempdir().expect("tempdir should create");
        let svelte_root = temp.path().join("node_modules").join("svelte").join("src");
        fs::create_dir_all(&svelte_root).expect("svelte src root should create");
        fs::write(
            svelte_root.join("index.js"),
            "export * from './internal.js';",
        )
        .expect("svelte entrypoint should write");

        let (content, mime_type) =
            resolve_host_runtime_passthrough_asset_from_root(temp.path(), "svelte/index.js")
                .expect("svelte index should be served by host runtime");

        assert_eq!(mime_type, "application/javascript");
        assert!(String::from_utf8_lossy(&content).contains("./internal"));
        assert!(resolve_host_runtime_passthrough_asset_from_root(
            temp.path(),
            "../svelte/index.js"
        )
        .is_none());
    }
}
