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

#[test]
fn sidecar_sources_do_not_compile_legacy_command_boundary() {
    let src_dir = Path::new("src");
    let mut offenders = Vec::new();
    collect_legacy_command_boundary_references(src_dir, &mut offenders);

    assert!(
        offenders.is_empty(),
        "backend sidecar sources must use app_invoke/runtime modules instead of compiling legacy command-boundary modules:\n{}",
        offenders.join("\n")
    );
}

fn collect_tauri_runtime_references(dir: &Path, offenders: &mut Vec<String>) {
    collect_rust_source_matches(dir, offenders, |_path, line| {
        let trimmed = line.trim_start();
        trimmed.starts_with("use tauri")
            || trimmed.starts_with("#[tauri::")
            || trimmed.contains("tauri::")
            || trimmed.contains("tauri_plugin_log")
            || trimmed.contains("tauri-plugin-log")
    });
}

fn collect_legacy_command_boundary_references(dir: &Path, offenders: &mut Vec<String>) {
    collect_rust_source_matches(dir, offenders, |path, line| {
        let trimmed = line.trim_start();
        ((path == Path::new("src/main.rs"))
            && (trimmed == "mod commands;" || trimmed == "pub mod commands;"))
            || trimmed.starts_with("use crate::commands")
            || trimmed.contains("crate::commands::")
    });
}

fn collect_rust_source_matches(
    dir: &Path,
    offenders: &mut Vec<String>,
    matches_forbidden: impl Fn(&Path, &str) -> bool + Copy,
) {
    for entry in fs::read_dir(dir)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", dir.display()))
    {
        let entry = entry.expect("failed to read directory entry");
        let path = entry.path();
        if path.is_dir() {
            collect_rust_source_matches(&path, offenders, matches_forbidden);
            continue;
        }
        if path.extension().and_then(|ext| ext.to_str()) != Some("rs") {
            continue;
        }

        let text = read(&path);
        for (line_index, line) in text.lines().enumerate() {
            if matches_forbidden(&path, line) {
                offenders.push(format!("{}:{}:{line}", path.display(), line_index + 1));
            }
        }
    }
}
