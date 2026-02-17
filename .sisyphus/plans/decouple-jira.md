# Decouple Task Management from JIRA

## TL;DR

> **Quick Summary**: Refactor the AI Command Center from a JIRA-driven task board to a local-first task manager. Tasks are created/managed locally with auto-increment IDs (T-1, T-2, T-3). JIRA becomes an optional read-only link on tasks — syncing displays JIRA info but never creates tasks or overwrites statuses.
> 
> **Deliverables**:
> - Local task CRUD (create, read, update — no delete)
> - Auto-increment T-N task IDs replacing JIRA keys as primary identifiers
> - Add Task UI: quick inline add per column + full form dialog
> - JIRA link as optional field on tasks (one per task, many tasks → one JIRA ticket)
> - JIRA sync rewritten: fetches info for linked tasks only, read-only display
> - PR matching via local task ID OR linked JIRA key
> - Full rename: "ticket" → "task" throughout codebase
> - Clean slate migration (drops old JIRA-sourced data, preserves config)
> 
> **Estimated Effort**: Large
> **Parallel Execution**: YES — 5 waves + final verification
> **Critical Path**: T1 → T3 → T11 → T12 → T13 → F1-F4

---

## Prerequisites & Overlap

> **IMPORTANT**: This plan incorporates fields and features from the `task-detail-view` plan.
> The detail view plan depends on this decouple being completed first.
>
> **Incorporated from task-detail-view**:
> - `acceptance_criteria TEXT` and `plan_text TEXT` columns in the `tasks` table (T1)
> - `OpenCodeEvent` interface and detail IPC wrappers (`getTaskDetail`, `updateTaskFields`) in frontend (T2)
> - `get_task_detail` and `update_task_fields` Tauri commands (T3)
>
> **Existing code to PRESERVE** (from detail-view Wave 1, already committed):
> - SSE bridge in main.rs: `start_sse_bridge()`, `SseEventPayload` struct, `tokio::spawn` call — committed as `a18f6d1`. T3 (Tauri commands rewrite) MUST preserve this code.
> - The commits `ff88c0a` (T2 frontend types) and `cdc0002` (T1 DB schema) will be superseded by this decouple plan. Their changes will be naturally overwritten.

## Context

### Original Request
User wants to decouple the task management system from JIRA. Currently all tasks come from JIRA sync — there's no way to create tasks locally. User wants a standalone task manager where JIRA is optional supplementary info attached via a link.

### Interview Summary
**Key Discussions**:
- **Task IDs**: Auto-increment with "T-" prefix (T-1, T-2, T-3). TEXT primary key with counter in config table.
- **JIRA link**: One optional JIRA key per task. Multiple tasks can link to same JIRA ticket. Read-only info display only.
- **JIRA sync**: Keep background polling, but sync only updates JIRA info on tasks that have a JIRA link. Never creates tasks or overwrites local status.
- **PR matching**: Match PRs via local task ID (T-42) OR linked JIRA key (PROJ-123) in branch/title. Link to ALL matching tasks.
- **Add Task UI**: Both quick inline add (+ button in column header) and full form dialog.
- **Task fields**: Minimal — title, description (optional), status (kanban column), optional JIRA link. JIRA-supplementary fields (jira_status, jira_assignee) populated by sync.
- **Task editing**: Fully editable after creation (title, description, JIRA link).
- **Task deletion**: Not supported. Move to "Done" column instead.
- **Status changes**: New `update_task_status` command. Via context menu and detail panel. No drag-and-drop.
- **Migration**: Clean slate. Drop all old JIRA-sourced data. Preserve config table.
- **Tests**: After implementation.

### Metis Review
**Identified Gaps** (addressed):
- **Missing `update_task_status` command**: No local status change pathway existed. Added as explicit requirement.
- **JIRA sync architecture**: Current JQL-pull-and-upsert must be completely rewritten to per-linked-task-refresh. Not a tweak — a rewrite.
- **`transition_ticket` removal**: JIRA is read-only, so the JIRA transition command is removed.
- **Assignee field**: Made JIRA-supplementary only (populated by sync, not user-editable).
- **FK cascade in migration**: No task deletion = no cascade issues. Migration drops all child tables before tickets.
- **PR multi-match ambiguity**: Resolved — link to ALL matching tasks.
- **Config preservation**: Confirmed — config table preserved through migration.
- **JIRA filter settings**: Kept in UI but sync logic changes fundamentally.

---

## Work Objectives

### Core Objective
Transform the AI Command Center from a JIRA-dependent task viewer into a standalone local-first task manager where JIRA is an optional supplementary info source.

### Concrete Deliverables
- New `tasks` table with auto-increment T-N IDs and optional `jira_key` column
- Rust CRUD methods: `create_task`, `get_all_tasks`, `get_task`, `update_task`, `update_task_status`
- Tauri commands: `create_task`, `update_task`, `get_tasks`, `update_task_status`, `refresh_jira_info`
- Frontend IPC wrappers matching all new commands
- `AddTaskInline.svelte` component (quick-add in column header)
- `AddTaskDialog.svelte` component (full creation form)
- Rewritten `jira_sync.rs` using batch JQL for linked tasks only
- Updated `github_poller.rs` with dual PR matching (local ID + JIRA key)
- Updated orchestrator prompts (JIRA ticket → task)
- Renamed types/stores/components from ticket → task
- Updated App.svelte and SettingsPanel.svelte for new data model

### Definition of Done
- [ ] `cargo test` passes with all new DB and backend tests
- [ ] `npm run test` passes with all updated and new frontend tests
- [ ] `npm run build` succeeds (Vite production build)
- [ ] `cargo build` succeeds in src-tauri/
- [ ] Tasks can be created, edited, and displayed on the kanban board
- [ ] JIRA info appears on tasks with JIRA links after sync
- [ ] PRs match via both T-N task IDs and JIRA keys

### Must Have
- Local task creation with auto-increment T-N IDs
- Task editing (title, description, JIRA link)
- Status changes via context menu (move between kanban columns)
- Optional JIRA link per task (one-to-many: many tasks → one JIRA ticket)
- JIRA sync: read-only, only updates info on linked tasks
- PR matching via local task ID OR linked JIRA key
- Clean slate migration preserving config

### Must NOT Have (Guardrails)
- No drag-and-drop reorder within columns or between columns
- No task deletion (use "Done" column instead)
- No bidirectional JIRA sync (no writing status back to JIRA)
- No JIRA search/browse/auto-complete picker — simple text input for JIRA key
- No task priorities, due dates, or labels/tags
- No user-editable assignee field (JIRA-supplementary only)
- No bulk import from JIRA
- No configurable ID prefix (fixed "T-" prefix)
- No multiple JIRA links per task
- No restructuring of the orchestrator flow (only prompt text changes)
- No changes to GitHub client HTTP logic or comment parsing
- No changes to OpenCode client/manager
- No excessive comments, over-abstraction, or generic variable names

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (vitest + @testing-library/svelte for frontend, #[cfg(test)] for Rust)
- **Automated tests**: Tests after implementation
- **Framework**: vitest (frontend), cargo test (Rust)

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

| Deliverable Type | Verification Tool | Method |
|------------------|-------------------|--------|
| Rust backend | Bash (cargo test) | Run specific tests, assert pass |
| Frontend components | Bash (npx vitest run) | Run specific test files, assert pass |
| Build verification | Bash (npm run build, cargo build) | Compile without errors |
| Integration | Bash (cargo test + npm test) | Full test suites pass |

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — 2 parallel):
├── Task 1: Backend DB layer rewrite (db.rs) [deep]
└── Task 2: Frontend data layer (types.ts, stores.ts, ipc.ts) [quick]

Wave 2 (Backend services + new UI components — 8 parallel):
├── Task 3: Tauri commands rewrite (main.rs) (depends: 1) [unspecified-high]
├── Task 4: JIRA sync rewrite (jira_sync.rs) (depends: 1) [deep]
├── Task 5: GitHub poller update (github_poller.rs) (depends: 1) [unspecified-high]
├── Task 6: Orchestrator update (orchestrator.rs) (depends: 1) [quick]
├── Task 7: AddTaskInline.svelte component (depends: 2) [visual-engineering]
├── Task 8: AddTaskDialog.svelte component (depends: 2) [visual-engineering]
├── Task 9: TaskCard.svelte rename + update (depends: 2) [visual-engineering]
└── Task 10: DetailPanel.svelte update (depends: 2) [visual-engineering]

Wave 3 (Integration — 2 parallel):
├── Task 11: KanbanBoard.svelte update (depends: 2, 7, 9) [visual-engineering]
└── Task 12: App.svelte + SettingsPanel integration (depends: 2, 3-10) [quick]

Wave 4 (Tests — 2 parallel):
├── Task 13: Rust backend tests (depends: 1, 3-6) [deep]
└── Task 14: Frontend tests (depends: 2, 7-12) [unspecified-high]

Wave FINAL (Verification — 4 parallel):
├── Task F1: Plan compliance audit [oracle]
├── Task F2: Code quality review [unspecified-high]
├── Task F3: Real QA — full flow verification [unspecified-high]
└── Task F4: Scope fidelity check [deep]

Critical Path: T1 → T3 → T12 → T14 → F1-F4
Parallel Speedup: ~65% faster than sequential
Max Concurrent: 8 (Wave 2)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|------------|--------|------|
| 1 | — | 3, 4, 5, 6, 13 | 1 |
| 2 | — | 7, 8, 9, 10, 11, 12, 14 | 1 |
| 3 | 1 | 12, 13 | 2 |
| 4 | 1 | 12, 13 | 2 |
| 5 | 1 | 12, 13 | 2 |
| 6 | 1 | 12, 13 | 2 |
| 7 | 2 | 11 | 2 |
| 8 | 2 | 12 | 2 |
| 9 | 2 | 11 | 2 |
| 10 | 2 | 12 | 2 |
| 11 | 2, 7, 9 | 12, 14 | 3 |
| 12 | 2, 3-10 | 14 | 3 |
| 13 | 1, 3-6 | F1-F4 | 4 |
| 14 | 2, 7-12 | F1-F4 | 4 |

### Agent Dispatch Summary

| Wave | # Parallel | Tasks → Agent Category |
|------|------------|----------------------|
| 1 | **2** | T1 → `deep`, T2 → `quick` |
| 2 | **8** | T3 → `unspecified-high`, T4 → `deep`, T5 → `unspecified-high`, T6 → `quick`, T7-T10 → `visual-engineering` |
| 3 | **2** | T11 → `visual-engineering`, T12 → `quick` |
| 4 | **2** | T13 → `deep`, T14 → `unspecified-high` |
| FINAL | **4** | F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep` |

---

## TODOs

- [ ] 1. Backend DB Layer Rewrite

  **What to do**:
  - Rename `TicketRow` struct to `TaskRow`. Add `jira_key: Option<String>` field. Rename `jira_status` and keep `assignee` as `jira_assignee` (JIRA-supplementary).
  - Rewrite the `run_migrations()` method:
    - Detect old `tickets` table via `sqlite_master` query
    - If exists: DROP tables in FK order (agent_logs → pr_comments → agent_sessions → pull_requests → tickets)
    - CREATE new `tasks` table: `id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, status TEXT NOT NULL, jira_key TEXT, jira_status TEXT, jira_assignee TEXT, acceptance_criteria TEXT, plan_text TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL`
    - Recreate agent_sessions, agent_logs, pull_requests, pr_comments with `FOREIGN KEY (ticket_id) REFERENCES tasks(id)` — keep column name as `ticket_id` in child tables to minimize FK blast radius (semantic mismatch is acceptable)
    - CREATE config table with `IF NOT EXISTS` (preserves existing config)
    - Add `next_task_id` default: `INSERT OR IGNORE INTO config (key, value) VALUES ('next_task_id', '1')`
  - Implement new methods:
    - `create_task(title, description, status, jira_key) -> Result<TaskRow>`: Read `next_task_id` from config, generate `T-{n}`, increment counter, INSERT into tasks, return the created row.
    - `get_all_tasks() -> Result<Vec<TaskRow>>`: SELECT all from tasks ORDER BY updated_at DESC
    - `get_task(id) -> Result<Option<TaskRow>>`: SELECT by id (include acceptance_criteria, plan_text in SELECT)
    - `update_task(id, title, description, jira_key) -> Result<()>`: UPDATE title, description, jira_key, updated_at
    - `update_task_status(id, status) -> Result<()>`: UPDATE status and updated_at
    - `update_task_fields(id, acceptance_criteria, plan_text) -> Result<()>`: UPDATE only the editable fields (acceptance_criteria, plan_text) + updated_at. Used by the detail view for saving user-edited content.
    - `update_task_jira_info(jira_key, jira_status, jira_assignee) -> Result<usize>`: UPDATE all tasks matching jira_key. Returns count of updated rows. MUST NOT touch acceptance_criteria or plan_text.
    - `get_tasks_with_jira_links() -> Result<Vec<TaskRow>>`: SELECT WHERE jira_key IS NOT NULL
    - `get_task_ids_and_jira_keys() -> Result<Vec<(String, Option<String>)>>`: For PR matching — returns all (id, jira_key) pairs
  - Keep ALL existing methods: PR CRUD, session CRUD, log CRUD, config CRUD, comment methods
  - Update `get_all_ticket_ids()` → `get_all_task_ids()` (used by PR matching)

  **Must NOT do**:
  - Don't change the `id` column type to INTEGER — keep TEXT for FK compatibility
  - Don't rename `ticket_id` FK column in child tables (agent_sessions, pull_requests) — too much blast radius
  - Don't add task ordering, priorities, or assignment fields
  - Don't implement task deletion

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Substantial rewrite of core data layer with multiple new methods, migration logic, and careful FK handling
  - **Skills**: []
    - No external skills needed — pure Rust/SQLite work
  - **Skills Evaluated but Omitted**:
    - `golang`: Not applicable — this is Rust

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 2)
  - **Blocks**: Tasks 3, 4, 5, 6, 13
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src-tauri/src/db.rs:258-285` — `upsert_ticket` method: follow this pattern for new create/update methods (lock conn, execute, params)
  - `src-tauri/src/db.rs:288-312` — `get_all_tickets`: follow for `get_all_tasks` (query_map pattern)
  - `src-tauri/src/db.rs:100-217` — `run_migrations()`: This is the method to REWRITE. Understand existing table creation order and FK relationships.
  - `src-tauri/src/db.rs:7-17` — `TicketRow` struct: Rename to `TaskRow`, add `jira_key` field
  - `src-tauri/src/db.rs:224-245` — `get_config/set_config`: Use this for reading/writing `next_task_id` counter

  **API/Type References**:
  - `src-tauri/src/db.rs:48-59` — `AgentSessionRow`: Has `ticket_id: String` FK — this references the tasks table but column name stays as-is
  - `src-tauri/src/db.rs:20-31` — `PrRow`: Has `ticket_id: String` FK — same treatment

  **WHY Each Reference Matters**:
  - `upsert_ticket` shows the exact Mutex lock + execute + params pattern to follow
  - `run_migrations` is the exact function to rewrite — understand what's there before changing it
  - `TicketRow` is the struct to rename — all fields carry over plus new `jira_key`
  - Child table FKs show what breaks if you rename the `ticket_id` column (don't do it)

  **Acceptance Criteria**:
  - [ ] `TaskRow` struct exists with fields: id, title, description, status, jira_key, jira_status, jira_assignee, acceptance_criteria, plan_text, created_at, updated_at
  - [ ] `update_task_fields` method updates acceptance_criteria and plan_text without touching other fields
  - [ ] `create_task` generates sequential T-1, T-2, T-3 IDs
  - [ ] `get_all_tasks` returns all tasks ordered by updated_at DESC
  - [ ] `update_task` modifies title, description, jira_key
  - [ ] `update_task_status` modifies status
  - [ ] `update_task_jira_info` updates all tasks matching a given jira_key
  - [ ] `get_tasks_with_jira_links` returns only tasks with non-NULL jira_key
  - [ ] Migration drops old tables, creates new schema, preserves config
  - [ ] `cargo build` succeeds in src-tauri/

  **QA Scenarios**:

  ```
  Scenario: Task creation with auto-increment ID
    Tool: Bash (cargo test)
    Preconditions: Fresh test database
    Steps:
      1. Run: cargo test test_create_task_autoincrement --manifest-path src-tauri/Cargo.toml -- --nocapture
      2. Test should: create 3 tasks, verify IDs are "T-1", "T-2", "T-3"
      3. Assert: all 3 tasks retrievable via get_task()
    Expected Result: Test passes, IDs are sequential T-N format
    Failure Indicators: Test failure, wrong ID format, non-sequential IDs
    Evidence: .sisyphus/evidence/task-1-create-autoincrement.txt

  Scenario: Migration preserves config but drops ticket data
    Tool: Bash (cargo test)
    Preconditions: Test database with old schema (tickets table)
    Steps:
      1. Run: cargo test test_migration_clean_slate --manifest-path src-tauri/Cargo.toml -- --nocapture
      2. Test should: create old-schema DB, insert config, run migration, verify config preserved, verify tasks table empty
    Expected Result: Config values intact, tasks table exists and is empty, old tickets table gone
    Failure Indicators: Config lost, old tables still exist, schema mismatch
    Evidence: .sisyphus/evidence/task-1-migration-clean-slate.txt

  Scenario: JIRA info update via jira_key
    Tool: Bash (cargo test)
    Preconditions: Test DB with tasks, some with jira_key
    Steps:
      1. Run: cargo test test_update_jira_info --manifest-path src-tauri/Cargo.toml -- --nocapture
      2. Create task with jira_key="PROJ-10", call update_task_jira_info("PROJ-10", "In Progress", "Alice")
      3. Verify: task now shows jira_status="In Progress", jira_assignee="Alice"
      4. Verify: task without jira_key is untouched
    Expected Result: Only linked tasks updated, unlinked tasks unchanged
    Failure Indicators: Wrong tasks updated, unlinked tasks modified
    Evidence: .sisyphus/evidence/task-1-jira-info-update.txt
  ```

  **Commit**: YES
  - Message: `refactor(db): rewrite schema for local-first task management`
  - Files: `src-tauri/src/db.rs`
  - Pre-commit: `cargo build --manifest-path src-tauri/Cargo.toml`

---

- [ ] 2. Frontend Data Layer Update

  **What to do**:
  - **types.ts**: Rename `Ticket` interface to `Task`. Add `jira_key: string | null` field. Rename `assignee` to `jira_assignee`. Keep `jira_status`. Add `acceptance_criteria: string | null` and `plan_text: string | null` fields. Add new `OpenCodeEvent` interface: `{ event_type: string; data: string; }` (after OpenCodeStatus). Keep all other types (AgentSession, AgentLog, PrComment, PullRequestInfo, OpenCodeStatus) unchanged. Update `KanbanColumn` and `COLUMN_LABELS` — keep as-is (columns are the same).
  - **stores.ts**: Rename `tickets` store to `tasks`. Rename `selectedTicketId` to `selectedTaskId`. Update type imports from `Ticket` to `Task`. Keep `activeSessions`, `ticketPrs`, `isLoading`, `error` stores.
  - **ipc.ts**: 
    - Add: `createTask(title: string, description: string, status: string, jiraKey: string | null): Promise<Task>`
    - Add: `updateTask(id: string, title: string, description: string, jiraKey: string | null): Promise<void>`
    - Add: `updateTaskStatus(id: string, status: string): Promise<void>`
    - Add: `getTaskDetail(taskId: string): Promise<Task>` (single task fetch for detail view)
    - Add: `updateTaskFields(taskId: string, acceptanceCriteria: string, planText: string): Promise<void>` (save editable fields from detail view)
    - Rename: `getTickets()` → `getTasks()` returning `Promise<Task[]>`
    - Rename: `syncJiraNow()` → `refreshJiraInfo()` returning `Promise<number>`
    - Remove: `transitionTicket()` (JIRA is read-only)
    - Remove: `getTicketDetail()` and `updateTicketFields()` (superseded by task-named versions above)
    - Keep: all PR, session, agent log, config, OpenCode functions unchanged

  **Must NOT do**:
  - Don't add priority, due date, or label fields to Task interface
  - Don't change PullRequestInfo, AgentSession, or other non-task types
  - Don't change the store pattern (keep writable stores)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small changes across 3 files — mostly renames and adding a few function signatures
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: No visual work, just data layer

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 1)
  - **Blocks**: Tasks 7, 8, 9, 10, 11, 12, 14
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src/lib/types.ts:1-10` — Current `Ticket` interface: rename to `Task`, add `jira_key` field
  - `src/lib/stores.ts:1-9` — Current stores: rename `tickets` → `tasks`, `selectedTicketId` → `selectedTaskId`
  - `src/lib/ipc.ts:4-6` — `getTickets()` pattern: follow for new functions (invoke + type)
  - `src/lib/ipc.ts:8-10` — `syncJiraNow()`: rename to `refreshJiraInfo()`
  - `src/lib/ipc.ts:12-14` — `transitionTicket()`: REMOVE this function

  **WHY Each Reference Matters**:
  - types.ts is the single source of truth for frontend data shapes — all components depend on it
  - stores.ts naming changes propagate to every component using `$tickets` / `$selectedTicketId`
  - ipc.ts functions are the API contract between frontend and Tauri commands

  **Acceptance Criteria**:
  - [ ] `Task` interface exists in types.ts with `jira_key: string | null`, `acceptance_criteria: string | null`, `plan_text: string | null` fields
  - [ ] `OpenCodeEvent` interface exists in types.ts
  - [ ] `tasks` and `selectedTaskId` stores exist in stores.ts
  - [ ] `createTask`, `updateTask`, `updateTaskStatus`, `getTasks`, `refreshJiraInfo`, `getTaskDetail`, `updateTaskFields` functions exist in ipc.ts
  - [ ] `transitionTicket`, `getTicketDetail`, `updateTicketFields` removed from ipc.ts
  - [ ] No TypeScript errors in the 3 modified files: `npx tsc --noEmit` (may show errors in other files that import these — that's expected and fixed in later tasks)

  **QA Scenarios**:

  ```
  Scenario: Types compile correctly
    Tool: Bash
    Preconditions: types.ts, stores.ts, ipc.ts modified
    Steps:
      1. Run: npx tsc --noEmit --pretty 2>&1 | head -50
      2. Check that types.ts, stores.ts, ipc.ts themselves have no errors
      3. Errors in OTHER files (components importing old names) are expected and OK
    Expected Result: The 3 data layer files compile without errors
    Failure Indicators: Type errors within the modified files themselves
    Evidence: .sisyphus/evidence/task-2-types-compile.txt
  ```

  **Commit**: YES
  - Message: `refactor(frontend): rename ticket to task in data layer`
  - Files: `src/lib/types.ts`, `src/lib/stores.ts`, `src/lib/ipc.ts`
  - Pre-commit: none (downstream components will have import errors until they're updated)

---

- [ ] 3. Tauri Commands Rewrite

  **What to do**:
  - Add new `#[tauri::command]` functions in main.rs:
    - `create_task(db, title, description, status, jira_key) -> Result<TaskRow, String>`: calls `db.create_task()`
    - `update_task(db, id, title, description, jira_key) -> Result<(), String>`: calls `db.update_task()`
    - `update_task_status(db, id, status) -> Result<(), String>`: calls `db.update_task_status()`
    - `get_task_detail(db, task_id) -> Result<TaskRow, String>`: calls `db.get_task()`, returns error if not found
    - `update_task_fields(db, task_id, acceptance_criteria, plan_text) -> Result<(), String>`: calls `db.update_task_fields()`
    - `refresh_jira_info(db, jira_client) -> Result<usize, String>`: Same logic as new JIRA sync — gets linked tasks, batch fetches from JIRA, updates JIRA info. Returns count of updated tasks.
  - Rename existing:
    - `get_tickets` → `get_tasks`: calls `db.get_all_tasks()` instead of `db.get_all_tickets()`
  - Remove:
    - `transition_ticket`: JIRA is read-only, no status transitions to JIRA
    - `sync_jira_now`: Replaced by `refresh_jira_info`
    - `get_ticket_detail`: Superseded by `get_task_detail`
    - `update_ticket_fields`: Superseded by `update_task_fields`
  - **PRESERVE** (already in main.rs from prior work):
    - `SseEventPayload` struct (~line 632)
    - `start_sse_bridge()` async function (~line 642)
    - SSE bridge spawn in setup() (~line 775)
    - These must NOT be removed or modified during the rewrite
  - Update:
    - `start_ticket_implementation`: Update to use `get_task()` instead of `get_ticket()`, keep parameter name as `ticketId` for now (renaming all orchestrator internals is Task 6)
    - `poll_pr_comments_now`: Update to use `get_all_task_ids()` and handle dual matching (see Task 5 for full logic — this command duplicates some github_poller logic)
  - Update `invoke_handler!` macro call to register new commands and remove old ones
  - Update `use db::TicketRow` → `use db::TaskRow`
  - Remove the local `map_jira_status_to_cockpit` function (no longer needed — JIRA status stored as-is)

  **Must NOT do**:
  - Don't restructure the orchestrator (just update the function calls)
  - Don't change the OpenCode commands (create_session, send_prompt, etc.)
  - Don't change the PR/comment commands (get_pull_requests, get_pr_comments, etc.) beyond updating to use task IDs

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Substantial changes to the main command file — multiple new commands, removals, and updates
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `golang`: Rust, not Go

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4, 5, 6, 7, 8, 9, 10)
  - **Blocks**: Tasks 12, 13
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src-tauri/src/main.rs:72-87` — `get_tickets` command: rename to `get_tasks`, update db call
  - `src-tauri/src/main.rs:91-209` — `sync_jira_now`: REPLACE with `refresh_jira_info` using new sync approach
  - `src-tauri/src/main.rs:213-246` — `transition_ticket`: REMOVE entirely
  - `src-tauri/src/main.rs:670-693` — `invoke_handler!` macro: update command registration
  - `src-tauri/src/main.rs:574-584` — `map_jira_status_to_cockpit`: REMOVE (no longer needed)

  **API/Type References**:
  - `src-tauri/src/db.rs` — New TaskRow struct and CRUD methods (from Task 1)
  - `src-tauri/src/jira_client.rs:65-105` — `search_issues()`: Used by refresh_jira_info for batch JQL query
  - `src-tauri/src/jira_client.rs:132-168` — `get_ticket_details()`: Alternative for individual JIRA fetches

  **WHY Each Reference Matters**:
  - `get_tickets` command is the template for the renamed `get_tasks`
  - `sync_jira_now` shows the current sync logic to be replaced
  - `transition_ticket` must be completely removed (JIRA is read-only)
  - `invoke_handler!` is where commands are registered — must add new, remove old
  - JiraClient methods are needed for the new `refresh_jira_info` implementation

  **Acceptance Criteria**:
  - [ ] `create_task`, `update_task`, `update_task_status`, `get_tasks`, `get_task_detail`, `update_task_fields`, `refresh_jira_info` commands exist
  - [ ] `transition_ticket`, `sync_jira_now`, `get_ticket_detail`, `update_ticket_fields` commands removed
  - [ ] SSE bridge code preserved: `SseEventPayload`, `start_sse_bridge`, SSE spawn in setup
  - [ ] `invoke_handler!` macro updated with correct command list
  - [ ] `cargo build` succeeds in src-tauri/

  **QA Scenarios**:

  ```
  Scenario: Backend compiles with new commands
    Tool: Bash
    Preconditions: db.rs (Task 1) and main.rs both updated
    Steps:
      1. Run: cargo build --manifest-path src-tauri/Cargo.toml 2>&1
      2. Verify: no compilation errors
    Expected Result: Clean build with 0 errors
    Failure Indicators: Compilation errors, missing imports, type mismatches
    Evidence: .sisyphus/evidence/task-3-cargo-build.txt

  Scenario: Old commands removed from handler
    Tool: Bash (grep)
    Preconditions: main.rs updated
    Steps:
      1. Run: grep -n "transition_ticket\|sync_jira_now" src-tauri/src/main.rs
      2. Verify: no matches in invoke_handler or command definitions
      3. Verify: create_task, update_task, get_tasks in invoke_handler
    Expected Result: Old commands absent, new commands registered
    Failure Indicators: Old command names still present
    Evidence: .sisyphus/evidence/task-3-commands-check.txt
  ```

  **Commit**: YES
  - Message: `refactor(commands): replace JIRA-driven commands with local task CRUD`
  - Files: `src-tauri/src/main.rs`
  - Pre-commit: `cargo build --manifest-path src-tauri/Cargo.toml`

---

- [ ] 4. JIRA Sync Rewrite

  **What to do**:
  - Completely rewrite `start_jira_sync()` in jira_sync.rs. New architecture:
    1. Read JIRA credentials from config (keep existing `read_sync_config` but simplify — filter settings like `filter_assigned_to_me` are no longer relevant for the sync query)
    2. Get all tasks with JIRA links: `db.get_tasks_with_jira_links()`
    3. If no linked tasks, sleep and continue
    4. Collect unique JIRA keys from linked tasks
    5. Build JQL: `key IN (KEY-1, KEY-2, KEY-3) ORDER BY updated DESC`
    6. Call `jira_client.search_issues()` with this JQL
    7. For each returned issue: call `db.update_task_jira_info(issue.key, jira_status, assignee)`
    8. Emit `jira-sync-complete` event (keep existing event name)
    9. Sleep for poll interval, loop
  - Remove `upsert_ticket_from_jira()` — no longer creates/upserts tickets
  - Remove `map_jira_status_to_cockpit()` — store JIRA status as-is (raw JIRA status name)
  - Remove or simplify `build_jql_query()` — no longer uses filter settings
  - Simplify `SyncConfig` — only needs credentials and poll interval. Filter settings become unused.
  - Extract sync logic into a reusable function that both background sync and manual `refresh_jira_info` command can call

  **Must NOT do**:
  - Don't write status back to JIRA
  - Don't create tasks from JIRA issues
  - Don't map JIRA status to local status — store raw JIRA status
  - Don't touch the JiraClient HTTP logic (jira_client.rs is unchanged)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Fundamental architecture change — not a tweak but a rewrite of the sync loop and its supporting functions
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 3, 5, 6, 7, 8, 9, 10)
  - **Blocks**: Tasks 12, 13
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src-tauri/src/jira_sync.rs:40-117` — Current `start_jira_sync()`: REWRITE this function entirely
  - `src-tauri/src/jira_sync.rs:120-130` — `SyncConfig`: Simplify — keep only credentials + poll_interval
  - `src-tauri/src/jira_sync.rs:133-190` — `read_sync_config()`: Simplify to only read needed fields
  - `src-tauri/src/jira_sync.rs:199-229` — `build_jql_query()`: Replace with simple `key IN (...)` builder
  - `src-tauri/src/jira_sync.rs:240-249` — `map_jira_status_to_cockpit()`: REMOVE
  - `src-tauri/src/jira_sync.rs:252-294` — `upsert_ticket_from_jira()`: REMOVE

  **API/Type References**:
  - `src-tauri/src/db.rs` — `get_tasks_with_jira_links()` and `update_task_jira_info()` (from Task 1)
  - `src-tauri/src/jira_client.rs:65-105` — `search_issues()`: Still used, but with different JQL

  **WHY Each Reference Matters**:
  - The entire jira_sync.rs is being rewritten — the agent needs to understand the current structure to replace it correctly
  - The new DB methods from Task 1 are the API for the rewritten sync
  - search_issues stays but the JQL query changes fundamentally

  **Acceptance Criteria**:
  - [ ] Sync loop gets tasks with JIRA links, not JQL filter results
  - [ ] Sync never creates new tasks (only updates JIRA info on existing tasks)
  - [ ] Sync uses batch JQL `key IN (...)` for efficient API usage
  - [ ] `upsert_ticket_from_jira` and `map_jira_status_to_cockpit` removed
  - [ ] `jira-sync-complete` event still emitted after sync
  - [ ] `cargo build` succeeds

  **QA Scenarios**:

  ```
  Scenario: Sync does NOT create tasks
    Tool: Bash (cargo test)
    Preconditions: Test DB with no tasks
    Steps:
      1. Run: cargo test test_jira_sync_no_task_creation --manifest-path src-tauri/Cargo.toml -- --nocapture
      2. Test simulates sync with JIRA returning issues
      3. Verify: tasks table remains empty
    Expected Result: 0 tasks after sync
    Failure Indicators: Any task created
    Evidence: .sisyphus/evidence/task-4-sync-no-create.txt

  Scenario: Sync updates JIRA info on linked tasks only
    Tool: Bash (cargo test)
    Preconditions: Test DB with 2 tasks: one with jira_key="PROJ-10", one without
    Steps:
      1. Run: cargo test test_jira_sync_updates_linked --manifest-path src-tauri/Cargo.toml -- --nocapture
      2. Simulate sync with JIRA returning info for PROJ-10
      3. Verify: linked task has updated jira_status/jira_assignee
      4. Verify: unlinked task is unchanged
    Expected Result: Only linked task updated
    Failure Indicators: Unlinked task modified or linked task not updated
    Evidence: .sisyphus/evidence/task-4-sync-linked-only.txt
  ```

  **Commit**: YES
  - Message: `refactor(jira-sync): rewrite from JQL-pull to linked-task-refresh`
  - Files: `src-tauri/src/jira_sync.rs`
  - Pre-commit: `cargo build --manifest-path src-tauri/Cargo.toml`

---

- [ ] 5. GitHub Poller Update (PR Matching)

  **What to do**:
  - Update the PR matching logic in `github_poller.rs` to support dual matching:
    1. Get all task IDs and their JIRA keys: `db.get_task_ids_and_jira_keys()`
    2. For each GitHub PR, check if PR title or branch name contains:
       - Any local task ID (T-1, T-42, etc.)
       - Any linked JIRA key (PROJ-123, etc.) — resolve to the task(s) that link to it
    3. Link PR to ALL matching tasks (not just first match)
  - Also update the same dual-matching logic in `poll_pr_comments_now` command in main.rs — BUT since main.rs is handled by Task 3, coordinate: Task 5 should implement the core matching function, Task 3 should call it.
  - Build a shared helper function (or put it in github_poller.rs as a pub function):
    ```rust
    pub fn find_matching_task_ids(
        pr_title: &str, pr_branch: &str,
        task_ids: &[String],
        jira_key_map: &HashMap<String, Vec<String>> // jira_key -> [task_ids]
    ) -> Vec<String>
    ```
  - Handle the edge case where `T-42` matches the `[A-Z]+-\d+` regex pattern (this is fine — local IDs will naturally be found by JIRA key extraction)

  **Must NOT do**:
  - Don't change GitHub API calls or comment parsing logic
  - Don't change the PR table schema
  - Don't add PR deletion or cleanup logic beyond what exists

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Moderate complexity — rewriting matching logic with new data queries and multi-match handling
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 3, 4, 6, 7, 8, 9, 10)
  - **Blocks**: Tasks 12, 13
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src-tauri/src/main.rs:306-324` — Current PR matching in `poll_pr_comments_now`: This is the pattern to extend with dual matching
  - `src-tauri/src/github_poller.rs` — Background poller with similar matching logic (read to understand full flow)
  - `src-tauri/src/github_client.rs` — GitHub API types (GitHubPr, PrHead, etc.)

  **API/Type References**:
  - `src-tauri/src/db.rs` — `get_task_ids_and_jira_keys()`: New method from Task 1 for dual matching
  - `src-tauri/src/db.rs:413-442` — `insert_pull_request()`: Called for each match (unchanged)

  **WHY Each Reference Matters**:
  - The current matching logic in main.rs shows exactly what needs to change
  - github_poller.rs has the background version of the same logic
  - The new DB method provides the data needed for dual matching

  **Acceptance Criteria**:
  - [ ] PRs match on local task IDs (T-42 in title or branch)
  - [ ] PRs match on linked JIRA keys (PROJ-123 resolving to task T-5)
  - [ ] Multiple matching tasks ALL get the PR linked
  - [ ] `cargo build` succeeds

  **QA Scenarios**:

  ```
  Scenario: PR matches local task ID
    Tool: Bash (cargo test)
    Preconditions: Task T-42 exists, PR title contains "T-42"
    Steps:
      1. Run: cargo test test_pr_match_local_id --manifest-path src-tauri/Cargo.toml -- --nocapture
      2. Verify: PR linked to T-42
    Expected Result: PR correctly linked to task
    Failure Indicators: No match found
    Evidence: .sisyphus/evidence/task-5-pr-match-local.txt

  Scenario: PR matches via linked JIRA key
    Tool: Bash (cargo test)
    Preconditions: Task T-5 has jira_key="PROJ-123", PR branch contains "PROJ-123"
    Steps:
      1. Run: cargo test test_pr_match_jira_key --manifest-path src-tauri/Cargo.toml -- --nocapture
      2. Verify: PR linked to T-5
    Expected Result: PR correctly linked via JIRA key resolution
    Failure Indicators: No match or wrong task matched
    Evidence: .sisyphus/evidence/task-5-pr-match-jira.txt

  Scenario: PR matches multiple tasks
    Tool: Bash (cargo test)
    Preconditions: T-5 and T-8 both have jira_key="PROJ-123", PR mentions "PROJ-123"
    Steps:
      1. Run: cargo test test_pr_match_multiple --manifest-path src-tauri/Cargo.toml -- --nocapture
      2. Verify: PR linked to BOTH T-5 and T-8
    Expected Result: PR linked to all matching tasks
    Failure Indicators: Only one task gets the PR
    Evidence: .sisyphus/evidence/task-5-pr-match-multi.txt
  ```

  **Commit**: YES
  - Message: `feat(github): add dual PR matching via task ID and JIRA key`
  - Files: `src-tauri/src/github_poller.rs`
  - Pre-commit: `cargo build --manifest-path src-tauri/Cargo.toml`

---

- [ ] 6. Orchestrator Prompt Updates

  **What to do**:
  - Update prompt text in orchestrator.rs:
    - `start_implementation()` line 92: Change `"Read this JIRA ticket and propose..."` → `"Read this task and propose an implementation approach."`
    - Update the prompt format to use task title instead of relying on JIRA-style context
    - Update `"Ticket: {}"` → `"Task: {} - {}"`  (include title for context since T-42 is less descriptive than PROJ-123)
  - Update `get_ticket()` calls → `get_task()` calls (method renamed in Task 1)
  - Leave the overall orchestrator flow UNCHANGED (read_ticket → implement → create_pr stages)
  - Stage names like `"read_ticket"` can stay — renaming these changes event payloads and frontend stage label logic, which is out of scope

  **Must NOT do**:
  - Don't restructure the orchestrator flow
  - Don't rename stage names (read_ticket, implement, create_pr, address_comments)
  - Don't change checkpoint/approval logic
  - Don't change error handling patterns

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small text changes and method rename calls — 10-15 lines modified
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 3, 4, 5, 7, 8, 9, 10)
  - **Blocks**: Tasks 12, 13
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src-tauri/src/orchestrator.rs:49-142` — `start_implementation()`: Update prompt and db calls
  - `src-tauri/src/orchestrator.rs:58-66` — `db.get_ticket(ticket_id)`: Change to `db.get_task(ticket_id)`
  - `src-tauri/src/orchestrator.rs:91-98` — Prompt construction: Update text

  **Acceptance Criteria**:
  - [ ] No "JIRA" references in orchestrator prompt text
  - [ ] `get_task()` called instead of `get_ticket()`
  - [ ] `cargo build` succeeds

  **QA Scenarios**:

  ```
  Scenario: No JIRA references in orchestrator prompts
    Tool: Bash (grep)
    Steps:
      1. Run: grep -in "jira" src-tauri/src/orchestrator.rs
      2. Verify: no matches in prompt strings (JIRA may appear in comments, that's OK)
    Expected Result: No JIRA references in runtime prompt strings
    Evidence: .sisyphus/evidence/task-6-no-jira-prompts.txt
  ```

  **Commit**: YES (groups with Task 3 or standalone)
  - Message: `refactor(orchestrator): update prompts from JIRA ticket to task`
  - Files: `src-tauri/src/orchestrator.rs`
  - Pre-commit: `cargo build --manifest-path src-tauri/Cargo.toml`

---

- [ ] 7. AddTaskInline Component

  **What to do**:
  - Create new `src/components/AddTaskInline.svelte`:
    - Accepts prop: `column: KanbanColumn` (the column this inline-add is placed in)
    - Renders a "+" button. On click, expands to show a text input for task title.
    - On Enter or blur-if-not-empty: calls `createTask(title, '', column, null)` via IPC, then collapses and clears input.
    - On Escape: collapses without creating.
    - Shows brief loading state while IPC call is pending.
    - Dispatches `task-created` event so parent (KanbanBoard) can refresh the task list.
  - Style: Follow existing component styling (Tokyo Night theme, --bg-card, --border, etc.). Compact — should fit in the column header area.

  **Must NOT do**:
  - Don't add description, JIRA link, or other fields to inline add (that's what the dialog is for)
  - Don't add validation beyond "title not empty"

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: New UI component with interaction states, styling, and event handling
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: Component design with states (collapsed/expanded/loading), animation, theme consistency

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 3-6, 8, 9, 10)
  - **Blocks**: Task 11
  - **Blocked By**: Task 2

  **References**:

  **Pattern References**:
  - `src/components/TicketCard.svelte:1-31` — Component structure pattern (script + template + style, Svelte 4 conventions)
  - `src/components/TicketCard.svelte:76-88` — Card styling pattern (--bg-card, --border, --accent variables)
  - `src/components/KanbanBoard.svelte:99-113` — Column header styling to match

  **API/Type References**:
  - `src/lib/types.ts` — `KanbanColumn` type (after Task 2 updates)
  - `src/lib/ipc.ts` — `createTask()` function (after Task 2 updates)

  **Acceptance Criteria**:
  - [ ] Component renders a "+" button in collapsed state
  - [ ] Clicking "+" shows text input
  - [ ] Pressing Enter with non-empty text calls `createTask` IPC
  - [ ] Pressing Escape or submitting collapses the input
  - [ ] Dispatches `task-created` event after successful creation
  - [ ] Styling matches existing Tokyo Night theme

  **QA Scenarios**:

  ```
  Scenario: Inline task creation flow
    Tool: Bash (npx vitest run)
    Steps:
      1. Run: npx vitest run src/components/AddTaskInline.test.ts
      2. Test renders component with column="todo"
      3. Simulate: click "+" button, type "My new task", press Enter
      4. Assert: createTask IPC called with ("My new task", "", "todo", null)
    Expected Result: IPC called with correct arguments
    Evidence: .sisyphus/evidence/task-7-inline-add.txt

  Scenario: Escape cancels without creating
    Tool: Bash (npx vitest run)
    Steps:
      1. Test renders component, clicks "+", types text, presses Escape
      2. Assert: createTask NOT called, input collapsed
    Expected Result: No IPC call, clean cancellation
    Evidence: .sisyphus/evidence/task-7-inline-cancel.txt
  ```

  **Commit**: YES
  - Message: `feat(ui): add inline task creation component`
  - Files: `src/components/AddTaskInline.svelte`, `src/components/AddTaskInline.test.ts`

---

- [ ] 8. AddTaskDialog Component

  **What to do**:
  - Create new `src/components/AddTaskDialog.svelte`:
    - Modal/overlay dialog for creating or editing tasks with all fields.
    - Props: `mode: 'create' | 'edit'`, `task: Task | null` (null for create mode, populated for edit)
    - Fields: title (required), description (textarea, optional), JIRA key (text input, optional, placeholder "e.g. PROJ-123"), status (dropdown from COLUMNS)
    - On submit:
      - Create mode: `createTask(title, description, status, jiraKey)`
      - Edit mode: `updateTask(task.id, title, description, jiraKey)`
    - Dispatches `task-saved` event with the result
    - Close on overlay click, Escape key, or Cancel button
    - Validation: title required, JIRA key format hint (not strictly validated — user may use any format)
  - Style: Centered modal with overlay backdrop, matching existing dark theme

  **Must NOT do**:
  - Don't add JIRA search/autocomplete
  - Don't add priority, labels, or assignee fields
  - Don't validate JIRA key against JIRA API (just accept user input)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Full dialog/modal component with form fields, validation, dual mode, and overlay
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: Modal pattern, form UX, responsive design, accessibility

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 3-7, 9, 10)
  - **Blocks**: Task 12
  - **Blocked By**: Task 2

  **References**:

  **Pattern References**:
  - `src/components/SettingsPanel.svelte:72-145` — Form layout pattern (sections, labels, inputs, save button)
  - `src/components/SettingsPanel.svelte:147-274` — Form styling (--bg-primary input background, --border, --accent focus)
  - `src/components/DetailPanel.svelte:37-109` — Panel structure with header and content areas

  **API/Type References**:
  - `src/lib/types.ts` — `Task`, `KanbanColumn`, `COLUMNS`, `COLUMN_LABELS` (after Task 2)
  - `src/lib/ipc.ts` — `createTask()`, `updateTask()` (after Task 2)

  **Acceptance Criteria**:
  - [ ] Dialog renders with title, description, JIRA key, and status fields
  - [ ] Create mode: calls `createTask` on submit
  - [ ] Edit mode: pre-fills fields from task prop, calls `updateTask` on submit
  - [ ] Closes on Escape, Cancel click, and overlay click
  - [ ] Title field is required (submit disabled when empty)
  - [ ] `task-saved` event dispatched after successful save

  **QA Scenarios**:

  ```
  Scenario: Create task via dialog
    Tool: Bash (npx vitest run)
    Steps:
      1. Run: npx vitest run src/components/AddTaskDialog.test.ts
      2. Render in create mode (task=null, mode='create')
      3. Fill title "Auth feature", description "Add login", jiraKey "PROJ-42", status "todo"
      4. Click submit
      5. Assert: createTask called with ("Auth feature", "Add login", "todo", "PROJ-42")
    Expected Result: IPC called with correct form values
    Evidence: .sisyphus/evidence/task-8-dialog-create.txt

  Scenario: Edit task via dialog
    Tool: Bash (npx vitest run)
    Steps:
      1. Render in edit mode with existing task (id="T-5", title="Old title", jira_key=null)
      2. Change title to "New title", add jiraKey "PROJ-99"
      3. Click submit
      4. Assert: updateTask called with ("T-5", "New title", ..., "PROJ-99")
    Expected Result: IPC called with updated values
    Evidence: .sisyphus/evidence/task-8-dialog-edit.txt
  ```

  **Commit**: YES
  - Message: `feat(ui): add task creation/edit dialog component`
  - Files: `src/components/AddTaskDialog.svelte`, `src/components/AddTaskDialog.test.ts`

---

- [ ] 9. TaskCard Component (Rename + Update TicketCard)

  **What to do**:
  - Rename `src/components/TicketCard.svelte` → `src/components/TaskCard.svelte`
  - Rename `src/components/TicketCard.test.ts` → `src/components/TaskCard.test.ts`
  - Update imports: `Ticket` → `Task`, `PullRequestInfo` stays the same
  - Update prop type: `ticket: Ticket` → `task: Task`
  - Update template:
    - Display `task.id` (now "T-42" format instead of "PROJ-123")
    - Show JIRA key as a secondary badge if `task.jira_key` is not null (small chip like "PROJ-123")
    - Show `task.jira_assignee` instead of `task.assignee` (when not null, JIRA-supplementary)
    - Keep PR links display unchanged
    - Keep session status display unchanged
  - Update the `dispatch('select', task.id)` call
  - Update all internal variable names from `ticket` to `task`

  **Must NOT do**:
  - Don't add edit or delete buttons on the card (editing is via DetailPanel)
  - Don't change the card layout significantly — keep it compact

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Component rename + template updates + conditional JIRA badge
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: Badge design, conditional display, visual hierarchy

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 3-8, 10)
  - **Blocks**: Task 11
  - **Blocked By**: Task 2

  **References**:

  **Pattern References**:
  - `src/components/TicketCard.svelte:1-74` — ENTIRE FILE: rename and update
  - `src/components/TicketCard.svelte:33-74` — Template structure: update variable names and add JIRA badge
  - `src/components/TicketCard.svelte:76-193` — Styles: add JIRA badge styling

  **Acceptance Criteria**:
  - [ ] File renamed to TaskCard.svelte
  - [ ] Prop is `task: Task` (not `ticket: Ticket`)
  - [ ] Displays T-N format task IDs
  - [ ] Shows JIRA key badge when `task.jira_key` is not null
  - [ ] Hides JIRA badge when `task.jira_key` is null

  **QA Scenarios**:

  ```
  Scenario: Task card renders with local ID and JIRA badge
    Tool: Bash (npx vitest run)
    Steps:
      1. Run: npx vitest run src/components/TaskCard.test.ts
      2. Render TaskCard with task {id: "T-5", title: "Auth", jira_key: "PROJ-123", ...}
      3. Assert: "T-5" visible, "PROJ-123" badge visible
    Expected Result: Both IDs displayed correctly
    Evidence: .sisyphus/evidence/task-9-card-with-jira.txt

  Scenario: Task card renders without JIRA badge
    Tool: Bash (npx vitest run)
    Steps:
      1. Render TaskCard with task {id: "T-3", title: "Fix bug", jira_key: null, ...}
      2. Assert: "T-3" visible, no JIRA badge
    Expected Result: Clean card without JIRA info
    Evidence: .sisyphus/evidence/task-9-card-no-jira.txt
  ```

  **Commit**: YES
  - Message: `refactor(ui): rename TicketCard to TaskCard with JIRA badge support`
  - Files: `src/components/TaskCard.svelte`, `src/components/TaskCard.test.ts`

---

- [ ] 10. DetailPanel Update

  **What to do**:
  - Update `src/components/DetailPanel.svelte`:
    - Change prop: `ticket: Ticket` → `task: Task`
    - Overview tab: show task ID (T-N), title, description, status
    - Add JIRA info section (conditional, only when `task.jira_key` is not null):
      - Display: JIRA key (as clickable link to JIRA if base URL configured), JIRA status, JIRA assignee
    - Add "Edit" button that opens AddTaskDialog in edit mode (dispatches event, parent handles dialog display, OR use a local `showEditDialog` boolean with inline dialog)
    - Add status change: buttons or dropdown to move task to different kanban column (calls `updateTaskStatus`)
    - Update session reference: `$activeSessions.get(task.id)` instead of `ticket.id`
    - Update all variable names: `ticket` → `task`

  **Must NOT do**:
  - Don't add a delete button
  - Don't allow editing JIRA-supplementary fields (jira_status, jira_assignee) — they're read-only from JIRA sync
  - Don't change the Logs, Checkpoints, or PR Comments tabs (they work the same)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Significant UI updates — new sections, conditional rendering, edit button, status change UI
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: Section layout, conditional sections, status change UI patterns

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 3-9)
  - **Blocks**: Task 12
  - **Blocked By**: Task 2

  **References**:

  **Pattern References**:
  - `src/components/DetailPanel.svelte:1-109` — ENTIRE FILE: update throughout
  - `src/components/DetailPanel.svelte:58-89` — Overview tab: add JIRA info section and edit/status buttons
  - `src/components/DetailPanel.svelte:111-267` — Styles: add styles for new sections

  **API/Type References**:
  - `src/lib/ipc.ts` — `updateTaskStatus()`, `updateTask()` (after Task 2)
  - `src/lib/types.ts` — `Task`, `COLUMNS`, `COLUMN_LABELS` (after Task 2)

  **Acceptance Criteria**:
  - [ ] Prop is `task: Task`
  - [ ] JIRA info section shown when `task.jira_key` is not null
  - [ ] JIRA info section hidden when `task.jira_key` is null
  - [ ] Edit button present that triggers edit mode
  - [ ] Status change UI (buttons/dropdown) calls `updateTaskStatus`

  **QA Scenarios**:

  ```
  Scenario: Detail panel shows JIRA info for linked task
    Tool: Bash (npx vitest run)
    Steps:
      1. Run: npx vitest run src/components/DetailPanel.test.ts
      2. Render with task having jira_key="PROJ-10", jira_status="In Progress"
      3. Assert: JIRA section visible with "PROJ-10" and "In Progress"
    Expected Result: JIRA info displayed correctly
    Evidence: .sisyphus/evidence/task-10-detail-jira.txt

  Scenario: Detail panel hides JIRA info for unlinked task
    Tool: Bash (npx vitest run)
    Steps:
      1. Render with task having jira_key=null
      2. Assert: no JIRA section visible
    Expected Result: Clean detail view without JIRA section
    Evidence: .sisyphus/evidence/task-10-detail-no-jira.txt
  ```

  **Commit**: YES
  - Message: `refactor(ui): update DetailPanel for local tasks with optional JIRA info`
  - Files: `src/components/DetailPanel.svelte`

---

- [ ] 11. KanbanBoard Update

  **What to do**:
  - Update `src/components/KanbanBoard.svelte`:
    - Import `TaskCard` instead of `TicketCard`
    - Import `AddTaskInline` component
    - Update store references: `$tickets` → `$tasks`, `$selectedTicketId` → `$selectedTaskId`
    - Update type references: `Ticket` → `Task`
    - Add `<AddTaskInline {column} on:task-created={loadTasks} />` in each column header
    - Add "New Task" button in top bar or column area that opens AddTaskDialog
    - Update context menu: add "Move to →" submenu with status options (calls `updateTaskStatus`)
    - Keep "Start Implementation" context menu item
    - Update `ticketsForColumn` → `tasksForColumn`
    - Add a local `showAddDialog` state and render `<AddTaskDialog>` when true

  **Must NOT do**:
  - Don't add drag-and-drop between columns
  - Don't add reorder within columns
  - Don't change the column layout or scrolling behavior

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Substantial UI changes — new components integrated, context menu expansion, state management
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: Integration of new components, context menu design, state management

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Task 12)
  - **Blocks**: Tasks 12, 14
  - **Blocked By**: Tasks 2, 7, 9

  **References**:

  **Pattern References**:
  - `src/components/KanbanBoard.svelte:1-70` — ENTIRE FILE: update throughout
  - `src/components/KanbanBoard.svelte:20-39` — Context menu pattern: extend with "Move to" submenu
  - `src/components/KanbanBoard.svelte:44-64` — Column rendering: integrate AddTaskInline

  **Acceptance Criteria**:
  - [ ] `TaskCard` imported instead of `TicketCard`
  - [ ] `AddTaskInline` rendered in each column
  - [ ] Context menu has "Move to" submenu with all status options
  - [ ] "New Task" button accessible for opening AddTaskDialog
  - [ ] Store references use `$tasks` and `$selectedTaskId`

  **QA Scenarios**:

  ```
  Scenario: Board renders with inline add buttons
    Tool: Bash (npx vitest run)
    Steps:
      1. Run: npx vitest run src/components/KanbanBoard.test.ts
      2. Render KanbanBoard with mock tasks
      3. Assert: each column has an AddTaskInline "+" button
    Expected Result: 5 columns, each with inline add capability
    Evidence: .sisyphus/evidence/task-11-board-inline-add.txt
  ```

  **Commit**: YES
  - Message: `refactor(ui): update KanbanBoard for local task management`
  - Files: `src/components/KanbanBoard.svelte`

---

- [ ] 12. App.svelte + SettingsPanel Integration

  **What to do**:
  - **App.svelte**:
    - Update imports: `tickets` → `tasks`, `selectedTicketId` → `selectedTaskId`, `Ticket` → `Task`, `getTickets` → `getTasks`
    - Remove `PullRequestInfo` import if no longer needed at this level (check usage)
    - Update `loadTickets()` → `loadTasks()`: calls `getTasks()`
    - Update `loadPullRequests()`: should still work (PRs reference task IDs now)
    - Update `$selectedTicketId` → `$selectedTaskId` throughout
    - Update `selectedTicket` → `selectedTask` reactive declaration
    - Update DetailPanel prop: `ticket={selectedTask}` → `task={selectedTask}`
    - Keep all event listeners as-is (`jira-sync-complete` still triggers `loadTasks()`)
    - Handle `task-created` and `task-saved` events from AddTaskDialog to refresh the board
  - **SettingsPanel.svelte**:
    - Keep JIRA settings section (credentials still needed for read-only sync)
    - Consider adding a note: "JIRA sync updates linked task info only" in the JIRA section
    - Keep GitHub and OpenCode settings unchanged
    - No structural changes needed

  **Must NOT do**:
  - Don't remove JIRA settings from SettingsPanel
  - Don't change OpenCode or GitHub settings
  - Don't modify event listener structure beyond renaming

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Mostly find-and-replace renames plus minor integration wiring
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Task 11)
  - **Blocks**: Task 14
  - **Blocked By**: Tasks 2, 3-10

  **References**:

  **Pattern References**:
  - `src/App.svelte:1-170` — ENTIRE FILE: update variable names and imports
  - `src/components/SettingsPanel.svelte:1-145` — Review for any needed changes (mostly keep as-is)

  **Acceptance Criteria**:
  - [ ] No references to old `tickets` store, `Ticket` type, or `getTickets` function in App.svelte
  - [ ] DetailPanel receives `task` prop
  - [ ] `loadTasks()` calls `getTasks()` correctly
  - [ ] JIRA settings preserved in SettingsPanel
  - [ ] `npm run build` succeeds (full Vite production build)

  **QA Scenarios**:

  ```
  Scenario: Full Vite build succeeds
    Tool: Bash
    Steps:
      1. Run: npm run build 2>&1
      2. Verify: no TypeScript errors, no build failures
    Expected Result: Build completes with 0 errors
    Evidence: .sisyphus/evidence/task-12-vite-build.txt
  ```

  **Commit**: YES
  - Message: `refactor(app): integrate all task management changes in App.svelte`
  - Files: `src/App.svelte`, `src/components/SettingsPanel.svelte`
  - Pre-commit: `npm run build`

---

- [ ] 13. Rust Backend Tests

  **What to do**:
  - Add comprehensive `#[cfg(test)] mod tests` in `db.rs` for all new methods:
    - `test_create_task_autoincrement`: Create 3 tasks, verify T-1, T-2, T-3 IDs
    - `test_create_task_with_jira_key`: Create task with JIRA link, verify stored
    - `test_create_task_without_jira_key`: Create task with null JIRA key, verify stored
    - `test_update_task`: Modify title/description/jira_key, verify changes
    - `test_update_task_status`: Change status, verify change and updated_at
    - `test_update_task_jira_info`: Update JIRA info by key, verify correct tasks updated
    - `test_get_tasks_with_jira_links`: Verify only linked tasks returned
    - `test_migration_clean_slate`: Old schema → new schema migration
    - `test_migration_preserves_config`: Config survives migration
  - Add tests for JIRA sync new behavior (unit tests for the sync functions, not integration):
    - `test_jira_sync_batch_jql_construction`: Verify `key IN (...)` JQL format
  - Add tests for PR matching:
    - `test_find_matching_tasks_local_id`: T-42 matches
    - `test_find_matching_tasks_jira_key`: PROJ-123 resolves to linked tasks
    - `test_find_matching_tasks_multi_match`: Multiple tasks matched
  - Follow existing test patterns: `make_test_db()` helper, temp files, cleanup
  - Run: `cargo test --manifest-path src-tauri/Cargo.toml`

  **Must NOT do**:
  - Don't test JIRA API calls (those require network — test the sync logic functions, not HTTP)
  - Don't test OpenCode client
  - Don't add integration tests that require the full Tauri app running

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Substantial test suite covering multiple modules with careful assertions
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Task 14)
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 1, 3, 4, 5, 6

  **References**:

  **Pattern References**:
  - `src-tauri/src/db.rs:753-1248` — Existing test suite: follow patterns for new tests
  - `src-tauri/src/db.rs:832-851` — `make_test_db` + `insert_test_ticket` helpers: create equivalent `insert_test_task`
  - `src-tauri/src/jira_sync.rs:296-350` — Existing JIRA sync tests: update for new behavior
  - `src-tauri/src/orchestrator.rs:556-697` — Existing orchestrator tests: update for new db calls

  **Acceptance Criteria**:
  - [ ] All new tests pass: `cargo test --manifest-path src-tauri/Cargo.toml`
  - [ ] No test failures in existing tests
  - [ ] Test coverage for: create, read, update status, JIRA info update, migration, PR matching

  **QA Scenarios**:

  ```
  Scenario: Full Rust test suite passes
    Tool: Bash
    Steps:
      1. Run: cargo test --manifest-path src-tauri/Cargo.toml 2>&1
      2. Verify: all tests pass, 0 failures
    Expected Result: test result: ok. N passed; 0 failed
    Evidence: .sisyphus/evidence/task-13-cargo-test.txt
  ```

  **Commit**: YES
  - Message: `test(backend): add comprehensive tests for local task management`
  - Files: `src-tauri/src/db.rs` (test section), `src-tauri/src/jira_sync.rs` (test section), `src-tauri/src/github_poller.rs` (test section)
  - Pre-commit: `cargo test --manifest-path src-tauri/Cargo.toml`

---

- [ ] 14. Frontend Tests

  **What to do**:
  - Update existing test files:
    - `src/components/TaskCard.test.ts` (renamed from TicketCard.test.ts in Task 9): Update for `Task` type, new props, JIRA badge conditional
    - `src/components/Toast.test.ts`: Verify still passes (likely unchanged)
    - `src/components/CheckpointPanel.test.ts`: Verify still passes (likely unchanged)
  - Add new test files:
    - `src/components/AddTaskInline.test.ts`: Test collapse/expand, submit, cancel, IPC calls
    - `src/components/AddTaskDialog.test.ts`: Test create mode, edit mode, form validation, IPC calls
    - `src/components/KanbanBoard.test.ts`: Test task rendering, inline add integration, context menu
  - Mock IPC functions: `vi.mock('../lib/ipc', () => ({ createTask: vi.fn(), updateTask: vi.fn(), ... }))`
  - Use typed fixture objects: `const baseTask: Task = { id: 'T-1', title: 'Test task', ... }`
  - Run: `npm run test`

  **Must NOT do**:
  - Don't test Tauri runtime behavior (use mocked IPC)
  - Don't add Playwright/browser tests (unit tests only)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Multiple test files, testing patterns for new components, mock setup
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Task 13)
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 2, 7-12

  **References**:

  **Pattern References**:
  - `src/components/TicketCard.test.ts` — Existing test pattern: render, query, assert. Use as template.
  - `src/components/Toast.test.ts` — Another test example for reference
  - `src/__mocks__/@tauri-apps/api/core.ts` — Tauri API mock setup

  **Acceptance Criteria**:
  - [ ] All tests pass: `npm run test`
  - [ ] New test files: AddTaskInline.test.ts, AddTaskDialog.test.ts
  - [ ] Updated test: TaskCard.test.ts with Task type and JIRA badge tests

  **QA Scenarios**:

  ```
  Scenario: Full frontend test suite passes
    Tool: Bash
    Steps:
      1. Run: npm run test 2>&1
      2. Verify: all tests pass, 0 failures
    Expected Result: All test suites pass
    Evidence: .sisyphus/evidence/task-14-vitest.txt
  ```

  **Commit**: YES
  - Message: `test(frontend): add and update tests for task management components`
  - Files: `src/components/AddTaskInline.test.ts`, `src/components/AddTaskDialog.test.ts`, `src/components/TaskCard.test.ts`, `src/components/KanbanBoard.test.ts`
  - Pre-commit: `npm run test`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Rejection → fix → re-run.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `cargo build --manifest-path src-tauri/Cargo.toml` + `npm run build` + `npm run test` + `cargo test --manifest-path src-tauri/Cargo.toml`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real QA — Full Flow Verification** — `unspecified-high`
  Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration: create a task inline, edit it in detail panel, link JIRA, verify sync updates info. Test edge cases: empty title submit, long title, special characters in JIRA key. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff. Verify 1:1 — everything in spec was built, nothing beyond spec was built. Check "Must NOT do" compliance. Detect cross-task contamination. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

| After Task | Message | Files | Verification |
|------------|---------|-------|--------------|
| 1 | `refactor(db): rewrite schema for local-first task management` | db.rs | cargo build |
| 2 | `refactor(frontend): rename ticket to task in data layer` | types.ts, stores.ts, ipc.ts | — |
| 3 | `refactor(commands): replace JIRA-driven commands with local task CRUD` | main.rs | cargo build |
| 4 | `refactor(jira-sync): rewrite from JQL-pull to linked-task-refresh` | jira_sync.rs | cargo build |
| 5 | `feat(github): add dual PR matching via task ID and JIRA key` | github_poller.rs | cargo build |
| 6 | `refactor(orchestrator): update prompts from JIRA ticket to task` | orchestrator.rs | cargo build |
| 7 | `feat(ui): add inline task creation component` | AddTaskInline.svelte, test | — |
| 8 | `feat(ui): add task creation/edit dialog component` | AddTaskDialog.svelte, test | — |
| 9 | `refactor(ui): rename TicketCard to TaskCard with JIRA badge` | TaskCard.svelte, test | — |
| 10 | `refactor(ui): update DetailPanel for tasks with optional JIRA info` | DetailPanel.svelte | — |
| 11 | `refactor(ui): update KanbanBoard for local task management` | KanbanBoard.svelte | — |
| 12 | `refactor(app): integrate all task management changes` | App.svelte, SettingsPanel.svelte | npm run build |
| 13 | `test(backend): comprehensive tests for local task management` | db.rs, jira_sync.rs, github_poller.rs | cargo test |
| 14 | `test(frontend): tests for task management components` | *.test.ts | npm run test |

---

## Success Criteria

### Verification Commands
```bash
cargo build --manifest-path src-tauri/Cargo.toml  # Expected: compiles with 0 errors
cargo test --manifest-path src-tauri/Cargo.toml    # Expected: all tests pass
npm run build                                       # Expected: Vite build succeeds
npm run test                                        # Expected: all vitest tests pass
```

### Final Checklist
- [ ] Tasks can be created with auto-increment T-N IDs
- [ ] Tasks can be edited (title, description, JIRA link)
- [ ] Tasks can be moved between kanban columns
- [ ] JIRA info displayed as read-only on linked tasks
- [ ] JIRA sync only updates info on linked tasks, never creates tasks
- [ ] PRs match via local task ID OR linked JIRA key
- [ ] No "transition_ticket" or "sync_jira_now" commands remain
- [ ] No drag-and-drop, priorities, deletion, or JIRA write-back
- [ ] All Rust tests pass
- [ ] All frontend tests pass
- [ ] Both builds succeed (cargo + vite)
