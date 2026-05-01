//! Unified Diff Parser
//!
//! Parses unified diff output (from `git diff`) into per-file structs.
//! Handles multi-file diffs, added/modified/deleted/renamed/binary files.

use serde::Serialize;

/// Represents a single file's changes in a unified diff
#[derive(Debug, Clone, Serialize)]
pub struct TaskFileDiff {
    pub sha: String,
    pub filename: String,
    pub status: String,
    pub additions: i32,
    pub deletions: i32,
    pub changes: i32,
    pub patch: Option<String>,
    pub previous_filename: Option<String>,
    /// Whether the patch was truncated due to exceeding 10,000 lines
    pub is_truncated: bool,
    /// Total number of patch lines before truncation (None if not truncated)
    pub patch_line_count: Option<i32>,
}

/// Parse unified diff output into per-file structs.
/// When `truncate` is true, patches exceeding 10,000 lines are truncated to 200 lines.
pub fn parse_unified_diff(diff_output: &str, truncate: bool) -> Vec<TaskFileDiff> {
    if diff_output.trim().is_empty() {
        return Vec::new();
    }

    let mut diffs = Vec::new();
    let mut current_file: Option<TaskFileDiff> = None;
    let mut patch_lines = Vec::new();
    let mut in_patch = false;

    for line in diff_output.lines() {
        // Start of a new file diff
        if line.starts_with("diff --git a/") {
            // Save previous file if exists
            finalize_current_file(&mut current_file, &mut patch_lines, truncate, &mut diffs);

            // Parse new file header: "diff --git a/path b/path"
            let filename = extract_filename_from_diff_header(line);
            current_file = Some(TaskFileDiff {
                sha: String::new(),
                filename,
                status: "modified".to_string(),
                additions: 0,
                deletions: 0,
                changes: 0,
                patch: None,
                previous_filename: None,
                is_truncated: false,
                patch_line_count: None,
            });
            in_patch = false;
        } else if let Some(ref mut file) = current_file {
            // Parse file mode changes
            if line.starts_with("new file mode") {
                file.status = "added".to_string();
            } else if line.starts_with("deleted file mode") {
                file.status = "removed".to_string();
            } else if line.starts_with("rename from ") {
                file.previous_filename =
                    Some(line.strip_prefix("rename from ").unwrap_or("").to_string());
            } else if line.starts_with("rename to ") {
                file.status = "renamed".to_string();
            } else if line.starts_with("Binary files") {
                if file.status == "modified" {
                    file.status = "binary".to_string();
                }
                file.patch = None;
                in_patch = false;
            } else if line.starts_with("@@") {
                // Start of hunk
                in_patch = true;
                patch_lines.push(line.to_string());
            } else if in_patch {
                // Collect patch lines
                if line.starts_with('+') && !line.starts_with("+++") {
                    file.additions += 1;
                    patch_lines.push(line.to_string());
                } else if line.starts_with('-') && !line.starts_with("---") {
                    file.deletions += 1;
                    patch_lines.push(line.to_string());
                } else if line.starts_with(' ') || line.starts_with('\\') {
                    // Context line or "\ No newline at end of file"
                    patch_lines.push(line.to_string());
                } else {
                    // Other lines in patch (shouldn't happen in well-formed diff)
                    patch_lines.push(line.to_string());
                }
            }
        }
    }

    // Save last file
    finalize_current_file(&mut current_file, &mut patch_lines, truncate, &mut diffs);

    // Calculate changes for all files
    for file in &mut diffs {
        file.changes = file.additions + file.deletions;
    }

    diffs
}

fn finalize_current_file(
    current_file: &mut Option<TaskFileDiff>,
    patch_lines: &mut Vec<String>,
    truncate: bool,
    diffs: &mut Vec<TaskFileDiff>,
) {
    if let Some(mut file) = current_file.take() {
        if !patch_lines.is_empty() && file.status != "binary" {
            if truncate && patch_lines.len() > 10_000 {
                file.patch_line_count = Some(patch_lines.len() as i32);
                file.patch = Some(patch_lines[..201].join("\n"));
                file.is_truncated = true;
            } else {
                file.patch = Some(patch_lines.join("\n"));
            }
        }
        diffs.push(file);
        patch_lines.clear();
    }
}

/// Extract filename from "diff --git a/path b/path" line
fn extract_filename_from_diff_header(line: &str) -> String {
    // Format: "diff --git a/path b/path"
    // We want the path after "b/"
    if let Some(b_start) = line.rfind(" b/") {
        line[b_start + 3..].to_string()
    } else {
        String::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_input() {
        let result = parse_unified_diff("", true);
        assert_eq!(result.len(), 0);

        let result = parse_unified_diff("   \n  \n  ", true);
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn test_single_file_modified() {
        let diff = r#"diff --git a/src/main.rs b/src/main.rs
index 1234567..abcdefg 100644
--- a/src/main.rs
+++ b/src/main.rs
@@ -1,3 +1,4 @@
 fn main() {
+    info!("hello");
     info!("world");
 }"#;

        let result = parse_unified_diff(diff, true);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].filename, "src/main.rs");
        assert_eq!(result[0].status, "modified");
        assert_eq!(result[0].additions, 1);
        assert_eq!(result[0].deletions, 0);
        assert_eq!(result[0].changes, 1);
        assert!(result[0].patch.is_some());
    }

    #[test]
    fn test_file_added() {
        let diff = r#"diff --git a/src/new.rs b/src/new.rs
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/src/new.rs
@@ -0,0 +1,2 @@
+fn foo() {
+}
"#;

        let result = parse_unified_diff(diff, true);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].filename, "src/new.rs");
        assert_eq!(result[0].status, "added");
        assert_eq!(result[0].additions, 2);
        assert_eq!(result[0].deletions, 0);
    }

    #[test]
    fn test_file_deleted() {
        let diff = r#"diff --git a/src/old.rs b/src/old.rs
deleted file mode 100644
index 1234567..0000000
--- a/src/old.rs
+++ /dev/null
@@ -1,2 +0,0 @@
-fn foo() {
-}
"#;

        let result = parse_unified_diff(diff, true);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].filename, "src/old.rs");
        assert_eq!(result[0].status, "removed");
        assert_eq!(result[0].additions, 0);
        assert_eq!(result[0].deletions, 2);
    }

    #[test]
    fn test_file_renamed() {
        let diff = r#"diff --git a/src/old_name.rs b/src/new_name.rs
similarity index 100%
rename from src/old_name.rs
rename to src/new_name.rs
"#;

        let result = parse_unified_diff(diff, true);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].filename, "src/new_name.rs");
        assert_eq!(result[0].status, "renamed");
        assert_eq!(
            result[0].previous_filename,
            Some("src/old_name.rs".to_string())
        );
        assert_eq!(result[0].additions, 0);
        assert_eq!(result[0].deletions, 0);
    }

    #[test]
    fn test_binary_file() {
        let diff = r#"diff --git a/image.png b/image.png
index 1234567..abcdefg 100644
Binary files a/image.png and b/image.png differ
"#;

        let result = parse_unified_diff(diff, true);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].filename, "image.png");
        assert_eq!(result[0].status, "binary");
        assert_eq!(result[0].patch, None);
    }

    #[test]
    fn test_added_binary_file_preserves_added_status() {
        let diff = r#"diff --git a/image.png b/image.png
new file mode 100644
index 0000000..abcdefg
Binary files /dev/null and b/image.png differ
"#;

        let result = parse_unified_diff(diff, true);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].filename, "image.png");
        assert_eq!(result[0].status, "added");
        assert_eq!(result[0].patch, None);
    }

    #[test]
    fn test_removed_binary_file_preserves_removed_status() {
        let diff = r#"diff --git a/image.png b/image.png
deleted file mode 100644
index 1234567..0000000
Binary files a/image.png and /dev/null differ
"#;

        let result = parse_unified_diff(diff, true);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].filename, "image.png");
        assert_eq!(result[0].status, "removed");
        assert_eq!(result[0].patch, None);
    }

    #[test]
    fn test_multi_file_diff() {
        let diff = r#"diff --git a/file1.rs b/file1.rs
index 1234567..abcdefg 100644
--- a/file1.rs
+++ b/file1.rs
@@ -1 +1,2 @@
 line1
+line2
diff --git a/file2.rs b/file2.rs
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/file2.rs
@@ -0,0 +1 @@
+new content
"#;

        let result = parse_unified_diff(diff, true);
        assert_eq!(result.len(), 2);

        assert_eq!(result[0].filename, "file1.rs");
        assert_eq!(result[0].status, "modified");
        assert_eq!(result[0].additions, 1);
        assert_eq!(result[0].deletions, 0);

        assert_eq!(result[1].filename, "file2.rs");
        assert_eq!(result[1].status, "added");
        assert_eq!(result[1].additions, 1);
        assert_eq!(result[1].deletions, 0);
    }

    #[test]
    fn test_patch_content_preserved() {
        let diff = r#"diff --git a/test.rs b/test.rs
index 1234567..abcdefg 100644
--- a/test.rs
+++ b/test.rs
@@ -1,3 +1,4 @@
 line1
+added
 line2
 line3
"#;

        let result = parse_unified_diff(diff, true);
        assert_eq!(result.len(), 1);
        let patch = result[0].patch.as_ref().unwrap();
        assert!(patch.contains("@@ -1,3 +1,4 @@"));
        assert!(patch.contains("+added"));
        assert!(patch.contains(" line1"));
    }

    #[test]
    fn test_finalize_current_file_assigns_truncated_patch_before_push() {
        let mut current_file = Some(TaskFileDiff {
            sha: String::new(),
            filename: "big.rs".to_string(),
            status: "modified".to_string(),
            additions: 0,
            deletions: 0,
            changes: 0,
            patch: None,
            previous_filename: None,
            is_truncated: false,
            patch_line_count: None,
        });
        let mut patch_lines = vec!["@@ -0,0 +1,10001 @@".to_string()];
        patch_lines.extend((0..10001).map(|i| format!("+line {i}")));
        let mut diffs = Vec::new();

        finalize_current_file(&mut current_file, &mut patch_lines, true, &mut diffs);

        assert!(current_file.is_none());
        assert!(patch_lines.is_empty());
        assert_eq!(diffs.len(), 1);
        assert_eq!(diffs[0].filename, "big.rs");
        assert!(diffs[0].is_truncated);
        assert_eq!(diffs[0].patch_line_count, Some(10002));
        let patch = diffs[0].patch.as_ref().unwrap();
        assert_eq!(patch.lines().count(), 201);
    }

    #[test]
    fn test_truncation_large_patch() {
        let mut diff = String::from("diff --git a/big.rs b/big.rs\nindex 1234567..abcdefg 100644\n--- a/big.rs\n+++ b/big.rs\n@@ -0,0 +1,10001 @@\n");
        for i in 0..10001 {
            diff.push_str(&format!("+line {}\n", i));
        }

        let result = parse_unified_diff(&diff, true);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].filename, "big.rs");
        assert!(result[0].is_truncated);
        assert_eq!(result[0].patch_line_count, Some(10002)); // 10001 lines + 1 @@ header

        let patch = result[0].patch.as_ref().unwrap();
        let patch_line_count = patch.lines().count();
        assert_eq!(patch_line_count, 201); // 200 lines + 1 @@ header
    }

    #[test]
    fn test_no_truncation_small_patch() {
        let mut diff = String::from("diff --git a/small.rs b/small.rs\nindex 1234567..abcdefg 100644\n--- a/small.rs\n+++ b/small.rs\n@@ -0,0 +1,100 @@\n");
        for i in 0..100 {
            diff.push_str(&format!("+line {}\n", i));
        }

        let result = parse_unified_diff(&diff, true);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].filename, "small.rs");
        assert!(!result[0].is_truncated);
        assert_eq!(result[0].patch_line_count, None);

        let patch = result[0].patch.as_ref().unwrap();
        let patch_line_count = patch.lines().count();
        assert_eq!(patch_line_count, 101); // 100 lines + 1 @@ header
    }

    #[test]
    fn test_truncation_boundary() {
        let mut diff = String::from("diff --git a/boundary.rs b/boundary.rs\nindex 1234567..abcdefg 100644\n--- a/boundary.rs\n+++ b/boundary.rs\n@@ -0,0 +1,9999 @@\n");
        for i in 0..9999 {
            diff.push_str(&format!("+line {}\n", i));
        }

        let result = parse_unified_diff(&diff, true);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].filename, "boundary.rs");
        assert!(!result[0].is_truncated);
        assert_eq!(result[0].patch_line_count, None);

        let patch = result[0].patch.as_ref().unwrap();
        let patch_line_count = patch.lines().count();
        assert_eq!(patch_line_count, 10000); // 9999 lines + 1 @@ header
    }

    #[test]
    fn test_truncation_binary_not_affected() {
        let diff = r#"diff --git a/image.png b/image.png
index 1234567..abcdefg 100644
Binary files a/image.png and b/image.png differ
"#;

        let result = parse_unified_diff(diff, true);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].filename, "image.png");
        assert_eq!(result[0].status, "binary");
        assert_eq!(result[0].patch, None);
        assert!(!result[0].is_truncated);
        assert_eq!(result[0].patch_line_count, None);
    }

    #[test]
    fn test_multi_file_mixed_truncation() {
        let mut diff = String::from("diff --git a/small.rs b/small.rs\nindex 1234567..abcdefg 100644\n--- a/small.rs\n+++ b/small.rs\n@@ -0,0 +1,10 @@\n");
        for i in 0..10 {
            diff.push_str(&format!("+line {}\n", i));
        }

        diff.push_str("diff --git a/big.rs b/big.rs\nindex 1234567..abcdefg 100644\n--- a/big.rs\n+++ b/big.rs\n@@ -0,0 +1,10001 @@\n");
        for i in 0..10001 {
            diff.push_str(&format!("+line {}\n", i));
        }

        let result = parse_unified_diff(&diff, true);
        assert_eq!(result.len(), 2);

        // First file: small, not truncated
        assert_eq!(result[0].filename, "small.rs");
        assert!(!result[0].is_truncated);
        assert_eq!(result[0].patch_line_count, None);
        let small_patch = result[0].patch.as_ref().unwrap();
        assert_eq!(small_patch.lines().count(), 11); // 10 lines + 1 @@ header

        // Second file: large, truncated
        assert_eq!(result[1].filename, "big.rs");
        assert!(result[1].is_truncated);
        assert_eq!(result[1].patch_line_count, Some(10002)); // 10001 lines + 1 @@ header
        let big_patch = result[1].patch.as_ref().unwrap();
        assert_eq!(big_patch.lines().count(), 201); // 200 lines + 1 @@ header
    }
}
