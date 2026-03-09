# Action Simplification & Agent Selection Redesign

## TL;DR

> **Quick Summary**: Restructure the action system so actions become simple "reusable prompt templates" (no agent selection), move agent/permission-mode selection to task creation, and make the task detail header status-driven ("Start Task" for backlog, reusable prompts for doing).
> 
> **Deliverables**:
> - DB migration V8: `agent` + `permission_mode` columns on tasks table
> - Backend: Thread `permission_mode` through `build_claude_args` → `spawn_claude_pty`
> - Backend: `run_action` reads agent/permission_mode from task record as fallback
> - Frontend: Task creation dialog with agent + permission mode selectors
> - Frontend: Status-driven task detail header
> - Frontend: Remove action buttons from kanban context menu
> - Frontend: Remove agent dropdown from Settings > Actions card
> - Frontend: Remove `agent` field from Action type
> 
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 4 waves
> **Critical Path**: Task 1 → Task 3 → Task 5 → Task 8 → Task 10 → Task 11

---

## Context

### Original Request
User wants to simplify the action system: actions should only add a prompt to the current running session. Agent selection should happen at task creation time, not per-action. Claude permission mode should also be selectable at task creation.

### Interview Summary
**Key Discussions**:
- **Start Task behavior**: "Start Task" button for backlog tasks creates worktree + starts session. Uses task's own title/prompt only (no prepended instruction).
- **Agent selection scope**: Sub-agent only (OpenCode sub-agents per task). Global `ai_provider` stays unchanged.
- **Settings > Actions**: Keep as reusable prompt templates; remove agent dropdown; remove from kanban right-click context menu.
- **Permission mode location**: Task creation dialog, provider-specific (Claude only).
- **Permission modes**: All 5 modes including `dontAsk` (with visual warning).
- **Header layout**: Status-driven: "Start Task" for backlog, reusable prompt buttons for doing.
- **Storage**: New DB columns on tasks table (`agent`, `permission_mode`).
- **Legacy fallback**: NULL → sensible defaults (default sub-agent, 'default' permission mode). No backfill.
- **Old action configs**: Silently ignore `agent` field via serde/TS defaults.
- **start_implementation**: Keep deprecated but untouched. New "Start Task" uses a new code path.

### Metis Review
**Identified Gaps** (addressed):
- `createTask` IPC wrapper missing `prompt` parameter → Already fixed: Rust `create_task` command (line 26-40 of `commands/tasks.rs`) accepts `prompt: Option<String>`, but frontend `createTask` in `ipc.ts` (line 4) does NOT pass it. Frontend `AddTaskDialog.svelte` also doesn't send it. This must be fixed as part of task creation dialog work.
- Claude CLI has 5 permission modes, not 4 → `dontAsk` will be added to `PermissionMode` type with visual warning.
- `TaskRow` struct used in 6+ SQL queries with hardcoded column lists → All SELECT statements must be updated to include new columns.
- `spawn_claude_pty` doesn't accept `permission_mode` → Threading is 4 layers deep: `build_claude_args` → `spawn_claude_pty` → `ClaudeCodeProvider::start/resume` → `run_action`.
- `start_implementation` left deprecated but functional per user decision.

---

## Work Objectives

### Core Objective
Simplify actions to be prompt-only templates and move agent/permission-mode configuration to task creation time, with a status-driven task detail header.

### Concrete Deliverables
- DB migration V8 adding `agent TEXT` and `permission_mode TEXT` columns to tasks
- Updated `TaskRow` struct and all SQL queries
- `build_claude_args` accepting and passing `--permission-mode` flag
- `spawn_claude_pty` → `ClaudeCodeProvider` → `run_action` threading permission_mode
- Updated `PermissionMode` type with all 5 modes
- Updated `Action` interface without `agent` field
- Updated `createTask` IPC call with agent + permission_mode params
- New task creation dialog with provider-conditional agent/permission_mode dropdowns
- Status-driven task detail header (Start Task vs reusable prompts)
- Removed action buttons from kanban context menu
- Removed agent dropdown from SettingsActionsCard

### Definition of Done
- [ ] `cargo test` passes in `src-tauri/`
- [ ] `pnpm test` passes
- [ ] `pnpm build` succeeds (frontend compiles)
- [ ] New tasks created with agent + permission_mode stored in DB
- [ ] Claude sessions use selected permission mode
- [ ] Existing tasks with NULL agent/permission_mode work with defaults

### Must Have
- Agent + permission_mode columns on tasks table
- Permission mode threaded to Claude CLI `--permission-mode` flag
- Status-driven header: "Start Task" for backlog, prompt buttons for doing
- Task creation dialog with conditional agent/permission_mode selectors
- `dontAsk` permission mode included with visual danger warning
- Action type simplified (no `agent` field)
- Kanban context menu: no action buttons

### Must NOT Have (Guardrails)
- MUST NOT change `run_action` backend logic beyond reading agent/permission_mode from task record
- MUST NOT remove `start_implementation` command — deprecated but leave in place
- MUST NOT rename the `'actions'` config key in `project_config` — existing JSON must continue to load
- MUST NOT pass `--permission-mode` for OpenCode provider — Claude only
- MUST NOT change event names (`task-changed`, `agent-status-changed`, `pty-output-*`, `claude-pty-exited`)
- MUST NOT change store structure (`$activeSessions`, `$selectedTaskId`, etc.)
- MUST NOT add provider selection per task — global `ai_provider` stays unchanged
- MUST NOT separate prompt from title in the task creation UI
- MUST NOT refactor `run_action` into separate start/resume commands
- MUST NOT add permission mode display/toggle in AgentPanel
- MUST NOT add per-task provider selection
- MUST NOT refactor actions storage from JSON to dedicated table
- MUST NOT add "edit task" for agent/permission_mode after creation

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (both `pnpm test` / vitest and `cargo test`)
- **Automated tests**: TDD — write or update tests first, verify they fail, then implement
- **Framework**: vitest (frontend), cargo test (backend)

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Frontend/UI**: Use Playwright (playwright skill) — Navigate, interact, assert DOM, screenshot
- **TUI/CLI**: Use interactive_bash (tmux) — Run command, send keystrokes, validate output
- **API/Backend**: Use Bash (cargo test) — Run specific test modules, assert output
- **Library/Module**: Use Bash (vitest) — Run specific test files, compare output

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — types, DB, args threading):
├── Task 1: Update PermissionMode type + Action type (frontend types) [quick]
├── Task 2: DB migration V8 + TaskRow struct + all SQL queries [deep]
├── Task 3: Thread permission_mode through build_claude_args + spawn_claude_pty [unspecified-high]
└── Task 4: Update actions.ts — remove agent from createAction + DEFAULT_ACTIONS [quick]

Wave 2 (Backend integration — depends on Wave 1):
├── Task 5: Thread permission_mode through ClaudeCodeProvider start/resume [unspecified-high]
├── Task 6: Update create_task command + IPC wrapper (add agent + permission_mode) [unspecified-high]
└── Task 7: Update run_action to read agent/permission_mode from task record [deep]

Wave 3 (Frontend UI — depends on Waves 1+2):
├── Task 8: Task creation dialog — add agent + permission_mode selectors [visual-engineering]
├── Task 9: Status-driven task detail header [visual-engineering]
├── Task 10: Remove action buttons from kanban context menu [quick]
└── Task 11: Remove agent dropdown from SettingsActionsCard [quick]

Wave FINAL (Verification — after ALL tasks):
├── Task F1: Plan compliance audit [oracle]
├── Task F2: Code quality review (build + lint + tests) [unspecified-high]
├── Task F3: Full QA — Playwright end-to-end [unspecified-high]
└── Task F4: Scope fidelity check [deep]

Critical Path: Task 1 → Task 5 → Task 7 → Task 8/9 → F1-F4
Parallel Speedup: ~60% faster than sequential
Max Concurrent: 4 (Wave 1)
```

### Dependency Matrix

| Task | Depends On | Blocks |
|------|-----------|--------|
| 1 | — | 4, 5, 6, 8, 9, 11 |
| 2 | — | 6, 7 |
| 3 | — | 5 |
| 4 | 1 | 10, 11 |
| 5 | 1, 3 | 7 |
| 6 | 1, 2 | 7, 8 |
| 7 | 2, 5, 6 | 9 |
| 8 | 1, 6 | F1-F4 |
| 9 | 1, 7 | F1-F4 |
| 10 | 4 | F1-F4 |
| 11 | 1, 4 | F1-F4 |

### Agent Dispatch Summary

- **Wave 1 (4 tasks)**: T1 → `quick`, T2 → `deep`, T3 → `unspecified-high`, T4 → `quick`
- **Wave 2 (3 tasks)**: T5 → `unspecified-high`, T6 → `unspecified-high`, T7 → `deep`
- **Wave 3 (4 tasks)**: T8 → `visual-engineering`, T9 → `visual-engineering`, T10 → `quick`, T11 → `quick`
- **FINAL (4 tasks)**: F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. Update PermissionMode type + Action type (frontend types)

  **What to do**:
  - Add `'dontAsk'` to `PermissionMode` union type in `src/lib/types.ts:389`
  - Remove `agent: string | null` field from `Action` interface in `src/lib/types.ts:351-358`
  - Add `agent: string | null` and `permission_mode: string | null` fields to `Task` interface in `src/lib/types.ts:1-15`
  - Update `actions.test.ts` — remove any assertions on `action.agent` field; add test for action without agent
  - TDD: Write test asserting Action has no `agent` property first, verify it fails, then update type

  **Must NOT do**:
  - Do NOT change the Action `id`, `name`, `prompt`, `builtin`, `enabled` fields
  - Do NOT change any types beyond Task, Action, and PermissionMode
  - Do NOT add CSS classes or visual styling to type definitions

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple type changes across 2 files
  - **Skills**: []
    - No specialized skills needed for type edits
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: No visual work involved

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4)
  - **Blocks**: Tasks 4, 5, 6, 8, 9, 11
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src/lib/types.ts:1-15` — Current Task interface. Add `agent: string | null` and `permission_mode: string | null` after `summary` field.
  - `src/lib/types.ts:351-358` — Current Action interface. Remove the `agent: string | null` field (line 355).
  - `src/lib/types.ts:389` — Current PermissionMode type. Add `| 'dontAsk'` to the union.

  **Test References**:
  - `src/lib/actions.test.ts` — Existing action tests. Update any tests that assert on `action.agent`.

  **Acceptance Criteria**:

  - [ ] `pnpm test` passes
  - [ ] `Action` interface has exactly: id, name, prompt, builtin, enabled (no agent)
  - [ ] `Task` interface includes `agent: string | null` and `permission_mode: string | null`
  - [ ] `PermissionMode` includes all 5 modes: `'default' | 'acceptEdits' | 'plan' | 'bypassPermissions' | 'dontAsk'`

  **QA Scenarios**:

  ```
  Scenario: Type compilation check
    Tool: Bash
    Preconditions: Frontend dependencies installed
    Steps:
      1. Run: pnpm exec tsc --noEmit
      2. Verify exit code is 0 (ignore pre-existing LSP warnings in unrelated files)
    Expected Result: No new type errors introduced
    Evidence: .sisyphus/evidence/task-1-tsc-check.txt

  Scenario: Action type has no agent field
    Tool: Bash (grep)
    Preconditions: types.ts updated
    Steps:
      1. Search for "agent" in the Action interface block in src/lib/types.ts
      2. Verify no `agent` field exists in Action interface
      3. Verify `agent` field EXISTS in Task interface
    Expected Result: Action interface has no agent field; Task interface has agent field
    Evidence: .sisyphus/evidence/task-1-type-verification.txt
  ```

  **Commit**: YES
  - Message: `refactor(types): simplify Action type and add dontAsk permission mode`
  - Files: `src/lib/types.ts`, `src/lib/actions.test.ts`
  - Pre-commit: `pnpm test`

- [x] 2. DB migration V8 + TaskRow struct + all SQL queries

  **What to do**:
  - Add V8 migration to `get_migrations()` in `src-tauri/src/db/mod.rs` (after line 514, before `])`)
  - V8 migration: `ALTER TABLE tasks ADD COLUMN agent TEXT; ALTER TABLE tasks ADD COLUMN permission_mode TEXT;`
  - Use `M::up_with_hook` pattern (see V5/V6 for examples) to safely check column existence before ALTER
  - Add `agent: Option<String>` and `permission_mode: Option<String>` fields to `TaskRow` struct in `src-tauri/src/db/tasks.rs:6-20`
  - Update ALL 6 SELECT queries in tasks.rs to include `agent, permission_mode` columns (positions 13, 14)
  - Update all `row.get(N)?` mappings to include the new columns
  - Update `create_task` INSERT to include agent and permission_mode params
  - Update `create_task` function signature to accept `agent: Option<&str>` and `permission_mode: Option<&str>`
  - Update `insert_test_task` helper in `db/mod.rs:529-536` to include new columns
  - Update ALL TaskRow literal constructions in test files (orchestration.rs tests)
  - TDD: Write test `test_create_task_with_agent_and_permission_mode` first, verify it fails, then implement
  - Also update `ensure_tasks_columns` safety net in `db/mod.rs:81-108` to include agent + permission_mode

  **Must NOT do**:
  - Do NOT backfill existing rows (user chose NULL → sensible defaults at runtime)
  - Do NOT change any other migration versions
  - Do NOT modify the `update_task` or `update_task_status` methods (they don't need agent/permission_mode)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Touches 6+ SQL queries, migration logic, and many test constructions across multiple files. Must be precise with column positions.
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `golang`: Wrong language

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4)
  - **Blocks**: Tasks 6, 7
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src-tauri/src/db/tasks.rs:6-20` — Current TaskRow struct. Add `agent` and `permission_mode` after `summary`.
  - `src-tauri/src/db/tasks.rs:24-54` — `get_tasks_for_project` query. SELECT must include agent, permission_mode. Row mapping must include `agent: row.get(13)?`, `permission_mode: row.get(14)?`.
  - `src-tauri/src/db/tasks.rs:56-137` — `create_task` function. Add params, update INSERT columns and VALUES, update returned TaskRow.
  - `src-tauri/src/db/tasks.rs:139-169` — `get_all_tasks`. Same pattern as get_tasks_for_project.
  - `src-tauri/src/db/tasks.rs:171-197` — `get_task`. Same pattern.
  - `src-tauri/src/db/tasks.rs:343-373` — `get_tasks_with_jira_links`. Same pattern.
  - `src-tauri/src/db/mod.rs:482-514` — V7 migration (last one). V8 goes after this, before `])`.
  - `src-tauri/src/db/mod.rs:81-108` — `ensure_tasks_columns` safety net. Add agent + permission_mode to the loop.
  - `src-tauri/src/db/mod.rs:529-536` — `insert_test_task` helper. Must include new columns in INSERT.

  **Test References**:
  - `src-tauri/src/db/tasks.rs:387-790` — All existing task tests. Every test constructing TaskRow or calling create_task must be updated.
  - `src-tauri/src/commands/orchestration.rs:450-910` — Tests constructing TaskRow literals. Must add `agent: None, permission_mode: None` to each.

  **Acceptance Criteria**:

  - [ ] `cargo test` passes in `src-tauri/`
  - [ ] New test `test_create_task_with_agent_and_permission_mode` passes
  - [ ] DB migration V8 adds columns without error on fresh and existing databases
  - [ ] All 6 SELECT queries return `agent` and `permission_mode` fields

  **QA Scenarios**:

  ```
  Scenario: Cargo tests pass with new migration
    Tool: Bash
    Preconditions: Rust code compiled
    Steps:
      1. Run: cd src-tauri && cargo test -- --test-threads=1 2>&1
      2. Verify all tests pass (0 failures)
    Expected Result: All tests pass including new agent/permission_mode tests
    Failure Indicators: Any "FAILED" or "panicked" in output
    Evidence: .sisyphus/evidence/task-2-cargo-test.txt

  Scenario: Create task with agent and permission_mode stored correctly
    Tool: Bash (cargo test)
    Preconditions: New test written
    Steps:
      1. Run: cd src-tauri && cargo test test_create_task_with_agent_and_permission_mode -- --nocapture
      2. Verify test creates task with agent="claude" and permission_mode="plan"
      3. Verify retrieved task has matching values
    Expected Result: Task round-trips agent and permission_mode through DB
    Evidence: .sisyphus/evidence/task-2-agent-roundtrip.txt
  ```

  **Commit**: YES
  - Message: `feat(db): add agent and permission_mode columns to tasks table`
  - Files: `src-tauri/src/db/mod.rs`, `src-tauri/src/db/tasks.rs`, `src-tauri/src/commands/orchestration.rs` (test literals only)
  - Pre-commit: `cd src-tauri && cargo test`

- [x] 3. Thread permission_mode through build_claude_args + spawn_claude_pty

  **What to do**:
  - Add `permission_mode: Option<&str>` parameter to `build_claude_args` in `src-tauri/src/pty_manager.rs:1237-1256`
  - If `permission_mode` is `Some(mode)`, add `--permission-mode` and `mode` to the args vec (before `--settings`)
  - Add `permission_mode: Option<&str>` parameter to `spawn_claude_pty` in `src-tauri/src/pty_manager.rs:387-398`
  - Pass `permission_mode` from `spawn_claude_pty` into `build_claude_args` call
  - Update ALL existing callers of `build_claude_args` and `spawn_claude_pty` to pass `None` for permission_mode (preserving current behavior)
  - TDD: Write test `test_build_claude_args_with_permission_mode` first — assert args contain `--permission-mode plan`. Verify it fails, then implement.
  - Also write test `test_build_claude_args_without_permission_mode` — assert args do NOT contain `--permission-mode`. 

  **Must NOT do**:
  - Do NOT change the OpenCode provider — permission mode is Claude-only
  - Do NOT change the arg ordering for existing args (resume, continue, settings)
  - Do NOT add permission_mode validation — trust the caller

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Must thread a parameter through multiple function signatures carefully without breaking existing callers
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `rust`: No Rust-specific skill available in skill list

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4)
  - **Blocks**: Task 5
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src-tauri/src/pty_manager.rs:1237-1256` — Current `build_claude_args`. Add permission_mode param. Insert `--permission-mode` + mode before `--settings` arg.
  - `src-tauri/src/pty_manager.rs:387-398` — Current `spawn_claude_pty` signature. Add `permission_mode: Option<&str>` after `hooks_settings_path`.
  - `src-tauri/src/providers/claude_code.rs:29-42` — `ClaudeCodeProvider::start` calls `spawn_claude_pty`. Currently passes: task_id, worktree_path, prompt, None, false, hooks_path, 80, 24, app. Will need to add `None` for permission_mode (or actual value in Task 5).
  - `src-tauri/src/providers/claude_code.rs:70-83` — `ClaudeCodeProvider::resume` calls `spawn_claude_pty`. Same pattern.

  **External References**:
  - Claude Code CLI docs: `--permission-mode` flag accepts: default, acceptEdits, plan, bypassPermissions, dontAsk

  **Acceptance Criteria**:

  - [ ] `cargo test` passes in `src-tauri/`
  - [ ] `build_claude_args` with `Some("plan")` produces args containing `["--permission-mode", "plan"]`
  - [ ] `build_claude_args` with `None` produces args NOT containing `--permission-mode`
  - [ ] Existing `spawn_claude_pty` callers updated to pass `None` for permission_mode

  **QA Scenarios**:

  ```
  Scenario: build_claude_args includes permission mode
    Tool: Bash (cargo test)
    Preconditions: New test written
    Steps:
      1. Run: cd src-tauri && cargo test test_build_claude_args_with_permission_mode -- --nocapture
      2. Verify args contain "--permission-mode" followed by "plan"
    Expected Result: Permission mode flag correctly included in args
    Evidence: .sisyphus/evidence/task-3-args-with-mode.txt

  Scenario: build_claude_args excludes permission mode when None
    Tool: Bash (cargo test)
    Preconditions: New test written
    Steps:
      1. Run: cd src-tauri && cargo test test_build_claude_args_without_permission_mode -- --nocapture
      2. Verify args do NOT contain "--permission-mode"
    Expected Result: No permission mode flag when None passed
    Evidence: .sisyphus/evidence/task-3-args-without-mode.txt
  ```

  **Commit**: YES
  - Message: `feat(pty): thread permission_mode through build_claude_args and spawn_claude_pty`
  - Files: `src-tauri/src/pty_manager.rs`, `src-tauri/src/providers/claude_code.rs`
  - Pre-commit: `cd src-tauri && cargo test`

- [x] 4. Update actions.ts — remove agent from createAction + DEFAULT_ACTIONS

  **What to do**:
  - Remove `agent: null` from `DEFAULT_ACTIONS` array in `src/lib/actions.ts:9`
  - Remove `agent: null` from `createAction` function return in `src/lib/actions.ts:40-49`
  - In `loadActions`, the `a.agent ?? null` fallback on line 26 now serves to silently drop the field from old stored JSON — keep this line for backward compat but change it to just spread without agent: `const { agent, ...rest } = a; return rest;` or simpler: just omit agent from the mapped result
  - Actually the simplest approach: since serde/TS won't have `agent` in the type, the JSON parse will just have an extra field that TypeScript ignores. The `map` on line 26 can be simplified to just `return parsed` without the agent fallback.
  - Update `actions.test.ts` to remove assertions on `agent` field
  - TDD: Update tests first, verify they fail, then update code

  **Must NOT do**:
  - Do NOT rename the `'actions'` config key in `project_config`
  - Do NOT change the `loadActions`, `saveActions`, or `getEnabledActions` function signatures
  - Do NOT modify the builtin Go action's `prompt: ""` — it stays empty

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small changes to 2 files
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3)
  - **Blocks**: Tasks 10, 11
  - **Blocked By**: Task 1 (needs updated Action type without agent)

  **References**:

  **Pattern References**:
  - `src/lib/actions.ts:4-13` — DEFAULT_ACTIONS with `agent: null`. Remove agent field.
  - `src/lib/actions.ts:26` — `parsed.map((a: Action) => ({ ...a, agent: a.agent ?? null }))` — simplify since agent no longer in type
  - `src/lib/actions.ts:40-49` — `createAction` returns object with `agent: null`. Remove it.

  **Test References**:
  - `src/lib/actions.test.ts` — Update assertions that check for agent field

  **Acceptance Criteria**:

  - [ ] `pnpm test` passes
  - [ ] `DEFAULT_ACTIONS` has no `agent` field
  - [ ] `createAction` returns object without `agent` field
  - [ ] Old stored JSON with `agent` field loads without error

  **QA Scenarios**:

  ```
  Scenario: Frontend tests pass after action simplification
    Tool: Bash
    Preconditions: types.ts and actions.ts updated
    Steps:
      1. Run: pnpm test -- --reporter=verbose 2>&1
      2. Verify all tests pass
    Expected Result: 0 failures
    Evidence: .sisyphus/evidence/task-4-test-results.txt

  Scenario: Old JSON with agent field parses correctly
    Tool: Bash (node script)
    Preconditions: Code updated
    Steps:
      1. Create a temporary test that parses old JSON: `[{"id":"test","name":"Go","prompt":"","agent":"build","builtin":true,"enabled":true}]`
      2. Verify it parses without error and resulting object has no `agent` property in the TypeScript type
    Expected Result: Old JSON silently ignores agent field
    Evidence: .sisyphus/evidence/task-4-backward-compat.txt
  ```

  **Commit**: YES (group with Task 1)
  - Message: `refactor(actions): remove agent field from actions`
  - Files: `src/lib/actions.ts`, `src/lib/actions.test.ts`
  - Pre-commit: `pnpm test`

- [x] 5. Thread permission_mode through ClaudeCodeProvider start/resume

  **What to do**:
  - Add `permission_mode: Option<&str>` parameter to `ClaudeCodeProvider::start` in `src-tauri/src/providers/claude_code.rs:17-45`
  - Add `permission_mode: Option<&str>` parameter to `ClaudeCodeProvider::resume` in `src-tauri/src/providers/claude_code.rs:47-86`
  - Pass `permission_mode` through to `spawn_claude_pty` calls (lines 30-41 and 71-83)
  - Update `Provider::start` and `Provider::resume` in `src-tauri/src/providers/mod.rs:55-83` to accept and pass `permission_mode`
  - For `Provider::OpenCode` variant, pass `None` to OpenCode (it ignores it) or don't thread it (just ignore the param)
  - Update ALL callers of `provider.start()` and `provider.resume()` in `src-tauri/src/commands/orchestration.rs`:
    - `start_implementation` line 225: pass `None` (deprecated, keep behavior)
    - `run_action` line 383 (start path): pass permission_mode from task record (or None for now, Task 7 will wire it)
    - `run_action` line 315-322 (resume path): pass permission_mode from task record (or None for now)
  - TDD: Write tests verifying new parameter is threaded correctly

  **Must NOT do**:
  - Do NOT change OpenCode provider internals — just accept and ignore the param
  - Do NOT modify `start_implementation` beyond adding `None` for the new param
  - Do NOT add permission_mode to the `abort` or `cleanup` methods

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Threading a parameter through 4 layers (Provider enum → ClaudeCode → spawn_claude_pty → build_claude_args) requires precision
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 6, 7)
  - **Blocks**: Task 7
  - **Blocked By**: Tasks 1, 3

  **References**:

  **Pattern References**:
  - `src-tauri/src/providers/claude_code.rs:17-45` — `ClaudeCodeProvider::start`. Add `permission_mode: Option<&str>`. Pass to `spawn_claude_pty`.
  - `src-tauri/src/providers/claude_code.rs:47-86` — `ClaudeCodeProvider::resume`. Same pattern.
  - `src-tauri/src/providers/mod.rs:55-67` — `Provider::start`. Add param, delegate to both variants.
  - `src-tauri/src/providers/mod.rs:70-83` — `Provider::resume`. Add param, delegate.
  - `src-tauri/src/commands/orchestration.rs:225` — `provider.start(...)` call in `start_implementation`. Add `None`.
  - `src-tauri/src/commands/orchestration.rs:315-322` — `provider.resume(...)` call in `run_action`. Add `None` (Task 7 wires actual value).
  - `src-tauri/src/commands/orchestration.rs:383` — `provider.start(...)` call in `run_action` start path. Add `None`.

  **Acceptance Criteria**:

  - [ ] `cargo test` passes
  - [ ] `Provider::start` and `Provider::resume` accept `permission_mode: Option<&str>`
  - [ ] `ClaudeCodeProvider::start` and `resume` pass permission_mode to `spawn_claude_pty`
  - [ ] All callers in orchestration.rs compile and pass `None` or actual value

  **QA Scenarios**:

  ```
  Scenario: Cargo tests pass with threaded permission_mode
    Tool: Bash
    Preconditions: Provider and PTY code updated
    Steps:
      1. Run: cd src-tauri && cargo test -- --test-threads=1 2>&1
      2. Verify 0 failures
    Expected Result: All tests pass
    Evidence: .sisyphus/evidence/task-5-cargo-test.txt

  Scenario: Provider start signature accepts permission_mode
    Tool: Bash (grep)
    Preconditions: Code updated
    Steps:
      1. Grep for "permission_mode" in providers/mod.rs
      2. Verify it appears in both `start` and `resume` signatures
    Expected Result: Both methods accept permission_mode parameter
    Evidence: .sisyphus/evidence/task-5-signature-check.txt
  ```

  **Commit**: YES
  - Message: `feat(provider): thread permission_mode through ClaudeCodeProvider start/resume`
  - Files: `src-tauri/src/providers/claude_code.rs`, `src-tauri/src/providers/mod.rs`, `src-tauri/src/commands/orchestration.rs`
  - Pre-commit: `cd src-tauri && cargo test`

- [x] 6. Update create_task command + IPC wrapper (add agent + permission_mode)

  **What to do**:
  - Update `create_task` Tauri command in `src-tauri/src/commands/tasks.rs:26-40` to accept `agent: Option<String>` and `permission_mode: Option<String>` parameters
  - Pass them through to `db.create_task(...)` call (which was updated in Task 2)
  - Update `createTask` IPC wrapper in `src/lib/ipc.ts:4-6` to accept and pass `agent: string | null` and `permissionMode: string | null` parameters
  - Update `AddTaskDialog.svelte` `handleSubmit` call to `createTask` to pass `null, null` for agent and permissionMode (Task 8 will add the actual UI)
  - IMPORTANT: The frontend `createTask` currently doesn't pass `prompt` either (line 4-5). Fix this too — pass `title` as `prompt` to match current backend behavior where prompt defaults to title.
  - TDD: Update frontend test if any exists for createTask, or verify compilation

  **Must NOT do**:
  - Do NOT change other task commands (update_task, delete_task, etc.)
  - Do NOT add validation logic — accept whatever frontend sends

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Crosses frontend-backend boundary, must keep IPC contract aligned
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5, 7)
  - **Blocks**: Tasks 7, 8
  - **Blocked By**: Tasks 1 (needs Task type), 2 (needs DB create_task signature)

  **References**:

  **Pattern References**:
  - `src-tauri/src/commands/tasks.rs:26-40` — Current `create_task` command. Add `agent: Option<String>` and `permission_mode: Option<String>` params. Pass to `db.create_task()`.
  - `src/lib/ipc.ts:4-6` — Current `createTask` wrapper. Add `agent` and `permissionMode` params. Pass to `invoke`.
  - `src/components/AddTaskDialog.svelte:34-39` — Current `createTask` call. Add `null, null` for agent and permissionMode.

  **API/Type References**:
  - `src/lib/types.ts:1-15` — Updated Task type (from Task 1) with agent + permission_mode fields

  **Acceptance Criteria**:

  - [ ] `cargo test` passes
  - [ ] `pnpm build` succeeds (no type errors from updated IPC call)
  - [ ] `createTask` IPC wrapper signature: `createTask(title, status, jiraKey, projectId, agent, permissionMode)`
  - [ ] Rust `create_task` command accepts agent and permission_mode

  **QA Scenarios**:

  ```
  Scenario: Frontend compiles with new createTask signature
    Tool: Bash
    Preconditions: ipc.ts and AddTaskDialog.svelte updated
    Steps:
      1. Run: pnpm build 2>&1
      2. Verify exit code 0
    Expected Result: Build succeeds without type errors
    Evidence: .sisyphus/evidence/task-6-build-check.txt

  Scenario: Rust create_task command compiles with new params
    Tool: Bash
    Preconditions: commands/tasks.rs updated
    Steps:
      1. Run: cd src-tauri && cargo test test_create_task -- --nocapture 2>&1
      2. Verify task creation tests pass
    Expected Result: All create_task tests pass
    Evidence: .sisyphus/evidence/task-6-cargo-test.txt
  ```

  **Commit**: YES
  - Message: `feat(ipc): add agent and permission_mode to createTask`
  - Files: `src-tauri/src/commands/tasks.rs`, `src/lib/ipc.ts`, `src/components/AddTaskDialog.svelte`
  - Pre-commit: `cd src-tauri && cargo test && cd .. && pnpm build`

- [x] 7. Update run_action to read agent/permission_mode from task record

  **What to do**:
  - In `run_action` command (`src-tauri/src/commands/orchestration.rs:250-406`), after retrieving the task (line 264), extract `task.agent` and `task.permission_mode`
  - Use task's agent as fallback when the IPC `agent` param is None: `let effective_agent = agent.or(task.agent.clone());`
  - Pass `task.permission_mode.as_deref()` to `provider.start()` and `provider.resume()` calls
  - For the `provider.resume()` call on line 315-322, pass `task.permission_mode.as_deref()`
  - For the `provider.start()` call on line 383, pass `task.permission_mode.as_deref()`
  - TDD: Write test verifying that when action `agent` is None, task's agent is used as fallback

  **Must NOT do**:
  - Do NOT change `run_action`'s IPC signature (still accepts `agent: Option<String>`)
  - Do NOT change `start_implementation` — it stays as-is with `None` for permission_mode
  - Do NOT add permission_mode to `run_action`'s IPC parameters — it comes from the task record
  - Do NOT restructure the run_action flow beyond reading from task

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Must understand the complex run_action flow (start vs resume paths, session status checks) and correctly wire the fallback logic
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (after Tasks 2, 5, 6 complete)
  - **Blocks**: Task 9
  - **Blocked By**: Tasks 2 (TaskRow with agent/permission_mode), 5 (provider accepts permission_mode), 6 (create_task stores values)

  **References**:

  **Pattern References**:
  - `src-tauri/src/commands/orchestration.rs:250-406` — Full `run_action` function. Two paths: resume (line 292-347) and start-fresh (line 349-406).
  - `src-tauri/src/commands/orchestration.rs:262-272` — Task retrieval block. After this, `task.agent` and `task.permission_mode` are available.
  - `src-tauri/src/commands/orchestration.rs:315-322` — `provider.resume()` call. Add `task.permission_mode.as_deref()`.
  - `src-tauri/src/commands/orchestration.rs:383` — `provider.start()` call. Add `task.permission_mode.as_deref()` and use `effective_agent`.

  **Acceptance Criteria**:

  - [ ] `cargo test` passes
  - [ ] `run_action` uses task.agent as fallback when IPC agent is None
  - [ ] `run_action` passes task.permission_mode to provider.start() and provider.resume()
  - [ ] `start_implementation` still passes None for permission_mode (unchanged)

  **QA Scenarios**:

  ```
  Scenario: Cargo tests pass with updated run_action
    Tool: Bash
    Preconditions: orchestration.rs updated
    Steps:
      1. Run: cd src-tauri && cargo test -- --test-threads=1 2>&1
      2. Verify all tests pass
    Expected Result: 0 failures
    Evidence: .sisyphus/evidence/task-7-cargo-test.txt

  Scenario: run_action compiles with permission_mode threading
    Tool: Bash
    Preconditions: All backend changes complete
    Steps:
      1. Run: cd src-tauri && cargo build 2>&1
      2. Verify successful compilation
    Expected Result: No compilation errors
    Evidence: .sisyphus/evidence/task-7-cargo-build.txt
  ```

  **Commit**: YES
  - Message: `feat(orchestration): read agent/permission_mode from task record in run_action`
  - Files: `src-tauri/src/commands/orchestration.rs`
  - Pre-commit: `cd src-tauri && cargo test`

- [x] 8. Task creation dialog — add agent + permission_mode selectors

  **What to do**:
  - In `AddTaskDialog.svelte`, add two new `$state` variables: `agent` and `permissionMode`
  - Add a provider-conditional agent dropdown:
    - Only visible when global `ai_provider` is `opencode`
    - Lists available OpenCode sub-agents (fetch via `getAgents()` IPC call)
    - Default: empty string (meaning "default agent")
  - Add a provider-conditional permission mode dropdown:
    - Only visible when global `ai_provider` is `claude-code`
    - Lists all 5 PermissionMode values with display labels
    - `dontAsk` option gets `text-error` class and "(dangerous)" suffix as visual warning
    - Default: `'default'`
  - Read `ai_provider` from config using `getConfig('ai_provider')` on mount
  - Update `handleSubmit` to pass `agent` and `permissionMode` to `createTask()`
  - Import `getConfig`, `getAgents` from ipc, and `PermissionMode` type from types
  - Ensure the new dropdowns use daisyUI classes (`select select-bordered select-sm`)

  **Must NOT do**:
  - Do NOT separate prompt from title — the existing title field IS the prompt
  - Do NOT add provider selection — global `ai_provider` stays unchanged
  - Do NOT add agent/permission_mode to edit mode — only creation
  - Do NOT add CSS `<style>` blocks — use Tailwind/daisyUI classes only

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: UI component work with conditional rendering and form elements
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: Needed for form layout and daisyUI component patterns

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 9, 10, 11)
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 1 (types), 6 (createTask IPC)

  **References**:

  **Pattern References**:
  - `src/components/AddTaskDialog.svelte:1-105` — Complete current dialog. Add selectors between JIRA Key input (line 89) and the submit footer (line 92).
  - `src/components/SettingsActionsCard.svelte:108-122` — Agent dropdown pattern. Reuse the `select` element pattern with `availableAgents`.
  - `src/lib/ipc.ts:37-39` — `getAgents()` IPC wrapper. Returns `AgentInfo[]`.
  - `src/lib/ipc.ts:4-6` — Updated `createTask` wrapper (from Task 6). Will accept agent + permissionMode.

  **API/Type References**:
  - `src/lib/types.ts:389` — Updated `PermissionMode` type (from Task 1) with all 5 modes.
  - `src/lib/types.ts:1-15` — Updated `Task` interface with agent + permission_mode.

  **Acceptance Criteria**:

  - [ ] `pnpm build` succeeds
  - [ ] When `ai_provider` is `claude-code`: permission mode dropdown is visible, agent dropdown is hidden
  - [ ] When `ai_provider` is `opencode`: agent dropdown is visible, permission mode dropdown is hidden
  - [ ] `dontAsk` option has visual danger styling (e.g. `text-error`)
  - [ ] Created task stores selected agent and permission_mode values

  **QA Scenarios**:

  ```
  Scenario: Task creation dialog shows Claude permission mode selector
    Tool: Playwright (playwright skill)
    Preconditions: App running with ai_provider=claude-code, pnpm tauri:dev
    Steps:
      1. Open app, navigate to board
      2. Press Cmd+T to open create task dialog
      3. Assert: permission mode dropdown is visible (select element with permission mode options)
      4. Assert: agent dropdown is NOT visible
      5. Select "plan" from permission mode dropdown
      6. Enter title "Test task with plan mode"
      7. Click Create Task
      8. Verify task appears in backlog
    Expected Result: Task created with permission_mode=plan stored
    Failure Indicators: Missing dropdown, wrong options, task creation fails
    Evidence: .sisyphus/evidence/task-8-claude-dialog.png

  Scenario: dontAsk option shows danger warning
    Tool: Playwright (playwright skill)
    Preconditions: App running with ai_provider=claude-code
    Steps:
      1. Open create task dialog
      2. Click permission mode dropdown
      3. Assert: "dontAsk" option has text-error class or danger styling
    Expected Result: dontAsk option visually distinguished as dangerous
    Evidence: .sisyphus/evidence/task-8-dontask-warning.png
  ```

  **Commit**: YES
  - Message: `feat(ui): add agent/permission_mode selectors to task creation dialog`
  - Files: `src/components/AddTaskDialog.svelte`
  - Pre-commit: `pnpm build`

- [x] 9. Status-driven task detail header

  **What to do**:
  - In `TaskDetailView.svelte`, make the header buttons status-dependent:
    - **Backlog tasks** (`task.status === 'backlog'`): Show ONLY a "Start Task" button (styled `btn btn-primary btn-sm`). This button calls `onRunAction` with `actionPrompt: ''` (empty prompt) and `agent: null`. The `run_action` backend handles the rest (creates worktree, starts session, moves to doing).
    - **Doing tasks** (`task.status === 'doing'`): Show `[Move to Done]` button + reusable prompt buttons (current action buttons). Prompt buttons disabled when `isSessionBusy`.
    - **Done tasks** (`task.status === 'done'`): Show nothing (or minimal — no action buttons).
  - Remove the "Move to Done" button from backlog tasks (it's not appropriate for backlog)
  - Keep the existing `handleActionClick` function for reusable prompts
  - The "Start Task" button should be prominent (primary styling) since it's the main action

  **Must NOT do**:
  - Do NOT change `onRunAction` callback signature
  - Do NOT change the AgentPanel, SelfReviewView, or sidebar
  - Do NOT add a prompt input to the header — Start Task sends empty prompt (backend uses task's own prompt)
  - Do NOT change the breadcrumb bar (lines 121-143)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: UI restructuring with conditional rendering
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: Header layout and button hierarchy design

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 8, 10, 11)
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 1 (types), 7 (run_action handles empty prompt for start)

  **References**:

  **Pattern References**:
  - `src/components/TaskDetailView.svelte:87-119` — Current header. Replace the button area (lines 96-117) with status-conditional blocks.
  - `src/components/TaskDetailView.svelte:77-79` — `handleActionClick` function. Still used for reusable prompts in "doing" state.
  - `src/components/TaskDetailView.svelte:14-17` — Props interface. `onRunAction` signature stays the same.

  **Acceptance Criteria**:

  - [ ] `pnpm build` succeeds
  - [ ] Backlog tasks show "Start Task" button only (no Move to Done, no reusable prompts)
  - [ ] Doing tasks show "Move to Done" + reusable prompt buttons
  - [ ] Done tasks show no action buttons
  - [ ] "Start Task" calls `onRunAction` with empty actionPrompt and null agent

  **QA Scenarios**:

  ```
  Scenario: Backlog task shows Start Task button
    Tool: Playwright (playwright skill)
    Preconditions: App running, at least one task in backlog
    Steps:
      1. Click on a backlog task to open detail view
      2. Assert: "Start Task" button is visible in header
      3. Assert: "Move to Done" button is NOT visible
      4. Assert: No reusable prompt buttons visible
    Expected Result: Only "Start Task" button in header for backlog tasks
    Evidence: .sisyphus/evidence/task-9-backlog-header.png

  Scenario: Doing task shows prompt buttons
    Tool: Playwright (playwright skill)
    Preconditions: App running, at least one task in doing status
    Steps:
      1. Click on a doing task to open detail view
      2. Assert: "Move to Done" button is visible
      3. Assert: Reusable prompt buttons are visible (e.g., "Go")
      4. Assert: "Start Task" button is NOT visible
    Expected Result: Move to Done + reusable prompts for doing tasks
    Evidence: .sisyphus/evidence/task-9-doing-header.png
  ```

  **Commit**: YES
  - Message: `feat(ui): status-driven task detail header`
  - Files: `src/components/TaskDetailView.svelte`
  - Pre-commit: `pnpm build`

- [x] 10. Remove action buttons from kanban context menu

  **What to do**:
  - In `KanbanBoard.svelte`, remove the action buttons block from the context menu (lines 297-306)
  - Remove the `{#each actions as action}` loop and the associated button elements
  - Remove the divider `<div class="h-px bg-base-300 my-1"></div>` on line 307 that separates actions from "Move to..."
  - Remove the `actions` state variable and `loadActions`/`getEnabledActions` imports if they're only used for the context menu
  - Check if `handleRunAction` function is still needed — if it's only used by the context menu, remove it too
  - Check if `isSessionBusy` and `busyReason` are still needed — they may be used elsewhere in the component
  - Keep the "Move to..." submenu intact

  **Must NOT do**:
  - Do NOT remove the entire context menu — only the action buttons section
  - Do NOT change the "Move to..." submenu
  - Do NOT change the drag-and-drop or task card components

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Straightforward removal of HTML/Svelte template code
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 8, 9, 11)
  - **Blocks**: F1-F4
  - **Blocked By**: Task 4 (actions type updated)

  **References**:

  **Pattern References**:
  - `src/components/KanbanBoard.svelte:294-319` — Context menu. Lines 297-306 are the action buttons to remove. Line 307 is the divider to remove.

  **Acceptance Criteria**:

  - [ ] `pnpm build` succeeds
  - [ ] Context menu has NO action buttons (no "Go" button etc.)
  - [ ] Context menu still has "Move to..." submenu
  - [ ] No unused imports or dead code from action removal

  **QA Scenarios**:

  ```
  Scenario: Context menu has no action buttons
    Tool: Playwright (playwright skill)
    Preconditions: App running with tasks on board
    Steps:
      1. Right-click on a task card in the kanban board
      2. Assert: Context menu appears
      3. Assert: "Move to..." option is present
      4. Assert: No "Go" or other action buttons in the menu
    Expected Result: Context menu only shows Move to... option
    Evidence: .sisyphus/evidence/task-10-context-menu.png

  Scenario: Build succeeds after context menu cleanup
    Tool: Bash
    Preconditions: KanbanBoard.svelte updated
    Steps:
      1. Run: pnpm build 2>&1
      2. Verify exit code 0
    Expected Result: Clean build
    Evidence: .sisyphus/evidence/task-10-build.txt
  ```

  **Commit**: YES
  - Message: `refactor(ui): remove action buttons from kanban context menu`
  - Files: `src/components/KanbanBoard.svelte`
  - Pre-commit: `pnpm build`

- [x] 11. Remove agent dropdown from SettingsActionsCard

  **What to do**:
  - In `SettingsActionsCard.svelte`, remove the agent dropdown block (lines 108-122): the `{#if aiProvider !== 'claude-code'}` conditional and its contents
  - Remove `aiProvider` and `availableAgents` from the component's Props interface (if they exist) since they're no longer needed
  - Update the parent `SettingsView.svelte` to stop passing `aiProvider` and `availableAgents` props to this component
  - Remove the `onUpdateAction` handler for the `'agent'` field if it exists
  - Keep the action name input, prompt textarea, enabled toggle, and reset button

  **Must NOT do**:
  - Do NOT remove the entire SettingsActionsCard — only the agent dropdown
  - Do NOT change the actions storage format (JSON in project_config)
  - Do NOT change the card's title or overall layout

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple removal of a UI section and unused props
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 8, 9, 10)
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 1 (Action type without agent), 4 (actions.ts without agent)

  **References**:

  **Pattern References**:
  - `src/components/SettingsActionsCard.svelte:108-122` — Agent dropdown block to remove.
  - `src/components/SettingsActionsCard.svelte:1-20` (approx) — Props interface. Remove aiProvider and availableAgents.
  - `src/components/SettingsView.svelte` — Parent component. Stop passing agent-related props.

  **Acceptance Criteria**:

  - [ ] `pnpm build` succeeds
  - [ ] SettingsActionsCard has NO agent dropdown
  - [ ] SettingsActionsCard still shows: action name, prompt, enabled toggle, reset button
  - [ ] SettingsView no longer passes aiProvider/availableAgents to SettingsActionsCard

  **QA Scenarios**:

  ```
  Scenario: Settings actions card has no agent dropdown
    Tool: Playwright (playwright skill)
    Preconditions: App running, navigate to Settings
    Steps:
      1. Navigate to Settings view
      2. Find the Actions card/section
      3. Assert: Action name input is present
      4. Assert: Prompt textarea is present
      5. Assert: No "Agent" dropdown/select element in the actions card
    Expected Result: Actions card shows name + prompt + enabled, no agent selector
    Evidence: .sisyphus/evidence/task-11-settings-actions.png

  Scenario: Build succeeds after settings cleanup
    Tool: Bash
    Preconditions: SettingsActionsCard.svelte and SettingsView.svelte updated
    Steps:
      1. Run: pnpm build 2>&1
      2. Verify exit code 0
    Expected Result: Clean build
    Evidence: .sisyphus/evidence/task-11-build.txt
  ```

  **Commit**: YES
  - Message: `refactor(ui): remove agent dropdown from settings actions card`
  - Files: `src/components/SettingsActionsCard.svelte`, `src/components/SettingsView.svelte`
  - Pre-commit: `pnpm build`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Rejection → fix → re-run.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `pnpm build` + `pnpm test` + `cargo test` (from src-tauri/). Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Full QA — Playwright end-to-end** — `unspecified-high` + `playwright` skill
  Start from clean state with `pnpm tauri:dev`. Execute full workflow: create task with agent/permission_mode → verify stored → click Start Task → verify session starts → use reusable prompts → verify kanban context menu has no action buttons → verify settings actions card has no agent dropdown. Save screenshots to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff. Verify 1:1 — everything in spec was built, nothing beyond spec. Check "Must NOT do" compliance. Detect cross-task contamination. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Wave 1**: `refactor(types): simplify Action type and add dontAsk permission mode` — types.ts, actions.ts, actions.test.ts
- **Wave 1**: `feat(db): add agent and permission_mode columns to tasks table` — db/mod.rs, db/tasks.rs
- **Wave 1**: `feat(pty): thread permission_mode through build_claude_args` — pty_manager.rs
- **Wave 2**: `feat(provider): thread permission_mode through ClaudeCodeProvider` — providers/claude_code.rs, providers/mod.rs
- **Wave 2**: `feat(ipc): add agent and permission_mode to createTask` — commands/tasks.rs, ipc.ts
- **Wave 2**: `feat(orchestration): read agent/permission_mode from task record in run_action` — commands/orchestration.rs
- **Wave 3**: `feat(ui): add agent/permission_mode selectors to task creation dialog` — AddTaskDialog.svelte
- **Wave 3**: `feat(ui): status-driven task detail header` — TaskDetailView.svelte
- **Wave 3**: `refactor(ui): remove action buttons from kanban context menu` — KanbanBoard.svelte
- **Wave 3**: `refactor(ui): remove agent dropdown from settings actions card` — SettingsActionsCard.svelte

---

## Success Criteria

### Verification Commands
```bash
cd src-tauri && cargo test                    # Expected: all tests pass
cd .. && pnpm test                            # Expected: all tests pass
pnpm build                                    # Expected: build succeeds
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All Rust tests pass
- [ ] All frontend tests pass
- [ ] Frontend builds without errors
- [ ] New task creation stores agent + permission_mode
- [ ] Claude sessions use --permission-mode flag
- [ ] Existing NULL tasks use sensible defaults
- [ ] Action buttons removed from kanban context menu
- [ ] Agent dropdown removed from settings actions card
