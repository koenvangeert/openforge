# Configurable Actions with Custom Prompts

## TL;DR

> **Quick Summary**: Replace the hardcoded "Start Implementation" context menu action with a configurable per-project actions system. Users can customize prompt text, add/remove actions, and toggle built-in defaults. The backend auto-detects whether to reuse an existing idle session or start a fresh one.
> 
> **Deliverables**:
> - `Action` interface in types.ts + action helpers in new `src/lib/actions.ts`
> - `run_action` Tauri command with session-reuse logic + prompt building refactor
> - `runAction` IPC wrapper
> - Dynamic context menu in KanbanBoard loading actions from project config
> - Actions management section in SettingsPanel (add/edit/delete/toggle)
> - Updated App.svelte event handler wiring
> - Cleanup of old hardcoded `start_implementation` pathway
> - Test suite for all new behavior
> 
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 2 waves + integration
> **Critical Path**: Task 1 → Task 3/4 → Task 5 → Task 7

---

## Context

### Original Request
User wants to make the "Start work" action configurable per project with custom prompts, add additional actions beyond "Start Implementation", and provide OOTB (out-of-the-box) actions with sensible defaults.

### Interview Summary
**Key Decisions**:
- **Session reuse**: No lightweight/full distinction. Actions send to existing idle session if available (completed/failed + server running). If session is running → actions disabled ("Agent is busy"). If session is paused → disabled ("Answer pending question first"). If no session → full flow (worktree, server, new session, prompt).
- **OOTB mutability**: Full control — users can edit, disable, or delete any action including built-ins.
- **Default actions**: Start Implementation, Plan/Design, Manual Testing (3 OOTB).
- **Ordering**: Alphabetical in context menu.

**Research Findings**:
- `start_implementation` (main.rs:283-422) handles full flow: worktree → server → session → prompt → agent session record
- Prompt construction (main.rs:358-383): auto-assembled task context + hardcoded instruction at line 383
- `agent_coordinator.rs:86-105` has duplicate prompt construction code — needs cleanup
- `project_config` table exists with (project_id, key, value) schema — actions stored as JSON blob under key `actions`
- `get_project_config`/`set_project_config` IPC wrappers already exist (ipc.ts:48-54)
- `opencode_client.prompt_async(session_id, text, agent)` sends prompts fire-and-forget
- `server_manager` tracks one server per task, `activeSessions` store keyed by task_id
- SSE events matched by task_id (not session_id) — prevents concurrent sessions per task
- No `delete_project_config` method exists — overwrite JSON blob instead
- SettingsPanel uses section-based layout with `<h3>` headers and `.field` label/input pairs

### Metis Review
**Identified Gaps** (addressed):
- **Session reuse race condition**: User clicks action, session becomes running between menu open and execution → Backend must re-check session status at execution time, not trust frontend state. Task 2 acceptance criteria includes this.
- **Empty actions list**: If user deletes all actions, context menu shows no action items → Acceptable state, menu still shows "Move to..." and "Delete".
- **Prompt building duplication**: `agent_coordinator.rs` has identical prompt code → Task 6 cleans this up.
- **Server port lookup**: Reusing session requires server still running. Server may have been stopped/crashed → Backend checks `server_mgr.get_server_port()`, falls back to full flow if None.
- **JSON blob size**: project_config value is TEXT column, no size limit. Large prompt texts are fine.
- **Action ID collisions**: User-created action could collide with builtin ID → Generate UUID for custom actions, reserve prefixed IDs for builtins.

---

## Work Objectives

### Core Objective
Replace the hardcoded "Start Implementation" with a dynamic, per-project configurable actions system where each action sends a custom prompt instruction to OpenCode, with the backend auto-detecting whether to reuse an existing session or create a new one.

### Concrete Deliverables
- `Action` interface in `src/lib/types.ts`
- `src/lib/actions.ts` — default actions constant, `loadActions()`, `saveActions()` helpers
- `run_action` Tauri command in `src-tauri/src/main.rs` with session-reuse logic
- Shared `build_task_prompt()` function extracted from `start_implementation`
- `runAction` IPC wrapper in `src/lib/ipc.ts`
- Dynamic context menu in `src/components/KanbanBoard.svelte`
- Actions management section in `src/components/SettingsPanel.svelte`
- Updated event handler in `src/App.svelte`
- Removal of duplicate code in `agent_coordinator.rs`
- Test files: `src/lib/actions.test.ts`, extended `KanbanBoard.test.ts`, extended `SettingsPanel.test.ts`

### Definition of Done
- [ ] `npx vitest run` — ALL tests pass (0 failures)
- [ ] `cargo test` — ALL Rust tests pass
- [ ] `cargo build --manifest-path src-tauri/Cargo.toml` — compiles without errors
- [ ] Context menu shows dynamic actions loaded from project config
- [ ] Actions disabled when agent is busy or paused
- [ ] Reusing idle session works (new prompt sent without creating worktree/server)
- [ ] Settings panel allows add/edit/delete/toggle actions
- [ ] Default actions seeded for new/existing projects on first load

### Must Have
- Action stored as JSON array in `project_config` under key `actions`
- Three OOTB defaults: Start Implementation, Plan/Design, Manual Testing
- Full CRUD on actions (add, edit, delete, toggle enable/disable) including OOTB ones
- Prompt = auto-assembled task context (title, description, AC, plan) + configurable instruction
- Session reuse: idle session (completed/failed) + server running → send prompt to existing session
- New session: no session or no server → full flow (worktree, server, new session)
- Actions disabled in context menu when session is running or paused
- Alphabetical ordering of actions in context menu
- Backend re-checks session status at execution time (not trusting frontend state)
- UUID-based IDs for custom actions; reserved prefixed IDs for builtins
- All existing tests continue to pass

### Must NOT Have (Guardrails)
- NO concurrent sessions per task (SSE routing limitation — defer to V2)
- NO drag-to-reorder UI — alphabetical only
- NO agent picker per action (always `None` — use default agent)
- NO changes to the OpenCode client API (`prompt_async` signature unchanged)
- NO new database tables — use existing `project_config`
- NO modifications to worktree creation, server spawning, or PTY management logic
- NO `as any`, `@ts-ignore`, or `@ts-expect-error`
- NO global CSS variable changes — scoped styles only
- NO importing from or calling `agent_coordinator.rs` — it contains dead/stale code with duplicate prompt builder. Task 6 cleans it up.
- NO auto-moving task status on action completion — remove the hardcoded `update_task_status("in_review")` in SSE bridge

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
| Rust command | Bash (cargo test + cargo build) | Compile + run tests |
| Frontend utility | Bash (npx vitest run) | Run specific test file |
| UI component | Bash (npx vitest run) | Component tests with testing-library |
| Integration | Bash (npx vitest run) | Full test suite, 0 failures |

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — foundation, all independent):
├── Task 1: Action types + defaults + helpers [quick]
└── Task 2: Backend run_action command + prompt refactor [unspecified-high]

Wave 2 (After Wave 1 — frontend, depends on types + backend):
├── Task 3: Dynamic context menu in KanbanBoard (depends: 1) [visual-engineering]
└── Task 4: Actions settings UI in SettingsPanel (depends: 1) [visual-engineering]

Wave 3 (After Wave 2 — integration + cleanup):
├── Task 5: Wire execution in App.svelte (depends: 2, 3) [quick]
└── Task 6: Clean up old hardcoded pathway (depends: 5) [quick]

Wave 4 (After Wave 3 — tests):
└── Task 7: Comprehensive test suite (depends: 3, 4, 5, 6) [unspecified-high]

Wave FINAL (After ALL tasks — verification):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)

Critical Path: Task 1 → Task 3 → Task 5 → Task 7 → FINAL
Parallel Speedup: ~40% faster than sequential
Max Concurrent: 2 (Waves 1, 2)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|------------|--------|------|
| 1 | — | 3, 4 | 1 |
| 2 | — | 5 | 1 |
| 3 | 1 | 5, 7 | 2 |
| 4 | 1 | 7 | 2 |
| 5 | 2, 3 | 6, 7 | 3 |
| 6 | 5 | 7 | 3 |
| 7 | 3, 4, 5, 6 | FINAL | 4 |

### Agent Dispatch Summary

| Wave | # Parallel | Tasks -> Agent Category |
|------|------------|----------------------|
| 1 | **2** | T1 -> `quick`, T2 -> `unspecified-high` |
| 2 | **2** | T3 -> `visual-engineering`, T4 -> `visual-engineering` |
| 3 | **2** | T5 -> `quick`, T6 -> `quick` |
| 4 | **1** | T7 -> `unspecified-high` |
| FINAL | **4** | F1 -> `oracle`, F2 -> `unspecified-high`, F3 -> `unspecified-high`, F4 -> `deep` |

---

## TODOs

- [x] 1. Action types, defaults constant, and helper functions

  **What to do**:
  - In `src/lib/types.ts`: Add `Action` interface:
    ```typescript
    export interface Action {
      id: string;
      name: string;
      prompt: string;
      builtin: boolean;
      enabled: boolean;
    }
    ```
  - Create `src/lib/actions.ts` with:
    - `DEFAULT_ACTIONS: Action[]` constant with 3 OOTB actions:
      1. `{ id: "builtin-start-implementation", name: "Start Implementation", prompt: "Implement this task. Create a branch, make the changes, and create a pull request when done.", builtin: true, enabled: true }`
      2. `{ id: "builtin-plan-design", name: "Plan/Design", prompt: "Analyze this task and create a detailed implementation plan. Break it down into concrete steps, identify potential risks, and suggest the approach. Don't implement anything yet — just plan and document your findings.", builtin: true, enabled: true }`
      3. `{ id: "builtin-manual-testing", name: "Manual Testing", prompt: "Create a comprehensive manual testing plan for this task. List all test scenarios with detailed steps, expected results, and edge cases. Include positive, negative, and boundary test cases.", builtin: true, enabled: true }`
    - `async function loadActions(projectId: string): Promise<Action[]>` — calls `getProjectConfig(projectId, 'actions')`, parses JSON, seeds defaults if null/empty, returns actions array
    - `async function saveActions(projectId: string, actions: Action[]): Promise<void>` — calls `setProjectConfig(projectId, 'actions', JSON.stringify(actions))`
    - `function createAction(name: string, prompt: string): Action` — returns new action with `id: crypto.randomUUID()`, `builtin: false`, `enabled: true`
    - `function getEnabledActions(actions: Action[]): Action[]` — filters to enabled, sorts alphabetically by name
  - Import `getProjectConfig`, `setProjectConfig` from `./ipc` in actions.ts

  **Must NOT do**:
  - Do NOT add actions to global stores — they're loaded per-component when needed
  - Do NOT create a Svelte store for actions
  - Do NOT export the Action interface from actions.ts (export from types.ts only)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Two small files, pure TypeScript, no complex logic
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 2)
  - **Blocks**: Task 3, Task 4
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/lib/types.ts` — All shared interfaces live here. Follow existing pattern (exported interfaces).
  - `src/lib/parseCheckpoint.ts` — Example of a small utility module. Follow naming/export pattern.
  - `src/lib/ipc.ts:48-54` — `getProjectConfig`/`setProjectConfig` wrappers to use.

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Actions module compiles and exports correctly
    Tool: Bash (npx vitest run --passWithNoTests)
    Steps:
      1. Verify no TypeScript compilation errors
    Expected Result: vitest exits 0
    Evidence: .sisyphus/evidence/task-1-compile.txt

  Scenario: DEFAULT_ACTIONS has 3 builtin actions
    Tool: Bash (npx tsx -e)
    Steps:
      1. Import DEFAULT_ACTIONS, verify length === 3
      2. Verify all have builtin: true, enabled: true
      3. Verify IDs are prefixed with "builtin-"
    Expected Result: All assertions pass
    Evidence: .sisyphus/evidence/task-1-defaults.txt
  ```

  **Commit**: YES
  - Message: `feat(lib): add Action type and configurable actions helpers`
  - Files: `src/lib/types.ts`, `src/lib/actions.ts`

- [x] 2. Backend: Add `run_action` Tauri command with session-reuse logic

  **What to do**:
  - In `src-tauri/src/main.rs`:
    1. Extract prompt building from `start_implementation` (lines 358-383) into a standalone function:
       ```rust
       fn build_task_prompt(task: &db::TaskRow, action_instruction: &str) -> String
       ```
       This function assembles: task context (id, title, description, AC, plan) + action instruction. Same logic as current lines 358-383 but with configurable instruction instead of hardcoded string.
    2. Add new `run_action` Tauri command:
       ```rust
       #[tauri::command]
       async fn run_action(
           db: State<'_, Mutex<db::Database>>,
           server_mgr: State<'_, server_manager::ServerManager>,
           sse_mgr: State<'_, sse_bridge::SseBridgeManager>,
           app: tauri::AppHandle,
           task_id: String,
           repo_path: String,
           action_prompt: String,
       ) -> Result<serde_json::Value, String>
       ```
       Logic:
       - Fetch task from DB
       - Build prompt via `build_task_prompt(&task, &action_prompt)`
       - Check for reusable session:
         - `db.get_latest_session_for_ticket(&task_id)` → if exists AND status is "completed" or "failed":
           - Check `server_mgr.get_server_port(&task_id)` → if Some(port):
             - Create OpenCodeClient, call `prompt_async` with existing `opencode_session_id`
             - Update agent session status to "running" via `db.update_agent_session()`
             - Start SSE bridge if not already running — handle `AlreadyRunning` error gracefully (just log + continue, it means bridge is already connected)
             - Return JSON with task_id, worktree_path (from worktree record), port, session_id
           - If no port (server stopped): fall through to full flow
         - If session is "running" or "paused": return error "Agent is busy" / "Answer pending question first"
         - **Orphaned server case**: if `get_server_port` returns Some but `get_latest_session_for_ticket` returns None → treat as "no reusable session", fall through to full flow (server will be reused by the full flow)
       - Full flow (no reusable session): same as current `start_implementation` lines 291-421 but using `build_task_prompt` for prompt construction
       - **Race condition guard**: Re-check session status AFTER acquiring resources (between menu click and execution, another action may have started). If status changed to "running"/"paused" after initial check, abort and return error.
    3. Update `start_implementation` to call `build_task_prompt` internally (DRY refactor)
    4. Register `run_action` in `invoke_handler!` macro
  - In `src-tauri/src/sse_bridge.rs`:
    1. **Remove hardcoded status transition**: Delete the `db.update_task_status(&task_id, "in_review")` block at lines 200-205. Actions should NOT auto-move task status on completion.
    2. **Rename event**: Change `"implementation-complete"` event to `"action-complete"` (lines 198, 210-211). Update the `CompletionPayload` comment (line 45) and log messages accordingly. This makes the event generic for all action types.
    3. Do NOT change the `"implementation-failed"` event — keep it as-is for now (failure handling is action-agnostic).
  - In `src/lib/ipc.ts`: Add IPC wrapper:
    ```typescript
    export async function runAction(taskId: string, repoPath: string, actionPrompt: string): Promise<ImplementationStatus> {
      return invoke<ImplementationStatus>("run_action", { taskId, repoPath, actionPrompt });
    }
    ```
  - Add Rust unit test for `build_task_prompt` in main.rs or a new test module

  **Must NOT do**:
  - Do NOT remove `start_implementation` — keep it working (it's still called by existing code until Task 5 wires up the new flow)
  - Do NOT change `prompt_async` signature in opencode_client.rs
  - Do NOT change worktree creation, server spawning, or PTY management logic
  - Do NOT touch `agent_coordinator.rs` yet (that's Task 6)
  - Do NOT import from or call `agent_coordinator.rs` — it contains stale/dead code

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: New Tauri command with session-reuse logic, prompt refactor, error handling — moderate complexity
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 1)
  - **Blocks**: Task 5
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src-tauri/src/main.rs:283-422` — Current `start_implementation`: the full flow to refactor. Lines 358-383 are the prompt construction to extract.
  - `src-tauri/src/main.rs:424-468` — `abort_implementation`: shows pattern for looking up session + server port for a task.
  - `src-tauri/src/main.rs:889-908` — `get_latest_session`: pattern for DB session lookup.
  - `src-tauri/src/sse_bridge.rs:193-212` — SSE idle handler with hardcoded `"in_review"` status + `"implementation-complete"` event to refactor

  **API/Type References**:
  - `src-tauri/src/opencode_client.rs:242-278` — `prompt_async(session_id, text, agent)` signature
  - `src-tauri/src/db.rs:1273-1298` — `get_latest_session_for_ticket()` returns `Option<AgentSessionRow>`
  - `src-tauri/src/db.rs:1220-1238` — `update_agent_session()` for changing session status
  - `src-tauri/src/db.rs:103-113` — `AgentSessionRow` struct with status field
  - `src/lib/types.ts:111-116` — `ImplementationStatus` return type
  - `src-tauri/src/sse_bridge.rs:45` — `CompletionPayload` struct comment to update

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Rust compiles with new run_action command
    Tool: Bash (cargo build)
    Steps:
      1. Run: cargo build --manifest-path src-tauri/Cargo.toml
      2. Verify no compilation errors
    Expected Result: Exit code 0
    Evidence: .sisyphus/evidence/task-2-compile.txt

  Scenario: run_action registered in invoke_handler
    Tool: Grep
    Steps:
      1. Grep for "run_action" in invoke_handler macro
      2. Verify it appears in the handler list
    Expected Result: run_action found in handler registration
    Evidence: .sisyphus/evidence/task-2-handler.txt

  Scenario: build_task_prompt produces correct output
    Tool: Bash (cargo test)
    Steps:
      1. Run: cargo test test_build_task_prompt
      2. Test verifies prompt includes task context + custom instruction
    Expected Result: Test passes
    Evidence: .sisyphus/evidence/task-2-prompt-test.txt

  Scenario: IPC wrapper compiles
    Tool: Bash (npx vitest run --passWithNoTests)
    Steps:
      1. Verify no TypeScript errors related to runAction
    Expected Result: vitest exits 0
    Evidence: .sisyphus/evidence/task-2-ipc.txt

  Scenario: SSE bridge no longer auto-moves task status
    Tool: Grep
    Steps:
      1. Search for "update_task_status" in sse_bridge.rs
      2. Verify NO call to update_task_status with "in_review" remains
    Expected Result: No hardcoded status transition in SSE bridge
    Evidence: .sisyphus/evidence/task-2-sse-no-automove.txt

  Scenario: SSE bridge emits action-complete instead of implementation-complete
    Tool: Grep
    Steps:
      1. Search for "implementation-complete" in sse_bridge.rs — should NOT be found
      2. Search for "action-complete" in sse_bridge.rs — should be found
    Expected Result: Event renamed to action-complete
    Evidence: .sisyphus/evidence/task-2-sse-event-rename.txt
  ```

  **Commit**: YES
  - Message: `feat(backend): add run_action command with session-reuse and refactor SSE bridge`
  - Files: `src-tauri/src/main.rs`, `src-tauri/src/sse_bridge.rs`, `src/lib/ipc.ts`

- [x] 3. Dynamic context menu in KanbanBoard

  **What to do**:
  - In `src/components/KanbanBoard.svelte`:
    1. Import `loadActions`, `getEnabledActions` from `../lib/actions`
    2. Import `activeProjectId` from `../lib/stores`
    3. Add reactive state: `let actions: Action[] = []`
    4. Load actions when project changes:
       ```svelte
       $: if ($activeProjectId) {
         loadActions($activeProjectId).then(a => { actions = getEnabledActions(a) })
       }
       ```
    5. Replace the hardcoded "Start Implementation" button (line 110) with a dynamic `{#each}` block:
       ```svelte
       {#each actions as action (action.id)}
         <button
           class="context-item"
           class:disabled={isSessionBusy}
           disabled={isSessionBusy}
           title={isSessionBusy ? busyReason : action.name}
           on:click={() => handleRunAction(action)}
         >
           {action.name}
         </button>
       {/each}
       ```
    6. Add reactive busy check:
       ```svelte
       $: contextSession = contextMenu.taskId ? $activeSessions.get(contextMenu.taskId) : null
       $: isSessionBusy = contextSession?.status === 'running' || contextSession?.status === 'paused'
       $: busyReason = contextSession?.status === 'running' ? 'Agent is busy' : contextSession?.status === 'paused' ? 'Answer pending question first' : ''
       ```
    7. Add handler:
       ```typescript
       function handleRunAction(action: Action) {
         const taskId = contextMenu.taskId
         closeContextMenu()
         dispatch('run-action', { taskId, actionPrompt: action.prompt })
       }
       ```
    8. Remove the old `handleStartImplementation()` function
    9. Add a divider between actions and "Move to..." (keep existing context-divider pattern)
    10. Style disabled context items (greyed out, cursor not-allowed, optional tooltip)

  **Must NOT do**:
  - Do NOT change the "Move to..." submenu or "Delete" button
  - Do NOT add drag-to-reorder
  - Do NOT add inline prompt editing in the context menu
  - Do NOT change the context menu positioning/styling (only add items)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: UI component modification with dynamic rendering, disabled states, visual treatment
  - **Skills**: [`frontend-ui-ux`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 4)
  - **Blocks**: Task 5, Task 7
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src/components/KanbanBoard.svelte:108-126` — Current context menu HTML to replace
  - `src/components/KanbanBoard.svelte:47-51` — Current `handleStartImplementation` to replace with `handleRunAction`
  - `src/components/KanbanBoard.svelte:193-246` — Context menu CSS to extend for disabled state

  **API/Type References**:
  - `src/lib/actions.ts` — `loadActions()`, `getEnabledActions()` from Task 1
  - `src/lib/types.ts` — `Action` interface from Task 1
  - `src/lib/stores.ts` — `activeSessions`, `activeProjectId`

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Context menu shows dynamic actions
    Tool: Bash (npx vitest run)
    Steps:
      1. Mock loadActions to return 2 enabled actions
      2. Render KanbanBoard with a task
      3. Verify both action names appear in context menu
    Expected Result: Dynamic action items rendered
    Evidence: .sisyphus/evidence/task-3-dynamic-menu.txt

  Scenario: Actions disabled when session is running
    Tool: Bash (npx vitest run)
    Steps:
      1. Set activeSessions with status='running' for the task
      2. Open context menu
      3. Verify action buttons have disabled attribute
    Expected Result: Actions disabled with proper reason
    Evidence: .sisyphus/evidence/task-3-disabled.txt
  ```

  **Commit**: YES
  - Message: `feat(ui): replace hardcoded Start Implementation with dynamic actions menu`
  - Files: `src/components/KanbanBoard.svelte`

- [x] 4. Actions management section in SettingsPanel

  **What to do**:
  - In `src/components/SettingsPanel.svelte`:
    1. Import `loadActions`, `saveActions`, `createAction`, `DEFAULT_ACTIONS` from `../lib/actions`
    2. Import `type Action` from `../lib/types`
    3. Add state: `let actions: Action[] = []`, `let editingAction: Action | null = null`
    4. Load actions in `loadConfig()`:
       ```typescript
       actions = await loadActions(projectId)
       ```
    5. Add new section after the GitHub section:
       ```svelte
       <section class="section">
         <h3>Actions</h3>
         <p class="section-description">Configure actions available in the task context menu. Each action sends its prompt to the AI agent along with the task context.</p>
         
         {#each actions as action, i (action.id)}
           <div class="action-item">
             <div class="action-header">
               <label class="action-toggle">
                 <input type="checkbox" bind:checked={action.enabled} />
                 <span class="action-name">{action.name}</span>
               </label>
               <button class="action-delete" on:click={() => removeAction(i)} title="Delete action">x</button>
             </div>
             <label class="field">
               <span>Name</span>
               <input type="text" bind:value={action.name} placeholder="Action name" />
             </label>
             <label class="field">
               <span>Prompt</span>
               <textarea bind:value={action.prompt} placeholder="Instruction for the AI agent..." rows="3"></textarea>
             </label>
           </div>
         {/each}
         
         <div class="action-buttons">
           <button class="btn btn-add" on:click={addAction}>+ Add Action</button>
           <button class="btn btn-reset" on:click={resetActions}>Reset to Defaults</button>
         </div>
       </section>
       ```
    6. Add handler functions:
       - `addAction()`: appends `createAction('New Action', '')` to actions array
       - `removeAction(index)`: splices action from array (with confirm for builtin)
       - `resetActions()`: with `confirm()`, resets actions to DEFAULT_ACTIONS
    7. Update `save()` to also save actions:
       ```typescript
       await saveActions($activeProjectId, actions)
       ```
    8. Style the new section:
       - `.action-item`: Card-like container with border, padding, margin-bottom
       - `.action-header`: Flex row with toggle + delete button
       - `.action-toggle`: Checkbox + name inline
       - `textarea`: Same styling as `.field input` but multi-line
       - `.btn-add`: Subtle outline button
       - `.btn-reset`: Text-only secondary button
       - Follow existing SettingsPanel design language (bg-primary inputs, border, accent colors)

  **Must NOT do**:
  - Do NOT add drag-to-reorder
  - Do NOT add action ID editing (auto-generated)
  - Do NOT modify existing Project, JIRA, or GitHub sections
  - Do NOT add global CSS variables

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Settings UI with form inputs, toggle switches, add/delete interactions, visual polish
  - **Skills**: [`frontend-ui-ux`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 3)
  - **Blocks**: Task 7
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src/components/SettingsPanel.svelte:86-117` — Existing sections (Project, JIRA, GitHub) for layout pattern
  - `src/components/SettingsPanel.svelte:33-49` — `save()` function to extend
  - `src/components/SettingsPanel.svelte:24-31` — `loadConfig()` function to extend
  - `src/components/SettingsPanel.svelte:127-256` — CSS styles to follow

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Actions section renders with defaults
    Tool: Bash (npx vitest run)
    Steps:
      1. Mock getProjectConfig to return null (first load → seed defaults)
      2. Render SettingsPanel
      3. Verify 3 action items visible
    Expected Result: 3 OOTB actions rendered
    Evidence: .sisyphus/evidence/task-4-defaults-render.txt

  Scenario: Add action creates new entry
    Tool: Bash (npx vitest run)
    Steps:
      1. Render SettingsPanel with defaults
      2. Click "Add Action" button
      3. Verify 4 action items now visible
    Expected Result: New action appended
    Evidence: .sisyphus/evidence/task-4-add-action.txt
  ```

  **Commit**: YES
  - Message: `feat(ui): add actions management section to SettingsPanel`
  - Files: `src/components/SettingsPanel.svelte`

- [x] 5. Wire execution in App.svelte

  **What to do**:
  - In `src/App.svelte`:
    1. Import `runAction` from `./lib/ipc` (add to existing import line)
    2. Replace `handleStartImplementation` (lines 118-145) with `handleRunAction`:
       ```typescript
       async function handleRunAction(event: CustomEvent<{ taskId: string; actionPrompt: string }>) {
         if (!activeProject) {
           $error = 'No active project selected'
           return
         }
         const { taskId, actionPrompt } = event.detail
         try {
           console.log('[session] Running action for task:', taskId)
           const result = await runAction(taskId, activeProject.path, actionPrompt)
           console.log('[session] Action started, session_id:', result.session_id)
           
           try {
             const session = await getSessionStatus(result.session_id)
             const updated = new Map($activeSessions)
             updated.set(taskId, session)
             $activeSessions = updated
           } catch (sessionErr) {
             console.error('[session] Failed to fetch session after action:', sessionErr)
           }
           
           await loadTasks()
         } catch (e) {
           console.error('[session] Failed to run action for task:', taskId, e)
           $error = String(e)
         }
       }
       ```
    3. Update the KanbanBoard event binding:
       - Change `on:start-implementation={handleStartImplementation}` to `on:run-action={handleRunAction}`
    4. Remove old `startImplementation` import from ipc (if no other callers remain)
    5. **Update SSE event listener**: Change `listen('implementation-complete', ...)` to `listen('action-complete', ...)` (Task 2 renamed this event in sse_bridge.rs). The handler logic stays the same — just the event name changes.

  **Must NOT do**:
  - Do NOT change session status update logic (Task 2 already removed auto-move from SSE bridge)
  - Do NOT change the `loadSessions` function

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small, focused change in one file — swap event handler and IPC call
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (with Task 6)
  - **Blocks**: Task 6, Task 7
  - **Blocked By**: Task 2, Task 3

  **References**:

  **Pattern References**:
  - `src/App.svelte:118-145` — Current `handleStartImplementation` to replace
  - `src/App.svelte:383` — Event binding `on:start-implementation` to update
  - `src/App.svelte:6` — IPC imports line

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: App.svelte compiles with new handler
    Tool: Bash (npx vitest run --passWithNoTests)
    Steps:
      1. Verify no TypeScript errors
    Expected Result: vitest exits 0
    Evidence: .sisyphus/evidence/task-5-compile.txt

  Scenario: Old event handler removed
    Tool: Grep
    Steps:
      1. Verify no "start-implementation" in App.svelte event bindings
      2. Verify "run-action" appears in event binding
    Expected Result: New event wired, old removed
    Evidence: .sisyphus/evidence/task-5-wiring.txt

  Scenario: SSE event listener updated to action-complete
    Tool: Grep
    Steps:
      1. Verify no "implementation-complete" in App.svelte — should NOT be found
      2. Verify "action-complete" appears in App.svelte listen() call
    Expected Result: Event listener matches renamed SSE event
    Evidence: .sisyphus/evidence/task-5-sse-listener.txt
  ```

  **Commit**: YES (grouped with Task 6)
  - Message: `refactor: wire configurable actions and clean up old implementation pathway`
  - Files: `src/App.svelte`

- [x] 6. Clean up old hardcoded pathway

  **What to do**:
  - In `src-tauri/src/main.rs`:
    1. Update `start_implementation` to use `build_task_prompt()` with the default instruction (from Task 2's refactor — just verify it's been done)
    2. Optionally: Mark `start_implementation` with a comment `// Legacy: kept for backward compat. New code should use run_action.`
  - In `src-tauri/src/agent_coordinator.rs`:
    1. Remove the duplicate prompt construction code (lines 86-105)
    2. If `start_implementation` in agent_coordinator is unused, remove the entire function
    3. If it IS used somewhere, update it to call `build_task_prompt()` from main.rs (or extract to a shared module)
  - In `src/lib/ipc.ts`:
    1. Check if `startImplementation` wrapper is still called anywhere
    2. If not, add a deprecation comment: `/** @deprecated Use runAction instead */`
  - In `src/App.svelte`:
    1. Remove the `startImplementation` import if no longer used

  **Must NOT do**:
  - Do NOT delete `start_implementation` Tauri command (may be used by other code paths)
  - Do NOT change `abort_implementation` — it's independent
  - Do NOT modify tests from other tasks

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small cleanup changes across a few files
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 5 in Wave 3)
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 7
  - **Blocked By**: Task 5

  **References**:

  **Pattern References**:
  - `src-tauri/src/agent_coordinator.rs:86-105` — Duplicate prompt code to clean up
  - `src-tauri/src/main.rs:358-383` — Original prompt code (should now use build_task_prompt)
  - `src/lib/ipc.ts:62-64` — `startImplementation` wrapper to deprecate

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: No duplicate prompt construction
    Tool: Grep
    Steps:
      1. Search for "Implement this task. Create a branch" in Rust files
      2. Should appear only in DEFAULT_ACTIONS constant or build_task_prompt default, not in start_implementation body
    Expected Result: Hardcoded instruction removed from start_implementation
    Evidence: .sisyphus/evidence/task-6-no-duplicate.txt

  Scenario: Rust still compiles
    Tool: Bash (cargo build)
    Steps:
      1. cargo build --manifest-path src-tauri/Cargo.toml
    Expected Result: Exit code 0
    Evidence: .sisyphus/evidence/task-6-compile.txt
  ```

  **Commit**: YES (grouped with Task 5)
  - Message: `refactor: wire configurable actions and clean up old implementation pathway`
  - Files: `src-tauri/src/main.rs`, `src-tauri/src/agent_coordinator.rs`, `src/lib/ipc.ts`

- [ ] 7. Comprehensive test suite for all changes

  **What to do**:
  - **`src/lib/actions.test.ts`** (NEW file): Test the actions module:
    - `DEFAULT_ACTIONS` has exactly 3 items, all builtin, all enabled
    - `loadActions()` returns defaults when no config exists (mock getProjectConfig → null)
    - `loadActions()` parses stored JSON correctly (mock getProjectConfig → JSON string)
    - `saveActions()` serializes and calls setProjectConfig
    - `createAction()` returns action with UUID id, builtin: false, enabled: true
    - `getEnabledActions()` filters disabled and sorts alphabetically
  - **`src/components/KanbanBoard.test.ts`** (NEW or EXTEND): Test dynamic context menu:
    - Context menu renders action items from loaded actions
    - Actions disabled when session is running
    - Actions disabled when session is paused
    - Dispatches `run-action` event with correct payload on click
  - **`src/components/SettingsPanel.test.ts`** (EXTEND): Test actions section:
    - Actions section renders with default actions
    - "Add Action" button creates new entry
    - Toggle checkbox changes enabled state
    - "Reset to Defaults" button resets actions
  - Run full test suite: `npx vitest run` → ALL tests pass with 0 failures
  - Run Rust tests: `cargo test` → ALL pass

  **Must NOT do**:
  - Do NOT delete or modify existing tests — only add new ones
  - Do NOT mock loadActions in SettingsPanel tests if it's simpler to mock getProjectConfig

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Multiple test files, needs understanding of existing test patterns
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (sequential after Wave 3)
  - **Blocks**: FINAL
  - **Blocked By**: Tasks 3, 4, 5, 6

  **References**:

  **Pattern References**:
  - `src/components/TaskCard.test.ts` — Component test pattern with typed fixtures
  - `src/components/AgentPanel.test.ts` — Store-driven component testing pattern
  - `src/lib/parseCheckpoint.test.ts` — Pure function test pattern
  - `src/components/SettingsPanel.test.ts` — Existing settings tests to extend

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: All new tests pass
    Tool: Bash (npx vitest run)
    Steps:
      1. Run: npx vitest run src/lib/actions.test.ts
      2. Run: npx vitest run src/components/KanbanBoard.test.ts
      3. Run: npx vitest run src/components/SettingsPanel.test.ts
    Expected Result: All test files green, 0 failures
    Evidence: .sisyphus/evidence/task-7-tests.txt

  Scenario: Full regression check
    Tool: Bash
    Steps:
      1. Run: npx vitest run
      2. Run: cargo test (from src-tauri/)
    Expected Result: 0 failures in both
    Evidence: .sisyphus/evidence/task-7-regression.txt
  ```

  **Commit**: YES
  - Message: `test: add comprehensive tests for configurable actions`
  - Files: `src/lib/actions.test.ts`, `src/components/KanbanBoard.test.ts`, `src/components/SettingsPanel.test.ts`

---

## Final Verification Wave

> 4 review agents run in PARALLEL. ALL must APPROVE. Rejection -> fix -> re-run.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists. For each "Must NOT Have": search codebase for forbidden patterns. Check evidence files. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `npx vitest run` + `cargo test` + `cargo build`. Review all changed files for forbidden patterns (`as any`, `@ts-ignore`, empty catches). Check AI slop. Verify TypeScript strict mode compliance.
  Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high`
  Execute EVERY QA scenario from EVERY task. Test cross-task integration. Test edge cases: empty actions list, all disabled, very long prompts, session reuse after completion, action while running. Save evidence.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: compare spec vs actual diff. Verify 1:1 compliance. Check "Must NOT do" adherence. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

| After Task(s) | Message | Files | Verification |
|------------|---------|-------|--------------|
| 1 | `feat(lib): add Action type and configurable actions helpers` | `src/lib/types.ts`, `src/lib/actions.ts` | `npx vitest run --passWithNoTests` |
| 2 | `feat(backend): add run_action command with session-reuse and refactor SSE bridge` | `src-tauri/src/main.rs`, `src-tauri/src/sse_bridge.rs`, `src/lib/ipc.ts` | `cargo build && cargo test` |
| 3 | `feat(ui): replace hardcoded Start Implementation with dynamic actions menu` | `src/components/KanbanBoard.svelte` | `npx vitest run` |
| 4 | `feat(ui): add actions management section to SettingsPanel` | `src/components/SettingsPanel.svelte` | `npx vitest run` |
| 5, 6 | `refactor: wire configurable actions and clean up old implementation pathway` | `src/App.svelte`, `src-tauri/src/main.rs`, `src-tauri/src/agent_coordinator.rs`, `src/lib/ipc.ts` | `npx vitest run && cargo build` |
| 7 | `test: add comprehensive tests for configurable actions` | `src/lib/actions.test.ts`, `src/components/KanbanBoard.test.ts`, `src/components/SettingsPanel.test.ts` | `npx vitest run` |

---

## Success Criteria

### Verification Commands
```bash
npx vitest run          # Expected: ALL tests pass, 0 failures
cargo test              # Expected: ALL Rust tests pass
cargo build --manifest-path src-tauri/Cargo.toml  # Expected: compiles
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass (vitest + cargo)
- [ ] Context menu shows project-specific actions
- [ ] Actions disabled when agent is busy/paused
- [ ] Session reuse works for idle sessions
- [ ] Settings panel manages actions (add/edit/delete/toggle/reset)
- [ ] Default actions seeded on first load
