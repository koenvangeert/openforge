use crate::db;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    name: String,
    path: String, // relative to project root
    is_dir: bool,
    size: Option<u64>,
    modified_at: Option<u64>, // unix timestamp ms
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    r#type: String,  // "text" | "image" | "binary"
    content: String, // text content or base64 for images
    mime_type: Option<String>,
    size: u64,
}

/// Resolve a path relative to the project root with security checks.
/// Returns the canonicalized absolute path if valid, or an error if the path tries to escape the root.
fn resolve_project_path(project_root: &Path, sub_path: Option<&str>) -> Result<PathBuf, String> {
    let resolved = if let Some(sub) = sub_path {
        if sub.is_empty() {
            project_root.to_path_buf()
        } else {
            project_root.join(sub)
        }
    } else {
        project_root.to_path_buf()
    };

    // Canonicalize both paths to prevent symlink and ".." traversal attacks
    let canonical_root = std::fs::canonicalize(project_root)
        .map_err(|e| format!("Failed to canonicalize project root: {}", e))?;

    let canonical_resolved = std::fs::canonicalize(&resolved)
        .map_err(|e| format!("Failed to canonicalize path: {}", e))?;

    // Verify the resolved path is within the project root
    if !canonical_resolved.starts_with(&canonical_root) {
        return Err("Path traversal detected: access denied".to_string());
    }

    Ok(canonical_resolved)
}

/// Detect file type from extension
fn detect_file_type(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    let text_exts = [
        "ts",
        "tsx",
        "js",
        "jsx",
        "rs",
        "py",
        "rb",
        "go",
        "json",
        "yaml",
        "yml",
        "md",
        "txt",
        "toml",
        "css",
        "html",
        "svelte",
        "vue",
        "sh",
        "bash",
        "zsh",
        "sql",
        "graphql",
        "xml",
        "csv",
        "env",
        "gitignore",
        "prettierrc",
        "eslintrc",
        "cfg",
        "ini",
        "conf",
        "log",
        "lock",
    ];

    let image_exts = ["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp"];

    if text_exts.contains(&ext.as_str()) {
        "text"
    } else if image_exts.contains(&ext.as_str()) {
        "image"
    } else {
        "binary"
    }
}

/// Get MIME type from file extension
fn get_mime_type(path: &Path) -> Option<String> {
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    let mime = match ext.as_str() {
        "ts" => "text/typescript",
        "tsx" => "text/typescript",
        "js" => "application/javascript",
        "jsx" => "application/javascript",
        "rs" => "text/rust",
        "py" => "text/python",
        "rb" => "text/ruby",
        "go" => "text/go",
        "json" => "application/json",
        "yaml" | "yml" => "application/yaml",
        "md" => "text/markdown",
        "txt" => "text/plain",
        "toml" => "text/toml",
        "css" => "text/css",
        "html" => "text/html",
        "svelte" => "text/svelte",
        "vue" => "text/vue",
        "sh" | "bash" | "zsh" => "text/shell",
        "sql" => "text/sql",
        "graphql" => "text/graphql",
        "xml" => "application/xml",
        "csv" => "text/csv",
        "env" => "text/plain",
        "cfg" | "ini" | "conf" => "text/plain",
        "log" => "text/plain",
        "lock" => "text/plain",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "bmp" => "image/bmp",
        _ => return None,
    };

    Some(mime.to_string())
}

#[tauri::command]
pub async fn fs_read_dir(
    db: State<'_, Arc<Mutex<db::Database>>>,
    project_id: String,
    dir_path: Option<String>,
) -> Result<Vec<FileEntry>, String> {
    // Look up project
    let project = {
        let db_guard = crate::db::acquire_db(&db);
        db_guard
            .get_project(&project_id)
            .map_err(|e| format!("Database error: {}", e))?
            .ok_or_else(|| format!("Project not found: {}", project_id))?
    };

    // Resolve path with security checks
    let project_root = Path::new(&project.path);
    let dir_to_read =
        resolve_project_path(project_root, dir_path.as_deref()).map_err(|e| e.to_string())?;

    // Read directory entries
    let mut entries = Vec::new();
    let entries_iter = tokio::fs::read_dir(&dir_to_read)
        .await
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut dir_entries = Vec::new();
    let mut file_entries = Vec::new();

    let mut read_dir = entries_iter;
    loop {
        match read_dir.next_entry().await {
            Ok(Some(entry)) => {
                let metadata = match entry.metadata().await {
                    Ok(m) => m,
                    Err(_) => continue, // skip entries we can't read metadata for
                };

                let name = entry.file_name();
                let name_str = name.to_string_lossy().to_string();

                let is_dir = metadata.is_dir();

                // Calculate relative path from project root
                let full_path = entry.path();
                let rel_path = full_path
                    .strip_prefix(project_root)
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|_| name_str.clone());

                let size = if is_dir { None } else { Some(metadata.len()) };

                let modified_at = metadata.modified().ok().and_then(|t| {
                    t.duration_since(std::time::UNIX_EPOCH)
                        .ok()
                        .map(|d| d.as_millis() as u64)
                });

                let entry = FileEntry {
                    name: name_str,
                    path: rel_path,
                    is_dir,
                    size,
                    modified_at,
                };

                if is_dir {
                    dir_entries.push(entry);
                } else {
                    file_entries.push(entry);
                }
            }
            Ok(None) => break,
            Err(e) => {
                return Err(format!("Error reading directory entry: {}", e));
            }
        }
    }

    // Sort directories and files alphabetically, directories first
    dir_entries.sort_by(|a, b| a.name.cmp(&b.name));
    file_entries.sort_by(|a, b| a.name.cmp(&b.name));

    entries.extend(dir_entries);
    entries.extend(file_entries);

    Ok(entries)
}

#[tauri::command]
pub async fn fs_read_file(
    db: State<'_, Arc<Mutex<db::Database>>>,
    project_id: String,
    file_path: String,
) -> Result<FileContent, String> {
    // Look up project
    let project = {
        let db_guard = crate::db::acquire_db(&db);
        db_guard
            .get_project(&project_id)
            .map_err(|e| format!("Database error: {}", e))?
            .ok_or_else(|| format!("Project not found: {}", project_id))?
    };

    // Resolve path with security checks
    let project_root = Path::new(&project.path);
    let full_path = resolve_project_path(project_root, Some(&file_path))?;

    // Detect file type
    let file_type = detect_file_type(&full_path);
    let mime_type = get_mime_type(&full_path);

    // Get file size
    let metadata = tokio::fs::metadata(&full_path)
        .await
        .map_err(|e| format!("Failed to read file metadata: {}", e))?;

    if metadata.is_dir() {
        return Err("Path is a directory, not a file".to_string());
    }

    let size = metadata.len();

    // Read content based on type
    let content = match file_type {
        "text" => {
            // Check size limit (1MB)
            const MAX_SIZE: u64 = 1_048_576;
            if size > MAX_SIZE {
                return Err(format!("File too large (max 1MB): {} bytes", size));
            }

            let bytes = tokio::fs::read(&full_path)
                .await
                .map_err(|e| format!("Failed to read file: {}", e))?;

            String::from_utf8(bytes).map_err(|e| format!("File is not valid UTF-8: {}", e))?
        }
        "image" => {
            let bytes = tokio::fs::read(&full_path)
                .await
                .map_err(|e| format!("Failed to read file: {}", e))?;

            use base64::Engine;
            base64::engine::general_purpose::STANDARD.encode(&bytes)
        }
        "binary" => {
            // Return empty content for binary files
            String::new()
        }
        _ => return Err(format!("Unknown file type: {}", file_type)),
    };

    Ok(FileContent {
        r#type: file_type.to_string(),
        content,
        mime_type,
        size,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, to_value};
    use std::fs;

    #[test]
    fn test_resolve_project_path_valid() {
        let temp = tempfile::tempdir().expect("Failed to create temp dir");
        let root = temp.path();
        let sub = root.join("subdir");
        fs::create_dir_all(&sub).expect("Failed to create subdir");

        let result = resolve_project_path(root, Some("subdir"));
        assert!(result.is_ok());
        let resolved = result.unwrap();
        let canonical_root = std::fs::canonicalize(root).expect("Failed to canonicalize root");
        assert!(
            resolved.starts_with(&canonical_root),
            "resolved path should be within root"
        );
    }

    #[test]
    fn test_resolve_project_path_traversal_rejected() {
        let temp = tempfile::tempdir().expect("Failed to create temp dir");
        let root = temp.path();

        let result = resolve_project_path(root, Some("../../../etc/passwd"));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("Path traversal") || err.contains("Failed to canonicalize"));
    }

    #[test]
    fn test_resolve_project_path_none_uses_root() {
        let temp = tempfile::tempdir().expect("Failed to create temp dir");
        let root = temp.path();

        let result = resolve_project_path(root, None);
        assert!(result.is_ok());
        let resolved = result.unwrap();
        assert_eq!(
            std::fs::canonicalize(root).unwrap(),
            resolved,
            "Should resolve to project root"
        );
    }

    #[test]
    fn test_resolve_project_path_empty_string_uses_root() {
        let temp = tempfile::tempdir().expect("Failed to create temp dir");
        let root = temp.path();

        let result = resolve_project_path(root, Some(""));
        assert!(result.is_ok());
        let resolved = result.unwrap();
        assert_eq!(
            std::fs::canonicalize(root).unwrap(),
            resolved,
            "Empty string should resolve to project root"
        );
    }

    #[test]
    fn test_detect_file_type_text() {
        assert_eq!(detect_file_type(Path::new("file.ts")), "text");
        assert_eq!(detect_file_type(Path::new("file.tsx")), "text");
        assert_eq!(detect_file_type(Path::new("file.js")), "text");
        assert_eq!(detect_file_type(Path::new("file.json")), "text");
        assert_eq!(detect_file_type(Path::new("file.md")), "text");
        assert_eq!(detect_file_type(Path::new("file.txt")), "text");
    }

    #[test]
    fn test_detect_file_type_image() {
        assert_eq!(detect_file_type(Path::new("file.png")), "image");
        assert_eq!(detect_file_type(Path::new("file.jpg")), "image");
        assert_eq!(detect_file_type(Path::new("file.jpeg")), "image");
        assert_eq!(detect_file_type(Path::new("file.gif")), "image");
        assert_eq!(detect_file_type(Path::new("file.svg")), "image");
    }

    #[test]
    fn test_detect_file_type_binary() {
        assert_eq!(detect_file_type(Path::new("file.exe")), "binary");
        assert_eq!(detect_file_type(Path::new("file.zip")), "binary");
        assert_eq!(detect_file_type(Path::new("file.pdf")), "binary");
        assert_eq!(detect_file_type(Path::new("unknown")), "binary");
    }

    #[test]
    fn test_get_mime_type_text() {
        assert_eq!(
            get_mime_type(Path::new("file.ts")),
            Some("text/typescript".to_string())
        );
        assert_eq!(
            get_mime_type(Path::new("file.json")),
            Some("application/json".to_string())
        );
        assert_eq!(
            get_mime_type(Path::new("file.md")),
            Some("text/markdown".to_string())
        );
    }

    #[test]
    fn test_get_mime_type_image() {
        assert_eq!(
            get_mime_type(Path::new("file.png")),
            Some("image/png".to_string())
        );
        assert_eq!(
            get_mime_type(Path::new("file.jpg")),
            Some("image/jpeg".to_string())
        );
    }

    #[test]
    fn test_get_mime_type_unknown() {
        assert_eq!(get_mime_type(Path::new("file.unknown")), None);
    }

    #[test]
    fn test_file_entry_serializes_with_camel_case_fields() {
        let entry = FileEntry {
            name: "src".to_string(),
            path: "src".to_string(),
            is_dir: true,
            size: None,
            modified_at: Some(123),
        };

        let value = to_value(entry).expect("serialize file entry");

        assert_eq!(
            value,
            json!({
                "name": "src",
                "path": "src",
                "isDir": true,
                "size": null,
                "modifiedAt": 123
            })
        );
    }

    #[test]
    fn test_file_content_serializes_with_camel_case_fields() {
        let content = FileContent {
            r#type: "image".to_string(),
            content: "abc123".to_string(),
            mime_type: Some("image/png".to_string()),
            size: 42,
        };

        let value = to_value(content).expect("serialize file content");

        assert_eq!(
            value,
            json!({
                "type": "image",
                "content": "abc123",
                "mimeType": "image/png",
                "size": 42
            })
        );
    }

    // Integration tests: test the full command logic path with real temp directories

    #[test]
    fn test_dir_listing_with_files_dirs_and_hidden_entries() {
        let temp = tempfile::tempdir().expect("Failed to create temp dir");
        let root = temp.path();

        fs::create_dir_all(root.join(".cache")).expect("Failed to create hidden dir");
        fs::create_dir_all(root.join("src")).expect("Failed to create src dir");
        fs::write(root.join("README.md"), "hello").expect("Failed to write README");
        fs::write(root.join(".env"), "secret").expect("Failed to write hidden");

        let resolved = resolve_project_path(root, None).expect("Failed to resolve root");

        let mut entries: Vec<FileEntry> = fs::read_dir(&resolved)
            .expect("Failed to read dir")
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let metadata = e.metadata().ok()?;
                let name = e.file_name().to_string_lossy().to_string();
                let relative = e
                    .path()
                    .strip_prefix(root)
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|_| name.clone());
                Some(FileEntry {
                    name,
                    path: relative,
                    is_dir: metadata.is_dir(),
                    size: if metadata.is_file() {
                        Some(metadata.len())
                    } else {
                        None
                    },
                    modified_at: metadata.modified().ok().and_then(|t| {
                        t.duration_since(std::time::UNIX_EPOCH)
                            .ok()
                            .map(|d| d.as_millis() as u64)
                    }),
                })
            })
            .collect();

        entries.sort_by(|a, b| {
            if a.is_dir && !b.is_dir {
                return std::cmp::Ordering::Less;
            }
            if !a.is_dir && b.is_dir {
                return std::cmp::Ordering::Greater;
            }
            a.name.cmp(&b.name)
        });

        assert_eq!(entries.len(), 4);
        assert!(entries[0].is_dir);
        assert_eq!(entries[0].name, ".cache");
        assert!(entries[1].is_dir);
        assert_eq!(entries[1].name, "src");
        assert!(!entries[2].is_dir);
        assert_eq!(entries[2].name, ".env");
        assert!(!entries[3].is_dir);
        assert_eq!(entries[3].name, "README.md");
    }

    #[test]
    fn test_file_reading_text_flow() {
        let temp = tempfile::tempdir().expect("Failed to create temp dir");
        let root = temp.path();

        fs::write(root.join("test.ts"), "console.log('hello')").expect("Failed to write file");

        let file_path =
            resolve_project_path(root, Some("test.ts")).expect("Failed to resolve path");

        // Verify file type detection
        assert_eq!(detect_file_type(file_path.as_path()), "text");

        // Verify MIME type
        assert_eq!(
            get_mime_type(file_path.as_path()),
            Some("text/typescript".to_string())
        );

        // Verify content reading (simulating what fs_read_file does for text)
        let content = fs::read_to_string(&file_path).expect("Failed to read file");
        assert_eq!(content, "console.log('hello')");
    }

    #[test]
    fn test_file_reading_image_flow() {
        let temp = tempfile::tempdir().expect("Failed to create temp dir");
        let root = temp.path();

        // Create a minimal PNG-like file
        let image_data = vec![0x89, 0x50, 0x4E, 0x47]; // PNG header bytes
        fs::write(root.join("test.png"), &image_data).expect("Failed to write image");

        let file_path =
            resolve_project_path(root, Some("test.png")).expect("Failed to resolve path");

        assert_eq!(detect_file_type(file_path.as_path()), "image");
        assert_eq!(
            get_mime_type(file_path.as_path()),
            Some("image/png".to_string())
        );

        // Verify base64 encoding works (simulating what fs_read_file does for images)
        let bytes = fs::read(&file_path).expect("Failed to read image bytes");
        use base64::Engine;
        let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
        assert!(!encoded.is_empty());
        // PNG header bytes [0x89, 0x50, 0x4E, 0x47] should encode to base64
        assert_eq!(encoded, "iVBORw==");
    }

    #[test]
    fn test_file_reading_binary_flow() {
        let temp = tempfile::tempdir().expect("Failed to create temp dir");
        let root = temp.path();

        fs::write(root.join("test.exe"), vec![0u8; 1024]).expect("Failed to write binary");

        let file_path =
            resolve_project_path(root, Some("test.exe")).expect("Failed to resolve path");

        assert_eq!(detect_file_type(file_path.as_path()), "binary");

        let metadata = fs::metadata(&file_path).expect("Failed to get metadata");
        assert_eq!(metadata.len(), 1024);
    }

    #[test]
    fn test_empty_directory_listing() {
        let temp = tempfile::tempdir().expect("Failed to create temp dir");
        let root = temp.path();

        let resolved = resolve_project_path(root, None).expect("Failed to resolve root");

        let entries: Vec<_> = fs::read_dir(&resolved)
            .expect("Failed to read dir")
            .filter_map(|e| e.ok())
            .collect();

        assert!(entries.is_empty());
    }

    #[test]
    fn test_nested_dir_resolution() {
        let temp = tempfile::tempdir().expect("Failed to create temp dir");
        let root = temp.path();

        fs::create_dir_all(root.join("src").join("lib")).expect("Failed to create nested dirs");

        // Resolve nested path
        let resolved =
            resolve_project_path(root, Some("src/lib")).expect("Failed to resolve nested path");

        let canonical_root = std::fs::canonicalize(root).expect("Failed to canonicalize root");
        assert!(resolved.starts_with(&canonical_root));
        // Verify it resolves to the nested directory
        assert!(resolved.ends_with("src/lib"));
    }
}
