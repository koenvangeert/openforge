# Question Visibility & Reconnection Fix

## TL;DR

> **Quick Summary**: Persist agent question data to DB so it survives app restart, show a prominent warning banner in AgentPanel when a session has a pending question, and enhance the Kanban card visual treatment for sessions awaiting input.
> 
> **Deliverables**:
> - Checkpoint data persisted to SQLite via extended `persist_session_status` command
> - Paused sessions loaded from DB on app startup
> - Warning banner above terminal showing question text (with generic fallback)
> - More prominent visual indicator on TaskCard for "needs input" state
> - Checkpoint data parser utility with graceful degradation
> - Comprehensive test suite for all new behavior
> 
> **Estimated Effort**: Short
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Task 1 → Task 4 → Task 5 → Task 6

---

## Context

### Original Request
User wants to see which sessions have pending agent questions more prominently, and fix a bug where the question disappears after reconnecting (full app restart) to a session with a pending question.

### Interview Summary
**Key Discussions**:
- Terminal survives reconnection, but the question text does not — confirmed reproducible even with `opencode attach`
- User wants a **warning-colored banner above the terminal** in AgentPanel (display only, no reply UI)
- User wants **more prominent Kanban card indicator** beyond the existing small "Needs Input" badge
- Tests after implementation, vitest + testing-library infrastructure exists
- Generic fallback for question text parsing — don't need to match exact OpenCode schema

**Research Findings**:
- `checkpoint_data` is NEVER persisted to DB — every `update_agent_session()` call passes `None`
- `loadSessions()` in App.svelte only loads completed/failed sessions from DB
- `loadSessionHistory()` in AgentPanel exits early for non-completed/non-failed sessions
- `persist_session_status` IPC already calls `update_agent_session` which accepts checkpoint_data — just always passes None
- TaskCard already has `needsInput` reactive binding and a small badge, can enhance
- Existing tests in TaskCard.test.ts and AgentPanel.test.ts provide patterns to follow

### Metis Review
**Identified Gaps** (addressed):
- **DB persistence gap**: checkpoint_data never written to DB → Added Task 1 + Task 4 to persist and load
- **Load-path filters**: Two filters exclude paused sessions → Task 4 updates both filters
- **Unknown event data schema**: permission.updated structure undocumented → Parser uses generic fallback (Task 2)
- **Terminal re-fit on banner show/hide**: Banner changes flex layout → Task 5 includes fitAddon.fit() trigger
- **Edge case: malformed checkpoint_data**: Parser must handle null, empty, invalid JSON → Task 2 acceptance criteria

---

## Work Objectives

### Core Objective
Make pending agent questions visible and persistent: survive app restart, show prominently on Kanban cards, and display question text in a banner above the terminal when viewing a paused session.

### Concrete Deliverables
- Extended `persist_session_status` Tauri command accepting optional `checkpoint_data` parameter
- Extended `persistSessionStatus` IPC wrapper with optional `checkpointData` parameter
- `parseCheckpointQuestion()` utility function in `src/lib/parseCheckpoint.ts`
- Enhanced TaskCard visual treatment for needs-input state
- Question banner in AgentPanel above terminal
- Updated `loadSessions()` and `loadSessionHistory()` to include paused sessions
- Test files covering all new behavior

### Definition of Done
- [ ] `npx vitest run` — ALL tests pass (0 failures)
- [ ] `cargo test` — ALL Rust tests pass
- [ ] App restart with a paused session → question banner visible in AgentPanel
- [ ] Kanban card for paused session has prominent visual treatment (not just small badge)

### Must Have
- checkpoint_data persisted to DB when `permission.updated` arrives
- checkpoint_data cleared in DB when `permission.replied` arrives
- Paused sessions loaded from DB on app startup
- Warning banner in AgentPanel showing question text when session is paused with checkpoint_data
- Parser handles null, empty, malformed JSON gracefully (never throws)
- Enhanced TaskCard visual indicator (warning border + background tint)
- fitAddon.fit() triggered when banner visibility changes
- All existing tests continue to pass

### Must NOT Have (Guardrails)
- NO reply/input UI on the banner — display only, user responds via terminal
- NO modifications to CheckpointToast.svelte — it serves a different purpose
- NO new Svelte stores — read from existing `activeSessions`
- NO changes to the `activeSessions` store Map structure
- NO global CSS variable changes — scoped styles only
- NO over-engineering for multiple simultaneous questions (OpenCode serializes permissions)
- NO excessive comments or JSDoc on simple utility functions

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: Tests-after
- **Framework**: vitest + @testing-library/svelte (frontend), cargo test (Rust)

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

| Deliverable Type | Verification Tool | Method |
|------------------|-------------------|--------|
| Rust command | Bash (cargo test) | Run tests, assert pass |
| Frontend utility | Bash (npx vitest run) | Run specific test file |
| UI component | Bash (npx vitest run) | Component tests with testing-library |
| Integration | Bash (npx vitest run) | Full test suite, 0 failures |

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — foundation, all independent):
├── Task 1: Extend persist_session_status with checkpoint_data [quick]
├── Task 2: Create checkpoint data parser utility [quick]
└── Task 3: Enhance TaskCard visual indicator [visual-engineering]

Wave 2 (After Wave 1 — integration, depends on foundation):
├── Task 4: Wire checkpoint persistence + load paused sessions (depends: 1) [unspecified-high]
└── Task 5: Add question banner to AgentPanel (depends: 2) [visual-engineering]

Wave 3 (After Wave 2 — tests):
└── Task 6: Comprehensive test suite for all changes (depends: 3, 4, 5) [unspecified-high]

Wave FINAL (After ALL tasks — verification):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)

Critical Path: Task 1 → Task 4 → Task 5 → Task 6 → FINAL
Parallel Speedup: ~50% faster than sequential
Max Concurrent: 3 (Wave 1)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|------------|--------|------|
| 1 | — | 4 | 1 |
| 2 | — | 5 | 1 |
| 3 | — | 6 | 1 |
| 4 | 1 | 5, 6 | 2 |
| 5 | 2, 4 | 6 | 2 |
| 6 | 3, 4, 5 | FINAL | 3 |

### Agent Dispatch Summary

| Wave | # Parallel | Tasks -> Agent Category |
|------|------------|----------------------|
| 1 | **3** | T1 -> `quick`, T2 -> `quick`, T3 -> `visual-engineering` |
| 2 | **2** | T4 -> `unspecified-high`, T5 -> `visual-engineering` |
| 3 | **1** | T6 -> `unspecified-high` |
| FINAL | **4** | F1 -> `oracle`, F2 -> `unspecified-high`, F3 -> `unspecified-high`, F4 -> `deep` |

---

## TODOs

- [ ] 1. Extend `persist_session_status` to accept optional checkpoint_data

  **What to do**:
  - In `src-tauri/src/main.rs`: Add an optional `checkpoint_data: Option<String>` parameter to the `persist_session_status` Tauri command. Pass it through to `db.update_agent_session()` instead of hardcoded `None`.
  - In `src-tauri/src/db.rs`: No changes needed — `update_agent_session()` already accepts `checkpoint_data: Option<&str>` at line 1225. Just verify the SQL updates the field correctly.
  - In `src/lib/ipc.ts`: Extend the `persistSessionStatus()` wrapper to accept an optional `checkpointData?: string | null` parameter and pass it to `invoke()`.
  - Add a Rust unit test in `db.rs` `#[cfg(test)]` module: create a session, update with checkpoint_data, read back and verify the field is set. Then update again with `None` and verify it's cleared.

  **Must NOT do**:
  - Do NOT create a separate Tauri command — extend the existing one
  - Do NOT change the function signature in a breaking way — the new parameter must be optional with a default of `None`
  - Do NOT modify the `agent_sessions` table schema — the `checkpoint_data TEXT` column already exists

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small, scoped change to existing command — add parameter, pass through, test
  - **Skills**: []
    - No special skills needed for this straightforward backend change

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: Task 4
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src-tauri/src/main.rs:867-907` — The existing `persist_session_status` command. Currently takes `task_id`, `status`, `error_message`. Add `checkpoint_data: Option<String>` parameter.
  - `src-tauri/src/main.rs:283-310` — Example of a Tauri command with `State<'_>` parameters showing the pattern to follow.

  **API/Type References**:
  - `src-tauri/src/db.rs:1222-1240` — `update_agent_session()` method signature showing it already accepts `checkpoint_data: Option<&str>` as 4th parameter. Currently called with `None` at main.rs:877.
  - `src-tauri/src/db.rs:103-113` — `AgentSessionRow` struct with `checkpoint_data: Option<String>` field.

  **Test References**:
  - `src-tauri/src/db.rs` bottom — `#[cfg(test)] mod tests` section with `make_test_db` helper and existing test patterns.

  **External References**:
  - `src/lib/ipc.ts:74-136` — Existing session IPC wrappers. Follow the same `invoke()` pattern for the extended call.

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Rust test — checkpoint_data round-trip
    Tool: Bash (cargo test)
    Preconditions: Clean test database
    Steps:
      1. Run: cargo test test_checkpoint_data_persistence --lib -- --nocapture
      2. Test creates session, calls update_agent_session with checkpoint_data = Some('{"question":"test"}')
      3. Reads session back, asserts checkpoint_data == Some('{"question":"test"}')
      4. Calls update_agent_session with checkpoint_data = None
      5. Reads session back, asserts checkpoint_data == None
    Expected Result: Test passes with 0 failures
    Failure Indicators: Test output contains "FAILED" or "panicked"
    Evidence: .sisyphus/evidence/task-1-rust-checkpoint-roundtrip.txt

  Scenario: IPC wrapper compiles and signature is correct
    Tool: Bash (npx vitest run)
    Preconditions: Frontend builds
    Steps:
      1. Run: npx vitest run --passWithNoTests
      2. Verify no TypeScript compilation errors related to ipc.ts
    Expected Result: vitest exits 0
    Failure Indicators: TypeScript errors mentioning persistSessionStatus
    Evidence: .sisyphus/evidence/task-1-ipc-compile.txt
  ```

  **Commit**: YES
  - Message: `feat(backend): extend persist_session_status to accept checkpoint_data`
  - Files: `src-tauri/src/main.rs`, `src-tauri/src/db.rs`, `src/lib/ipc.ts`
  - Pre-commit: `cargo test`

- [ ] 3. Enhance TaskCard visual indicator for needs-input state

  **What to do**:
  - In `src/components/TaskCard.svelte`: Enhance the visual treatment when `needsInput` is true (line 31: `$: needsInput = session?.status === 'paused' && session?.checkpoint_data !== null`)
  - Add a CSS class `needs-input` to the card button element when `needsInput` is true
  - Visual changes for the `.card.needs-input` state:
    - Full warning-colored border on all 4 sides: `border: 2px solid var(--warning)`
    - Subtle warning background tint: `background: rgba(224, 175, 104, 0.08)`
    - Pulsing box-shadow glow: `box-shadow: 0 0 12px rgba(224, 175, 104, 0.2)` with the existing `pulse` animation
  - Keep the existing "Needs Input" text badge — the new styling is additive, not replacing
  - Ensure the existing `.card.paused` border-left styling is overridden by the more prominent `.card.needs-input` styling (needs-input takes priority over paused since it's a more specific state)

  **Must NOT do**:
  - Do NOT modify global CSS variables in App.svelte
  - Do NOT change the existing `needsInput` reactive logic
  - Do NOT add new stores or props
  - Do NOT change the card layout/structure — only CSS visual treatment

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: CSS styling refinement, visual design judgment needed
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: Needed for visual design judgment on the enhanced indicator treatment

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2)
  - **Blocks**: Task 6
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src/components/TaskCard.svelte:30-31` — Existing `needsInput` reactive binding: `$: needsInput = session?.status === 'paused' && session?.checkpoint_data !== null`
  - `src/components/TaskCard.svelte:34` — Card button element where class binding should be added: `class:paused={statusClass === 'paused'}`
  - `src/components/TaskCard.svelte:104-114` — Existing `.card.running`, `.card.paused`, `.card.failed` CSS patterns showing the convention for state-specific card styles
  - `src/components/TaskCard.svelte:146-155` — Existing `.needs-input-badge` CSS with pulse animation

  **Test References**:
  - `src/components/TaskCard.test.ts:76-127` — Existing tests for "Needs Input" badge visibility. Follow this pattern for the new CSS class test.

  **External References**:
  - `src/App.svelte` — CSS variables: `--warning` = `#e0af68`, used for warning color palette

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Card has needs-input class when session is paused with checkpoint_data
    Tool: Bash (npx vitest run)
    Preconditions: TaskCard.svelte has the new class binding
    Steps:
      1. Run: npx vitest run src/components/TaskCard.test.ts
      2. Verify existing tests still pass (no regressions)
      3. Verify the card renders with class "needs-input" when session has status='paused' and checkpoint_data='{"q":"test"}'
    Expected Result: All tests pass, including new class assertion
    Failure Indicators: Any test failure in TaskCard.test.ts
    Evidence: .sisyphus/evidence/task-3-taskcard-tests.txt

  Scenario: Card does NOT have needs-input class when running
    Tool: Bash (npx vitest run)
    Preconditions: Same as above
    Steps:
      1. Test renders TaskCard with session status='running', checkpoint_data=null
      2. Assert card element does NOT have class "needs-input"
    Expected Result: Class absent for running state
    Failure Indicators: Class present when it shouldn't be
    Evidence: .sisyphus/evidence/task-3-taskcard-no-class.txt
  ```

  **Commit**: YES
  - Message: `feat(ui): enhance TaskCard visual indicator for needs-input state`
  - Files: `src/components/TaskCard.svelte`
  - Pre-commit: `npx vitest run src/components/TaskCard.test.ts`

- [ ] 2. Create checkpoint data parser utility

  **What to do**:
  - Create `src/lib/parseCheckpoint.ts` with a single exported function: `parseCheckpointQuestion(checkpointData: string | null): string | null`
  - The function should:
    1. Return `null` if input is `null`, `undefined`, or empty string
    2. Try to parse as JSON
    3. Try to extract a question/description from known OpenCode fields (try `properties.description`, `properties.title`, `properties.permission.description`, `properties.message` — be permissive)
    4. If any field found, return it as a string (truncated to 500 chars if longer)
    5. If JSON parses but no recognizable field found, return `"Agent is waiting for input"`
    6. If JSON fails to parse, return `"Agent is waiting for input"`
  - Never throw — all errors caught internally

  **Must NOT do**:
  - Do NOT add excessive JSDoc or comments — the function is self-explanatory
  - Do NOT import anything external — pure function with no dependencies
  - Do NOT export more than the one function (no types needed to be exported)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single pure function in a new file, ~30 lines of code
  - **Skills**: []
    - No special skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3)
  - **Blocks**: Task 5
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src/lib/ipc.ts` — Follow the same file structure: TypeScript, no default exports, named export
  - `src/components/TaskCard.svelte:31` — Shows the condition `session?.status === 'paused' && session?.checkpoint_data !== null` that triggers the need for this parser

  **API/Type References**:
  - `src/lib/types.ts:22` — `checkpoint_data: string | null` — the field this parser consumes
  - OpenCode SSE event data format from AGENTS.md: `{ "type": "permission.updated", "properties": { "sessionID": "...", ... } }` — properties structure is the most likely shape

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Parser handles null/empty input
    Tool: Bash (node -e)
    Preconditions: File exists at src/lib/parseCheckpoint.ts
    Steps:
      1. Run: npx tsx -e "import {parseCheckpointQuestion} from './src/lib/parseCheckpoint'; console.log(JSON.stringify({null: parseCheckpointQuestion(null), empty: parseCheckpointQuestion('')}))"
      2. Assert output is: {"null":null,"empty":null}
    Expected Result: null returned for null and empty string
    Failure Indicators: Output shows non-null value or throws error
    Evidence: .sisyphus/evidence/task-2-parser-null-empty.txt

  Scenario: Parser handles valid JSON with no known fields
    Tool: Bash (node -e)
    Preconditions: File exists at src/lib/parseCheckpoint.ts
    Steps:
      1. Run: npx tsx -e "import {parseCheckpointQuestion} from './src/lib/parseCheckpoint'; console.log(parseCheckpointQuestion('{\"unknown\":\"data\"}'))"
      2. Assert output contains: "Agent is waiting for input"
    Expected Result: Generic fallback message returned
    Failure Indicators: Returns null or throws
    Evidence: .sisyphus/evidence/task-2-parser-fallback.txt

  Scenario: Parser handles malformed JSON
    Tool: Bash (node -e)
    Preconditions: File exists
    Steps:
      1. Run: npx tsx -e "import {parseCheckpointQuestion} from './src/lib/parseCheckpoint'; console.log(parseCheckpointQuestion('not json at all'))"
      2. Assert output contains: "Agent is waiting for input"
    Expected Result: Generic fallback, no thrown error
    Failure Indicators: Process exits with error code or exception
    Evidence: .sisyphus/evidence/task-2-parser-malformed.txt
  ```

  **Commit**: YES
  - Message: `feat(lib): add checkpoint data parser with generic fallback`
  - Files: `src/lib/parseCheckpoint.ts`
  - Pre-commit: `npx vitest run --passWithNoTests`

- [ ] 4. Wire checkpoint persistence + load paused sessions on startup

  **What to do**:
  - **Persist on `permission.updated`**: In `src/App.svelte`, in the `permission.updated` event handler (line 263-278), after updating the in-memory store, call `persistSessionStatus(taskId, 'paused', null, event.payload.data)` to write checkpoint_data to DB. Use the extended IPC from Task 1.
  - **Clear on `permission.replied`**: In the `permission.replied` handler (line 279-288), after updating the in-memory store, call `persistSessionStatus(taskId, 'running', null, null)` to clear checkpoint_data in DB.
  - **Load paused sessions on startup**: In the `loadSessions()` function in App.svelte (around line 85-91), update the filter that currently only loads completed/failed sessions. Also load sessions with `status === 'paused'` into the `activeSessions` store. The DB query (`getLatestSessions`) already returns all statuses — just remove the frontend filter for paused.
  - **Load paused sessions in AgentPanel**: In `src/components/AgentPanel.svelte` `loadSessionHistory()` (line 92-146), update the early-return guard at line 113 (`if (existingSession.status !== 'completed' && existingSession.status !== 'failed') return`) to also allow `'paused'` status through. For paused sessions, set `status = 'idle'` (display-wise) but still let the terminal + banner render.
  - **Also persist on other status changes**: Review all existing calls to `persistSessionStatus` and make sure they pass `null` for the new checkpoint_data parameter (maintaining existing behavior for non-permission events).

  **Must NOT do**:
  - Do NOT change the `activeSessions` store type or structure
  - Do NOT modify the DB schema — column already exists
  - Do NOT add new IPC commands — use the extended `persistSessionStatus` from Task 1
  - Do NOT change the `implementation-complete` or `implementation-failed` handlers — they already set status correctly

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Touches multiple files with careful state management across frontend event handlers
  - **Skills**: []
    - No special skills needed

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Task 1 for extended IPC)
  - **Parallel Group**: Wave 2 (with Task 5)
  - **Blocks**: Task 5, Task 6
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src/App.svelte:263-278` — `permission.updated` handler where checkpoint_data is stored in-memory. Add `persistSessionStatus()` call here.
  - `src/App.svelte:279-288` — `permission.replied` handler where checkpoint_data is cleared. Add `persistSessionStatus()` call here.
  - `src/App.svelte:85-91` — `loadSessions()` function that loads sessions from DB on startup. Currently filters to completed/failed only.
  - `src/App.svelte:168-172` — `implementation-complete` handler showing pattern of calling `persistSessionStatus` after updating in-memory store.

  **API/Type References**:
  - `src/lib/ipc.ts` — `persistSessionStatus(taskId, status, errorMessage, checkpointData?)` — the extended IPC from Task 1
  - `src/lib/ipc.ts` — `getLatestSessions(taskIds)` — batch fetch already returns all statuses from DB

  **Test References**:
  - `src/components/AgentPanel.test.ts` — Existing tests for AgentPanel session loading. Verify no regressions.

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: permission.updated persists checkpoint_data to DB
    Tool: Bash (cargo test)
    Preconditions: Task 1 complete (persist_session_status accepts checkpoint_data)
    Steps:
      1. Verify the App.svelte permission.updated handler now calls persistSessionStatus with checkpoint_data
      2. Run: cargo test -- to verify Rust backend handles the data correctly
    Expected Result: checkpoint_data written to DB, readable after restart
    Failure Indicators: persistSessionStatus not called, or DB test fails
    Evidence: .sisyphus/evidence/task-4-persist-permission.txt

  Scenario: Paused sessions loaded on startup
    Tool: Bash (npx vitest run)
    Preconditions: loadSessions() filter updated
    Steps:
      1. Review App.svelte loadSessions() to verify paused sessions are no longer filtered out
      2. Run: npx vitest run to verify no regressions
    Expected Result: vitest passes, paused sessions included in activeSessions store
    Failure Indicators: Tests fail or paused sessions still filtered
    Evidence: .sisyphus/evidence/task-4-load-paused.txt

  Scenario: permission.replied clears checkpoint_data in DB
    Tool: Bash (grep)
    Preconditions: App.svelte updated
    Steps:
      1. Verify permission.replied handler calls persistSessionStatus with null checkpoint_data
      2. Verify in-memory store also cleared (existing behavior preserved)
    Expected Result: Both in-memory and DB checkpoint_data cleared
    Failure Indicators: Only one of the two cleared
    Evidence: .sisyphus/evidence/task-4-clear-permission.txt
  ```

  **Commit**: YES (grouped with Task 5)
  - Message: `feat(ui): persist checkpoint data and show question banner on reconnect`
  - Files: `src/App.svelte`, `src/components/AgentPanel.svelte`
  - Pre-commit: `npx vitest run`

- [ ] 5. Add question banner to AgentPanel

  **What to do**:
  - In `src/components/AgentPanel.svelte`: Import `parseCheckpointQuestion` from `../lib/parseCheckpoint`
  - Add a reactive binding: `$: questionText = session ? parseCheckpointQuestion(session.checkpoint_data) : null`
  - Add a `$:` reactive block that calls `fitAddon?.fit()` when `questionText` changes (to re-fit terminal after banner appears/disappears)
  - Add HTML between the `.status-bar` div and `.output-container` div:
    ```svelte
    {#if questionText}
      <div class="question-banner">
        <span class="question-icon">?</span>
        <span class="question-text">{questionText}</span>
      </div>
    {/if}
    ```
  - Style the banner:
    - `background: rgba(224, 175, 104, 0.12)` (warning tint)
    - `border: 1px solid rgba(224, 175, 104, 0.3)`
    - `border-radius: 6px` (match other elements)
    - `padding: 10px 16px`
    - `color: var(--warning)` for icon, `var(--text-primary)` for text
    - `font-size: 0.8125rem`
    - Icon: `?` in a circular background (similar to CheckpointToast pattern)
    - Text: max 3 lines, overflow with ellipsis, `title` attribute for full text on hover
  - The banner is **display only** — no buttons, no dismiss, no input

  **Must NOT do**:
  - Do NOT add reply/input buttons to the banner
  - Do NOT add a dismiss/close button — banner disappears reactively when permission is replied
  - Do NOT modify CheckpointToast.svelte
  - Do NOT add new stores — read from existing `session` reactive binding
  - Do NOT change the terminal or PTY logic

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: UI component with specific visual design requirements
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: Needed for visual design quality of the banner component

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 4 in Wave 2)
  - **Parallel Group**: Wave 2 (with Task 4)
  - **Blocks**: Task 6
  - **Blocked By**: Task 2 (parser utility), Task 4 (persistence ensures data available)

  **References**:

  **Pattern References**:
  - `src/components/AgentPanel.svelte:28` — Reactive session binding: `$: session = $activeSessions.get(taskId) || null`
  - `src/components/AgentPanel.svelte:307-359` — Template structure showing `.status-bar` and `.output-container` divs. Banner goes between them.
  - `src/components/CheckpointToast.svelte:46-52` — Toast icon + message layout pattern to follow (similar structure but as inline banner not floating toast)
  - `src/components/AgentPanel.svelte:370-378` — `.status-bar` CSS showing the design language (bg-secondary, border, border-radius, padding)

  **API/Type References**:
  - `src/lib/parseCheckpoint.ts` — `parseCheckpointQuestion(checkpoint_data: string | null): string | null` — from Task 2

  **External References**:
  - `src/App.svelte` CSS variables: `--warning` (#e0af68), `--text-primary`, `--border`, `--bg-secondary` — use these for consistent theming

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Banner visible when session is paused with checkpoint_data
    Tool: Bash (npx vitest run)
    Preconditions: AgentPanel.svelte updated with banner, parseCheckpoint.ts exists
    Steps:
      1. Run: npx vitest run src/components/AgentPanel.test.ts
      2. Test renders AgentPanel with session status='paused', checkpoint_data='{"question":"approve?"}'
      3. Assert element with class "question-banner" is in the document
      4. Assert text contains "Agent is waiting for input" (generic fallback) or parsed question
    Expected Result: Banner rendered with question text
    Failure Indicators: Banner not found or text missing
    Evidence: .sisyphus/evidence/task-5-banner-visible.txt

  Scenario: Banner NOT visible when session is running
    Tool: Bash (npx vitest run)
    Preconditions: Same as above
    Steps:
      1. Test renders AgentPanel with session status='running', checkpoint_data=null
      2. Assert element with class "question-banner" is NOT in the document
    Expected Result: No banner rendered
    Failure Indicators: Banner present when it shouldn't be
    Evidence: .sisyphus/evidence/task-5-banner-hidden.txt

  Scenario: Banner NOT visible when no session
    Tool: Bash (npx vitest run)
    Preconditions: Same as above
    Steps:
      1. Test renders AgentPanel with no session in activeSessions store
      2. Assert element with class "question-banner" is NOT in the document
    Expected Result: No banner rendered
    Failure Indicators: Banner present with no session
    Evidence: .sisyphus/evidence/task-5-banner-no-session.txt
  ```

  **Commit**: YES (grouped with Task 4)
  - Message: `feat(ui): persist checkpoint data and show question banner on reconnect`
  - Files: `src/components/AgentPanel.svelte`
  - Pre-commit: `npx vitest run`

- [ ] 6. Comprehensive test suite for all changes

  **What to do**:
  - **`src/lib/parseCheckpoint.test.ts`** (NEW file): Test the parser utility:
    - `null` input → returns `null`
    - Empty string → returns `null`
    - Malformed JSON → returns `"Agent is waiting for input"`
    - Valid JSON with no known fields → returns `"Agent is waiting for input"`
    - Valid JSON with `properties.description` → returns that description
    - Valid JSON with `properties.title` → returns that title
    - Very long string (>500 chars) → returns truncated result
  - **`src/components/TaskCard.test.ts`** (EXTEND): Add tests for new `.needs-input` CSS class:
    - Session paused with checkpoint_data → card has class `needs-input`
    - Session paused without checkpoint_data → card does NOT have class `needs-input`
    - Session running → card does NOT have class `needs-input`
    - No session → card does NOT have class `needs-input`
  - **`src/components/AgentPanel.test.ts`** (EXTEND): Add tests for question banner:
    - Session paused with checkpoint_data → `.question-banner` element present
    - Session paused without checkpoint_data → `.question-banner` NOT present
    - Session running → `.question-banner` NOT present
    - No session → `.question-banner` NOT present
  - Run full test suite: `npx vitest run` → ALL tests pass with 0 failures
  - Run Rust tests: `cargo test` → ALL pass

  **Must NOT do**:
  - Do NOT delete or modify existing tests — only add new ones
  - Do NOT mock the parser in AgentPanel tests (it's a pure function, use it directly)
  - Do NOT add tests for CheckpointToast (out of scope)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Spans multiple test files, needs understanding of existing test patterns
  - **Skills**: []
    - No special skills needed — follow existing vitest + testing-library patterns

  **Parallelization**:
  - **Can Run In Parallel**: NO (must verify all implementation is complete)
  - **Parallel Group**: Wave 3 (sequential after Wave 2)
  - **Blocks**: FINAL
  - **Blocked By**: Tasks 3, 4, 5

  **References**:

  **Pattern References**:
  - `src/components/TaskCard.test.ts:76-127` — Existing "Needs Input" badge tests. Follow exact same fixture pattern (`baseSession` spread with overrides) for new CSS class tests.
  - `src/components/AgentPanel.test.ts:78-89` — Existing AgentPanel test setup with `baseSession` fixture. Extend with checkpoint_data variants.
  - `src/components/CheckpointToast.test.ts:1-67` — Example of store-driven component testing pattern.

  **API/Type References**:
  - `src/lib/parseCheckpoint.ts` — Function signature from Task 2
  - `src/lib/types.ts:16-26` — AgentSession interface for fixture construction

  **Test References**:
  - `vitest.config.ts` — Test configuration, path aliases for Tauri mocks
  - `src/__mocks__/@tauri-apps/api/` — Mock directory for Tauri APIs

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: All new tests pass
    Tool: Bash (npx vitest run)
    Preconditions: All implementation tasks (1-5) complete
    Steps:
      1. Run: npx vitest run src/lib/parseCheckpoint.test.ts
      2. Assert: All parser tests pass (7+ tests, 0 failures)
      3. Run: npx vitest run src/components/TaskCard.test.ts
      4. Assert: All TaskCard tests pass (existing + new, 0 failures)
      5. Run: npx vitest run src/components/AgentPanel.test.ts
      6. Assert: All AgentPanel tests pass (existing + new, 0 failures)
    Expected Result: All test files green
    Failure Indicators: Any test failure
    Evidence: .sisyphus/evidence/task-6-all-tests.txt

  Scenario: Full regression check
    Tool: Bash (npx vitest run)
    Preconditions: All test files written
    Steps:
      1. Run: npx vitest run
      2. Assert: 0 test failures across entire project
    Expected Result: Full green test suite
    Failure Indicators: Any regression in existing tests
    Evidence: .sisyphus/evidence/task-6-full-regression.txt

  Scenario: Rust tests still pass
    Tool: Bash (cargo test)
    Preconditions: Task 1 Rust changes in place
    Steps:
      1. Run: cargo test (from src-tauri/)
      2. Assert: All tests pass including new checkpoint_data test
    Expected Result: 0 failures
    Failure Indicators: Any Rust test failure
    Evidence: .sisyphus/evidence/task-6-rust-tests.txt
  ```

  **Commit**: YES
  - Message: `test: add comprehensive tests for question visibility and reconnect`
  - Files: `src/lib/parseCheckpoint.test.ts`, `src/components/TaskCard.test.ts`, `src/components/AgentPanel.test.ts`
  - Pre-commit: `npx vitest run`

---

## Final Verification Wave

> 4 review agents run in PARALLEL. ALL must APPROVE. Rejection -> fix -> re-run.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `npx vitest run` + `cargo test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp).
  Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high`
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration (features working together). Test edge cases: null checkpoint_data, malformed JSON, rapid permission.updated/replied. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance (no reply UI, no CheckpointToast changes, no new stores). Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

| After Task(s) | Message | Files | Verification |
|------------|---------|-------|--------------|
| 1 | `feat(backend): extend persist_session_status to accept checkpoint_data` | `src-tauri/src/main.rs`, `src-tauri/src/db.rs`, `src/lib/ipc.ts` | `cargo test` |
| 2 | `feat(lib): add checkpoint data parser with generic fallback` | `src/lib/parseCheckpoint.ts` | `npx vitest run src/lib/parseCheckpoint.test.ts` (if test exists yet) |
| 3 | `feat(ui): enhance TaskCard visual indicator for needs-input state` | `src/components/TaskCard.svelte` | `npx vitest run src/components/TaskCard.test.ts` |
| 4, 5 | `feat(ui): persist checkpoint data and show question banner on reconnect` | `src/App.svelte`, `src/components/AgentPanel.svelte` | `npx vitest run` |
| 6 | `test: add comprehensive tests for question visibility and reconnect` | `src/components/AgentPanel.test.ts`, `src/components/TaskCard.test.ts`, `src/lib/parseCheckpoint.test.ts` | `npx vitest run` |

---

## Success Criteria

### Verification Commands
```bash
npx vitest run          # Expected: ALL tests pass, 0 failures
cargo test              # Expected: ALL Rust tests pass
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass (vitest + cargo)
- [ ] App restart preserves question data for paused sessions
- [ ] Question banner visible in AgentPanel for paused sessions
- [ ] Kanban card prominently indicates needs-input state
