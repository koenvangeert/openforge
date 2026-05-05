use std::{fs, path::Path};

fn read(path: impl AsRef<Path>) -> String {
    fs::read_to_string(path.as_ref())
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", path.as_ref().display()))
}

#[test]
fn cargo_manifest_does_not_link_tauri_runtime_or_log_plugin() {
    let manifest = read("Cargo.toml");

    for forbidden in ["tauri =", "tauri-plugin-log", "tauri_build", "tauri-build"] {
        assert!(
            !manifest.contains(forbidden),
            "backend sidecar manifest must not contain {forbidden}"
        );
    }
}

#[test]
fn rust_backend_sources_do_not_import_tauri_runtime() {
    let src_dir = Path::new("src");
    let mut offenders = Vec::new();
    collect_tauri_runtime_references(src_dir, &mut offenders);

    assert!(
        offenders.is_empty(),
        "backend sidecar Rust sources must use backend-owned abstractions instead of Tauri runtime imports:\n{}",
        offenders.join("\n")
    );
}

fn collect_tauri_runtime_references(dir: &Path, offenders: &mut Vec<String>) {
    for entry in fs::read_dir(dir)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", dir.display()))
    {
        let entry = entry.expect("failed to read directory entry");
        let path = entry.path();
        if path.is_dir() {
            collect_tauri_runtime_references(&path, offenders);
            continue;
        }
        if path.extension().and_then(|ext| ext.to_str()) != Some("rs") {
            continue;
        }

        let text = read(&path);
        for (line_index, line) in text.lines().enumerate() {
            let trimmed = line.trim_start();
            if trimmed.starts_with("use tauri")
                || trimmed.starts_with("#[tauri::")
                || trimmed.contains("tauri::")
                || trimmed.contains("tauri_plugin_log")
                || trimmed.contains("tauri-plugin-log")
            {
                offenders.push(format!("{}:{}:{line}", path.display(), line_index + 1));
            }
        }
    }
}
