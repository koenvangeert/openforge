# Learnings

## 2026-02-25T10:37:21Z Session Start
- Both cargo build and pnpm build pass on clean baseline
- DB uses rusqlite_migration crate with M::up() pattern (post-rebase)
- 41 existing cargo warnings (all pre-existing, not from our changes)

## Task 2: check_claude_installed Command (2026-02-25T11:39:00Z)

### Implementation Summary
- Added `ClaudeInstallStatus` struct in `src-tauri/src/commands/config.rs` with fields: `installed`, `path`, `version`, `authenticated`
- Implemented `check_claude_installed()` Tauri command following exact pattern of `check_opencode_installed()`
- Added three subprocess checks:
  1. `which claude` - checks if CLI is installed
  2. `claude --version` - gets version string
  3. `claude auth status` - checks authentication (exit code 0 = authenticated)
- Registered command in `src-tauri/src/main.rs` generate_handler! macro
- Added `checkClaudeInstalled()` IPC wrapper in `src/lib/ipc.ts`

### Pre-existing Issues Fixed
- Fixed duplicate closing bracket in `src-tauri/src/db/mod.rs` line 326 (syntax error)
- Fixed missing `provider` and `claude_session_id` fields in three `AgentSessionRow` struct initializers in `src-tauri/src/db/agents.rs`
- Fixed missing `provider` parameter in two `create_agent_session()` calls in `src-tauri/src/commands/orchestration.rs`

### Build Status
- ✅ `cargo build` passes (src-tauri/)
- ✅ `pnpm build` passes (frontend)
- All 41 cargo warnings are pre-existing (not from this task)

### Pattern Notes
- `check_claude_installed` mirrors `check_opencode_installed` exactly, with addition of `authenticated` field
- Authentication check uses `claude auth status` exit code (0 = authenticated, non-zero = not authenticated)
- All subprocess errors are gracefully handled with `unwrap_or(false)` for auth check

## 2026-02-25 Task 3: claude_process_manager.rs created

### Module structure
- Followed `server_manager.rs` pattern exactly: error enum, ManagedProcess struct, Manager struct with Arc<Mutex<HashMap>>
- `ClaudeProcessError` has `SpawnFailed`, `AlreadyRunning`, `ProcessNotFound`, `IoError(io::Error)` variants
- `ManagedClaudeProcess` tracks child process, pid, worktree_path, task_id
- `pid_dir_override` field used for test isolation (same as ServerManager)

### Key implementation details
- `get_user_environment()` is a private fn in `pty_manager.rs` — NOT pub, so we replicated it locally in the new module
- Claude CLI args order for new run: `-p`, prompt, `--output-format`, `stream-json`, `--verbose`, `--permission-mode`, `acceptEdits`
- Claude CLI args order for resume: `--resume`, session_id, `-p`, prompt, `--output-format`, `stream-json`, `--verbose`, `--permission-mode`, `acceptEdits`
- CRITICAL: Use `.current_dir()` NOT `--cwd` (that flag does not exist in Claude CLI)
- CRITICAL: `--verbose` is required — without it only `system.init` and `result` events are emitted
- PID files: `~/.ai-command-center/pids/{task_id}-claude.pid` (includes `-claude` suffix to distinguish from opencode pid files)
- `cleanup_stale_pids` only processes files ending in `-claude.pid` — ignores opencode `.pid` files

### cargo build result
- Build passes with 47 warnings (all pre-existing or expected "never used" for module not yet wired to state)
- No errors

## 2026-02-25T11:00:00Z Wave 1 Task 1 - V2 Migration Complete

### Migration Pattern (rusqlite_migration)
- V2 migration uses `M::up_with_hook()` pattern (like V1)
- Hook checks if tables exist before executing ALTER TABLE (handles bootstrap case)
- Config table check prevents errors on existing databases with only tasks table
- All 223 tests pass after implementation

### AgentSessionRow Schema Changes
- Added `provider: String` field (stores "opencode" or "claude-code")
- Added `claude_session_id: Option<String>` field (stores Claude session ID when using Claude provider)
- All 4 SELECT queries updated: get_agent_session, get_latest_session_for_ticket, get_latest_sessions_for_tickets, and the dynamic SQL in get_latest_sessions_for_tickets

### Method Updates
- `create_agent_session` now requires `provider: &str` parameter (6 args total)
- New method `set_agent_session_claude_id` follows exact pattern of `set_agent_session_opencode_id`
- Updated all test calls in agents.rs, projects.rs, and tasks.rs to pass "opencode" as provider

### Test Coverage
- New test `test_agent_session_with_claude_provider` validates:
  - Creating session with "claude-code" provider
  - Setting claude_session_id via new method
  - Retrieving and verifying both fields
- All existing tests updated to pass provider parameter
- Database initialization test updated: config_count 15→16, user_version 1→2

### Key Learnings
- SQLite doesn't support `ALTER TABLE IF EXISTS` - must check table existence in hook
- Bootstrap test creates minimal schema (only tasks table) - migration must handle gracefully
- Config table may not exist in bootstrap scenario - check before INSERT
- Using `.ok()` on execute() calls in hook allows graceful handling of missing tables

## 2026-02-25T11:52:00Z Task 4: Frontend Types Update

### Implementation Summary
- Updated `AgentSession` interface in `src/lib/types.ts` to add two new fields:
  - `provider: string` (stores "opencode" or "claude-code")
  - `claude_session_id: string | null` (stores Claude session ID when using Claude provider)
- Added new `ClaudeInstallStatus` interface with fields: `installed`, `path`, `version`, `authenticated`
- Verified `checkClaudeInstalled()` IPC wrapper already exists in `src/lib/ipc.ts` (lines 123-125) ✓

### Build & Test Results
- ✅ `pnpm build` passes (TypeScript compilation successful)
- ✅ `pnpm test` shows same 6 pre-existing failures (TaskDetailView.test.ts, PrReviewView.test.ts)
- No new errors or regressions introduced

### Key Pattern Notes
- `AgentSession` interface now maps 1:1 to Rust `AgentSessionRow` struct (both have provider + claude_session_id)
- New fields are additive and nullable — no breaking changes to existing code
- `ClaudeInstallStatus` mirrors structure of OpenCode status check response
- Frontend types are now ready for Claude Code integration tasks

## 2026-02-25T12:00:00Z Task 5: Query Methods for Agent Sessions

### Implementation Summary
- Added `get_sessions_by_provider(provider: &str)` method to `src-tauri/src/db/agents.rs`
  - Filters agent_sessions by provider field
  - Returns Vec<AgentSessionRow> ordered by created_at DESC
  - Handles empty results gracefully (returns empty Vec)
  
- Added `get_running_claude_sessions()` method to `src-tauri/src/db/agents.rs`
  - Filters for provider='claude-code' AND status='running'
  - Returns Vec<AgentSessionRow> ordered by created_at DESC
  - Specialized query for Claude-specific workflow

### Query Pattern
- Both methods follow exact pattern from `get_agent_session` (lines 91-115)
- Use `conn.prepare()` with parameterized queries
- Map rusqlite rows to AgentSessionRow struct with all 11 fields
- Collect results into Vec before returning

### Test Coverage
- `test_get_sessions_by_provider`: Creates 3 sessions (2 opencode, 1 claude-code), verifies filtering by provider
  - Tests filtering for "opencode" (2 results)
  - Tests filtering for "claude-code" (1 result)
  - Tests filtering for nonexistent provider (0 results)
  
- `test_get_running_claude_sessions`: Creates 3 sessions (1 running claude, 1 completed claude, 1 running opencode)
  - Verifies only running claude-code session is returned
  - Validates all fields (id, provider, status)

### Build & Test Results
- ✅ Both new tests pass
- ✅ All 225 Rust tests pass (no regressions)
- ✅ No new compiler warnings introduced

### Key Learnings
- Query methods are simple filters — no complex joins needed
- Provider field enables multi-agent support (opencode vs claude-code)
- Running sessions query is critical for lifecycle management (resume, interrupt)

## Task 4 — ClaudeBridgeManager (claude_bridge.rs)

### Inline app.state() in async tasks causes lifetime errors
Inside `tokio::spawn(async move { ... })`, calling `app.state::<Mutex<T>>()` inline within
a deeply nested match arm causes `E0597` ("does not live long enough"). The fix: extract DB
access into plain `fn` helper functions (not `async fn`) that take `&AppHandle`. The helper
pattern used by `sse_bridge.rs` for `persist_session_completed` is the correct pattern.

### Claude NDJSON event format
- `{"type":"system","subtype":"init","session_id":"<claude_id>",...}` — first event, captures session ID
- `{"type":"result","subtype":"success",...}` — completion
- `{"type":"result","subtype":"error_*",...}` — various error subtypes all start with "error"
- `{"type":"assistant",...}` and `{"type":"tool_use",...}`, `{"type":"tool_result",...}` — stream events
- EOF without result event → status "interrupted"

### Status mapping for Claude bridge
| Claude event | App session status | Tauri event |
|---|---|---|
| system.init | (unchanged) | agent-event (system.init) |
| assistant/tool_use/tool_result | running | agent-event |
| result.success | completed | action-complete |
| result.error_* | failed | implementation-failed |
| EOF without result | interrupted | (none) |

### tokio::select! with oneshot in a loop
Use `_ = &mut cancel_rx` (mutable borrow) in `tokio::select!` inside a loop — this works
correctly: once the channel fires, the arm triggers and `break` exits the loop cleanly.

### BridgeHandle cleanup pattern
The bridge HashMap entry is removed by the spawned task itself after the loop exits
(both on EOF and on cancel). This mirrors the SSE bridge pattern.

## orchestration.rs Claude Code branching (Task: add provider branching)

### Pattern Used
- Read provider at function start: `db_lock.get_config("ai_provider").ok().flatten().unwrap_or_else(|| "opencode".to_string())`
- In `abort_task_agent`: read provider from latest session's `provider` field instead of global config (session already has it stored)
- Plain if/else branching — NO trait/interface pattern
- For `start_implementation`: worktree creation is SHARED before the if/else; both providers use same git worktree setup
- For `run_action` Claude resume: get `worktree_path` from `db.get_worktree_for_task(&task_id)` (returns `WorktreeRow` with `worktree_path: String`)
- For `run_action` Claude new start: check `existing_worktree.is_none()` before creating worktree (reuse if exists)
- `spawn_claude` / `spawn_claude_resume` return `Result<(u32, tokio::process::ChildStdout), ClaudeProcessError>` — destructure as `let (_, stdout) = ...`
- `start_bridge(app, task_id, stdout)` — takes `tokio::process::ChildStdout` directly (NOT `Option<>` like SSE bridge)
- Session `provider` field on `AgentSessionRow` enables branching in abort

### State params pattern
- Adding `State<'_, ClaudeProcessManager>` and `State<'_, ClaudeBridgeManager>` to command signatures compiles fine even when those states are NOT yet managed in main.rs (Tauri resolves state at runtime, not compile time)
- For `abort_task_agent` helper: adds `claude_process_mgr: &State<'_, ClaudeProcessManager>` and `claude_bridge_mgr: &State<'_, ClaudeBridgeManager>` params; caller passes `&claude_process_mgr` and `&claude_bridge_mgr`

### Key differences from SSE bridge API
- SSE bridge: `sse_mgr.start_bridge(app, task_id, Some(session_id), port)` — takes `Option<String>` and port
- Claude bridge: `claude_bridge_mgr.start_bridge(app, task_id, stdout)` — takes `ChildStdout` directly
- SSE bridge: `sse_mgr.stop_bridge(task_id).await` 
- Claude bridge: `claude_bridge_mgr.stop_bridge(task_id).await` (same pattern)

## spawn_claude_pty PTY method (Task: Add Claude PTY support)

### Pattern: Cloning spawn_pty for interactive TUI process

When adding a new PTY spawn method for a different process (claude vs opencode):
- **Import**: Change `use std::path::PathBuf;` → `use std::path::{Path, PathBuf};` so method can accept `&Path`
- **Command args**: `CommandBuilder::new("claude")` + `.arg("--resume")` + `.arg(session_id)` — NO stream-json flags for TUI mode
- **CWD**: Use `cmd.cwd(worktree_path)` on `CommandBuilder` (NOT `.current_dir()` which is tokio's API)
- **PID file suffix**: Use distinct suffix (`-claude-pty.pid`) to avoid collision with opencode (`-pty.pid`) and claude process (`-claude.pid`)
- **Cleanup of old sessions**: Match the PID file suffix in the replace-guard at method start

### Tauri command pattern for Path params
The command takes `worktree_path: String` and converts inside: `std::path::Path::new(&worktree_path)` — no need to import Path in commands/pty.rs, just use the full path.

### IPC wrapper convention
`spawnClaudePty(taskId, worktreePath, claudeSessionId, cols, rows)` — camelCase params map directly to snake_case Tauri command params via Tauri's auto-conversion.

### generate_handler! insertion point
PTY commands are at lines ~262-265 in main.rs. New commands go after `commands::pty::pty_spawn`.

## Claude Manager State Registration (Completed)

### Task Summary
Registered `ClaudeProcessManager` and `ClaudeBridgeManager` as Tauri managed state in `src-tauri/src/main.rs` with startup PID cleanup and shutdown handler cleanup.

### Implementation Details

**State Registration (lines 170-171, 180-181):**
- Created instances in `.setup()` closure after whisper_manager
- Registered with `app.manage()` after existing managers
- Both managers now accessible via `app_handle.state::<T>()` in commands and shutdown handler

**Startup PID Cleanup (lines 191-193):**
- Added `claude_process_manager::ClaudeProcessManager::new().cleanup_stale_pids()` call
- Follows same pattern as server and PTY manager cleanup
- Only processes files ending in `-claude.pid`, ignoring opencode `.pid` files

**Shutdown Handler (lines 308-309, 319-323):**
- Retrieved state handles in `RunEvent::Exit` handler
- Added Claude cleanup AFTER SSE bridge stop, BEFORE OpenCode server stop
- Shutdown order: PTY → SSE → Claude Bridge → Claude Processes → OpenCode Servers
- Used `let _ = ...` pattern to suppress unused Result warning

### Build & Test Results
- ✅ `cargo build` compiles cleanly (45 warnings, all pre-existing)
- ✅ `cargo test` passes all 232 tests with 0 failures
- ✅ No new warnings introduced

### Key Patterns Observed
1. **State Registration Pattern**: Create instance → `app.manage(instance)` → access via `app_handle.state::<T>()`
2. **Startup Cleanup Pattern**: Call `Manager::new().cleanup_stale_pids()` after state registration
3. **Shutdown Pattern**: Get state handles → `block_on(async { ... })` → call async cleanup methods
4. **Error Handling**: Use `let _ = ...` for non-critical async operations in shutdown


## GlobalSettingsPanel AI Provider Section (Task: add AI provider dropdown)

- Added `checkOpenCodeInstalled` and `checkClaudeInstalled` imports to `GlobalSettingsPanel.svelte`
- Both install-check calls are wrapped in separate try/catch blocks (silent failure pattern)
- `ai_provider` defaults to `'opencode'` when `getConfig` returns null
- Install status checks happen in `loadConfig()` after the main config loads
- Test mock (`GlobalSettingsPanel.test.ts`) must include `checkOpenCodeInstalled` and `checkClaudeInstalled` mocks even though they're wrapped in try/catch — their absence from the vi.mock() factory doesn't cause a hard failure (caught silently), but adding them keeps the mock complete
- `setConfig` call count in the save test increased from 4 to 5 (added `ai_provider`)
- daisyUI `badge-xs badge-success` / `badge-xs badge-warning` work for auth status indicators
- `alert alert-warning text-xs py-2` works for the "not installed" warning
- `import type { ClaudeInstallStatus }` is NOT needed in the component — inline type inference from `checkClaudeInstalled()` return value is sufficient; importing unused types fails with `noUnusedLocals`
