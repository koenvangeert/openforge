# Learnings — remove-subfolder-scanning

## Conventions & Patterns

(Subagents append findings here after each task)
# Task 2: Remove scan_repos Command + RepoInfo Struct - Learnings

**Timestamp:** 2026-02-18

## Summary
Successfully removed the `scan_repos` Tauri command and all related code from the Rust backend. All deletions completed cleanly with zero compilation errors.

## Key Findings

### 1. Deletion Sequence
- **RepoInfo struct** (git_worktree.rs:59-63): Removed cleanly, no other references
- **Repository Scanning section** (git_worktree.rs:87-127): Entire section including comment banner and function deleted
- **git2 import**: Not explicitly imported at top of file (was only used within deleted scan_repos function)
- **scan_repos Tauri command** (main.rs:229-235): Removed with proper spacing
- **invoke_handler entry** (main.rs:889): Removed from macro list

### 2. Critical Gotcha Avoided
The `invoke_handler![]` macro is where all Tauri commands are registered. Removing the function definition alone would have caused a compile error if the macro entry wasn't also removed. Both deletions were necessary and completed.

### 3. Build Verification
- `cargo build` succeeded with exit code 0
- 28 pre-existing warnings (unrelated to this task)
- No new errors introduced

### 4. QA Results
All four verification scenarios passed:
- ✅ QA1: `grep -c "scan_repos" src-tauri/src/main.rs` = 0
- ✅ QA2: `grep -c "RepoInfo" src-tauri/src/git_worktree.rs` = 0
- ✅ QA3: `grep -c "git2" src-tauri/src/git_worktree.rs` = 0
- ✅ QA4: `grep -c "create_worktree" src-tauri/src/git_worktree.rs` = 4 (intact)

## Patterns & Conventions Observed
1. **Section separators**: Code uses comment banners (`// ============...`) to organize logical sections
2. **Tauri command pattern**: All commands use `#[tauri::command]` attribute with `State<'_>` parameters
3. **Error handling**: Commands return `Result<T, String>` with `.map_err()` conversions
4. **Macro registration**: The `invoke_handler![]` macro must include all exported commands

## No Issues Encountered
- Clean deletion with no orphaned references
- No unused imports left behind
- Worktree operations remain fully functional
- No edge cases or gotchas

## Files Modified
- `src-tauri/src/git_worktree.rs`: Removed RepoInfo struct and scan_repos function
- `src-tauri/src/main.rs`: Removed scan_repos command and invoke_handler entry

## Scope Boundaries Respected
- ✅ Did NOT remove git2 from Cargo.toml (out of scope)
- ✅ Did NOT touch worktree operations (create_worktree, delete_worktree, etc.)
- ✅ Did NOT modify other Tauri commands
- ✅ Did NOT modify code outside git_worktree.rs and main.rs

## 2026-02-18 - Task 1: DB Migration repos_root_path → path

### Changes Made
- Added migration code in `Database::new()` (lines 264-279) to safely rename column for existing databases
- Migration pattern: Check if old column exists using `pragma_table_info`, then `ALTER TABLE ... RENAME COLUMN`
- Updated CREATE TABLE statement to use `path` instead of `repos_root_path`
- Renamed `ProjectRow.repos_root_path` to `ProjectRow.path`
- Updated all 4 CRUD methods: `create_project`, `get_all_projects`, `get_project`, `update_project`
- Changed function parameter names from `repos_root_path` to `path` for consistency

### Migration Pattern Used
```rust
let repos_root_path_exists: bool = conn.query_row(
    "SELECT COUNT(*) FROM pragma_table_info('projects') WHERE name='repos_root_path'",
    [],
    |row| {
        let count: i64 = row.get(0)?;
        Ok(count > 0)
    },
)?;

if repos_root_path_exists {
    conn.execute(
        "ALTER TABLE projects RENAME COLUMN repos_root_path TO path",
        [],
    )?;
}
```

### Verification Results
- ✅ `cargo build` succeeded (exit 0, only warnings, no errors)
- ✅ `cargo test` passed (51/51 tests passed)
- ✅ `grep -c "repos_root_path" src-tauri/src/db.rs` returns 5 (all in migration code)
- Evidence saved to `.sisyphus/evidence/task-1-*.txt`

### Key Learnings
1. SQLite column renames require `ALTER TABLE ... RENAME COLUMN` (not DROP/ADD)
2. Migration must check if column exists before renaming to support both fresh and existing databases
3. The migration code itself contains the old column name (5 occurrences), which is correct
4. All SQL statements (INSERT, SELECT, UPDATE) must be updated to use new column name
5. Struct field names must match for serde serialization to work correctly

### Notes
- Did NOT modify `main.rs` (as instructed) - that will be handled by Task 2
- Did NOT touch `worktrees.repo_path` column (different field)
- Migration is idempotent - safe to run multiple times
