# Agent Status Notifications — "Needs Input" Badge & Toast

## TL;DR

> **Quick Summary**: Add a "Needs Input" badge to Kanban ticket cards and a clickable toast notification when an AI agent is blocked and needs user approval, so the user never misses a checkpoint regardless of which ticket they're viewing.
> 
> **Deliverables**:
> - "Needs Input" badge on TaskCard when agent is paused with checkpoint data
> - New `CheckpointToast.svelte` notification component (separate from existing error Toast)
> - Click-to-navigate: toast click selects the ticket and opens DetailPanel to Checkpoints tab
> - Tests for all new/modified components
> 
> **Estimated Effort**: Short
> **Parallel Execution**: YES - 3 waves + final verification
> **Critical Path**: Task 1 (stores/types) → Task 4 (CheckpointToast) → Task 5 (App.svelte wiring)

---

## Context

### Original Request
User wants to see status reports when the AI is processing — specifically when agents ask questions or need input. They want visibility in the dashboard (badge on cards) and a small notification (toast) that fires only when the agent is blocked and needs input.

### Interview Summary
**Key Discussions**:
- **What to show**: Agent questions/prompts — when the AI needs input (not progress updates)
- **Notification trigger**: Only when input is needed (agent blocked at checkpoint)
- **Dashboard placement**: Badge/indicator on Kanban ticket cards (not a separate panel)
- **Notification action**: Clickable — navigates to the relevant ticket's checkpoint panel
- **Test strategy**: Tests after implementation (Vitest + Testing Library)

**Research Findings**:
- `checkpoint-reached` event already fires from orchestrator.rs when agent pauses for approval
- `activeSessions` store (Map<string, AgentSession>) already tracks sessions by ticket_id
- Current visibility gap: user must have the right ticket selected + Checkpoints tab open to notice
- `Toast.svelte` is error-only, tightly coupled to `error` store — not suitable for enhancement
- `TaskCard.svelte` has existing badge patterns (`.jira-badge`) and pulse animation on `.status-dot.running`
- `DetailPanel.svelte` `activeTab` is local state with no `initialTab` prop — needs small addition

### Metis Review
**Identified Gaps** (addressed):
- Badge/toast condition must match CheckpointPanel exactly: `status === 'paused' && checkpoint_data !== null`
- `activeTab` in DetailPanel is local state — need `initialTab` prop for click-to-navigate
- Settings view edge case: toast click must also set `showSettings = false`
- Stale toast after checkpoint resolution: dismiss when session status changes away from paused
- Multiple simultaneous checkpoints: single-slot replacement (new replaces old, no queue)
- Long ticket titles in toast: use truncation pattern from TaskCard

---

## Work Objectives

### Core Objective
Make it impossible to miss when an AI agent needs user input, by adding persistent visual indicators on Kanban cards and a proactive clickable notification toast.

### Concrete Deliverables
- `CheckpointNotification` type in `src/lib/types.ts`
- `checkpointNotification` store + `pendingCheckpointTab` store in `src/lib/stores.ts`
- `initialTab` prop on `DetailPanel.svelte`
- "Needs Input" badge on `TaskCard.svelte`
- New `CheckpointToast.svelte` component
- Event wiring in `App.svelte`
- Tests for TaskCard badge, CheckpointToast, DetailPanel initialTab

### Definition of Done
- [x] `npx vitest run` — all tests pass (existing + new), zero failures (74/74 pass)
- [x] Badge visible on Kanban card when agent is paused with checkpoint data
- [x] Toast fires on `permission.updated` SSE event (replaces old `checkpoint-reached`)
- [x] Toast click navigates to ticket (DetailPanel replaced by tabless TaskDetailView)
- [x] Toast auto-dismisses or is dismissed when checkpoint is resolved

### Must Have
- Badge uses condition: `session.status === 'paused' && session.checkpoint_data !== null`
- Toast is a NEW component (`CheckpointToast.svelte`), not a modification of `Toast.svelte`
- Click-to-navigate sets `selectedTaskId` and opens DetailPanel to Checkpoints tab
- Toast click also closes Settings view if open (`showSettings = false`)
- Toast auto-dismisses when session status changes (checkpoint resolved/aborted)

### Must NOT Have (Guardrails)
- DO NOT modify `Toast.svelte` or `Toast.test.ts` — create a separate component
- DO NOT modify `CheckpointPanel.svelte` — approve/reject flow stays untouched
- DO NOT add OS-level notifications, sounds, or window focus
- DO NOT create a notification queue, array store, or stacking toasts — single-slot only
- DO NOT add badge counts — binary indicator only (needs input or doesn't)
- DO NOT add notification counter in header bar
- DO NOT add column-level "attention needed" indicators
- DO NOT restructure TaskCard layout or rename existing CSS classes
- DO NOT add any backend (Rust) changes — this is frontend-only
- DO NOT add a `needsInput` field to types — derive from existing `status + checkpoint_data`

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.
> Acceptance criteria requiring "user manually tests/confirms" are FORBIDDEN.

### Test Decision
- **Infrastructure exists**: YES (Vitest + Testing Library)
- **Automated tests**: YES (tests after implementation)
- **Framework**: Vitest with @testing-library/svelte
- **Pattern**: Colocated `ComponentName.test.ts` files next to components

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

| Deliverable Type | Verification Tool | Method |
|------------------|-------------------|--------|
| Svelte Components | Vitest + Testing Library | Render, assert DOM, simulate events |
| Store Logic | Vitest | Import store, set values, verify reactivity |
| Integration | Vitest + Playwright | Full event flow: emit → store → UI |

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — foundation + independent badge):
├── Task 1: Add notification type + stores [quick]
├── Task 2: Add initialTab prop to DetailPanel [quick]
└── Task 3: Add "Needs Input" badge to TaskCard [quick]

Wave 2 (After Task 1 — notification component):
└── Task 4: Create CheckpointToast component [visual-engineering]

Wave 3 (After Tasks 2, 3, 4 — integration wiring):
└── Task 5: Wire App.svelte event → stores → components [unspecified-high]

Wave FINAL (After ALL tasks — verification):
├── Task F1: Plan compliance audit [oracle]
├── Task F2: Code quality review [unspecified-high]
├── Task F3: Real manual QA [unspecified-high]
└── Task F4: Scope fidelity check [deep]

Critical Path: Task 1 → Task 4 → Task 5 → FINAL
Parallel Speedup: ~40% faster than sequential (Wave 1 runs 3 tasks simultaneously)
Max Concurrent: 3 (Wave 1)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|------------|--------|------|
| 1 | — | 4, 5 | 1 |
| 2 | — | 5 | 1 |
| 3 | — | 5 | 1 |
| 4 | 1 | 5 | 2 |
| 5 | 2, 3, 4 | FINAL | 3 |
| F1-F4 | 5 | — | FINAL |

### Agent Dispatch Summary

| Wave | # Parallel | Tasks → Agent Category |
|------|------------|----------------------|
| 1 | **3** | T1 → `quick`, T2 → `quick`, T3 → `quick` |
| 2 | **1** | T4 → `visual-engineering` |
| 3 | **1** | T5 → `unspecified-high` |
| FINAL | **4** | F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep` |

---

## TODOs

- [x] 1. Add CheckpointNotification type and notification stores (DONE — `pendingCheckpointTab` store intentionally omitted, see T2)

  **What to do**:
  - Add a `CheckpointNotification` interface to `src/lib/types.ts` with fields: `ticketId: string`, `ticketKey: string`, `sessionId: string`, `stage: string`, `message: string`, `timestamp: number`
  - Add a `checkpointNotification` writable store to `src/lib/stores.ts` typed as `writable<CheckpointNotification | null>(null)` — this is the single-slot notification state
  - Add a `pendingCheckpointTab` writable store to `src/lib/stores.ts` typed as `writable<string | null>(null)` — used to signal DetailPanel to open on Checkpoints tab after navigation

  **Must NOT do**:
  - DO NOT create an array/queue store — single-slot only
  - DO NOT add any fields to existing types (`AgentSession`, `Ticket`, etc.)
  - DO NOT modify any existing store definitions

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small, well-scoped changes to two files — add one interface and two store declarations
  - **Skills**: []
    - No specialized skills needed for adding types and stores
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: No UI work in this task

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: Task 4 (CheckpointToast needs the type and store), Task 5 (wiring needs stores)
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src/lib/types.ts` — All existing type definitions. Follow the `interface` pattern with exported interfaces. Add `CheckpointNotification` after the `AgentLog` interface (line ~end of agent-related types)
  - `src/lib/stores.ts` — All existing store definitions. Follow the `export const name = writable<Type>(default)` pattern. Add new stores after `activeSessions` store since they're related to agent session notifications

  **API/Type References**:
  - `src/lib/types.ts:AgentSession` — The `AgentSession` interface defines the session shape. `CheckpointNotification` will be derived from checkpoint-reached event data, not from AgentSession directly
  - `src-tauri/src/orchestrator.rs:130-138` — The `checkpoint-reached` event payload shape: `{ ticket_id, session_id, stage, data }` — this is what `CheckpointNotification` maps to

  **WHY Each Reference Matters**:
  - `types.ts` — You need to see the existing type naming convention (PascalCase interfaces, `string | null` for nullable) and find the right insertion point
  - `stores.ts` — You need to see the existing store pattern (`writable<Type>(initialValue)`) and the `activeSessions` store to understand the agent session tracking already in place

  **Acceptance Criteria**:
  - [ ] `CheckpointNotification` interface exported from `src/lib/types.ts`
  - [ ] `checkpointNotification` store exported from `src/lib/stores.ts` with initial value `null`
  - [ ] `pendingCheckpointTab` store exported from `src/lib/stores.ts` with initial value `null`
  - [ ] `npx vitest run` → all existing tests still pass (zero regressions)

  **QA Scenarios**:

  ```
  Scenario: Stores are importable and have correct initial values
    Tool: Bash (npx vitest)
    Preconditions: No changes to existing stores
    Steps:
      1. Write a quick inline test or verify via existing test runner
      2. Import `checkpointNotification` and `pendingCheckpointTab` from `src/lib/stores`
      3. Read initial values using `get()` from `svelte/store`
    Expected Result: Both stores resolve to `null` initially
    Failure Indicators: Import error, type error, or non-null initial value
    Evidence: .sisyphus/evidence/task-1-stores-importable.txt

  Scenario: Type is correctly exported and usable
    Tool: Bash (npx vitest)
    Preconditions: types.ts has new interface
    Steps:
      1. Import `CheckpointNotification` from `src/lib/types`
      2. Create a typed object matching the interface
      3. Verify TypeScript accepts it without errors
    Expected Result: No TypeScript errors when using the type
    Failure Indicators: TS compilation error or import failure
    Evidence: .sisyphus/evidence/task-1-type-export.txt

  Scenario: Existing tests are unbroken
    Tool: Bash
    Preconditions: All changes applied
    Steps:
      1. Run `npx vitest run`
      2. Check output for failures
    Expected Result: All existing tests pass, zero failures
    Failure Indicators: Any test failure output
    Evidence: .sisyphus/evidence/task-1-no-regression.txt
  ```

  **Commit**: YES
  - Message: `feat(stores): add checkpoint notification type and stores`
  - Files: `src/lib/types.ts`, `src/lib/stores.ts`
  - Pre-commit: `npx vitest run`

- [x] 2. ~~Add initialTab prop to DetailPanel for external tab control~~ SUPERSEDED — DetailPanel removed by task-detail-view plan; replaced by tabless TaskDetailView. Toast click navigates via `$selectedTaskId` directly.

  **What to do**:
  - Add an `initialTab` export prop to `DetailPanel.svelte`: `export let initialTab: string | null = null`
  - Add a reactive statement to set `activeTab` when `initialTab` changes: `$: if (initialTab) activeTab = initialTab`
  - Import the `pendingCheckpointTab` store and react to it: when `$pendingCheckpointTab` is set, use it as `initialTab` and then clear the store back to `null`
  - Write tests in `DetailPanel.test.ts` verifying: (a) default tab is 'overview' when no `initialTab`, (b) tab switches to 'checkpoints' when `initialTab='checkpoints'` is passed

  **Must NOT do**:
  - DO NOT restructure the existing tab system
  - DO NOT change default behavior (still opens to 'overview' without prop)
  - DO NOT modify CheckpointPanel.svelte

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small prop addition + reactive statement + focused tests
  - **Skills**: []
    - No specialized skills needed
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: Minimal UI change, just prop plumbing

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3)
  - **Blocks**: Task 5 (wiring needs initialTab to work)
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src/components/DetailPanel.svelte:16` — Current `activeTab` declaration: `let activeTab: 'overview' | 'logs' | 'checkpoints' | 'comments' = 'overview'`. This is local state — you're adding a prop that can override it
  - `src/components/DetailPanel.svelte:72-76` — PR Comments tab already has a badge pattern (notification dot on tab). Good reference for how the component handles visual indicators on tabs

  **API/Type References**:
  - `src/lib/stores.ts:pendingCheckpointTab` — The store that Task 1 creates. DetailPanel should subscribe to this and use its value to switch tabs, then clear it

  **Test References**:
  - `src/components/DetailPanel.test.ts` (if exists) — Follow existing test patterns. If no test file exists yet, follow `src/components/TaskCard.test.ts` for structure: typed fixtures, `render()` with props, `screen` queries

  **WHY Each Reference Matters**:
  - `DetailPanel.svelte:16` — You need to see the exact `activeTab` type union to ensure `initialTab` uses the same type
  - `pendingCheckpointTab` store — This is the bridge between toast click (sets store) and DetailPanel (reads store and switches tab)

  **Acceptance Criteria**:
  - [ ] `DetailPanel.svelte` accepts `initialTab` prop
  - [ ] Default behavior unchanged: opens to 'overview' when `initialTab` is not set
  - [ ] Tab switches to specified value when `initialTab` is provided
  - [ ] Component reacts to `pendingCheckpointTab` store changes
  - [ ] `npx vitest run src/components/DetailPanel.test.ts` → tests pass
  - [ ] `npx vitest run` → all tests pass (zero regressions)

  **QA Scenarios**:

  ```
  Scenario: DetailPanel opens to overview by default
    Tool: Bash (npx vitest)
    Preconditions: DetailPanel rendered without initialTab prop
    Steps:
      1. Render DetailPanel with required props (task, session) but no initialTab
      2. Query for active tab indicator
      3. Assert 'overview' tab is selected
    Expected Result: The overview tab is active by default
    Failure Indicators: Different tab is active or no tab is active
    Evidence: .sisyphus/evidence/task-2-default-tab.txt

  Scenario: DetailPanel opens to checkpoints when initialTab='checkpoints'
    Tool: Bash (npx vitest)
    Preconditions: DetailPanel rendered with initialTab='checkpoints'
    Steps:
      1. Render DetailPanel with initialTab='checkpoints' and required session data
      2. Query for active tab indicator
      3. Assert 'checkpoints' tab is selected
    Expected Result: The checkpoints tab is active
    Failure Indicators: Overview tab is active instead
    Evidence: .sisyphus/evidence/task-2-initial-tab.txt

  Scenario: Existing tests are unbroken
    Tool: Bash
    Preconditions: All changes applied
    Steps:
      1. Run `npx vitest run`
    Expected Result: All existing tests pass
    Failure Indicators: Any test failure
    Evidence: .sisyphus/evidence/task-2-no-regression.txt
  ```

  **Commit**: YES
  - Message: `feat(detail-panel): add initialTab prop for external tab control`
  - Files: `src/components/DetailPanel.svelte`, `src/components/DetailPanel.test.ts`
  - Pre-commit: `npx vitest run`

- [x] 3. Add "Needs Input" badge to TaskCard for paused agent sessions

  **What to do**:
  - Import the `activeSessions` store in `TaskCard.svelte`
  - Add a reactive derived variable: `$: needsInput = (() => { const session = $activeSessions.get(ticket.id); return session?.status === 'paused' && session?.checkpoint_data !== null; })()`
  - Render a small "Needs Input" badge/pill on the card when `needsInput` is true — position it near the top-right of the card or below the status dot
  - Style the badge: use `--warning` color (#e0af68), small pill shape, matching the existing `.jira-badge` pattern size
  - Add a subtle pulse animation to the badge to draw attention (similar to existing `.status-dot.running` pulse)
  - Write tests in `TaskCard.test.ts`: badge visible when session is paused+checkpoint, hidden when running, hidden when paused-without-checkpoint, hidden when no session

  **Must NOT do**:
  - DO NOT restructure the existing card layout
  - DO NOT rename existing CSS classes
  - DO NOT change the existing status-dot behavior
  - DO NOT add a `needsInput` field to the Ticket or AgentSession types — derive it

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small visual addition to existing component with clear patterns to follow
  - **Skills**: []
    - No specialized skills needed — follows existing TaskCard patterns
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: Badge is small and follows existing conventions, not a design task

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2)
  - **Blocks**: Task 5 (integration testing)
  - **Blocked By**: None (uses existing `activeSessions` store)

  **References**:

  **Pattern References**:
  - `src/components/TaskCard.svelte:133-140` — Existing `.jira-badge` styling: small pill with padding, border-radius, font-size 0.65rem. Follow this size/shape for the "Needs Input" badge
  - `src/components/TaskCard.svelte:148-151` — Existing `pulse` animation on `.status-dot.running`: `@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }` at 1.5s infinite. Reuse or adapt for the badge
  - `src/components/TaskCard.svelte:16-18` — `truncate()` helper function for long text

  **API/Type References**:
  - `src/lib/stores.ts:activeSessions` — `writable<Map<string, AgentSession>>` — keyed by ticket_id. Access with `$activeSessions.get(ticket.id)`
  - `src/lib/types.ts:AgentSession` — Has `status: string` and `checkpoint_data: string | null` fields

  **Test References**:
  - `src/components/TaskCard.test.ts` — Existing tests with typed `baseTicket` fixture and `render(TaskCard, { props: { ticket } })` pattern. Add new tests following this exact structure. There are 6 existing tests that must continue to pass

  **WHY Each Reference Matters**:
  - `.jira-badge` — Ensures "Needs Input" badge matches existing badge size and styling conventions
  - `pulse` animation — Reuse the exact animation keyframes for consistency
  - `TaskCard.test.ts` — You need to see the fixture pattern to create test variants with `activeSessions` store set up

  **Acceptance Criteria**:
  - [ ] Badge renders on card when `activeSessions` has a session with `status='paused'` and `checkpoint_data !== null` for that ticket
  - [ ] Badge does NOT render when session status is 'running'
  - [ ] Badge does NOT render when session is paused but `checkpoint_data` is null
  - [ ] Badge does NOT render when no session exists for the ticket
  - [ ] Badge uses `--warning` color and has pulse animation
  - [ ] All 6 existing TaskCard tests still pass
  - [ ] `npx vitest run src/components/TaskCard.test.ts` → all tests pass (existing + new)

  **QA Scenarios**:

  ```
  Scenario: Badge appears for paused session with checkpoint data
    Tool: Bash (npx vitest)
    Preconditions: activeSessions store has entry for ticket with status='paused', checkpoint_data='{"question":"approve?"}'
    Steps:
      1. Set activeSessions store with a paused session for the test ticket
      2. Render TaskCard with the matching ticket
      3. Query for element containing text "Needs Input" or class ".needs-input-badge"
    Expected Result: Badge element is present in the DOM
    Failure Indicators: Element not found, wrong text, or missing from DOM
    Evidence: .sisyphus/evidence/task-3-badge-visible.txt

  Scenario: Badge hidden when session is running
    Tool: Bash (npx vitest)
    Preconditions: activeSessions store has entry with status='running'
    Steps:
      1. Set activeSessions store with a running session
      2. Render TaskCard
      3. Query for ".needs-input-badge" or "Needs Input" text
    Expected Result: Badge element is NOT present in the DOM
    Failure Indicators: Badge unexpectedly present
    Evidence: .sisyphus/evidence/task-3-badge-hidden-running.txt

  Scenario: Badge hidden when paused without checkpoint data
    Tool: Bash (npx vitest)
    Preconditions: activeSessions store has entry with status='paused', checkpoint_data=null
    Steps:
      1. Set activeSessions store with paused session but null checkpoint_data
      2. Render TaskCard
      3. Query for badge
    Expected Result: Badge element is NOT present in the DOM
    Failure Indicators: Badge unexpectedly present
    Evidence: .sisyphus/evidence/task-3-badge-hidden-no-checkpoint.txt

  Scenario: Existing TaskCard tests unbroken
    Tool: Bash
    Preconditions: All changes applied
    Steps:
      1. Run `npx vitest run src/components/TaskCard.test.ts`
    Expected Result: All 6+ existing tests pass plus new badge tests
    Failure Indicators: Any test failure
    Evidence: .sisyphus/evidence/task-3-no-regression.txt
  ```

  **Commit**: YES
  - Message: `feat(task-card): add needs-input badge for paused agent sessions`
  - Files: `src/components/TaskCard.svelte`, `src/components/TaskCard.test.ts`
  - Pre-commit: `npx vitest run`

- [x] 4. Create CheckpointToast notification component

  **What to do**:
  - Create `src/components/CheckpointToast.svelte` — a new notification toast component
  - Subscribe to `checkpointNotification` store — render when value is non-null, hide when null
  - Display: ticket key/ID + truncated message (e.g., "Agent needs input on PROJ-42") using `--warning` accent color
  - Add close button (X) that clears `checkpointNotification` store to null
  - Add click handler on the toast body that:
    1. Sets `selectedTaskId` store to the `ticketId` from the notification
    2. Sets `pendingCheckpointTab` store to `'checkpoints'`
    3. Clears `checkpointNotification` store to null
  - Auto-dismiss after 8 seconds (longer than error toast's 5s since this is actionable)
  - Cancel auto-dismiss timer if user clicks or closes manually
  - Clear notification (dismiss toast) when the store is externally set to null (session resolved/aborted)
  - Style: fixed position bottom-right, z-index 200, slideIn animation, `--warning` background/accent, `cursor: pointer` on body, max-width 400px with text truncation for long ticket titles
  - Create `src/components/CheckpointToast.test.ts` with tests for: renders when notification set, click dispatches navigation stores, close button clears store, does not render when null

  **Must NOT do**:
  - DO NOT modify `Toast.svelte` or `Toast.test.ts`
  - DO NOT create a notification queue or array — single-slot store only
  - DO NOT add OS-level notifications or sounds
  - DO NOT position the toast in same exact spot as error toast — offset vertically (e.g., bottom: 80px) to avoid overlap

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: New UI component with animation, positioning, click interactions, and visual design considerations (color, spacing, overlap avoidance)
  - **Skills**: []
    - No specialized skills needed beyond visual engineering
  - **Skills Evaluated but Omitted**:
    - `playwright`: Not needed for component-level testing (Vitest handles it)
    - `frontend-ui-ux`: visual-engineering category covers this

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (solo)
  - **Blocks**: Task 5 (App.svelte needs to mount this component)
  - **Blocked By**: Task 1 (needs `CheckpointNotification` type and `checkpointNotification` store)

  **References**:

  **Pattern References**:
  - `src/components/Toast.svelte` — **DO NOT MODIFY**, but use as the **style reference**. Copy the positioning pattern (fixed, bottom-right, z-200), animation pattern (`slideIn` keyframes), and close button pattern. Offset vertically to avoid overlap (use `bottom: 80px` instead of `bottom: 20px`)
  - `src/components/Toast.svelte:28-68` — Exact CSS to reference for box-shadow, border-radius, padding, font-size, animation duration (0.2s ease-out)

  **API/Type References**:
  - `src/lib/types.ts:CheckpointNotification` — The type created in Task 1. Has `ticketId`, `ticketKey`, `sessionId`, `stage`, `message`, `timestamp`
  - `src/lib/stores.ts:checkpointNotification` — Store to subscribe to (`writable<CheckpointNotification | null>`)
  - `src/lib/stores.ts:selectedTaskId` — Set this on click to navigate to the ticket
  - `src/lib/stores.ts:pendingCheckpointTab` — Set this to `'checkpoints'` on click so DetailPanel opens to correct tab

  **Test References**:
  - `src/components/Toast.test.ts` — Test structure for toast-like components: render, check visibility based on store value, test dismiss behavior. Follow this pattern for `CheckpointToast.test.ts`

  **External References**:
  - No external libraries needed — pure Svelte + CSS

  **WHY Each Reference Matters**:
  - `Toast.svelte` CSS — Ensures visual consistency with existing toast (same shadow, radius, animation feel) while being a separate component
  - Store references — The click handler needs to set 3 stores in sequence (selectedTaskId, pendingCheckpointTab, clear checkpointNotification)
  - `Toast.test.ts` — Shows how to test store-driven visibility and dismiss behavior

  **Acceptance Criteria**:
  - [ ] `CheckpointToast.svelte` exists as a new file in `src/components/`
  - [ ] Toast renders when `checkpointNotification` store has a value
  - [ ] Toast does NOT render when store is null
  - [ ] Toast displays ticket key and message text
  - [ ] Click on toast body sets `selectedTaskId` and `pendingCheckpointTab` stores
  - [ ] Click on toast body clears `checkpointNotification` store
  - [ ] Close button clears `checkpointNotification` store
  - [ ] Auto-dismisses after 8 seconds
  - [ ] `npx vitest run src/components/CheckpointToast.test.ts` → all tests pass
  - [ ] `npx vitest run src/components/Toast.test.ts` → existing tests still pass (untouched file)
  - [ ] `npx vitest run` → zero regressions

  **QA Scenarios**:

  ```
  Scenario: Toast renders with checkpoint notification data
    Tool: Bash (npx vitest)
    Preconditions: checkpointNotification store set to { ticketId: 't1', ticketKey: 'PROJ-42', sessionId: 's1', stage: 'implement', message: 'Agent needs approval', timestamp: Date.now() }
    Steps:
      1. Set checkpointNotification store with test data
      2. Render CheckpointToast component
      3. Query for element containing "PROJ-42"
      4. Query for element containing "Agent needs approval" or similar message
    Expected Result: Toast is visible with ticket key and message
    Failure Indicators: Toast not rendered, wrong text, or missing elements
    Evidence: .sisyphus/evidence/task-4-toast-renders.txt

  Scenario: Toast click navigates to ticket and opens checkpoints tab
    Tool: Bash (npx vitest)
    Preconditions: checkpointNotification store set with ticketId='t1'
    Steps:
      1. Set checkpointNotification store
      2. Render CheckpointToast
      3. Click on the toast body element
      4. Read selectedTaskId store value
      5. Read pendingCheckpointTab store value
      6. Read checkpointNotification store value
    Expected Result: selectedTaskId='t1', pendingCheckpointTab='checkpoints', checkpointNotification=null
    Failure Indicators: Any store has wrong value after click
    Evidence: .sisyphus/evidence/task-4-toast-click-navigate.txt

  Scenario: Close button dismisses toast without navigation
    Tool: Bash (npx vitest)
    Preconditions: checkpointNotification store set
    Steps:
      1. Set checkpointNotification store
      2. Render CheckpointToast
      3. Click the close button (X)
      4. Read checkpointNotification store value
      5. Read selectedTaskId store value
    Expected Result: checkpointNotification=null, selectedTaskId unchanged (no navigation)
    Failure Indicators: Store not cleared or unexpected navigation
    Evidence: .sisyphus/evidence/task-4-toast-close.txt

  Scenario: Toast not rendered when store is null
    Tool: Bash (npx vitest)
    Preconditions: checkpointNotification store is null (default)
    Steps:
      1. Render CheckpointToast without setting store
      2. Query for toast container element
    Expected Result: No toast element in the DOM
    Failure Indicators: Toast unexpectedly rendered
    Evidence: .sisyphus/evidence/task-4-toast-hidden.txt
  ```

  **Commit**: YES
  - Message: `feat(notifications): create CheckpointToast component`
  - Files: `src/components/CheckpointToast.svelte`, `src/components/CheckpointToast.test.ts`
  - Pre-commit: `npx vitest run`

- [x] 5. Wire App.svelte: connect checkpoint events to notification stores and mount CheckpointToast (uses SSE `permission.updated`/`permission.replied` instead of old `checkpoint-reached` event)

  **What to do**:
  - Import `CheckpointToast` component and mount it in `App.svelte` template (alongside existing `<Toast />`)
  - Import `checkpointNotification` and `pendingCheckpointTab` stores
  - In the existing `checkpoint-reached` event listener (`App.svelte:79-86`), AFTER the current `activeSessions` update, add logic to populate the `checkpointNotification` store:
    1. Fetch the session via `getSessionStatus(event.payload.session_id)`
    2. If `session.status === 'paused' && session.checkpoint_data !== null`, set `$checkpointNotification` to a `CheckpointNotification` object with the ticket info
  - In the existing `stage-completed` event listener, clear `$checkpointNotification` if it matches the completed session's ticket (stale toast cleanup)
  - In the existing `session-aborted` event listener, clear `$checkpointNotification` if it matches the aborted session's ticket (stale toast cleanup)
  - Handle Settings view edge case: if `showSettings` is true when CheckpointToast click navigates, also set `showSettings = false`. This can be done by subscribing to `selectedTaskId` changes with a reactive statement, or by adding the logic to the checkpoint-reached handler. NOTE: since `showSettings` is local state in App.svelte, the cleanest approach is to add a reactive block: `$: if ($selectedTaskId && $pendingCheckpointTab) showSettings = false`
  - Pass the `pendingCheckpointTab` value down to DetailPanel as `initialTab` prop (or DetailPanel reads it from store directly — Task 2 handles the DetailPanel side)

  **Must NOT do**:
  - DO NOT modify `Toast.svelte` — only add `CheckpointToast` alongside it
  - DO NOT modify `CheckpointPanel.svelte`
  - DO NOT change the existing `checkpoint-reached` handler logic — only ADD to it
  - DO NOT create new event types on the backend (Rust side)
  - DO NOT add OS-level notifications

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Integration task touching App.svelte's event system with multiple stores, edge case handling, and coordination between components. Requires understanding the full data flow
  - **Skills**: []
    - No specialized skills needed
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: No visual design work — purely wiring and logic
    - `playwright`: QA scenarios handle integration verification

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (solo, after all Wave 1+2 tasks)
  - **Blocks**: Final verification wave
  - **Blocked By**: Task 2 (DetailPanel initialTab), Task 3 (TaskCard badge), Task 4 (CheckpointToast component)

  **References**:

  **Pattern References**:
  - `src/App.svelte:79-86` — EXISTING `checkpoint-reached` listener. This is the PRIMARY insertion point. Currently updates `activeSessions` store only. You're adding notification store population here
  - `src/App.svelte:90-98` — EXISTING `stage-completed` listener. Add stale notification cleanup here
  - `src/App.svelte:109-113` — EXISTING `session-aborted` listener. Add stale notification cleanup here
  - `src/App.svelte:166-169` — Where DetailPanel is rendered. Pass `initialTab` prop or ensure it reads from `pendingCheckpointTab` store
  - `src/App.svelte:179` — Where `<Toast />` is rendered. Add `<CheckpointToast />` near here

  **API/Type References**:
  - `src/lib/types.ts:CheckpointNotification` — Shape of the notification object to create
  - `src/lib/stores.ts:checkpointNotification` — Store to populate on checkpoint-reached
  - `src/lib/stores.ts:pendingCheckpointTab` — Store to clear after DetailPanel consumes it
  - `src/lib/ipc.ts:getSessionStatus` — Already used in the checkpoint-reached handler to fetch full session data

  **Test References**:
  - Existing event listener tests in App.svelte (if any) — follow same patterns
  - `src/components/Toast.test.ts` — Shows store-driven component rendering pattern

  **WHY Each Reference Matters**:
  - `App.svelte:79-86` — You're extending this exact handler. Read it carefully to understand the current flow before adding code
  - `stage-completed` and `session-aborted` listeners — These are where you clean up stale notifications. Without this, a toast could stay visible after the checkpoint is already resolved
  - `App.svelte:179` — Mount point for CheckpointToast. Place it adjacent to existing Toast

  **Acceptance Criteria**:
  - [ ] `<CheckpointToast />` is mounted in App.svelte template
  - [ ] `checkpoint-reached` event populates `checkpointNotification` store when session is paused with checkpoint data
  - [ ] `stage-completed` event clears `checkpointNotification` if it matches the completed session
  - [ ] `session-aborted` event clears `checkpointNotification` if it matches the aborted session
  - [ ] Settings view closes when toast click navigates (`showSettings = false`)
  - [ ] `npx vitest run` → all tests pass (zero regressions)

  **QA Scenarios**:

  ```
  Scenario: CheckpointToast component is mounted in App
    Tool: Bash (grep)
    Preconditions: App.svelte has been updated
    Steps:
      1. Search App.svelte for `<CheckpointToast` import and usage
      2. Verify it's in the template section
    Expected Result: CheckpointToast is imported and rendered in App.svelte
    Failure Indicators: Component not found in template
    Evidence: .sisyphus/evidence/task-5-toast-mounted.txt

  Scenario: Checkpoint-reached event triggers notification store
    Tool: Bash (npx vitest)
    Preconditions: App.svelte checkpoint-reached handler updated
    Steps:
      1. Simulate checkpoint-reached event (or test the handler logic directly)
      2. Verify checkpointNotification store is populated with correct data
    Expected Result: Store contains CheckpointNotification with matching ticketId, sessionId, stage
    Failure Indicators: Store is null or has wrong data
    Evidence: .sisyphus/evidence/task-5-event-triggers-notification.txt

  Scenario: Stage-completed clears stale notification
    Tool: Bash (npx vitest)
    Preconditions: checkpointNotification store has value for ticket T1
    Steps:
      1. Set checkpointNotification store for ticket T1
      2. Simulate stage-completed event for ticket T1
      3. Read checkpointNotification store
    Expected Result: Store is null (notification cleared)
    Failure Indicators: Stale notification remains
    Evidence: .sisyphus/evidence/task-5-stale-clear.txt

  Scenario: Full test suite passes with no regressions
    Tool: Bash
    Preconditions: All changes applied
    Steps:
      1. Run `npx vitest run`
    Expected Result: All tests pass, zero failures
    Failure Indicators: Any test failure
    Evidence: .sisyphus/evidence/task-5-no-regression.txt
  ```

  **Commit**: YES
  - Message: `feat(app): wire checkpoint notifications with click-to-navigate`
  - Files: `src/App.svelte`
  - Pre-commit: `npx vitest run`

---

## Final Verification Wave

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (render component, check store, check event listener). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in `.sisyphus/evidence/`. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `npx vitest run` full suite. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp). Verify TypeScript strict mode compliance.
  Output: `Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill)
  Start dev server (`npm run dev`). Use Playwright to: navigate to board, verify badge appears on ticket with paused session, trigger checkpoint-reached event, verify toast appears, click toast, verify DetailPanel opens to Checkpoints tab. Test edge cases: dismiss toast, toast with Settings open, badge disappears after approval.
  Save screenshots to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (`git diff`). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Verify `Toast.svelte` and `CheckpointPanel.svelte` are UNTOUCHED. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

| After Task | Message | Files | Verification |
|------------|---------|-------|--------------|
| 1 | `feat(stores): add checkpoint notification type and stores` | `src/lib/types.ts`, `src/lib/stores.ts` | `npx vitest run` |
| 2 | `feat(detail-panel): add initialTab prop for external tab control` | `src/components/DetailPanel.svelte`, `src/components/DetailPanel.test.ts` | `npx vitest run` |
| 3 | `feat(task-card): add needs-input badge for paused agent sessions` | `src/components/TaskCard.svelte`, `src/components/TaskCard.test.ts` | `npx vitest run` |
| 4 | `feat(notifications): create CheckpointToast component` | `src/components/CheckpointToast.svelte`, `src/components/CheckpointToast.test.ts` | `npx vitest run` |
| 5 | `feat(app): wire checkpoint notifications with click-to-navigate` | `src/App.svelte` | `npx vitest run` |

---

## Success Criteria

### Verification Commands
```bash
npx vitest run                          # Expected: All tests pass (existing + new)
npx vitest run src/components/TaskCard.test.ts      # Expected: Badge tests pass
npx vitest run src/components/CheckpointToast.test.ts  # Expected: Toast tests pass
npx vitest run src/components/Toast.test.ts         # Expected: Existing tests still pass (untouched)
```

### Final Checklist
- [x] All "Must Have" present (badge condition, new component, click-to-navigate, Settings edge case, auto-dismiss)
- [x] All "Must NOT Have" absent (Toast.svelte unmodified, no queue, no OS notifications, no backend changes)
- [x] All tests pass — zero regressions (74/74)
- [x] Badge visible on Kanban cards with paused+checkpoint sessions
- [x] Toast fires on permission.updated, clickable, navigates correctly
