# Full-Page Task Detail View

## DEPENDENCY: Requires `decouple-jira` plan completion first

> **This plan assumes the JIRA decouple is DONE.** All references use post-decouple naming:
> - `Task` (not `Ticket`), `tasks` store (not `tickets`), `selectedTaskId` (not `selectedTicketId`)
> - `TaskRow` in Rust, `Task` interface in TypeScript
> - IPC: `getTaskDetail()`, `updateTaskFields()`, `getTasks()`
> - DB: `tasks` table with `acceptance_criteria` and `plan_text` columns
> - SSE bridge already in main.rs (committed as `a18f6d1`)
>
> **Wave 1 (T1, T2, T3) from the original plan is REMOVED** — all foundation work is now
> handled by the decouple-jira plan + existing SSE bridge commit.

## TL;DR

> **Quick Summary**: Replace the side panel (DetailPanel) with a full-page two-column task detail view. Left column (dominant, ~70% width) provides a live-streaming agent chat panel powered by SSE, with checkpoint controls and abort. Right column (~30% width) shows task info + editable fields (acceptance criteria, plan). Navigation via simple view state switch — no router library.
> 
> **Deliverables**:
> - New `TaskDetailView.svelte` full-page component with two-column layout
> - New `TaskInfoPanel.svelte` (right) and `AgentChatPanel.svelte` (left) sub-components
> - Fixed PR comments data flow (currently broken — always empty)
> - Removed old `DetailPanel.svelte` side panel
> - Component tests for all new Svelte components
> 
> **Estimated Effort**: Medium
> **Parallel Execution**: YES — 4 waves (Wave 1 removed, handled by decouple-jira)
> **Critical Path**: T4 → T8 → T11 → F1-F4

---

## Context

### Original Request
User wants a full-page detail view when clicking a ticket card. The view should show all task information (description, acceptance criteria, plan) and provide deep integration with the OpenCode AI agent — real-time streaming of agent output, checkpoint interactions, session control.

### Interview Summary
**Key Discussions**:
- **Navigation**: Simple view state switch in App.svelte (same as Settings toggle). No router library needed for a desktop app.
- **Layout**: Two-column full-page — left for ticket info + editable fields, right for live agent chat
- **Side panel**: Replace entirely — clicking a card goes straight to the full-page detail view
- **Agent interaction**: Wire up existing SSE endpoint for live streaming, replacing 3-second polling
- **Agent controls**: Abort + checkpoint approve/reject (existing capabilities, no new controls)
- **Editable fields**: New local fields (acceptance_criteria, plan) as plain text — NOT synced to JIRA
- **General prompt**: Explicitly deferred to a future iteration
- **Tests**: After implementation, using existing Vitest infrastructure

### Metis Review
**Identified Gaps** (all addressed):
- **CRITICAL — upsert_ticket data loss**: Current `INSERT OR REPLACE` in `db.rs` clobbers entire rows on JIRA sync. New `acceptance_criteria` and `plan` fields would be wiped. Fix: change to `INSERT ... ON CONFLICT(id) DO UPDATE SET` that explicitly lists JIRA-synced columns only.
- **CRITICAL — SSE format unknown**: OpenCode's `/event` SSE endpoint format is undocumented. Fix: build a resilient SSE parser that forwards raw event data; let frontend display whatever comes through.
- **HIGH — PR comments data flow broken**: `prComments` in `App.svelte:17` is declared as `[]` and never populated. The PR Comments tab is always empty. Fix: load comments via existing `getPrComments(prId)` IPC when detail view mounts.
- **HIGH — Back navigation undefined**: No way to return to board from detail view. Fix: add back button in detail view header + Escape key handler.
- **HIGH — Empty state for right panel**: Most tickets have no active session. Fix: show clear "No active session" state with guidance.
- **MEDIUM — Save behavior for editable fields**: Fix: explicit Save button matching SettingsPanel pattern.
- **MEDIUM — SSE subscription lifecycle**: Fix: start on app launch (like jira_sync), frontend filters by session. Cleanup handled by Tauri on app close.

---

## Work Objectives

### Core Objective
Build a full-page task detail view that replaces the side panel, providing comprehensive ticket information display, local editable fields, and real-time AI agent interaction via SSE streaming.

### Concrete Deliverables
- `src/components/TaskDetailView.svelte` — full-page two-column layout container
- `src/components/TaskInfoPanel.svelte` — right column (info + editable fields + PR comments)
- `src/components/AgentChatPanel.svelte` — left column (live stream + controls)
- Updated `src/App.svelte` — view switch replacing side panel
- New test files for all new components

### Definition of Done
- [ ] `npm run build` succeeds with zero errors
- [ ] `cargo build` succeeds with zero warnings in project code
- [ ] `npm run test` passes — all existing + new tests green
- [ ] `cargo test` passes — all existing + new tests green
- [ ] Clicking a ticket card navigates to full-page detail view
- [ ] Back button and Escape return to Kanban board
- [ ] Editable fields save to DB and survive JIRA sync
- [ ] Agent events stream in real-time when a session is active
- [ ] Old DetailPanel.svelte is removed

### Must Have
- Two-column layout (left ~70%: agent chat/interaction, right ~30%: task info + editable fields)
- Editable acceptance_criteria and plan fields with explicit Save button
- Live SSE streaming replacing 3-second polling (SSE bridge already in main.rs)
- Checkpoint approve/reject inline in agent panel
- Abort session button
- Back-to-board navigation (button + Escape key)
- Empty state when no agent session exists

### Must NOT Have (Guardrails)
- **No router library** — use simple view state switch only
- **No markdown rendering** — plain text only, no markdown parser dependencies
- **No chat input** — user cannot type messages to the agent (general prompt feature deferred)
- **No session history** — show latest session only, not historical sessions
- **No new agent control types** — no pause/resume/restart, only existing abort + approve/reject
- **No JIRA write-back** — editable fields are local only
- **No modification to orchestrator.rs flow** — SSE is additive, not a replacement for the synchronous prompt flow
- **No modification to TicketCard's event dispatch interface** — the `select` event and its data shape must remain unchanged
- **No over-abstraction** — no utility function files, no component library patterns, no prop-drilling abstractions unless genuinely needed
- **No excessive comments** — JSDoc/docstrings only on exported functions, not on obvious code

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (Vitest + Testing Library for frontend, cargo test for Rust)
- **Automated tests**: Tests-after (implement first, then add component tests)
- **Framework**: Vitest (frontend), cargo test (Rust)

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

| Deliverable Type | Verification Tool | Method |
|------------------|-------------------|--------|
| Frontend/UI | Playwright (playwright skill) | Navigate, interact, assert DOM, screenshot |
| Backend/DB | Bash (cargo test) | Run tests, assert output |
| IPC/API | Bash (npm run test) | Vitest with mocked invoke |
| Build | Bash (npm run build && cargo build) | Assert zero errors |

---

## Execution Strategy

### Parallel Execution Waves

> **Wave 1 REMOVED** — T1 (DB), T2 (types/IPC), T3 (SSE bridge) are handled by `decouple-jira` plan + existing commits.

```
Wave 1 (UI Components — all three view components + wiring, 4 parallel):
├── Task 4: TaskDetailView.svelte + App.svelte navigation [visual-engineering]
├── Task 5: TaskInfoPanel.svelte (right column) [visual-engineering]
├── Task 6: AgentChatPanel.svelte (left column + SSE) [visual-engineering]
└── Task 7: PR comments loading fix [quick]

Wave 2 (Cleanup + Integration):
├── Task 8: Remove old DetailPanel + dead code cleanup [quick]
└── Task 9: Integration verification + polish [deep]

Wave 3 (Tests):
├── Task 11: Frontend tests for new components [unspecified-high]
└── Task 12: Full build + test suite verification [quick]

Wave FINAL (Independent review, 4 parallel):
├── Task F1: Plan compliance audit [oracle]
├── Task F2: Code quality review [unspecified-high]
├── Task F3: Real manual QA [unspecified-high]
└── Task F4: Scope fidelity check [deep]

Critical Path: T4 → T8 → T11 → F1-F4
Parallel Speedup: ~55% faster than sequential
Max Concurrent: 4 (Wave 1)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|------------|--------|------|
| T4 | decouple-jira complete | T8, T9 | 1 |
| T5 | decouple-jira complete | T8, T9 | 1 |
| T6 | decouple-jira complete | T8, T9 | 1 |
| T7 | decouple-jira complete | T9 | 1 |
| T8 | T4, T5, T6 | T11, T12 | 2 |
| T9 | T4, T5, T6, T7 | T11, T12 | 2 |
| T11 | T8, T9 | F1-F4 | 3 |
| T12 | T11 | F1-F4 | 3 |

### Agent Dispatch Summary

| Wave | # Parallel | Tasks → Agent Category |
|------|------------|----------------------|
| 1 | **4** | T4 → `visual-engineering`, T5 → `visual-engineering`, T6 → `visual-engineering`, T7 → `quick` |
| 2 | **2** | T8 → `quick`, T9 → `deep` |
| 3 | **2** | T11 → `unspecified-high`, T12 → `quick` |
| FINAL | **4** | F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep` |

---

## TODOs

- [x] 1. ~~Backend: DB schema migration + fix upsert + new CRUD + Tauri commands~~ — **SUPERSEDED by decouple-jira T1 + T3**

  **What to do**:
  - Add new columns to the `tickets` table via `ALTER TABLE` in `run_migrations()`:
    ```sql
    ALTER TABLE tickets ADD COLUMN acceptance_criteria TEXT;
    ALTER TABLE tickets ADD COLUMN plan_text TEXT;
    ```
    Use the `let _ = conn.execute(...)` pattern to silently ignore "duplicate column" errors (SQLite doesn't support `IF NOT EXISTS` for ALTER TABLE ADD COLUMN). Column name is `plan_text` to avoid conflict with SQL reserved word `plan`.
  - **CRITICAL**: Change `upsert_ticket()` from `INSERT OR REPLACE` to `INSERT ... ON CONFLICT(id) DO UPDATE SET` that explicitly lists only JIRA-synced columns. The new fields (`acceptance_criteria`, `plan_text`) MUST NOT appear in the ON CONFLICT UPDATE clause:
    ```sql
    INSERT INTO tickets (id, title, description, status, jira_status, assignee, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      status = excluded.status,
      jira_status = excluded.jira_status,
      assignee = excluded.assignee,
      updated_at = excluded.updated_at
    ```
  - Add `acceptance_criteria` and `plan_text` fields to `TicketRow` struct (both `Option<String>`)
  - Update `get_all_tickets()` and `get_ticket()` SELECT queries to include the new columns
  - Add new method `update_ticket_fields(&self, id: &str, acceptance_criteria: Option<&str>, plan_text: Option<&str>) -> Result<()>` that updates ONLY the editable fields
  - Add new Tauri commands in `main.rs`:
    - `get_ticket_detail(ticket_id: String) -> Result<TicketRow, String>` — returns single ticket with all fields
    - `update_ticket_fields(ticket_id: String, acceptance_criteria: String, plan_text: String) -> Result<(), String>` — saves editable fields
  - Register the new commands in the `generate_handler![]` macro

  **Must NOT do**:
  - Do NOT modify the existing `CREATE TABLE IF NOT EXISTS tickets` statement
  - Do NOT change the `upsert_ticket` method signature (callers in `main.rs:sync_jira_now` must still work)
  - Do NOT add `acceptance_criteria` or `plan_text` to the `upsert_ticket` parameter list

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Backend Rust work touching DB schema, SQL queries, and Tauri commands — requires careful handling of SQL migration edge cases
  - **Skills**: []
    - No special skills needed — standard Rust/SQL work
  - **Skills Evaluated but Omitted**:
    - `golang`: Not relevant — this is Rust

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T2, T3)
  - **Blocks**: T4, T5, T6, T7, T8
  - **Blocked By**: None (can start immediately)

  **References** (CRITICAL):

  **Pattern References**:
  - `src-tauri/src/db.rs:100-217` — `run_migrations()` method where ALTER TABLE statements should be added (after line 214, before the `Ok(())`)
  - `src-tauri/src/db.rs:258-285` — Current `upsert_ticket()` method that MUST be changed from INSERT OR REPLACE to ON CONFLICT
  - `src-tauri/src/db.rs:288-312` — `get_all_tickets()` SELECT query that needs new columns added
  - `src-tauri/src/db.rs:616-636` — `get_ticket()` SELECT query that needs new columns added
  - `src-tauri/src/db.rs:7-17` — `TicketRow` struct that needs new fields
  - `src-tauri/src/db.rs:225-245` — `get_config`/`set_config` pattern to follow for the new update method

  **API/Type References**:
  - `src-tauri/src/main.rs:553-572` — Existing `get_config`/`set_config` Tauri commands as pattern for new commands
  - `src-tauri/src/main.rs:671-693` — `generate_handler![]` macro where new commands must be registered

  **Test References**:
  - `src-tauri/src/db.rs:853-878` — `test_upsert_ticket_insert_and_retrieve` — pattern for DB tests
  - `src-tauri/src/db.rs:880-907` — `test_upsert_ticket_update_existing` — critical: a similar test should verify that upsert preserves new fields

  **WHY Each Reference Matters**:
  - `run_migrations()` is where schema changes go — add ALTER TABLE after existing CREATE TABLE statements
  - `upsert_ticket()` is the CRITICAL fix — current INSERT OR REPLACE destroys any data not in the INSERT column list
  - `TicketRow` changes flow through to the frontend via Tauri command serialization — Serde derives handle it automatically
  - Test patterns show how to create temp DBs and clean up after

  **Acceptance Criteria**:

  - [ ] `cargo build` succeeds with no errors
  - [ ] `cargo test` passes — all existing DB tests still green
  - [ ] New columns exist after migration (verified by Rust test inserting and reading back)
  - [ ] `upsert_ticket` preserves `acceptance_criteria` and `plan_text` when called (verified by test: set fields, call upsert, read back, assert fields unchanged)
  - [ ] New `update_ticket_fields` method works (verified by test)
  - [ ] New Tauri commands registered and callable

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: JIRA sync preserves user-edited fields
    Tool: Bash (cargo test)
    Preconditions: Clean test database
    Steps:
      1. Insert ticket PROJ-1 via upsert_ticket with title "Original"
      2. Call update_ticket_fields("PROJ-1", "My criteria", "My plan")
      3. Read back ticket, assert acceptance_criteria = "My criteria" and plan_text = "My plan"
      4. Call upsert_ticket("PROJ-1", "Updated Title", ...) again (simulating JIRA sync)
      5. Read back ticket, assert title = "Updated Title" AND acceptance_criteria = "My criteria" AND plan_text = "My plan"
    Expected Result: New fields survive upsert — title changed but acceptance_criteria/plan_text preserved
    Failure Indicators: acceptance_criteria or plan_text is NULL after step 5
    Evidence: .sisyphus/evidence/task-1-upsert-preserves-fields.txt

  Scenario: Schema migration handles existing database
    Tool: Bash (cargo test)
    Preconditions: Test database created with initial schema (no new columns)
    Steps:
      1. Create Database (runs migrations including ALTER TABLE)
      2. Insert ticket with upsert_ticket
      3. Read back ticket, assert acceptance_criteria is None and plan_text is None
      4. Update fields, read back, assert values set
    Expected Result: Migration adds columns without errors, NULL default works
    Failure Indicators: Migration error, column not found
    Evidence: .sisyphus/evidence/task-1-migration-existing-db.txt
  ```

  **Commit**: YES
  - Message: `feat(db): add editable ticket fields with safe upsert`
  - Files: `src-tauri/src/db.rs`, `src-tauri/src/main.rs`
  - Pre-commit: `cargo test`

---

- [x] 2. ~~Frontend: types + IPC wrappers + navigation store~~ — **SUPERSEDED by decouple-jira T2**

  **What to do**:
  - Update `Ticket` interface in `types.ts` to add:
    ```typescript
    acceptance_criteria: string | null;
    plan_text: string | null;
    ```
  - Add new SSE event type in `types.ts`:
    ```typescript
    export interface OpenCodeEvent {
      event_type: string;
      data: string;
      session_id: string | null;
    }
    ```
  - Add new IPC wrappers in `ipc.ts`:
    ```typescript
    export async function getTicketDetail(ticketId: string): Promise<Ticket> { ... }
    export async function updateTicketFields(ticketId: string, acceptanceCriteria: string, planText: string): Promise<void> { ... }
    ```
  - Update `stores.ts` — the existing `selectedTicketId` store already serves as the navigation state. When it's non-null, the detail view shows. When null, the board shows. No new store needed — this matches the existing pattern. However, add a comment clarifying this dual purpose.

  **Must NOT do**:
  - Do NOT add a separate routing store or view state enum — `selectedTicketId` is sufficient
  - Do NOT remove or rename any existing store exports
  - Do NOT modify existing IPC function signatures

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small changes across three files — adding type fields, function wrappers, and a comment
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: No visual work in this task

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1, T3)
  - **Blocks**: T4, T5, T6, T7
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src/lib/types.ts:1-10` — Existing `Ticket` interface to extend (add fields after line 9, before closing brace)
  - `src/lib/ipc.ts:1-79` — IPC wrapper pattern (invoke with type params, typed return)
  - `src/lib/stores.ts:1-9` — Store pattern with writable
  - `src/lib/types.ts:56-61` — `OpenCodeStatus` interface as pattern for the new `OpenCodeEvent`

  **WHY Each Reference Matters**:
  - `Ticket` interface is used by every component that displays ticket data — adding fields here flows through automatically via TypeScript's structural typing
  - IPC wrappers follow a strict pattern: typed return, string invoke name matching Rust command names
  - The stores file is minimal and should stay minimal — don't over-engineer

  **Acceptance Criteria**:

  - [ ] TypeScript compiles with no errors (`npx tsc --noEmit`)
  - [ ] `Ticket` interface includes `acceptance_criteria: string | null` and `plan_text: string | null`
  - [ ] `OpenCodeEvent` interface exported from types.ts
  - [ ] `getTicketDetail` and `updateTicketFields` functions exported from ipc.ts
  - [ ] Existing imports in other files still resolve (no breaking changes)

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: TypeScript compilation passes
    Tool: Bash
    Preconditions: All source files present
    Steps:
      1. Run `npx tsc --noEmit` from project root
    Expected Result: Exit code 0, no type errors
    Failure Indicators: Any "error TS" lines in output
    Evidence: .sisyphus/evidence/task-2-tsc-check.txt

  Scenario: Existing tests still pass
    Tool: Bash
    Preconditions: node_modules installed
    Steps:
      1. Run `npm run test`
    Expected Result: All existing tests pass (TicketCard, Toast, CheckpointPanel)
    Failure Indicators: Any test failures
    Evidence: .sisyphus/evidence/task-2-existing-tests.txt
  ```

  **Commit**: YES
  - Message: `feat(types): add editable ticket fields and SSE event types`
  - Files: `src/lib/types.ts`, `src/lib/ipc.ts`, `src/lib/stores.ts`
  - Pre-commit: `npm run test`

---

- [x] 3. ~~Backend: SSE event bridge (background task)~~ — **DONE, committed as `a18f6d1`, preserved by decouple-jira T3**

  **What to do**:
  - Add a background task in `main.rs` setup (after `OpenCodeManager::start()` and `OpenCodeClient` creation) that:
    1. Calls `opencode_client.subscribe_events().await`
    2. Reads the byte stream, buffering bytes and splitting by `\n\n` (SSE event boundary)
    3. For each event block, extracts `event:` and `data:` fields
    4. Emits parsed events to the frontend via `app.emit("opencode-event", payload)`
  - Follow the exact same `tokio::spawn` + `app_handle.clone()` pattern as `jira_sync::start_jira_sync` (main.rs:655-658) and `github_poller::start_github_poller` (main.rs:662-665)
  - SSE parsing should be resilient to unknown event formats:
    - Buffer incoming bytes into a String
    - Split on `\n\n` to get event blocks
    - For each block, split lines and extract `event:` and `data:` prefixes
    - Forward as `{ event_type: String, data: String }` JSON
  - Handle SSE connection drops gracefully: log the error, wait 5 seconds, reconnect. Loop forever.
  - Add a serializable struct for the SSE event payload:
    ```rust
    #[derive(serde::Serialize, Clone)]
    struct SseEventPayload {
        event_type: String,
        data: String,
    }
    ```

  **Must NOT do**:
  - Do NOT modify `orchestrator.rs` — SSE is additive observation, not a replacement
  - Do NOT create a Tauri command for this — it's a background task, not request-response
  - Do NOT try to filter events by session on the backend — let the frontend filter
  - Do NOT add complex reconnection logic (exponential backoff, jitter) — simple 5s sleep is fine

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Async Rust with streaming, SSE parsing, and error handling — requires careful handling of the tokio stream API
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `golang`: Not relevant

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1, T2)
  - **Blocks**: T6
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src-tauri/src/main.rs:655-658` — `jira_sync::start_jira_sync` background task spawn pattern (FOLLOW THIS EXACTLY)
  - `src-tauri/src/main.rs:662-665` — `github_poller::start_github_poller` spawn pattern (same approach)
  - `src-tauri/src/opencode_client.rs:174-197` — `subscribe_events()` method that returns `EventStream`
  - `src-tauri/src/opencode_client.rs:240-250` — `EventStream` struct with `into_stream()` returning byte stream
  - `src-tauri/src/main.rs:628-634` — Where `OpenCodeManager::start()` runs — SSE task should start after this

  **External References**:
  - SSE format spec: events are separated by `\n\n`, fields are `event: type\ndata: payload\n`
  - `tokio_stream::StreamExt` — already in Cargo.toml dependencies, used for `.next().await` on the stream

  **WHY Each Reference Matters**:
  - The `jira_sync` spawn pattern is the PROVEN approach for long-running background tasks in this codebase
  - `subscribe_events()` already handles the HTTP connection — we just need to consume the byte stream
  - `into_stream()` returns `impl Stream<Item = Result<Bytes, reqwest::Error>>` — buffer and parse

  **Acceptance Criteria**:

  - [ ] `cargo build` succeeds
  - [ ] `cargo test` passes (all existing tests green)
  - [ ] Background task is spawned in `main.rs` setup after OpenCode manager starts
  - [ ] SSE parsing handles standard SSE format (`event:`, `data:` lines separated by `\n\n`)
  - [ ] Events emitted via `app.emit("opencode-event", ...)` with serialized payload
  - [ ] Connection drop is handled with reconnection after 5s delay

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: SSE bridge compiles and integrates
    Tool: Bash
    Preconditions: Source code updated
    Steps:
      1. Run `cargo build` from src-tauri/
      2. Verify no compilation errors
      3. Grep main.rs for "opencode-event" to confirm emit is present
      4. Grep main.rs for the tokio::spawn call for SSE
    Expected Result: Build succeeds, SSE task spawn is present in setup
    Failure Indicators: Compilation errors, missing spawn call
    Evidence: .sisyphus/evidence/task-3-sse-bridge-build.txt

  Scenario: Existing tests unaffected
    Tool: Bash
    Preconditions: Cargo builds
    Steps:
      1. Run `cargo test` from src-tauri/
    Expected Result: All existing tests pass
    Failure Indicators: Any test failures
    Evidence: .sisyphus/evidence/task-3-cargo-test.txt
  ```

  **Commit**: YES
  - Message: `feat(sse): add background SSE event bridge for real-time agent streaming`
  - Files: `src-tauri/src/main.rs`
  - Pre-commit: `cargo test`

---

- [ ] 4. TaskDetailView.svelte + App.svelte navigation wiring

  **What to do**:
  - Create `src/components/TaskDetailView.svelte` — the full-page two-column layout container:
    - **Header bar**: Back button (left-arrow + "Back to Board"), task ID, task title, status badge
    - **Two-column body**: Left column (70% width, dominant) and right column (30% width) with a vertical divider
    - Left column renders `<AgentChatPanel>` (built in T6) — the primary focus of the view
    - Right column renders `<TaskInfoPanel>` (built in T5) — scrollable sidebar with task details
    - Props: `task: Task` (full task object)
    - Escape key handler: listen on `svelte:window` for Escape, navigate back
    - Responsive: min-width 800px before columns stack vertically
  - Modify `src/App.svelte` to replace the side panel with full-page navigation:
    - When `$selectedTaskId` is non-null, show `<TaskDetailView>` INSTEAD of the board (not alongside it)
    - Remove the `detail-area` div and `DetailPanel` import
    - Keep the `has-detail` CSS class logic removal (no longer needed)
    - The board is hidden when detail view is shown (same pattern as `showSettings`)
    - When `$selectedTaskId` is set to null (back button or Escape), board is shown again
  - For now, use placeholder text ("Info panel here", "Chat panel here") for the left and right columns — T5 and T6 will fill these in

  **Must NOT do**:
  - Do NOT import a router library
  - Do NOT change TicketCard's event dispatch or KanbanBoard's event handling
  - Do NOT remove DetailPanel.svelte file yet (that's T8)
  - Do NOT implement the left/right panel contents (T5 and T6 handle that)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Full-page layout design, responsive CSS, visual structure — core UI architecture work
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: Layout design, responsive behavior, visual hierarchy
  - **Skills Evaluated but Omitted**:
    - `playwright`: Not needed for building — only for QA verification

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T5, T6, T7)
  - **Blocks**: T8, T9
  - **Blocked By**: T1, T2

  **References**:

  **Pattern References**:
  - `src/App.svelte:149-169` — Current view switching pattern (`showSettings` toggle) — follow this same approach for detail view
  - `src/App.svelte:119-170` — Main layout structure (header + main content)
  - `src/components/DetailPanel.svelte:37-109` — Current detail panel structure to be superseded (reference for what information to include in header)
  - `src/App.svelte:174-186` — CSS variables (dark theme) that must be used in new component

  **API/Type References**:
  - `src/lib/types.ts:1-10` — `Ticket` interface (will have new fields after T2)
  - `src/lib/stores.ts:5` — `selectedTicketId` store — setting to null navigates back

  **WHY Each Reference Matters**:
  - `App.svelte:149-169` shows the exact conditional rendering pattern to follow — `{#if selectedTicket}` replaces `{#if showSettings}`
  - CSS variables must be consistent with the existing dark theme
  - `selectedTicketId` store is the single source of truth for navigation state

  **Acceptance Criteria**:

  - [ ] `TaskDetailView.svelte` renders a two-column layout with header
  - [ ] App.svelte shows TaskDetailView when selectedTicketId is set, hides board
  - [ ] Back button and Escape key set selectedTicketId to null, restoring board
  - [ ] Layout uses CSS variables from the existing theme
  - [ ] Responsive: columns stack below 800px width
  - [ ] `npm run build` succeeds

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Navigation from board to detail view
    Tool: Playwright (playwright skill)
    Preconditions: App running with at least one ticket in the database
    Steps:
      1. Navigate to the app (localhost:1420 or Tauri window)
      2. Verify Kanban board is visible (selector: `.kanban`)
      3. Click a ticket card (selector: `.card`)
      4. Verify Kanban board is hidden
      5. Verify TaskDetailView is visible (selector: `.task-detail-view`)
      6. Verify header shows ticket ID and title
      7. Verify two columns are visible — left (agent chat, wider) and right (ticket info, narrower)
    Expected Result: Full-page detail view replaces board
    Failure Indicators: Board still visible, detail view not rendered, missing columns
    Evidence: .sisyphus/evidence/task-4-nav-to-detail.png

  Scenario: Back navigation restores board
    Tool: Playwright (playwright skill)
    Preconditions: Detail view is open
    Steps:
      1. Click back button (selector: `.back-btn`)
      2. Verify Kanban board is visible again (selector: `.kanban`)
      3. Verify detail view is hidden
    Expected Result: Board restored, detail view gone
    Failure Indicators: Detail view still showing, board not restored
    Evidence: .sisyphus/evidence/task-4-back-nav.png

  Scenario: Escape key navigates back
    Tool: Playwright (playwright skill)
    Preconditions: Detail view is open
    Steps:
      1. Press Escape key
      2. Verify Kanban board is visible
    Expected Result: Same as back button
    Failure Indicators: Escape doesn't navigate back
    Evidence: .sisyphus/evidence/task-4-escape-nav.png
  ```

  **Commit**: YES
  - Message: `feat(ui): add full-page task detail view with two-column layout`
  - Files: `src/components/TaskDetailView.svelte`, `src/App.svelte`
  - Pre-commit: `npm run test`

---

- [ ] 5. TaskInfoPanel.svelte (right column)

  **What to do**:
  - Create `src/components/TaskInfoPanel.svelte` — the right column of the detail view:
    - **Task metadata section**: Status badge, JIRA status (if jira_key set), jira_assignee, created/updated dates (read-only display fields)
    - **Description section**: Full task description in a scrollable `<pre>` block (read-only)
    - **Acceptance Criteria section**: `<textarea>` for editing acceptance_criteria, with a "Save" button. Load initial value from `task.acceptance_criteria`. On save, call `updateTaskFields()` IPC. Show brief "Saved!" feedback after successful save (match SettingsPanel pattern).
    - **Plan section**: Same as above but for `plan_text` field
    - **Save behavior**: Single "Save" button at the bottom that saves both fields at once. Disabled while saving. Shows "Saved!" for 2 seconds after success.
    - **PR Links section**: Display pull requests from `$ticketPrs` store for this task. Each PR shows as a clickable link (using `openUrl` IPC). Show PR state (open/closed) with color coding.
    - **PR Comments section**: For each PR, load comments via `getPrComments(prId)` IPC on component mount. Display comments grouped by PR. Show unaddressed count badge. Allow marking comments as addressed inline.
    - Props: `task: Task`
  - Scroll the entire right panel independently

  **Must NOT do**:
  - Do NOT add markdown rendering
  - Do NOT add form validation beyond disabling save while in-flight
  - Do NOT sync fields back to JIRA
  - Do NOT add undo/redo for text fields
  - Do NOT add auto-save — explicit save button only

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Form layout, editable fields, data display — core UI/UX component work
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: Form design, save interaction pattern, visual hierarchy
  - **Skills Evaluated but Omitted**:
    - `playwright`: Not needed for building

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T4, T6, T7)
  - **Blocks**: T8, T9
  - **Blocked By**: T1, T2

  **References**:

  **Pattern References**:
  - `src/components/DetailPanel.svelte:59-89` — Current overview tab showing ticket metadata fields — same data, new layout
  - `src/components/SettingsPanel.svelte:42-65` — Save behavior pattern: `isSaving` flag, `saved` flag with setTimeout to clear, disabled button while saving
  - `src/components/PrCommentsPanel.svelte:1-72` — PR comments display pattern with checkboxes and "Address Selected" button
  - `src/components/DetailPanel.svelte:111-266` — CSS patterns for field labels, values, and layout

  **API/Type References**:
   - `src/lib/types.ts` — `Task` interface with `acceptance_criteria` and `plan_text` fields (post-decouple naming)
   - `src/lib/types.ts` — `PullRequestInfo` interface for PR display
   - `src/lib/types.ts` — `PrComment` interface for comment display
   - `src/lib/ipc.ts` — `updateTaskFields()`, `getPrComments()`, `markCommentAddressed()`, `openUrl()` functions
   - `src/lib/stores.ts` — `ticketPrs` store for PR data

  **WHY Each Reference Matters**:
  - `DetailPanel.svelte:59-89` has the exact field display pattern (label + value) to replicate
  - `SettingsPanel.svelte:42-65` has the EXACT save UX pattern the user expects (Save/Saving.../Saved! flow)
  - `PrCommentsPanel.svelte` has PR comment display and "address" interaction to move into this panel
  - The `ticketPrs` store is already populated by `App.svelte:loadPullRequests()`

  **Acceptance Criteria**:

  - [ ] Displays all task metadata (status, jira_assignee, dates, description)
  - [ ] Editable textarea for acceptance_criteria and plan_text
  - [ ] Save button calls `updateTaskFields()` IPC
  - [ ] Save button shows Saving.../Saved! states
  - [ ] PR links displayed with state color coding
  - [ ] PR comments loaded and displayed per PR
  - [ ] Comments can be marked as addressed
  - [ ] Panel scrolls independently

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Display ticket information
    Tool: Playwright (playwright skill)
    Preconditions: App running, ticket exists in DB with description
    Steps:
      1. Navigate to a ticket's detail view
      2. Verify ticket status is displayed (selector: `.ticket-status`)
      3. Verify description is displayed in a pre block (selector: `.description`)
      4. Verify editable textareas exist for acceptance criteria and plan (selectors: `textarea.acceptance-criteria`, `textarea.plan-text`)
    Expected Result: All ticket data visible, editable fields present
    Failure Indicators: Missing fields, empty display for non-null data
    Evidence: .sisyphus/evidence/task-5-ticket-info-display.png

  Scenario: Save editable fields
    Tool: Playwright (playwright skill)
    Preconditions: Detail view open for a ticket
    Steps:
      1. Type "Test criteria" into acceptance criteria textarea
      2. Type "Test plan" into plan text textarea
      3. Click Save button (selector: `.btn-save`)
      4. Verify button text changes to "Saved!" temporarily
      5. Navigate back to board and re-open the same ticket
      6. Verify fields still contain "Test criteria" and "Test plan"
    Expected Result: Fields persist across navigation
    Failure Indicators: Fields empty after re-opening, save button doesn't respond
    Evidence: .sisyphus/evidence/task-5-save-fields.png

  Scenario: Empty state for fields
    Tool: Playwright (playwright skill)
    Preconditions: Ticket with no acceptance_criteria or plan_text set
    Steps:
      1. Open ticket detail view
      2. Verify textareas are empty but present
      3. Verify placeholder text is shown
    Expected Result: Empty textareas with placeholder guidance
    Failure Indicators: Missing textareas, error state
    Evidence: .sisyphus/evidence/task-5-empty-fields.png
  ```

  **Commit**: YES
   - Message: `feat(ui): add task info panel with editable fields and PR section`
   - Files: `src/components/TaskInfoPanel.svelte`
  - Pre-commit: `npm run test`

---

- [ ] 6. AgentChatPanel.svelte (right column + SSE wiring)

  **What to do**:
  - Create `src/components/AgentChatPanel.svelte` — the right column of the detail view:
    - **State management**: Read session from `$activeSessions` store using `task.id` as key
    - **Empty state (no session)**: Display "No active agent session" with brief guidance text. This is the default state for most tasks.
    - **Running state**: Display a live-scrolling event log. Listen for `opencode-event` Tauri events via `listen()` from `@tauri-apps/api/event`. Filter events that belong to the current session (if the event payload includes session info) or display all events while a session is active. Each event rendered as a timestamped log entry (similar to current LogViewer pattern). Auto-scroll to bottom on new events (with auto-scroll toggle).
    - **Paused state (checkpoint)**: Display the checkpoint data in a readable format. Show Approve and Reject buttons with feedback input. Use the same checkpoint interaction pattern as current `CheckpointPanel.svelte`.
    - **Failed state**: Display error message, abort status
    - **Completed state**: Display "Session completed" with summary
    - **Abort button**: Visible when session is running or paused. Calls `abortSession()` IPC.
    - **Stage indicator**: Show current stage label (Reading Ticket, Implementing, Creating PR, Addressing Comments)
    - Cleanup: `onDestroy` to remove the `opencode-event` listener
   - Props: `task: Task`

  **Must NOT do**:
  - Do NOT add a message input box (no chat input — deferred)
  - Do NOT show historical sessions — latest only
  - Do NOT add pause/resume controls
  - Do NOT modify orchestrator.rs
  - Do NOT keep the 3-second polling from LogViewer — use SSE events exclusively, with a fallback to polling ONLY if SSE events aren't arriving after 10 seconds (graceful degradation)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Real-time event display, multiple UI states, streaming interaction — complex frontend component
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: State-driven UI, real-time updates, interaction patterns
  - **Skills Evaluated but Omitted**:
    - `playwright`: Not needed for building

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T4, T5, T7)
  - **Blocks**: T8, T9
  - **Blocked By**: T1, T2, T3

  **References**:

  **Pattern References**:
  - `src/components/LogViewer.svelte:1-99` — Current log display pattern with auto-scroll, timestamp formatting, log entry styling. Supersede but follow visual approach.
  - `src/components/CheckpointPanel.svelte:1-176` — Checkpoint approve/reject pattern. Reuse this logic in the paused state section.
  - `src/components/DetailPanel.svelte:81-89` — Agent status display and abort button pattern
  - `src/App.svelte:69-111` — Tauri event listener pattern with `listen()` and `onDestroy` cleanup via `UnlistenFn`

  **API/Type References**:
  - `src/lib/types.ts:12-22` — `AgentSession` interface with stage, status, checkpoint_data
  - `src/lib/stores.ts:6` — `activeSessions` store (Map<string, AgentSession>)
  - `src/lib/ipc.ts:24-30` — `approveCheckpoint()`, `rejectCheckpoint()` functions
  - `src/lib/ipc.ts:40-42` — `abortSession()` function
  - `@tauri-apps/api/event` — `listen()` function for subscribing to Tauri events

  **WHY Each Reference Matters**:
  - `LogViewer.svelte` has the exact scrolling log pattern to replicate (auto-scroll toggle, monospace font, timestamped entries)
  - `CheckpointPanel.svelte` has the approve/reject UX to embed inline (not as a separate tab anymore)
  - `App.svelte:69-111` shows how to properly subscribe to Tauri events with cleanup — CRITICAL for preventing listener leaks
  - `activeSessions` store is already updated by App.svelte's event listeners — AgentChatPanel just reads from it reactively

  **Acceptance Criteria**:

  - [ ] Displays "No active session" when no session exists for the ticket
  - [ ] Shows stage label and status when session is active
  - [ ] Listens for `opencode-event` Tauri events and displays them as log entries
  - [ ] Auto-scrolls to bottom on new events
  - [ ] Shows checkpoint data and approve/reject buttons when session is paused
  - [ ] Abort button visible and functional when session is running/paused
  - [ ] Shows error message when session failed
  - [ ] Shows completion state when session finished
  - [ ] Event listener cleaned up on component destroy

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Empty state — no agent session
    Tool: Playwright (playwright skill)
    Preconditions: Ticket with no agent session in activeSessions store
    Steps:
      1. Open detail view for a ticket with no session
      2. Verify right panel shows empty state (selector: `.empty-state`)
      3. Verify text contains "No active" or similar
    Expected Result: Clear empty state displayed
    Failure Indicators: Error, blank panel, or stale session data
    Evidence: .sisyphus/evidence/task-6-empty-state.png

  Scenario: Running session displays events
    Tool: Playwright (playwright skill)
    Preconditions: Ticket has an active running session, OpenCode SSE events being emitted
    Steps:
      1. Open detail view for ticket with running session
      2. Verify agent panel shows "running" status (selector: `.status-running`)
      3. Verify event log container exists (selector: `.event-log`)
      4. Wait for SSE events (timeout: 10s)
      5. Verify at least one event entry appears in the log
      6. Verify abort button is visible (selector: `.btn-abort`)
    Expected Result: Live events streaming into the log
    Failure Indicators: No events appearing, wrong status displayed
    Evidence: .sisyphus/evidence/task-6-running-session.png

  Scenario: Checkpoint approve/reject
    Tool: Playwright (playwright skill)
    Preconditions: Session paused at checkpoint
    Steps:
      1. Open detail view for ticket with paused session
      2. Verify checkpoint data is displayed (selector: `.checkpoint-data`)
      3. Verify Approve button exists (selector: `.btn-approve`)
      4. Verify Reject button exists with feedback input (selector: `.btn-reject`, `.feedback-input`)
    Expected Result: Checkpoint UI rendered with action buttons
    Failure Indicators: Missing buttons, missing checkpoint data
    Evidence: .sisyphus/evidence/task-6-checkpoint.png
  ```

  **Commit**: YES
  - Message: `feat(ui): add agent chat panel with SSE streaming and checkpoint controls`
  - Files: `src/components/AgentChatPanel.svelte`
  - Pre-commit: `npm run test`

---

- [ ] 7. Fix PR comments data flow in detail view

  **What to do**:
  - The current PR comments data flow is broken: `prComments` in `App.svelte:17` is declared as `[]` and never populated. The `PrCommentsPanel` receives an always-empty array.
  - In the new `TaskInfoPanel` (T5), PR comments need to be loaded dynamically. Ensure the panel fetches comments correctly:
    1. Read PRs for this ticket from `$ticketPrs` store
    2. For each PR, call `getPrComments(prId)` IPC to load comments
    3. Display comments grouped by PR
  - If T5 has already handled this correctly, verify and close. If not, wire it up.
  - Also verify that `addressSelectedPrComments()` IPC still works from the new location

  **Must NOT do**:
  - Do NOT refactor the entire PR comment pipeline
  - Do NOT change how comments are stored in the database
  - Do NOT modify GitHub polling behavior

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Data flow fix — wiring existing IPC calls to the new component
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: No visual design needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T4, T5, T6)
  - **Blocks**: T9
  - **Blocked By**: T2

  **References**:

  **Pattern References**:
  - `src/App.svelte:17` — `let prComments: PrComment[] = []` — the broken declaration (never populated)
  - `src/App.svelte:34-47` — `loadPullRequests()` — loads PRs into `$ticketPrs` store correctly
  - `src/components/PrCommentsPanel.svelte:1-72` — Current comment display component
  - `src/lib/ipc.ts:60-62` — `getPrComments(prId)` IPC wrapper that fetches comments per PR

  **WHY Each Reference Matters**:
  - `App.svelte:17` is the root of the bug — `prComments` is never set, so comments are always empty
  - `loadPullRequests()` works correctly for PR data — the issue is only with comment fetching
  - `getPrComments(prId)` exists and works — it just needs to be called from the right place

  **Acceptance Criteria**:

  - [ ] PR comments actually load and display for tickets with PRs
  - [ ] Comments can be marked as addressed from the detail view
  - [ ] Unused `prComments` variable removed from App.svelte
  - [ ] `npm run build` succeeds

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: PR comments load correctly
    Tool: Playwright (playwright skill)
    Preconditions: Ticket has a PR with at least one comment in the database
    Steps:
      1. Open detail view for the ticket
      2. Scroll to PR comments section in left panel
      3. Verify at least one comment is displayed
      4. Verify comment shows author and body text
    Expected Result: Comments loaded and visible
    Failure Indicators: Empty comment section despite data existing, loading errors in console
    Evidence: .sisyphus/evidence/task-7-pr-comments.png

  Scenario: No PR comments graceful empty state
    Tool: Playwright (playwright skill)
    Preconditions: Ticket with no PRs
    Steps:
      1. Open detail view for ticket without PRs
      2. Verify PR section shows appropriate empty state
    Expected Result: Clean empty state, no errors
    Failure Indicators: Error messages, broken layout
    Evidence: .sisyphus/evidence/task-7-no-prs.png
  ```

  **Commit**: YES (groups with T5)
   - Message: `fix(pr): wire PR comments loading in detail view`
   - Files: `src/App.svelte`, `src/components/TaskInfoPanel.svelte`
  - Pre-commit: `npm run test`

---

- [ ] 8. Remove old DetailPanel + dead code cleanup

  **What to do**:
  - Delete `src/components/DetailPanel.svelte`
  - Remove `DetailPanel` import and usage from `App.svelte`
  - Remove the `detail-area` CSS class and `has-detail` modifier from `App.svelte`
  - Remove the unused `prComments` declaration from `App.svelte` (if not already removed in T7)
  - Clean up any now-unused imports in `App.svelte`
  - Verify `LogViewer.svelte` — if it's no longer imported anywhere after DetailPanel removal, consider keeping it (it may still be useful) or removing it. Check imports first.
  - Keep `CheckpointPanel.svelte` — it may be reused or referenced by AgentChatPanel (T6). Check if T6 imported it. If not, keep it anyway — no harm.
  - Keep `PrCommentsPanel.svelte` — same reasoning. Check if TicketInfoPanel uses it.

  **Must NOT do**:
  - Do NOT remove components that are still imported by the new view components
  - Do NOT remove test files for removed components (let T11 handle test updates)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: File deletion and import cleanup — straightforward mechanical task
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `git-master`: Simple deletion doesn't need git skill

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with T9)
  - **Blocks**: T10, T11, T12
  - **Blocked By**: T4, T5, T6

  **References**:

  **Pattern References**:
  - `src/App.svelte:10` — `DetailPanel` import to remove
  - `src/App.svelte:163-167` — DetailPanel usage to remove
  - `src/App.svelte:274-278` — `.detail-area` CSS to remove
  - `src/App.svelte:270-272` — `.board-area.has-detail` CSS to remove

  **WHY Each Reference Matters**:
  - These are the exact lines to modify/remove — the agent needs to know precisely where the old code lives

  **Acceptance Criteria**:

  - [ ] `DetailPanel.svelte` file deleted
  - [ ] No imports of `DetailPanel` remain in codebase
  - [ ] `App.svelte` compiles without dead CSS or unused variables
  - [ ] `npm run build` succeeds
  - [ ] No console errors on app load

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Build succeeds after cleanup
    Tool: Bash
    Preconditions: All T4-T7 changes in place
    Steps:
      1. Run `npm run build`
      2. Verify exit code 0
      3. Grep codebase for "DetailPanel" — should only appear in test files (if any) or not at all
    Expected Result: Clean build, no dead references
    Failure Indicators: Build errors, import resolution failures
    Evidence: .sisyphus/evidence/task-8-build-after-cleanup.txt

  Scenario: App loads without errors
    Tool: Playwright (playwright skill)
    Preconditions: App built and running
    Steps:
      1. Open app
      2. Check browser console for errors
      3. Verify Kanban board renders
      4. Click a ticket, verify detail view renders
    Expected Result: No console errors, full navigation works
    Failure Indicators: Console errors about missing modules, broken rendering
    Evidence: .sisyphus/evidence/task-8-no-errors.png
  ```

  **Commit**: YES
  - Message: `refactor: remove old DetailPanel side panel`
  - Files: `src/components/DetailPanel.svelte` (deleted), `src/App.svelte`
  - Pre-commit: `npm run build`

---

- [ ] 9. Integration verification + polish

  **What to do**:
  - End-to-end verification of the complete feature:
    1. Start from the Kanban board
    2. Click a ticket → verify full-page detail view loads
    3. Verify left column: ticket info, description, editable fields, PR links
    4. Edit acceptance criteria and plan, save, navigate away and back — verify persistence
    5. Verify right column: empty state for tickets without sessions
    6. If an agent session exists: verify streaming events display, checkpoint controls work
    7. Back button and Escape key both return to board
    8. Board still functions normally after returning
  - Fix any visual polish issues:
    - Spacing, alignment, color consistency with existing theme
    - Scroll behavior (left and right columns scroll independently)
    - Loading states (while fetching ticket detail, while saving)
  - Fix any integration bugs found during verification
  - Ensure Tauri events (`checkpoint-reached`, `stage-completed`, `session-aborted`, `jira-sync-complete`) still work correctly — the listeners are in App.svelte and should still fire

  **Must NOT do**:
  - Do NOT add new features beyond what's specified
  - Do NOT refactor working code for "cleanliness"
  - Do NOT change component APIs established in T4-T7

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Cross-component integration verification requiring understanding of the full data flow
  - **Skills**: [`frontend-ui-ux`, `playwright`]
    - `frontend-ui-ux`: Visual polish assessment
    - `playwright`: Browser-based verification
  - **Skills Evaluated but Omitted**:
    - `git-master`: No git operations needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with T8)
  - **Blocks**: T10, T11, T12
  - **Blocked By**: T4, T5, T6, T7

  **References**:

  **Pattern References**:
  - All files created/modified in T4-T8
  - `src/App.svelte` — event listeners that must still work
  - `src/lib/stores.ts` — all stores that drive reactivity

  **WHY Each Reference Matters**:
  - This is a verification task — references are to the entire feature surface area

  **Acceptance Criteria**:

  - [ ] Full navigation flow works: board → detail → board
  - [ ] Editable fields persist across navigation
  - [ ] Both columns scroll independently
  - [ ] Visual theme is consistent (dark mode, correct CSS variables)
  - [ ] No console errors during any interaction
  - [ ] Tauri events still update the UI correctly

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Full feature walkthrough
    Tool: Playwright (playwright skill)
    Preconditions: App running with tickets, at least one with a PR
    Steps:
      1. Verify Kanban board loads with tickets
      2. Click a ticket card
      3. Verify detail view opens with correct ticket data
      4. Type in acceptance criteria textarea, click Save
      5. Navigate back with back button
      6. Click same ticket again
      7. Verify saved text persists in acceptance criteria
      8. Press Escape to go back
      9. Verify board is restored
    Expected Result: Complete flow works end-to-end
    Failure Indicators: Any step fails, data doesn't persist, navigation broken
    Evidence: .sisyphus/evidence/task-9-full-walkthrough.png

  Scenario: Theme consistency check
    Tool: Playwright (playwright skill)
    Preconditions: Detail view open
    Steps:
      1. Take full-page screenshot
      2. Verify dark background (--bg-primary: #1a1b26)
      3. Verify text is light (--text-primary: #c0caf5)
      4. Verify accent color usage (--accent: #7aa2f7) on links and active elements
    Expected Result: Consistent dark theme throughout
    Failure Indicators: White backgrounds, wrong text colors, unstyled elements
    Evidence: .sisyphus/evidence/task-9-theme-consistency.png
  ```

  **Commit**: YES
  - Message: `fix(ui): integration polish for task detail view`
  - Files: Various (whatever needs fixing)
  - Pre-commit: `npm run build && npm run test`

---

- [ ] 10. Rust tests for new DB operations

  **What to do**:
  - Add new Rust tests in `db.rs` `#[cfg(test)] mod tests`:
    - `test_new_columns_migration`: Verify acceptance_criteria and plan_text columns exist after migration
    - `test_update_ticket_fields`: Insert ticket, update fields, read back, assert values
    - `test_upsert_preserves_editable_fields`: Insert ticket, set editable fields, call upsert_ticket (simulating JIRA sync), verify editable fields are preserved while JIRA fields are updated
    - `test_editable_fields_null_by_default`: Insert ticket via upsert, read back, assert acceptance_criteria and plan_text are None
  - Follow existing test patterns:
    - Use `make_test_db()` helper
    - Use `insert_test_ticket()` helper where appropriate
    - Create temp DB, test, drop DB, clean up file

  **Must NOT do**:
  - Do NOT modify existing tests
  - Do NOT add integration tests that require a running OpenCode server

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Straightforward Rust test additions following established patterns
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `golang`: Not Rust

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with T11, T12)
  - **Blocks**: F1-F4
  - **Blocked By**: T8, T9

  **References**:

  **Pattern References**:
  - `src-tauri/src/db.rs:832-837` — `make_test_db()` helper to use
  - `src-tauri/src/db.rs:839-851` — `insert_test_ticket()` helper to use
  - `src-tauri/src/db.rs:853-878` — `test_upsert_ticket_insert_and_retrieve` — pattern for new tests
  - `src-tauri/src/db.rs:880-907` — `test_upsert_ticket_update_existing` — pattern for upsert preservation test

  **WHY Each Reference Matters**:
  - `make_test_db()` creates isolated temp databases — use for every new test
  - The existing upsert tests show exactly how to structure the new preservation test

  **Acceptance Criteria**:

  - [ ] All new tests pass (`cargo test`)
  - [ ] All existing tests still pass
  - [ ] At least 4 new tests added
  - [ ] Upsert preservation test proves JIRA sync safety

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: All Rust tests pass
    Tool: Bash
    Preconditions: All code changes in place
    Steps:
      1. Run `cargo test` from src-tauri/
      2. Verify all tests pass, including new ones
      3. Verify test_upsert_preserves_editable_fields specifically passes
    Expected Result: 0 failures, all new tests listed as passing
    Failure Indicators: Any test failure
    Evidence: .sisyphus/evidence/task-10-cargo-test.txt
  ```

  **Commit**: YES
  - Message: `test(db): add tests for editable ticket fields and upsert safety`
  - Files: `src-tauri/src/db.rs`
  - Pre-commit: `cargo test`

---

- [ ] 11. Frontend tests for new components

  **What to do**:
  - Create test files for new components following existing patterns:
    - `src/components/TaskDetailView.test.ts`: Test rendering, back navigation dispatch, Escape key handling
    - `src/components/TicketInfoPanel.test.ts`: Test field display, editable field rendering, save button interaction (mock IPC)
    - `src/components/AgentChatPanel.test.ts`: Test empty state, running state, checkpoint display, abort button
  - Follow existing test conventions:
    - Import from `@testing-library/svelte` (render, screen, fireEvent)
    - Use `vi.mock('../lib/ipc', ...)` for IPC mocking
    - Create typed fixture objects at file top
    - Use `describe`/`it` blocks with clear descriptions
  - Mock the Tauri event API (`listen`) for SSE event tests using the existing mock at `src/__mocks__/@tauri-apps/api/event.ts`

  **Must NOT do**:
  - Do NOT modify existing test files
  - Do NOT add E2E Playwright tests in this task (that's for QA scenarios in F3)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Testing multiple components with mocked dependencies requires understanding of the test infrastructure and component APIs
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `playwright`: These are unit tests, not browser tests

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with T10, T12)
  - **Blocks**: F1-F4
  - **Blocked By**: T8, T9

  **References**:

  **Pattern References**:
  - `src/components/TicketCard.test.ts` — Component test pattern with typed fixtures and prop rendering
  - `src/components/CheckpointPanel.test.ts` — Test pattern for interactive components with button clicks and state changes
  - `src/components/Toast.test.ts` — Test pattern for components using Svelte stores
  - `src/__mocks__/@tauri-apps/api/event.ts` — Tauri event mock for listen/unlisten
  - `src/__mocks__/@tauri-apps/api/core.ts` — Tauri invoke mock for IPC

  **WHY Each Reference Matters**:
  - `TicketCard.test.ts` shows how to render with props and assert text content — foundational pattern
  - `CheckpointPanel.test.ts` shows how to test interactive elements (buttons, inputs) — needed for save/approve/reject tests
  - The mock files are already configured in vitest.config.ts path aliases — use them

  **Acceptance Criteria**:

  - [ ] At least 3 test files created (one per new component)
  - [ ] At least 15 total test cases across all new files
  - [ ] All new tests pass (`npm run test`)
  - [ ] All existing tests still pass
  - [ ] Tests cover: rendering, empty states, interactions, error states

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: All frontend tests pass
    Tool: Bash
    Preconditions: All test files created
    Steps:
      1. Run `npm run test`
      2. Verify all tests pass (new + existing)
      3. Count total test cases — expect ≥ 15 new
    Expected Result: 0 failures, ≥ 15 new passing tests
    Failure Indicators: Any test failure, fewer than 15 new tests
    Evidence: .sisyphus/evidence/task-11-vitest-results.txt
  ```

  **Commit**: YES
  - Message: `test(ui): add component tests for task detail view`
  - Files: `src/components/TaskDetailView.test.ts`, `src/components/TicketInfoPanel.test.ts`, `src/components/AgentChatPanel.test.ts`
  - Pre-commit: `npm run test`

---

- [ ] 12. Full build + test suite verification

  **What to do**:
  - Run the complete build and test pipeline:
    1. `npm run build` — Vite production build (must succeed with 0 errors)
    2. `cargo build` — Rust backend build (must succeed)
    3. `npm run test` — All frontend tests (must all pass)
    4. `cargo test` — All Rust tests (must all pass)
  - Fix any issues found — this is the final integration gate before review
  - Check for common issues:
    - Unused imports or variables (TypeScript strict mode catches these)
    - Dead CSS classes
    - `console.log` left in production code (remove unless it's error logging)

  **Must NOT do**:
  - Do NOT add new features
  - Do NOT refactor passing code

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Build verification — run commands, fix issues
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential (after T10, T11)
  - **Blocks**: F1-F4
  - **Blocked By**: T10, T11

  **References**:

  **Pattern References**:
  - `package.json:6-13` — Build and test scripts
  - `src-tauri/Cargo.toml` — Rust build configuration

  **Acceptance Criteria**:

  - [ ] `npm run build` exits with code 0
  - [ ] `cargo build` exits with code 0
  - [ ] `npm run test` — all tests pass, 0 failures
  - [ ] `cargo test` — all tests pass, 0 failures
  - [ ] No `console.log` in non-error paths of production code

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Complete build pipeline
    Tool: Bash
    Preconditions: All tasks T1-T11 complete
    Steps:
      1. Run `npm run build` — capture output
      2. Run `cargo build` from src-tauri/ — capture output
      3. Run `npm run test` — capture output
      4. Run `cargo test` from src-tauri/ — capture output
    Expected Result: All 4 commands exit code 0
    Failure Indicators: Any non-zero exit code
    Evidence: .sisyphus/evidence/task-12-full-pipeline.txt
  ```

  **Commit**: YES (if fixes were needed)
  - Message: `chore: fix build issues from integration`
  - Files: Various
  - Pre-commit: `npm run build && npm run test`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Rejection → fix → re-run.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, curl endpoint, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `npx tsc --noEmit` + `npm run test` + `cargo test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp). Verify component-scoped styles use CSS variables.
  Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill)
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration (navigation + save + SSE + PR comments working together). Test edge cases: empty ticket description, very long description, ticket with no assignee, rapid navigation between tickets. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance: no router library added, no markdown renderer, no chat input, no session history. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

| After Task | Message | Files | Verification |
|------------|---------|-------|--------------|
| T1 | `feat(db): add editable ticket fields with safe upsert` | db.rs, main.rs | cargo test |
| T2 | `feat(types): add editable ticket fields and SSE event types` | types.ts, ipc.ts, stores.ts | npm run test |
| T3 | `feat(sse): add background SSE event bridge` | main.rs | cargo test |
| T4 | `feat(ui): add full-page task detail view with two-column layout` | TaskDetailView.svelte, App.svelte | npm run test |
| T5 | `feat(ui): add ticket info panel with editable fields and PR section` | TicketInfoPanel.svelte | npm run test |
| T6 | `feat(ui): add agent chat panel with SSE streaming and checkpoint controls` | AgentChatPanel.svelte | npm run test |
| T7 | `fix(pr): wire PR comments loading in detail view` | App.svelte, TicketInfoPanel.svelte | npm run test |
| T8 | `refactor: remove old DetailPanel side panel` | DetailPanel.svelte (del), App.svelte | npm run build |
| T9 | `fix(ui): integration polish for task detail view` | Various | npm run build && npm run test |
| T10 | `test(db): add tests for editable ticket fields and upsert safety` | db.rs | cargo test |
| T11 | `test(ui): add component tests for task detail view` | *.test.ts | npm run test |
| T12 | `chore: fix build issues from integration` | Various | npm run build && npm run test |

---

## Success Criteria

### Verification Commands
```bash
npm run build     # Expected: exit 0, production build succeeds
cargo build       # Expected: exit 0, Rust compilation succeeds
npm run test      # Expected: all tests pass (existing + ~15 new)
cargo test        # Expected: all tests pass (existing + ~4 new)
```

### Final Checklist
- [ ] Clicking a ticket card opens full-page detail view (not side panel)
- [ ] Two-column layout: left (info + editable fields), right (agent chat)
- [ ] Back button and Escape return to Kanban board
- [ ] Editable fields (acceptance_criteria, plan) save and persist
- [ ] JIRA sync does NOT clobber editable fields
- [ ] SSE events stream in real-time to the agent chat panel
- [ ] Checkpoint approve/reject works inline in agent panel
- [ ] Abort session works from agent panel
- [ ] PR comments load and display correctly (previously broken)
- [ ] Old DetailPanel.svelte removed
- [ ] All "Must NOT Have" items absent (no router, no markdown, no chat input)
- [ ] All tests pass (frontend + Rust)
- [ ] Production build succeeds
