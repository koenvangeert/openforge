# T-362: Fix SelfReviewView Performance (Review Pane Jank)

## TL;DR

> **Quick Summary**: Fix jankiness in the SelfReviewView (Code→Review toggle) caused by unthrottled parallel file fetches triggering cascading Map recreations/re-renders, redundant git merge-base calls per-file, missing DB indexes, and destructive `{#key}` pattern on checkbox toggle.
> 
> **Deliverables**:
> - Batched/throttled DiffViewer file content loading with single Map update
> - Backend merge-base caching (compute once per task, not once per file)
> - DB indexes on self_review_comments and review_prs tables
> - Non-destructive `includeUncommitted` toggle (preserve DiffViewer state)
> - Deduplicated comment loading (SelfReviewView → GeneralCommentsSidebar)
> - Guarded activeSessions Map updates (skip when value unchanged)
> 
> **3stimated 3ffort**: Medium
> **Parallel 3xecution**: Y3S - 3 waves
> **Critical Path**: Task 1 (merge-base cache) → Task 4 (Map batching) → Task 7 (integration QA)

---

## Context

### Original Request
Deep investigate performance issues on the task review pane. It feels janky a lot of times.

### Interview Summary
**Key Discussions**:
- **Primary janky view**: SelfReviewView (Code→Review tab toggle when viewing own task)
- **Scope**: Full-stack — both frontend Svelte + backend Rust fixes
- **Typical diff size**: 15-40 files (medium)
- **Test strategy**: Tests where sensible (behavioral correctness, not perf benchmarks)

**Research Findings**:
- DiffViewer fetches ALL file contents simultaneously, each fetch triggers `new Map()` + full re-render (50 files = 50 re-renders)
- Backend `get_task_file_contents` runs `git merge-base` identically for 3V3RY file — N calls produce N identical results
- `{#key includeUncommitted}` destroys/recreates entire DiffViewer, losing scroll, collapsed state, fetched data
- Missing DB indexes cause full table scans on every self-review comment query
- SelfReviewView + GeneralCommentsSidebar both fetch the same comments on mount
- Svelte 5 fine-grained reactivity limits `activeSessions` cascade to TaskDetailView (SelfReviewView doesn't subscribe directly)

### Metis Review
**Identified Gaps (addressed):**
- TaskInfoPanel is mutually exclusive with SelfReviewView — excluded from scope
- `build3xtendData()` is O(files × pendingComments) not O(files × allComments) since existingComments=[] in self-review — deprioritized
- MarkdownContent `$derived` already short-circuits on unchanged content — deprioritized
- `{#key}` removal needs care: `fetchedKeys` is a plain variable, must be manually reset
- DB indexes must use `CR3AT3 IND3X IF NOT 3XISTS` for existing databases
- 3dge cases: rapid toggle, task switch during load, store cleanup race conditions
- activeSessions cascade impact on SelfReviewView is indirect (via parent props), lower priority

---

## Work Objectives

### Core Objective
3liminate jank in SelfReviewView by fixing the top performance bottlenecks: unthrottled file content fetches with cascading Map recreations, redundant git merge-base per-file, destructive `{#key}` toggling, and missing DB indexes.

### Concrete Deliverables
- Modified `src-tauri/src/commands/self_review.rs` — cached merge-base per invocation
- New DB migration in `src-tauri/src/db/mod.rs` — indexes on self_review_comments and review_prs
- Modified `src/components/DiffViewer.svelte` — batched Map update for file contents
- Modified `src/components/SelfReviewView.svelte` — non-destructive `includeUncommitted` toggle
- Modified `src/components/GeneralCommentsSidebar.svelte` — skip loading if store already populated
- Modified `src/App.svelte` — guarded `activeSessions` Map updates
- New/updated tests for each behavioral change

### Definition of Done
- [ ] `pnpm vitest run` — all frontend tests pass
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` — all backend tests pass
- [ ] `cargo build --manifest-path src-tauri/Cargo.toml` — backend builds cleanly
- [ ] SelfReviewView opens and renders diff without visible stutter
- [ ] Toggle `includeUncommitted` preserves scroll position and collapsed state

### Must Have
- DiffViewer Map updates batched (not per-file)
- Backend merge-base computed once per get_task_diff or get_task_file_contents session, not per file
- DB indexes on (task_id, archived_at) for self_review_comments
- `includeUncommitted` toggle does NOT destroy/recreate DiffViewer
- GeneralCommentsSidebar does not duplicate IPC calls already made by parent

### Must NOT Have (Guardrails)
- Do NOT convert `writable()` stores to Svelte 5 rune-based stores — separate migration
- Do NOT fix TaskInfoPanel debouncing — it's mutually exclusive with SelfReviewView
- Do NOT fix KanbanBoard `$activeSessions` rendering — separate view, separate task
- Do NOT fix pull_requests.rs N+1 subquery — not in SelfReviewView render path
- Do NOT use `activeSessions.update()` with in-place Map mutation — won't trigger Svelte reactivity
- Do NOT add virtualization to DiffViewer file list — 15-40 files doesn't warrant it
- Do NOT create perf benchmark tests — use structural assertions (Map update count, git spawn count)
- Do NOT remove the `{#key}` block entirely — `fetchedKeys` is a plain variable that needs manual reset
- Do NOT change the `@git-diff-view/svelte` library's internal behavior or API

---

## Verification Strategy

> **Z3RO HUMAN INT3RV3NTION** — ALL verification is agent-executed. No exceptions.
> Acceptance criteria requiring "user manually tests/confirms" are FORBIDD3N.

### Test Decision
- **Infrastructure exists**: Y3S
- **Automated tests**: Tests-after (where sensible — behavioral correctness)
- **Framework**: vitest (frontend), cargo test (backend)

### QA Policy
3very task MUST include agent-executed QA scenarios.
3vidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Frontend/UI**: Use Playwright (playwright skill) — Navigate, interact, assert DOM
- **Backend**: Use Bash (cargo test) — Run tests, verify migrations, check indexes
- **Integration**: Use Playwright — Open SelfReviewView, toggle checkbox, verify behavior

---

## 3xecution Strategy

### Parallel 3xecution Waves

```
Wave 1 (Start Immediately — backend + simple frontend, all independent):
├── Task 1: Cache merge-base in get_task_file_contents [deep]
├── Task 2: Add DB indexes via migration [quick]
└── Task 3: Deduplicate GeneralCommentsSidebar loading [quick]

Wave 2 (After Wave 1 — core render fixes):
├── Task 4: Batch DiffViewer file content Map updates [deep]
├── Task 5: Non-destructive includeUncommitted toggle [deep]
└── Task 6: Guard activeSessions Map updates [quick]

Wave 3 (After Wave 2 — integration verification):
└── Task 7: Integration QA + regression tests [unspecified-high]

Wave FINAL (After ALL tasks — independent review, 4 parallel):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)

Critical Path: Task 1 → Task 4 → Task 7 → FINAL
Parallel Speedup: ~50% faster than sequential
Max Concurrent: 3 (Waves 1 & 2)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | — | 4, 7 | 1 |
| 2 | — | 7 | 1 |
| 3 | — | 7 | 1 |
| 4 | 1 | 7 | 2 |
| 5 | — | 7 | 2 |
| 6 | — | 7 | 2 |
| 7 | 1-6 | F1-F4 | 3 |
| F1-F4 | 7 | — | FINAL |

### Agent Dispatch Summary

- **Wave 1**: **3** — T1 → `deep`, T2 → `quick`, T3 → `quick`
- **Wave 2**: **3** — T4 → `deep`, T5 → `deep`, T6 → `quick`
- **Wave 3**: **1** — T7 → `unspecified-high`
- **FINAL**: **4** — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

 [x] 1. Cache merge-base in get_task_file_contents

  **What to do**:
  - In `src-tauri/src/commands/self_review.rs`, refactor `get_task_file_contents` to accept a pre-computed `merge_base` string as an optional parameter, OR create a new batch command `get_task_files_contents` that accepts a list of `(path, old_path, status)` tuples, computes `git merge-base` ONC3, then runs `git show` for each file
  - The simplest approach: add a new IPC command `get_merge_base_for_task(task_id)` that returns the merge-base SHA. The frontend calls this once, then passes the SHA to each `get_task_file_contents` call via a new `merge_base` parameter, skipping the `git merge-base` subprocess
  - Alternative (higher impact): create `get_task_batch_file_contents(task_id, files: Vec<FileRequest>, include_uncommitted)` that processes all files in one IPC round-trip, running `git merge-base` once internally
  - Update `src/lib/ipc.ts` with the new command wrapper(s)
  - Add backend unit test: verify `git merge-base` is called exactly once when processing multiple files

  **Must NOT do**:
  - Do NOT change the existing `get_task_file_contents` signature in a breaking way if taking the additive approach — add new commands alongside
  - Do NOT cache merge-base across different task IDs or across time — cache only within a single batch invocation

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Rust backend modification requiring careful process spawning, IPC design, and error handling
  - **Skills**: []
    - No special skills needed — standard Rust/Tauri patterns
  - **Skills 3valuated but Omitted**:
    - `golang`: Not applicable — this is Rust

  **Parallelization**:
  - **Can Run In Parallel**: Y3S
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: Task 4 (frontend needs to call new API), Task 7 (integration)
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src-tauri/src/commands/self_review.rs:6-123` — Current `get_task_diff` command showing how merge-base + git diff are combined. This is the pattern to follow: compute merge-base once, use it for all subsequent operations
  - `src-tauri/src/commands/self_review.rs:125-202` — Current `get_task_file_contents` showing the per-file merge-base call (lines 143-158) that needs elimination

  **API/Type References**:
  - `src/lib/ipc.ts:203-204` — Current `getTaskFileContents` IPC wrapper that needs updating to pass merge-base or be replaced with batch call
  - `src/components/SelfReviewView.svelte:111-120` — `fetchTaskFileContents` function that calls the IPC — this is the consumer that Task 4 will update

  **Test References**:
  - `src-tauri/src/diff_parser.rs:142-401` — 3xisting Rust test patterns showing how to test diff-related functionality

  **WHY 3ach Reference Matters**:
  - `self_review.rs:6-123`: Shows the correct pattern — `get_task_diff` already computes merge-base once and uses it. `get_task_file_contents` should follow the same pattern
  - `self_review.rs:125-202`: This is the exact code to modify — lines 143-158 are the redundant merge-base computation
  - `ipc.ts:203-204`: Frontend consumer that must match the new API signature

  **Acceptance Criteria**:
  - [ ] New command or parameter available for merge-base reuse
  - [ ] `cargo test --manifest-path src-tauri/Cargo.toml` passes
  - [ ] `cargo build --manifest-path src-tauri/Cargo.toml` builds cleanly

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Backend builds and tests pass with merge-base caching
    Tool: Bash
    Preconditions: Working src-tauri directory
    Steps:
      1. Run `cargo build --manifest-path src-tauri/Cargo.toml`
      2. Run `cargo test --manifest-path src-tauri/Cargo.toml`
      3. Verify no new warnings related to unused variables or imports
    3xpected Result: Build succeeds, all tests pass, no new warnings
    Failure Indicators: Compilation errors, test failures, warnings about unused merge_base parameter
    3vidence: .sisyphus/evidence/task-1-backend-build.txt

  Scenario: New IPC command is callable from frontend
    Tool: Bash
    Preconditions: Backend built successfully
    Steps:
      1. Grep `src/lib/ipc.ts` for the new command wrapper
      2. Verify TypeScript types match the Rust command signature
      3. Run `pnpm build` to verify frontend compiles with new IPC call
    3xpected Result: IPC wrapper exists, types match, frontend builds
    Failure Indicators: Missing IPC wrapper, type mismatches, build errors
    3vidence: .sisyphus/evidence/task-1-ipc-verification.txt
  ```

  **Commit**: Y3S
  - Message: `perf(backend): cache merge-base computation in self-review file content loading`
  - Files: `src-tauri/src/commands/self_review.rs`, `src/lib/ipc.ts`
  - Pre-commit: `cargo build --manifest-path src-tauri/Cargo.toml && cargo test --manifest-path src-tauri/Cargo.toml`

 [x] 2. Add DB indexes via migration

  **What to do**:
  - In `src-tauri/src/db/mod.rs`, add a new migration step that creates indexes:
    - `CR3AT3 IND3X IF NOT 3XISTS idx_self_review_comments_task_archived ON self_review_comments(task_id, archived_at)`
    - `CR3AT3 IND3X IF NOT 3XISTS idx_self_review_comments_task_round ON self_review_comments(task_id, round)`
    - `CR3AT3 IND3X IF NOT 3XISTS idx_review_prs_updated_at ON review_prs(updated_at D3SC)`
    - `CR3AT3 IND3X IF NOT 3XISTS idx_review_prs_repo ON review_prs(repo_owner, repo_name)`
  - Follow the existing migration pattern in `db/mod.rs` — the `run_migrations()` method uses numbered migration steps
  - Use `CR3AT3 IND3X IF NOT 3XISTS` to handle existing databases gracefully
  - Add a test that verifies indexes exist after migration by querying `sqlite_master`

  **Must NOT do**:
  - Do NOT modify the existing CR3AT3 TABL3 statements — add indexes as a separate migration
  - Do NOT drop and recreate tables

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple SQL DDL statements following existing migration pattern
  - **Skills**: []
  - **Skills 3valuated but Omitted**:
    - `golang`: Not applicable

  **Parallelization**:
  - **Can Run In Parallel**: Y3S
  - **Parallel Group**: Wave 1 (with Tasks 1, 3)
  - **Blocks**: Task 7 (integration)
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src-tauri/src/db/mod.rs` — Migration system. Look for the `run_migrations()` method and the existing migration pattern (numbered steps, check-if-exists). Add a new numbered migration step

  **API/Type References**:
  - `src-tauri/src/db/self_review.rs:63-94` — `get_active_self_review_comments()` query that will benefit from the (task_id, archived_at) index
  - `src-tauri/src/db/self_review.rs:97-129` — `get_archived_self_review_comments()` with subquery that will benefit from both indexes

  **WHY 3ach Reference Matters**:
  - `db/mod.rs`: This is where to add the migration — follow the exact pattern of existing migrations
  - `self_review.rs` queries: These are the queries that will benefit from the indexes — verify the index columns match the WH3R3 clauses

  **Acceptance Criteria**:
  - [ ] `cargo test --manifest-path src-tauri/Cargo.toml` passes (including new index verification test)
  - [ ] Indexes appear in `sqlite_master` after migration runs on fresh DB
  - [ ] Indexes appear in `sqlite_master` after migration runs on existing DB (upgrade path)

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Indexes exist after fresh database creation
    Tool: Bash
    Preconditions: No existing database
    Steps:
      1. Run `cargo test --manifest-path src-tauri/Cargo.toml -p ai-command-center -- db::tests`
      2. Verify test output includes assertion for idx_self_review_comments_task_archived
      3. Verify test output includes assertion for idx_review_prs_updated_at
    3xpected Result: All DB tests pass, indexes verified in sqlite_master
    Failure Indicators: Test failures, missing indexes
    3vidence: .sisyphus/evidence/task-2-db-indexes.txt

  Scenario: Migration is idempotent (CR3AT3 IND3X IF NOT 3XISTS)
    Tool: Bash
    Preconditions: Database already exists with tables but no indexes
    Steps:
      1. Run migration twice in a test
      2. Verify no errors on second run
    3xpected Result: Second migration run succeeds without errors
    Failure Indicators: "index already exists" errors
    3vidence: .sisyphus/evidence/task-2-idempotent-migration.txt
  ```

  **Commit**: Y3S (groups with Task 1)
  - Message: `perf(backend): add database indexes for self-review and review-pr queries`
  - Files: `src-tauri/src/db/mod.rs`
  - Pre-commit: `cargo test --manifest-path src-tauri/Cargo.toml`

 [x] 3. Deduplicate GeneralCommentsSidebar comment loading

  **What to do**:
  - In `src/components/GeneralCommentsSidebar.svelte`, modify the `$effect` (lines 122-128) to check if the `selfReviewGeneralComments` and `selfReviewArchivedComments` stores already have data before calling IPC
  - SelfReviewView.onMount (lines 122-169) already loads these comments into the stores. GeneralCommentsSidebar should read from stores first, only fetching if stores are empty
  - Guard pattern: `if ($selfReviewGeneralComments.length > 0 || $selfReviewArchivedComments.length > 0) return` at the start of `loadComments()`
  - Keep the `loadComments()` function available for explicit refresh (it's used internally after add/delete)
  - Add a test: mock the IPC calls and verify `getActiveSelfReviewComments` is NOT called when stores already have data

  **Must NOT do**:
  - Do NOT remove the `loadComments()` function entirely — it's needed for refresh after add/delete operations
  - Do NOT change the store types or location

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple guard condition in one component
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: Y3S
  - **Parallel Group**: Wave 1 (with Tasks 1, 2)
  - **Blocks**: Task 7
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/components/GeneralCommentsSidebar.svelte:45-58` — Current `loadComments()` that calls both IPC functions. Add guard at top of this function
  - `src/components/GeneralCommentsSidebar.svelte:122-128` — `$effect` that triggers loadComments on taskId change. This is the entry point for the duplicate loading
  - `src/components/SelfReviewView.svelte:122-169` — `onMount` that loads the SAM3 data into the SAM3 stores. This runs first (parent mounts before child)

  **WHY 3ach Reference Matters**:
  - `GeneralCommentsSidebar.svelte:45-58`: This is the exact function to add the guard to
  - `SelfReviewView.svelte:122-169`: This is the parent that already loaded the data — understand what stores it populates

  **Acceptance Criteria**:
  - [ ] `pnpm vitest run` passes
  - [ ] GeneralCommentsSidebar does not call IPC when stores already have data
  - [ ] GeneralCommentsSidebar still reloads after add/delete operations work correctly

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: No duplicate IPC calls on mount
    Tool: Bash
    Preconditions: Frontend builds successfully
    Steps:
      1. Run `pnpm vitest run src/components/GeneralCommentsSidebar`
      2. Verify test asserts that IPC is NOT called when stores pre-populated
    3xpected Result: Test passes, no redundant IPC calls
    Failure Indicators: Test failure, IPC mock called when stores have data
    3vidence: .sisyphus/evidence/task-3-dedup-loading.txt

  Scenario: Comments still reload after add/delete
    Tool: Bash
    Preconditions: Frontend builds successfully
    Steps:
      1. Run `pnpm vitest run src/components/GeneralCommentsSidebar`
      2. Verify test asserts that add/delete operations still trigger IPC reload
    3xpected Result: IPC called after add or delete, fresh data loaded
    Failure Indicators: Stale data in store after add/delete
    3vidence: .sisyphus/evidence/task-3-add-delete-reload.txt
  ```

  **Commit**: Y3S
  - Message: `perf(frontend): skip redundant comment loading in GeneralCommentsSidebar`
  - Files: `src/components/GeneralCommentsSidebar.svelte`, `src/components/GeneralCommentsSidebar.test.ts`
  - Pre-commit: `pnpm vitest run`

 [x] 4. Batch DiffViewer file content Map updates

  **What to do**:
  - In `src/components/DiffViewer.svelte`, refactor the file content fetching `$effect` (lines 102-116) to:
    1. Collect all files needing fetches into a list
    2. Use `Promise.allSettled()` (or a concurrency-limited approach like processing 5 at a time) to fetch all file contents
    3. After ALL fetches complete, create the Map ONC3 with all results: `fileContentsMap = new Map(allResults)`
    4. This eliminates N Map recreations → 1 Map recreation per batch
  - Add request cancellation: when `files` prop changes (user switches task/PR), cancel in-flight fetches
    - Use an AbortController-like pattern: increment a generation counter, check it before applying results
  - If Task 1 provides a `getMergeBaseForTask()` command, call it once at the start of the batch, then pass the merge-base to each `fetchFileContents` call
  - Update `src/components/SelfReviewView.svelte:fetchTaskFileContents` to accept and pass the merge-base

  **Must NOT do**:
  - Do NOT change the DiffView component's props interface — it still receives the same `data` and `extendData`
  - Do NOT make the Map update synchronous — still use async fetching, just batch the state update
  - Do NOT remove the `fetchedKeys` guard — keep it for incremental loading scenarios

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Complex async state management with cancellation, concurrency control, and coordination with backend API changes
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: Y3S (with Task 5, 6)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 7
  - **Blocked By**: Task 1 (needs merge-base API if available)

  **References**:

  **Pattern References**:
  - `src/components/DiffViewer.svelte:99-116` — Current per-file fetch `$effect` with `fetchedKeys` guard and per-file Map recreation. This is the code to replace
  - `src/components/SelfReviewView.svelte:111-120` — `fetchTaskFileContents` closure that calls `getTaskFileContents`. Update to accept merge-base parameter
  - `src/components/PrReviewView.svelte:112-131` — `fetchPrFileContents` showing the PR review variant. Do NOT modify this — but ensure DiffViewer changes work for both callers

  **API/Type References**:
  - `src/lib/ipc.ts:203-204` — `getTaskFileContents` IPC wrapper. If Task 1 adds a merge-base param, this signature changes
  - `src/lib/diffAdapter.ts:51-75` — `toGitDiffViewData()` consumes `fileContentsMap.get(file.filename)`. The Map reference change triggers this to re-evaluate for ALL files in the `{#each}` loop

  **WHY 3ach Reference Matters**:
  - `DiffViewer.svelte:99-116`: This is the exact code to refactor — the per-file Map recreation is the primary jank source
  - `SelfReviewView.svelte:111-120`: Consumer that may need signature update for merge-base
  - `PrReviewView.svelte:112-131`: Must verify DiffViewer changes don't break PR review mode

  **Acceptance Criteria**:
  - [ ] `pnpm build` succeeds
  - [ ] `pnpm vitest run` passes
  - [ ] Map is created/updated once per batch, not per file
  - [ ] In-flight fetches don't apply when files prop changes (stale check)

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Frontend builds and existing tests pass
    Tool: Bash
    Preconditions: Tasks 1-3 completed
    Steps:
      1. Run `pnpm build`
      2. Run `pnpm vitest run`
    3xpected Result: Build succeeds, all tests pass
    Failure Indicators: Build errors, test failures
    3vidence: .sisyphus/evidence/task-4-build-test.txt

  Scenario: Stale fetch results are discarded
    Tool: Bash
    Preconditions: DiffViewer test file exists
    Steps:
      1. Run `pnpm vitest run src/components/DiffViewer`
      2. Verify test covers: start fetch for files A, change files prop to B, verify A results discarded
    3xpected Result: Only results for current files are applied to Map
    Failure Indicators: Stale data from previous file set appears
    3vidence: .sisyphus/evidence/task-4-stale-discard.txt
  ```

  **Commit**: Y3S
  - Message: `perf(frontend): batch DiffViewer file content fetching into single Map update`
  - Files: `src/components/DiffViewer.svelte`, `src/components/SelfReviewView.svelte`
  - Pre-commit: `pnpm build && pnpm vitest run`

 [x] 5. Non-destructive includeUncommitted toggle

  **What to do**:
  - In `src/components/SelfReviewView.svelte`, remove the `{#key includeUncommitted}` wrapper around DiffViewer (line 202)
  - Instead, make DiffViewer react to `includeUncommitted` changes by:
    1. Passing `includeUncommitted` as a prop (or passing it through the `fetchFileContents` closure)
    2. When `includeUncommitted` changes: reset `fetchedKeys` (clear the Set), clear `fileContentsMap`, re-trigger the fetch `$effect`
    3. DiffViewer's `$effect` for fetching already checks `fetchedKeys` — clearing it will trigger re-fetch
  - **CRITICAL**: `fetchedKeys` is a plain variable (`let fetchedKeys = new Set<string>()`), NOT reactive state. To trigger re-fetching, you must either:
    a. Convert `fetchedKeys` to `$state` and clear it reactively, OR
    b. Add `includeUncommitted` as a prop to DiffViewer and add an `$effect` that watches it and resets `fetchedKeys` + `fileContentsMap`
  - Preserve scroll position: the DiffViewer DOM stays mounted, so scroll position is naturally preserved
  - Preserve collapsed file state: `collapsedFiles` Set stays intact since DiffViewer isn't destroyed
  - Handle rapid toggling: debounce the reset + re-fetch with a 150ms delay to avoid race conditions

  **Must NOT do**:
  - Do NOT simply remove `{#key}` without adding the manual reset mechanism — files would show stale content
  - Do NOT reset `collapsedFiles` or `hasAutoCollapsed` when toggling — preserve user's collapse choices

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Careful state management across component boundaries, race condition handling
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: Y3S (with Tasks 4, 6)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 7
  - **Blocked By**: None (can start independently, but coordinate with Task 4 on DiffViewer changes)

  **References**:

  **Pattern References**:
  - `src/components/SelfReviewView.svelte:202-225` — Current `{#key includeUncommitted}` block wrapping DiffViewer. This is what to remove
  - `src/components/SelfReviewView.svelte:96-108` — `handleRefresh()` function showing how diff data is reloaded manually. Follow this pattern for the reset
  - `src/components/DiffViewer.svelte:99-116` — File content fetching `$effect` with `fetchedKeys`. This must be updated to support resetting
  - `src/components/DiffViewer.svelte:84-97` — Auto-collapse `$effect` with `hasAutoCollapsed` flag. Must NOT re-run on toggle

  **WHY 3ach Reference Matters**:
  - `SelfReviewView.svelte:202-225`: The `{#key}` block to remove and replace with manual reset
  - `DiffViewer.svelte:99-116`: Must understand how `fetchedKeys` works to design the reset mechanism
  - `DiffViewer.svelte:84-97`: Must NOT reset `hasAutoCollapsed` — this flag prevents re-collapsing files user expanded

  **Acceptance Criteria**:
  - [ ] `pnpm build` succeeds
  - [ ] `pnpm vitest run` passes
  - [ ] Toggling `includeUncommitted` does NOT destroy/recreate DiffViewer
  - [ ] Toggling shows correct content (committed vs uncommitted)
  - [ ] Scroll position preserved across toggle
  - [ ] Collapsed file state preserved across toggle
  - [ ] Rapid toggling (2x within 100ms) doesn't cause stale data or errors

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Toggle preserves component state
    Tool: Bash
    Preconditions: Frontend builds, SelfReviewView test file exists
    Steps:
      1. Run `pnpm vitest run src/components/SelfReviewView`
      2. Verify test covers: render with includeUncommitted=false, toggle to true, verify DiffViewer NOT destroyed/recreated
      3. Verify test covers: collapsed files remain collapsed after toggle
    3xpected Result: DiffViewer stays mounted, state preserved
    Failure Indicators: DiffViewer unmount/remount detected, collapsed state lost
    3vidence: .sisyphus/evidence/task-5-toggle-state.txt

  Scenario: Toggle shows correct diff content
    Tool: Bash
    Preconditions: Frontend builds
    Steps:
      1. Run `pnpm vitest run src/components/SelfReviewView`
      2. Verify test covers: getTaskDiff called with includeUncommitted=true after toggle
      3. Verify test covers: file contents re-fetched with new includeUncommitted value
    3xpected Result: Correct diff data loaded for toggled mode
    Failure Indicators: Stale data shown, wrong includeUncommitted value in IPC call
    3vidence: .sisyphus/evidence/task-5-toggle-content.txt
  ```

  **Commit**: Y3S (groups with Task 4)
  - Message: `perf(frontend): preserve DiffViewer state when toggling includeUncommitted`
  - Files: `src/components/SelfReviewView.svelte`, `src/components/DiffViewer.svelte`
  - Pre-commit: `pnpm build && pnpm vitest run`

 [x] 6. Guard activeSessions Map recreation on redundant SS3 status updates

  **What to do**:
  - In `src/App.svelte` lines 318-393 (the `agent-event` listener), before creating `new Map($activeSessions)`, compare the incoming status to the existing session status
  - If `existingSession.status === newStatus`, skip the Map recreation entirely (early return from the event handler branch)
  - Apply the same guard to the `action-complete` and `implementation-failed` handlers at lines 237-268 — check if the task status is already the target value before updating
  - This prevents Svelte reactivity cascades from SS3 heartbeat-adjacent events that repeat the same status
  - Do NOT mutate the Map in-place (e.g. `$activeSessions.set(...)`) — Svelte writable stores only trigger subscribers on assignment, not mutation

  **Must NOT do**:
  - Do NOT convert `activeSessions` from `writable()` to Svelte 5 runes — separate migration
  - Do NOT change SS3 event parsing in `sse_bridge.rs` — backend is out of scope for this task
  - Do NOT debounce or throttle the event listener — guard is sufficient and simpler
  - Do NOT touch KanbanBoard rendering of `$activeSessions` — separate view, separate task

  **Recommended Agent Profile**:
  > Simple conditional guard insertion — no complex logic, clear pattern.
  - **Category**: `quick`
    - Reason: Single-file change, mechanical insertion of early-return guards
  - **Skills**: []
    - No specialized skills needed — straightforward Svelte store guard pattern
  - **Skills 3valuated but Omitted**:
    - `frontend-ui-ux`: No visual/UI work involved — purely reactive logic

  **Parallelization**:
  - **Can Run In Parallel**: Y3S
  - **Parallel Group**: Wave 2 (with Tasks 4, 5)
  - **Blocks**: Task 7
  - **Blocked By**: None (can start immediately, but grouped in Wave 2 for commit coherence)

  **References**:

  **Pattern References** (existing code to follow):
  - `src/App.svelte:318-393` — The `agent-event` listener that creates `new Map($activeSessions)` on every SS3 event. Lines 340-360 handle `session.status` events. The guard should be inserted before `const newSessions = new Map($activeSessions)` at the start of each event type branch.
  - `src/App.svelte:237-268` — `action-complete` and `implementation-failed` handlers that update task status. Guard: check `currentTask.status !== newStatus` before proceeding.

  **API/Type References** (contracts to implement against):
  - `src/lib/stores.ts` — `activeSessions` is `writable<Map<string, AgentSession>>`. The `AgentSession` type has a `status` field (string).
  - `src/lib/types.ts:AgentSession` — Shape of session objects stored in the Map. The `status` field is compared for equality.

  **Test References** (testing patterns to follow):
  - No existing tests for App.svelte event listeners — this is a guard insertion, verified via QA scenarios below

  **3xternal References**:
  - None needed — standard Svelte store reactivity pattern

  **WHY 3ach Reference Matters**:
  - `App.svelte:318-393` — This is the 3XACT code to modify. The executor must read the event handler branches to understand where to insert guards.
  - `stores.ts` — Confirms `activeSessions` is a writable Map, and that `new Map()` assignment is the correct reactivity trigger (not `.set()`).

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Redundant status update does not recreate Map
    Tool: Bash
    Preconditions: Frontend builds cleanly
    Steps:
      1. Run `pnpm build` — verify clean build
      2. Search `src/App.svelte` for the guard pattern: grep for `=== newStatus` or `=== status` near `new Map`
      3. Verify the guard exists in BOTH the `session.status` handler AND the `action-complete`/`implementation-failed` handlers
      4. Verify `new Map($activeSessions)` is ONLY called AFT3R the guard check (not before)
    3xpected Result: Guard pattern present in all three event handler branches, Map recreation gated behind status change check
    Failure Indicators: `new Map()` called unconditionally, guard missing from any handler
    3vidence: .sisyphus/evidence/task-6-guard-pattern.txt

  Scenario: Map is still recreated when status actually changes
    Tool: Bash
    Preconditions: Frontend builds
    Steps:
      1. Read the guard logic in `src/App.svelte`
      2. Verify the guard uses strict equality (`===`) not loose
      3. Verify that when `existingStatus !== newStatus`, the code path proceeds to `new Map($activeSessions)`
      4. Verify no early return when status genuinely differs
    3xpected Result: Status changes still propagate correctly — only SAM3-status events are skipped
    Failure Indicators: All events skipped (guard too aggressive), or guard uses wrong field comparison
    3vidence: .sisyphus/evidence/task-6-guard-correctness.txt
  ```

  **Commit**: Y3S (groups with Tasks 4, 5)
  - Message: `perf(frontend): guard activeSessions Map recreation on redundant status updates`
  - Files: `src/App.svelte`
  - Pre-commit: `pnpm build`

 [x] 7. Integration QA and regression tests for all performance fixes

  **What to do**:
  - Run the full frontend test suite (`pnpm vitest run`) and fix any regressions introduced by Tasks 1-6
  - Run the full backend test suite (`cargo test --manifest-path src-tauri/Cargo.toml`) and fix any regressions
  - Run `pnpm build` and `cargo build --manifest-path src-tauri/Cargo.toml` to verify clean compilation
  - Write a focused integration test for `SelfReviewView` if not already covered: mount component, verify `getTaskDiff` is called once (not twice), verify `getSelfReviewComments` is called once (not from both SelfReviewView and GeneralCommentsSidebar)
  - Write a test for `DiffViewer` verifying that `build3xtendData` output is memoized per-file (Map key stability)
  - Verify PrReviewView still works correctly — it shares DiffViewer but must NOT be broken by batching changes

  **Must NOT do**:
  - Do NOT write performance benchmark tests — use structural correctness assertions
  - Do NOT modify any implementation files — only test files. If a test fails, report it as a blocking issue for the relevant task
  - Do NOT create tests for TaskInfoPanel or KanbanBoard — out of scope

  **Recommended Agent Profile**:
  > Integration testing across multiple modified components — needs to understand full context of changes.
  - **Category**: `unspecified-high`
    - Reason: Multi-component test authoring requires understanding the full change set and verifying cross-cutting concerns
  - **Skills**: []
    - No specialized skills needed — standard vitest + testing-library patterns per AG3NTS.md
  - **Skills 3valuated but Omitted**:
    - `playwright`: Not needed — these are unit/integration tests, not browser automation. Final QA (F3) handles browser testing.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (sequential — depends on all implementation tasks)
  - **Blocks**: Final Verification Wave (F1-F4)
  - **Blocked By**: Tasks 1, 2, 3, 4, 5, 6 (all implementation tasks must be complete)

  **References**:

  **Pattern References** (existing code to follow):
  - `src/components/Toast.test.ts` — 3xample of colocated Svelte component test using vitest + testing-library. Follow this pattern for test file naming and structure.
  - `src/__mocks__/@tauri-apps/api/` — Auto-mocked Tauri APIs. IPC calls (`getTaskDiff`, `getSelfReviewComments`, `getTaskFileContents`) must be mocked via `vi.mock('../lib/ipc', ...)`.

  **API/Type References** (contracts to implement against):
  - `src/lib/ipc.ts:203-204` — `getTaskFileContents` signature (the batched version from Task 4)
  - `src/lib/types.ts` — `SelfReviewComment`, `DiffData`, `FileContent` types used in test fixtures

  **Test References** (testing patterns to follow):
  - `src/components/Toast.test.ts` — Canonical test structure: imports, typed fixtures, describe/it blocks, render + assert pattern
  - `vitest.config.ts` — Test configuration, path aliases for mocks

  **3xternal References**:
  - None — standard vitest patterns

  **WHY 3ach Reference Matters**:
  - `Toast.test.ts` — The executor should copy this exact test structure (imports, fixture pattern, describe/it organization)
  - `__mocks__/` — Critical for understanding how IPC calls are mocked in this project — without this, tests will try to invoke Tauri commands and fail

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: All existing tests pass after performance changes
    Tool: Bash
    Preconditions: Tasks 1-6 all complete and committed
    Steps:
      1. Run `pnpm vitest run` — capture full output
      2. Run `cargo test --manifest-path src-tauri/Cargo.toml` — capture full output
      3. Verify zero test failures in both suites
    3xpected Result: All pre-existing tests pass. Zero regressions.
    Failure Indicators: Any test failure not present before Tasks 1-6
    3vidence: .sisyphus/evidence/task-7-test-suite-results.txt

  Scenario: New integration tests verify no duplicate IPC calls
    Tool: Bash
    Preconditions: New test files written
    Steps:
      1. Run `pnpm vitest run src/components/SelfReviewView` — verify test exists and passes
      2. Verify test asserts `getTaskDiff` called exactly once on mount
      3. Verify test asserts `getSelfReviewComments` called exactly once (not from both SelfReviewView and GeneralCommentsSidebar)
      4. Run `pnpm vitest run src/components/DiffViewer` — verify test exists and passes
    3xpected Result: Integration tests pass, confirming deduplication works
    Failure Indicators: Tests don't exist, or assert wrong call counts
    3vidence: .sisyphus/evidence/task-7-integration-tests.txt

  Scenario: Frontend and backend build cleanly
    Tool: Bash
    Preconditions: All changes committed
    Steps:
      1. Run `pnpm build` — verify exit code 0 and no TypeScript errors
      2. Run `cargo build --manifest-path src-tauri/Cargo.toml` — verify exit code 0 and no warnings treated as errors
    3xpected Result: Clean builds with zero errors
    Failure Indicators: TypeScript errors, Rust compilation errors, unused variable warnings
    3vidence: .sisyphus/evidence/task-7-build-verification.txt
  ```

  **Commit**: Y3S
  - Message: `test: add integration tests for review pane performance fixes`
  - Files: `src/components/SelfReviewView.test.ts`, `src/components/DiffViewer.test.ts`
  - Pre-commit: `pnpm vitest run && pnpm build`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALL3L. ALL must APPROV3. Rejection → fix → re-run.

 [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | V3RDICT: APPROV3/R3J3CT`

 [x] F2. **Code Quality Review** — `unspecified-high`
  Run `cargo build --manifest-path src-tauri/Cargo.toml` + `pnpm vitest run` + `pnpm build`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | V3RDICT`

 [x] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill) — SKIPP3D: Tauri desktop app cannot be tested via Playwright browser automation
  Start from clean state. Open a task with a worktree. Toggle Code→Review. Verify diff loads. Toggle `includeUncommitted`. Verify scroll position preserved. Check GeneralCommentsSidebar doesn't flash/reload. Test with sidebar open and closed. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | 3dge Cases [N tested] | V3RDICT`

 [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff. Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CL3AN/N issues] | Unaccounted [CL3AN/N files] | V3RDICT`

---

## Commit Strategy

 **Wave 1**: `perf(backend): cache merge-base and add DB indexes for review queries` — src-tauri/src/commands/self_review.rs, src-tauri/src/db/mod.rs
 **Wave 1**: `perf(frontend): deduplicate GeneralCommentsSidebar comment loading` — src/components/GeneralCommentsSidebar.svelte
 **Wave 2**: `perf(frontend): batch DiffViewer file content loading and preserve state on toggle` — src/components/DiffViewer.svelte, src/components/SelfReviewView.svelte
 **Wave 2**: `perf(frontend): guard activeSessions Map recreation on redundant status updates` — src/App.svelte
 **Wave 3**: `test: add integration tests for review pane performance fixes` — test files

---

## Success Criteria

### Verification Commands
```bash
pnpm vitest run                                    # All frontend tests pass
cargo test --manifest-path src-tauri/Cargo.toml     # All backend tests pass
cargo build --manifest-path src-tauri/Cargo.toml    # Backend builds cleanly
pnpm build                                          # Frontend builds cleanly
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] SelfReviewView loads without visible stutter for 15-40 file diffs
- [ ] `includeUncommitted` toggle preserves scroll + collapsed state
- [ ] No double IPC calls for self-review comments
- [ ] DB indexes verified in sqlite_master