
## 2026-02-26: HTTP Server Integration Tests

### JSON test data in Rust
When using raw string literals (`r#"..."#`) for JSON test data in Rust, keep the JSON on a single line. Multi-line raw strings include literal newlines which cause JSON parsing errors ("control character found").

**Bad:**
```rust
let json = r#"{
    "title": "Test",
    "description": "Details"
}"#;
```

**Good:**
```rust
let json = r#"{"title": "Test", "description": "Details"}"#;
```

### Tauri test compilation requirements
Tauri's `generate_context!()` macro requires the `frontendDist` directory to exist at compile time. Create an empty `dist/` directory when running `cargo test` in a Tauri project without a built frontend.

### Pre-existing test errors in db modules
The `create_task` method signature requires 5 arguments (title, status, jira_key, project_id, plan_text). Several test files in `db/projects.rs` and `db/tasks.rs` were calling it with only 4 arguments, missing the `plan_text` parameter. This is a pre-existing issue that needs to be fixed separately.

## Plugin Installer Implementation - Key Learnings

### Raw String Literals in Rust
- Use `r#"..."#` for embedding TypeScript/multi-line content without escaping
- Allows unmodified source code with quotes and newlines preserved
- Perfect for embedding tool implementations as constants

### Edit Tool Workflow for Rust Code
- **Key Issue**: Appending to `.setup()` closure requires careful scope management
- **Solution**: Identify closing braces carefully; use range-based replace (`end` param) to properly close match statements
- **Pattern**: When code is inside a match/if block, identify the exact closing brace and insert AFTER it
- **Lesson**: Prefer range-based edits for structural changes in nested code

### dirs Crate Usage
- `dirs::home_dir()` returns `Option<PathBuf>` - handles all platforms
- Returns `None` only if home directory cannot be determined (very rare)
- More reliable than parsing `$HOME` environment variable

### Tauri Startup Lifecycle
- `.setup()` closure runs once during app initialization
- Best location for one-time resource setup (file creation, config loading)
- Errors here are logged to stderr; app startup not blocked
- Runs BEFORE window is shown to user

### Error Propagation in Setup
- Use `?` operator with `Box<dyn std::error::Error>` for flexible error handling
- `Box<dyn std::error::Error>` works with any error type implementing `Error` trait
- Logging errors via `eprintln!` ensures visibility in console even if app continues

### Testing Patterns
- Unit tests for constants verify non-empty content and key markers
- File existence tests are difficult (require mocking `home_dir()`); skipped here
- Integration test happens naturally when app runs (plugin written to real directory)

