# Self-Review Design Alignment

## TL;DR

> **Quick Summary**: Align the self-review screen implementation with the .pen design file — add breadcrumb toolbar with code/review toggle, always show subtitle row, and fix sidebar width.
> 
> **Deliverables**:
> - Breadcrumb toolbar row with path navigation and code_view/review_view toggle
> - Subtitle row always visible (not just when jira_title present)
> - Comments sidebar at 360px (down from 480px)
> - All existing tests passing + new tests for added features
> 
> **Estimated Effort**: Short
> **Parallel Execution**: YES — 2 waves
> **Critical Path**: Task 1 → Task 2 + Task 3 + Task 4 (parallel) → Task 5

---

## Context

### Original Request
User asked to review the `.pen` design file for the self-review screen and update the app to match. The design file is at `design.pen`, screen "Open Forge — Self-Review" (node `L03bF`).

### Interview Summary
**Key Discussions**:
- Breadcrumb toolbar should appear in BOTH code and review modes (not just review)
- Status badge `[IN_REVIEW]` — user explicitly rejected, will update design instead
- TDD approach confirmed

**Research Findings**:
- The existing implementation closely matches the design (file tree, diff viewer, comments sidebar, send-to-agent panel all align)
- 4 specific gaps identified between design and code
- One pre-existing stale test (`'renders status badge with status label'`) is currently failing and must be cleaned up
- All SelfReviewView tests are green (11/11 pass)
- No backend/Rust/IPC changes needed

### Metis Review
**Identified Gaps** (addressed):
- Stale test baseline must be established → Task 1 prerequisite
- Subtitle "always visible" needs content spec for null jira_title → Default: show empty row for visual consistency
- Breadcrumb interactivity → Display-only (terminal aesthetic, not clickable navigation)
- Toggle guard (worktreePath) must be preserved → Explicitly noted in guardrails

---

## Work Objectives

### Core Objective
Make the self-review screen match the .pen design by adding a breadcrumb toolbar, updating the subtitle row visibility, and fixing the sidebar width.

### Concrete Deliverables
- `TaskDetailView.svelte` — Breadcrumb toolbar row + subtitle fix + toggle relocation
- `TaskDetailView.test.ts` — Stale test fix + new breadcrumb tests
- `SelfReviewView.svelte` — Sidebar width 480px → 360px
- `SelfReviewView.test.ts` — Sidebar width test

### Definition of Done
- [ ] `pnpm test -- --run TaskDetailView.test` → ALL PASS (0 failures)
- [ ] `pnpm test -- --run SelfReviewView.test` → ALL PASS (0 failures)
- [ ] `pnpm test -- --run` → No NEW failures (pre-existing PrReviewView/App failures are out of scope)
- [ ] `pnpm build` → Success, no type errors

### Must Have
- Breadcrumb toolbar visible in BOTH code and review modes
- Breadcrumb shows path: `$ cd board / {task.status} / {task.jira_key || task.id} / {code|self_review}`
- Code/Review toggle buttons in breadcrumb (right-aligned), style as outlined buttons
- Toggle ONLY appears when `worktreePath !== null` (existing guard preserved)
- Subtitle row always rendered (even when `jira_title` is null)
- Comments sidebar at `w-[360px]` (not `w-[480px]`)
- TDD: tests written/updated BEFORE implementation

### Must NOT Have (Guardrails)
- **NO status badge** — User explicitly rejected this. Do NOT add `[IN_REVIEW]` or any status text.
- **NO changes to Back button logic** (`handleBack()` must stay intact)
- **NO changes to action buttons** (`handleStatusChange()`, `handleActionClick()` untouched)
- **NO changes to DiffViewer, FileTree, SendToAgentPanel, GeneralCommentsSidebar** — these already match the design
- **NO changes to sidebar auto-open behavior** (`sidebarVisible = false` default stays)
- **NO clickable breadcrumb segments** — breadcrumb is display-only text
- **NO `<style>` blocks** — daisyUI/Tailwind classes only (per project rules)
- **NO hardcoded hex colors** — use daisyUI semantic classes only
- **NO changes to AgentPanel, TaskInfoPanel, or KanbanBoard**
- **NO changes to navigation.ts or stores.ts**

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (vitest + @testing-library/svelte)
- **Automated tests**: TDD (test-first)
- **Framework**: vitest
- **Each task follows**: RED (failing test) → GREEN (minimal impl) → REFACTOR

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Frontend/UI**: Use Playwright (playwright skill) — Navigate, interact, assert DOM, screenshot
- **Tests**: Use Bash (pnpm test) — Run targeted test suites, assert pass/fail

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — prerequisite):
└── Task 1: Fix stale status badge test [quick]

Wave 2 (After Wave 1 — parallel feature work):
├── Task 2: Add breadcrumb toolbar + move toggle [deep]
├── Task 3: Always show subtitle row [quick]
└── Task 4: Fix comments sidebar width [quick]

Wave FINAL (After ALL tasks):
└── Task 5: Full test suite + visual QA [deep]

Critical Path: Task 1 → Tasks 2+3+4 → Task 5
Parallel Speedup: Wave 2 runs 3 tasks concurrently
Max Concurrent: 3 (Wave 2)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | — | 2, 3, 4 | 1 |
| 2 | 1 | 5 | 2 |
| 3 | 1 | 5 | 2 |
| 4 | 1 | 5 | 2 |
| 5 | 2, 3, 4 | — | FINAL |

### Agent Dispatch Summary

- **Wave 1**: 1 task — T1 → `quick`
- **Wave 2**: 3 tasks — T2 → `deep`, T3 → `quick`, T4 → `quick`
- **FINAL**: 1 task — T5 → `deep` + `playwright` skill

---

## TODOs

- [x] 1. Fix stale status badge test in TaskDetailView.test.ts

  **What to do**:
  - Run `pnpm test -- --run TaskDetailView.test.ts` to confirm the `'renders status badge with status label'` test fails
  - The test at line 166-169 expects `screen.getAllByText('Backlog')` but TaskDetailView does NOT render task status anywhere — this is a stale test from a removed/never-added feature
  - **Remove the entire test case** (lines 166-170) since the user explicitly rejected adding a status badge
  - Run tests again to verify all remaining TaskDetailView tests pass (should be 13/13)

  **Must NOT do**:
  - Do NOT add status badge rendering to make the test pass
  - Do NOT change any other test cases
  - Do NOT touch the component code

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single test file change, removing ~5 lines
  - **Skills**: []
    - No specialized skills needed for test deletion

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (solo prerequisite)
  - **Blocks**: Tasks 2, 3, 4
  - **Blocked By**: None (start immediately)

  **References**:

  **Pattern References**:
  - `src/components/TaskDetailView.test.ts:166-170` — The stale test to remove. It calls `screen.getAllByText('Backlog')` which has no matching render in the component.

  **WHY Each Reference Matters**:
  - The test file is the ONLY file to touch. Lines 166-170 contain the failing assertion. Removing these 5 lines fixes the baseline.

  **Acceptance Criteria**:

  - [ ] `pnpm test -- --run TaskDetailView.test.ts` → PASS (13 tests, 0 failures)
  - [ ] The test `'renders status badge with status label'` no longer exists in the test file

  **QA Scenarios**:

  ```
  Scenario: Stale test removed, remaining tests pass
    Tool: Bash
    Preconditions: Test file has the stale test removed
    Steps:
      1. Run: pnpm test -- --run TaskDetailView.test.ts
      2. Check stdout for test count and pass/fail
      3. Verify "renders status badge" does NOT appear in output
    Expected Result: 13 tests pass, 0 failures, no "status badge" test name in output
    Failure Indicators: Any test failure, or "renders status badge" still appears
    Evidence: .sisyphus/evidence/task-1-stale-test-removed.txt
  ```

  **Evidence to Capture**:
  - [ ] task-1-stale-test-removed.txt — Full test output showing all pass

  **Commit**: YES
  - Message: `fix(test): remove stale status badge test from TaskDetailView`
  - Files: `src/components/TaskDetailView.test.ts`
  - Pre-commit: `pnpm test -- --run TaskDetailView.test.ts`

---

- [ ] 2. Add breadcrumb toolbar to TaskDetailView + move Code/Review toggle

  **What to do**:

  **TDD Phase — RED (write failing tests first)**:
  - Add new test cases to `TaskDetailView.test.ts`:
    - `'renders breadcrumb with board path segment'` — expect `$ cd board` text present
    - `'renders breadcrumb with task status segment'` — expect task.status text in breadcrumb (e.g., "backlog")
    - `'renders breadcrumb with task identifier'` — expect task.jira_key "PROJ-123" or task.id in breadcrumb
    - `'renders breadcrumb with code segment by default'` — expect "code" text in breadcrumb when not in review mode
    - `'renders breadcrumb with task id when no jira_key'` — expect "T-42" for task without jira_key
    - Update existing `'hides Review toggle when no worktree'` test to look for toggle in breadcrumb area instead of header
  - Run tests → verify RED (new tests fail)

  **TDD Phase — GREEN (implement to pass)**:
  - In `TaskDetailView.svelte`, add a new breadcrumb toolbar row **between the existing `<header>` closing tag (line 134) and the `<div class="flex flex-1 ...">` (line 136)**:
    ```
    <div class="flex items-center justify-between h-10 px-6 border-b border-base-300 shrink-0">
      <!-- Left: breadcrumb -->
      <div class="flex items-center gap-1.5 font-mono text-xs">
        <span class="text-base-content/50">$ cd board</span>
        <span class="text-base-content/20">/</span>
        <span class="text-base-content/50">{task.status}</span>
        <span class="text-base-content/20">/</span>
        <span class="text-primary font-semibold">{task.jira_key || task.id}</span>
        <span class="text-base-content/20">/</span>
        <span class="text-primary font-semibold">{reviewMode ? 'self_review' : 'code'}</span>
      </div>
      <!-- Right: code/review toggle (only when worktree exists) -->
      {#if worktreePath !== null}
        <div class="flex items-center gap-2.5">
          <button class="..." onclick={() => reviewMode = false}>code_view</button>
          <button class="..." onclick={() => reviewMode = true}>review_view</button>
        </div>
      {/if}
    </div>
    ```
  - Remove the Code/Review toggle from the existing header `<div>` (lines 98-103 approximately — the `{#if worktreePath !== null}` block with the pill-group toggle)
  - Use outlined button styling for toggle buttons: the active one gets `text-primary border border-primary`, inactive gets `text-base-content/50 border border-base-300`
  - Run tests → verify GREEN

  **TDD Phase — REFACTOR**:
  - Clean up class strings, ensure consistent spacing
  - Verify visual output matches design

  **Must NOT do**:
  - Do NOT add `<style>` blocks — Tailwind/daisyUI classes only
  - Do NOT change Back button, Move to Done, or action button logic
  - Do NOT make breadcrumb segments clickable (display-only)
  - Do NOT change `reviewMode` state management logic
  - Do NOT touch DiffViewer toolbar (that's a separate component)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: TDD workflow with multiple test cases + template restructuring across test + component files
  - **Skills**: []
    - No specialized skills needed — standard Svelte 5 component work

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 3, 4)
  - **Blocks**: Task 5
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src/components/TaskDetailView.svelte:82-134` — The existing `<header>` element. The breadcrumb row goes AFTER this header's closing tag, as a sibling inside the outer flex-col container.
  - `src/components/TaskDetailView.svelte:98-103` — The current Code/Review toggle pill-group to be REMOVED from here and recreated in the breadcrumb toolbar.
  - `src/components/TaskDetailView.svelte:19` — `let reviewMode = $state(false)` — This state drives the toggle. The breadcrumb buttons set this same state.
  - `src/components/TaskDetailView.svelte:20` — `let worktreePath = $state<string | null>(null)` — Guard: toggle only shows when worktree exists.

  **Test References**:
  - `src/components/TaskDetailView.test.ts:195-199` — Existing `'hides Review toggle when no worktree'` test. This test looks for `screen.queryByText('Review')` which will need updating since the toggle button text changes to `review_view`.
  - `src/components/TaskDetailView.test.ts:112-124` — `baseTask` fixture with `jira_key: 'PROJ-123'` and `status: 'backlog'` — use these values in breadcrumb assertions.
  - `src/components/TaskDetailView.test.ts:73-94` — IPC mocks including `getWorktreeForTask: vi.fn().mockResolvedValue(null)` — toggle hidden by default because worktree is null.

  **API/Type References**:
  - `src/lib/types.ts:1-13` — Task interface: `status: string`, `jira_key: string | null`, `id: string`

  **Design References**:
  - Design node `oYKe3` "Toolbar" — 40px height, padding [0,24], justified space-between, bottom border. Left: breadcrumb text. Right: code_view/review_view buttons.
  - Design node `RJLdB` "codeBtn" — height 28, padding [0,10], border stroke, text "code_view" in #00D084 when active
  - Design node `Sj1Yq` "reviewBtn" — height 28, padding [0,10], border stroke, text "review_view" in #888888 when inactive

  **WHY Each Reference Matters**:
  - Lines 82-134: The breadcrumb inserts AFTER the header close tag but INSIDE the outer flex-col div. Understanding this nesting is critical.
  - Lines 98-103: This is the exact code to REMOVE (the pill-group toggle). Miss this and you'll have duplicate toggles.
  - Lines 195-199: This test WILL BREAK because the toggle text changes. Must update assertion text.
  - `baseTask`: The test fixture defines what values appear in breadcrumb assertions. Use "PROJ-123" and "backlog".

  **Acceptance Criteria**:

  - [ ] Test file created/updated: `src/components/TaskDetailView.test.ts`
  - [ ] `pnpm test -- --run TaskDetailView.test.ts` → PASS (all tests, 0 failures)
  - [ ] Breadcrumb row renders with correct path segments for task with jira_key
  - [ ] Breadcrumb row renders with task.id when jira_key is null
  - [ ] Toggle buttons appear in breadcrumb when worktree exists
  - [ ] Toggle buttons hidden when no worktree (existing guard preserved)
  - [ ] Old pill-group toggle removed from header
  - [ ] Clicking `code_view` / `review_view` switches between modes

  **QA Scenarios**:

  ```
  Scenario: Breadcrumb renders with correct path for Jira-linked task
    Tool: Bash
    Preconditions: TaskDetailView rendered with baseTask (jira_key='PROJ-123', status='backlog')
    Steps:
      1. Run: pnpm test -- --run TaskDetailView.test.ts
      2. Check output for breadcrumb-related test names and pass status
    Expected Result: All breadcrumb tests pass. Output includes "renders breadcrumb" test names with ✓
    Failure Indicators: Any ✗ next to breadcrumb tests
    Evidence: .sisyphus/evidence/task-2-breadcrumb-tests.txt

  Scenario: Breadcrumb visible in running app
    Tool: Playwright (playwright skill)
    Preconditions: App running with `pnpm tauri:dev`, task with worktree selected
    Steps:
      1. Navigate to a task detail view (click any task card)
      2. Assert breadcrumb row exists with text matching `$ cd board`
      3. Assert task status segment visible
      4. Assert code_view / review_view buttons visible
      5. Click review_view button
      6. Assert breadcrumb last segment changes to "self_review"
      7. Assert diff viewer loads (split/unified toolbar visible)
      8. Click code_view button
      9. Assert breadcrumb last segment changes back to "code"
      10. Take screenshot of breadcrumb in each mode
    Expected Result: Breadcrumb renders, toggle works, path segment updates dynamically
    Failure Indicators: Missing breadcrumb row, toggle buttons not found, segment doesn't update
    Evidence: .sisyphus/evidence/task-2-breadcrumb-code-mode.png, .sisyphus/evidence/task-2-breadcrumb-review-mode.png
  ```

  **Evidence to Capture**:
  - [ ] task-2-breadcrumb-tests.txt — Test output
  - [ ] task-2-breadcrumb-code-mode.png — Screenshot of breadcrumb in code mode
  - [ ] task-2-breadcrumb-review-mode.png — Screenshot of breadcrumb in review mode

  **Commit**: YES
  - Message: `feat(ui): add breadcrumb toolbar with code/review toggle to task detail view`
  - Files: `src/components/TaskDetailView.svelte`, `src/components/TaskDetailView.test.ts`
  - Pre-commit: `pnpm test -- --run TaskDetailView.test.ts`

---

- [ ] 3. Always show subtitle row in TaskDetailView

  **What to do**:

  **TDD Phase — RED**:
  - Add test case to `TaskDetailView.test.ts`:
    - `'renders subtitle row even when jira_title is null'` — render with `baseTask` (which has `jira_title: null`) and verify the subtitle row container element exists (use a data attribute or check for the border-t styling container)
    - `'renders jira_title in subtitle when available'` — render with task that has `jira_title: 'Some Jira Title'` and verify the text appears
  - Run tests → verify RED

  **TDD Phase — GREEN**:
  - In `TaskDetailView.svelte`, change the subtitle conditional from:
    ```svelte
    {#if task.jira_title && task.jira_key}
      <button class="text-sm text-base-content/50 ..." ...>{task.jira_title}</button>
    {/if}
    ```
    To always render the subtitle row, showing jira_title content when available:
    ```svelte
    <div class="text-sm text-base-content/50 truncate px-6 pb-3 -mt-1 border-t border-base-300" data-testid="subtitle-row">
      {#if task.jira_title && task.jira_key}
        <button class="hover:text-primary transition-colors cursor-pointer text-left w-full truncate"
          title={task.jira_title}
          onclick={() => jiraBaseUrl && openUrl(`${jiraBaseUrl}/browse/${task.jira_key}`)}
        >{task.jira_title}</button>
      {:else}
        <span class="invisible">&#8203;</span>
      {/if}
    </div>
    ```
  - The row renders always (for visual structure/border), with invisible zero-width space when no content
  - Run tests → verify GREEN

  **Must NOT do**:
  - Do NOT duplicate the task title in the subtitle
  - Do NOT add any new IPC calls or store subscriptions
  - Do NOT change the Jira link click behavior

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small conditional change + 2 test cases
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 2, 4)
  - **Blocks**: Task 5
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src/components/TaskDetailView.svelte:127-133` — The current subtitle conditional block. This is the exact code to modify.

  **Test References**:
  - `src/components/TaskDetailView.test.ts:112-124` — `baseTask` has `jira_title: null`, `jira_key: 'PROJ-123'` — the default fixture for testing null subtitle state.

  **Design References**:
  - Design node `w8cUY` "Subtitle Row" — height 32, padding [0,24], top border (stroke thickness 1 on top edge), contains task description text at fontSize 11.

  **WHY Each Reference Matters**:
  - Lines 127-133: This is the ONLY code to change. The `{#if}` wrapper makes the row conditional — we need to make the row always render.
  - `baseTask`: Tests will use this fixture which has `jira_title: null` to verify the row still renders.

  **Acceptance Criteria**:

  - [ ] Test cases added: `'renders subtitle row even when jira_title is null'`, `'renders jira_title in subtitle when available'`
  - [ ] `pnpm test -- --run TaskDetailView.test.ts` → PASS (all tests)
  - [ ] Subtitle row renders as a visual element even when `jira_title` is null
  - [ ] Subtitle row shows clickable `jira_title` text when available

  **QA Scenarios**:

  ```
  Scenario: Subtitle row visible with null jira_title
    Tool: Bash
    Preconditions: Test file has new subtitle tests
    Steps:
      1. Run: pnpm test -- --run TaskDetailView.test.ts
      2. Check that 'renders subtitle row even when jira_title is null' passes
    Expected Result: Test passes — subtitle row element found in DOM even with null jira_title
    Failure Indicators: Test fails because subtitle row not found
    Evidence: .sisyphus/evidence/task-3-subtitle-tests.txt

  Scenario: Subtitle shows jira_title when present
    Tool: Bash
    Preconditions: Test renders TaskDetailView with jira_title set
    Steps:
      1. Run: pnpm test -- --run TaskDetailView.test.ts
      2. Check that 'renders jira_title in subtitle when available' passes
    Expected Result: Test finds jira_title text in subtitle row
    Failure Indicators: Text not found in DOM
    Evidence: .sisyphus/evidence/task-3-subtitle-tests.txt
  ```

  **Evidence to Capture**:
  - [ ] task-3-subtitle-tests.txt — Test output

  **Commit**: YES (groups with Task 2)
  - Message: `feat(ui): always show subtitle row in task detail view`
  - Files: `src/components/TaskDetailView.svelte`, `src/components/TaskDetailView.test.ts`
  - Pre-commit: `pnpm test -- --run TaskDetailView.test.ts`

---

- [ ] 4. Fix comments sidebar width in SelfReviewView

  **What to do**:

  **TDD Phase — RED**:
  - Add test case to `SelfReviewView.test.ts`:
    - `'comments sidebar renders at 360px width'` — render SelfReviewView with PR comments that trigger auto-open, then verify the sidebar container has `w-[360px]` class (not `w-[480px]`)
  - Run tests → verify RED (currently `w-[480px]`)

  **TDD Phase — GREEN**:
  - In `SelfReviewView.svelte` line 138, change:
    ```
    <div class="w-[480px] shrink-0 border-l ...">
    ```
    To:
    ```
    <div class="w-[360px] shrink-0 border-l ...">
    ```
  - Run tests → verify GREEN

  **Must NOT do**:
  - Do NOT change `sidebarVisible = false` default
  - Do NOT change auto-open behavior (lines 46-51)
  - Do NOT change sidebar tab structure (pr/notes)
  - Do NOT touch SendToAgentPanel

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single CSS class value change + 1 test case
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 2, 3)
  - **Blocks**: Task 5
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src/components/SelfReviewView.svelte:138` — The sidebar container div: `<div class="w-[480px] shrink-0 border-l border-base-300 overflow-hidden flex flex-col bg-base-100">`. Change `w-[480px]` to `w-[360px]`.

  **Test References**:
  - `src/components/SelfReviewView.test.ts:78-86` — `beforeEach` setup that resets stores. Follow this pattern.
  - `src/components/SelfReviewView.test.ts:266-289` — Tests that interact with the sidebar (addressed comments). These show how to trigger sidebar visibility via PR comments.

  **Design References**:
  - Design node `ckUBE` "Comments Sidebar" — width: 360 (explicit in design)

  **WHY Each Reference Matters**:
  - Line 138: The ONLY line to change in the component. `480px` → `360px`.
  - Lines 266-289: Shows how sidebar is made visible in tests (via PR comments + auto-open). The new test needs the sidebar to be visible to check its width class.

  **Acceptance Criteria**:

  - [ ] `pnpm test -- --run SelfReviewView.test.ts` → PASS (all tests)
  - [ ] Sidebar container has class `w-[360px]` (verified by test)

  **QA Scenarios**:

  ```
  Scenario: Sidebar width is 360px
    Tool: Bash
    Preconditions: SelfReviewView test file has new width test
    Steps:
      1. Run: pnpm test -- --run SelfReviewView.test.ts
      2. Check that 'comments sidebar renders at 360px width' passes
    Expected Result: Test passes — sidebar has w-[360px] class
    Failure Indicators: Test fails because width class is still w-[480px]
    Evidence: .sisyphus/evidence/task-4-sidebar-width-test.txt
  ```

  **Evidence to Capture**:
  - [ ] task-4-sidebar-width-test.txt — Test output

  **Commit**: YES
  - Message: `fix(ui): reduce comments sidebar width to 360px to match design`
  - Files: `src/components/SelfReviewView.svelte`, `src/components/SelfReviewView.test.ts`
  - Pre-commit: `pnpm test -- --run SelfReviewView.test.ts`

---

## Final Verification Wave

- [ ] 5. Full test suite + visual QA

  **What to do**:
  - Run the complete test suite: `pnpm test -- --run`
  - Verify NO new failures introduced (pre-existing PrReviewView/App failures are out of scope — document these)
  - Run `pnpm build` to verify no type errors
  - Visual QA with Playwright: open the app, navigate to a task, verify breadcrumb, toggle between code/review, check sidebar width, verify subtitle

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Full verification requires running tests + build + visual QA
  - **Skills**: [`playwright`]
    - `playwright`: Needed for browser-based visual QA of the running app

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave FINAL (after all implementation)
  - **Blocks**: None
  - **Blocked By**: Tasks 2, 3, 4

  **Acceptance Criteria**:

  - [ ] `pnpm test -- --run` → No NEW test failures (same or fewer than baseline)
  - [ ] `pnpm build` → Exit code 0
  - [ ] Visual: breadcrumb visible in both code and review mode
  - [ ] Visual: toggle switches modes correctly
  - [ ] Visual: subtitle row present
  - [ ] Visual: sidebar width narrower than before

  **QA Scenarios**:

  ```
  Scenario: Full test suite passes with no regressions
    Tool: Bash
    Preconditions: All implementation tasks complete
    Steps:
      1. Run: pnpm test -- --run 2>&1 | tail -20
      2. Count total failures
      3. Compare against baseline: 10 failures (PrReviewView: 8, App: 1, TaskDetailView: 1 stale — now 0)
      4. Verify TaskDetailView and SelfReviewView both show 0 failures
    Expected Result: ≤9 total failures (baseline minus the fixed stale test). TaskDetailView: 0 fail. SelfReviewView: 0 fail.
    Failure Indicators: New test name appears in failure list that wasn't in baseline
    Evidence: .sisyphus/evidence/task-5-full-test-results.txt

  Scenario: Build succeeds with no type errors
    Tool: Bash
    Preconditions: All source changes in place
    Steps:
      1. Run: pnpm build
      2. Check exit code
    Expected Result: Exit code 0, no TypeScript errors
    Failure Indicators: Non-zero exit code, TS error messages in output
    Evidence: .sisyphus/evidence/task-5-build-output.txt

  Scenario: Visual QA — breadcrumb and toggle in browser
    Tool: Playwright (playwright skill)
    Preconditions: App running via pnpm tauri:dev, at least one task with a worktree exists
    Steps:
      1. Navigate to any task (click a task card on the board)
      2. Assert: breadcrumb toolbar row is visible below the black header bar
      3. Assert: breadcrumb contains "$ cd board" text
      4. Assert: breadcrumb contains task ID or Jira key
      5. Assert: breadcrumb contains "code" as last segment
      6. Assert: code_view and review_view buttons are visible
      7. Click review_view button
      8. Assert: breadcrumb last segment changes to "self_review"
      9. Assert: diff viewer area loads (file tree, split/unified toolbar visible)
      10. Assert: comments sidebar (if visible) is narrower than before (~360px)
      11. Take screenshot
      12. Click code_view button
      13. Assert: breadcrumb last segment changes back to "code"
      14. Assert: Agent panel loads (code mode content visible)
      15. Take screenshot
    Expected Result: All assertions pass. Breadcrumb, toggle, and sidebar match design. Screenshots captured.
    Failure Indicators: Missing breadcrumb, broken toggle, sidebar too wide, layout glitch
    Evidence: .sisyphus/evidence/task-5-visual-qa-review-mode.png, .sisyphus/evidence/task-5-visual-qa-code-mode.png
  ```

  **Evidence to Capture**:
  - [ ] task-5-full-test-results.txt — Full test run output
  - [ ] task-5-build-output.txt — Build output
  - [ ] task-5-visual-qa-review-mode.png — Screenshot in review mode
  - [ ] task-5-visual-qa-code-mode.png — Screenshot in code mode

  **Commit**: NO (verification only)

---

## Commit Strategy

| Order | Message | Files | Pre-commit |
|-------|---------|-------|------------|
| 1 | `fix(test): remove stale status badge test from TaskDetailView` | `TaskDetailView.test.ts` | `pnpm test -- --run TaskDetailView.test.ts` |
| 2 | `feat(ui): add breadcrumb toolbar with code/review toggle to task detail view` | `TaskDetailView.svelte`, `TaskDetailView.test.ts` | `pnpm test -- --run TaskDetailView.test.ts` |
| 3 | `feat(ui): always show subtitle row in task detail view` | `TaskDetailView.svelte`, `TaskDetailView.test.ts` | `pnpm test -- --run TaskDetailView.test.ts` |
| 4 | `fix(ui): reduce comments sidebar width to 360px to match design` | `SelfReviewView.svelte`, `SelfReviewView.test.ts` | `pnpm test -- --run SelfReviewView.test.ts` |

---

## Success Criteria

### Verification Commands
```bash
pnpm test -- --run TaskDetailView.test.ts  # Expected: all pass
pnpm test -- --run SelfReviewView.test.ts  # Expected: all pass
pnpm build                                  # Expected: exit 0
```

### Final Checklist
- [ ] Breadcrumb toolbar visible in BOTH code and review modes
- [ ] Code/Review toggle in breadcrumb, NOT in header
- [ ] Toggle guard (worktreePath) preserved
- [ ] Subtitle row always visible
- [ ] Comments sidebar at 360px
- [ ] No status badge added (explicit rejection)
- [ ] All tests pass, no regressions
- [ ] No `<style>` blocks, no hardcoded hex colors
