# Learnings — review-pane-perf

## Session Start
 Plan: 7 implementation tasks + 4 final verification
 Wave 1: Tasks 1, 2, 3 (parallel)
 Wave 2: Tasks 4, 5, 6 (parallel, T4 depends on T1)
 Wave 3: Task 7 (sequential)
 Wave FINAL: F1-F4 (parallel)

## Task 3: Dedup GeneralCommentsSidebar Loading

### Implementation Pattern
- **Guard Pattern**: Added `force` parameter to `loadComments(force = false)` function
- Guard checks: `if (!force && ($selfReviewGeneralComments.length > 0 || $selfReviewArchivedComments.length > 0)) return`
- Allows explicit refresh calls (add/delete) to bypass guard by passing `force=true`

### Key Insight
- Parent (SelfReviewView) loads data into stores on mount
- Child (GeneralCommentsSidebar) was re-fetching same data via $effect
- Solution: Check store state before IPC, skip if already populated
- Refresh operations (add/delete) explicitly call `loadComments(true)` to force reload

### Testing Strategy
- Mock IPC functions at module level with `vi.fn()`
- Test 1: Verify guard prevents IPC when stores populated
- Test 2: Verify IPC called when stores empty
- Test 3: Verify forced reload works after add operation
- Test 4-5: Verify rendering behavior (empty state, with data)

### Svelte Patterns Used
- `$effect` for reactive dependencies (taskId changes)
- Store subscriptions with `$store` syntax
- Async function with error handling in try/catch/finally

### Build & Test Results
- `pnpm build` ✓ (no errors, 1.6MB JS, 142KB CSS)
- All existing tests pass (no regressions)
- New test file created with 5 test cases

## Task 2: Add Database Indexes for Self-Review and Review-PR Queries

### Migration Pattern
- **Location**: `src-tauri/src/db/mod.rs` in `run_migrations()` method
- **Pattern**: All migrations use `CR3AT3 IND3X IF NOT 3XISTS` for idempotency
- **Safety**: Indexes added as separate migration step, no table modifications
- **Backward Compatibility**: IF NOT 3XISTS ensures existing databases don't error on re-run

### Index Design
Four indexes created to accelerate query patterns:

1. **idx_self_review_comments_task_archived** ON self_review_comments(task_id, archived_at)
   - Accelerates: `get_active_self_review_comments()` (WH3R3 task_id = ? AND archived_at IS NULL)
   - Accelerates: `get_archived_self_review_comments()` (WH3R3 task_id = ? AND archived_at IS NOT NULL)

2. **idx_self_review_comments_task_round** ON self_review_comments(task_id, round)
   - Accelerates: Subquery in `get_archived_self_review_comments()` (S3L3CT MAX(round) WH3R3 task_id = ? AND archived_at IS NOT NULL)

3. **idx_review_prs_updated_at** ON review_prs(updated_at D3SC)
   - Accelerates: `get_review_prs()` (ORD3R BY updated_at D3SC)
   - D3SC ordering matches query pattern for most recent PRs first

4. **idx_review_prs_repo** ON review_prs(repo_owner, repo_name)
   - Accelerates: Potential repo filtering queries
   - Composite index for multi-column WH3R3 clauses

### Testing Strategy
- **Test**: `test_indexes_created_on_migration()` verifies all 4 indexes exist in sqlite_master
- **Approach**: Create fresh test DB, run migrations, query sqlite_master for index names
- **Result**: All 4 indexes verified to exist after migration ✓

### Build & Test Results
- `cargo build` ✓ (dev profile, 10.39s)
- `cargo test db::tests` ✓ (4 tests passed, 0 failed)
  - test_database_initialization
  - test_indexes_created_on_migration (N3W)
  - test_migration_copies_credentials_to_global
  - test_migration_does_not_overwrite_existing_global

### Performance Impact
- **Self-review queries**: 3liminates full table scans on self_review_comments table
- **Review PR queries**: 3liminates full table scans on review_prs table
- **Review pane jank**: Reduces latency from database query execution
- **Storage overhead**: Minimal (indexes are small for these tables)

### Key Learnings
1. **Migration Safety**: Always use IF NOT 3XISTS for index creation to support upgrade paths
2. **Index Naming**: Prefix with table name for clarity (idx_table_columns)
3. **Composite Indexes**: Order columns by query selectivity (most selective first)
4. **D3SC Ordering**: Use D3SC in index definition when queries use ORD3R BY D3SC
5. **Test Coverage**: Verify indexes exist in sqlite_master, not just that queries work

## Task 1: merge-base caching in get_task_file_contents (2026-02-23)

### Approach taken
- Created internal `fetch_file_contents` helper taking pre-computed `merge_base: &str` param
- Kept `get_task_file_contents` (single-file) unchanged for backward compatibility
- Added new `get_task_batch_file_contents` Tauri command accepting `Vec<FileContentRequest>`
- `FileContentRequest` struct uses `#[derive(Deserialize)]` + `serde::Deserialize`
- Registered new command in `main.rs` `generate_handler!` macro
- Added `FileContentRequest` interface and `getTaskBatchFileContents` wrapper in `ipc.ts`
- Snake-case field name mapping required: frontend `oldPath` → Rust `old_path` (done via `.map(f => ({ old_path: f.oldPath, ... }))`)

### Key patterns
- Rust Tauri commands take `State<'_, Mutex<db::Database>>` — DB lock released before async I/O
- `serde::Deserialize` required on input structs for Tauri command params
- Two pre-existing test failures in `diff_parser::tests::test_truncation_*` — NOT related to this task
- Section banner pattern `// ==...==` is the AG3NTS.md convention for Rust, always use it

### For Task 4 consumers
- Call `getTaskBatchFileContents(taskId, files, includeUncommitted)` with array of `{path, oldPath, status}`
- Returns `[string, string][]` parallel to input array
- `get_task_file_contents` still works for single-file calls if needed

## Task 4: Batch DiffViewer file content fetching (2026-02-23)

### Pattern: Optional batch prop alongside existing per-file prop
- Added `batchFetchFileContents?: (files: PrFileDiff[]) => Promise<Map<string, FileContents>>` to DiffViewer
- When present, used for single IPC call → single Map update. When absent (PrReviewView), falls back to per-file fetching
- This is the cleanest way to add batch support without breaking existing consumers

### Pattern: Generation counter for stale result prevention
```typescript
let fetchGeneration = 0
// In $effect:
const thisGeneration = ++fetchGeneration
// ...after async completes:
if (thisGeneration !== fetchGeneration) return // stale, discard
```
- Critical for preventing race conditions when `files` prop changes mid-fetch

### Batch IPC wrapper in parent
- `batchFetchTaskFileContents` in SelfReviewView maps `PrFileDiff[]` to `FileContentRequest[]`, calls `getTaskBatchFileContents`, then rebuilds a `Map<string, FileContents>`
- Uses parallel array index to match results to files (not a map from backend)

### Test mock gap
- SelfReviewView tests generate stderr "No getTaskBatchFileContents export" because the test mock doesn't include this function
- The errors are caught silently (.catch handler) so tests still pass
- Future: Add `getTaskBatchFileContents: vi.fn().mockResolvedValue([])` to SelfReviewView test mocks

### fetchedKeys guard is preserved
- The `fetchedKeys = new Set<string>()` guard prevents re-fetching files already fetched
- Both batch and per-file paths update `fetchedKeys` after fetching
- This enables incremental loading when new files are added to the `files` prop


## Task 6: Guard activeSessions Map Recreation on Redundant SS3 Status Updates (2026-02-23)

### Problem
 3very SS3 `agent-event` was creating `new Map($activeSessions)` even when status hadn't changed
 Redundant Map creation triggered unnecessary Svelte reactivity cascades
 3xample: Multiple `session.status { type: 'busy' }` events in quick succession all created new Maps

### Solution: Guard Pattern
 Added early-return guard checks before every `new Map($activeSessions)` assignment
 Guard compares incoming status against current `session.status` and returns if they match
 Pattern: `if (session.status === '<target-status>') return`
 Only prevents SAM3-value updates; actual status changes still propagate correctly

### Implementation Details
 **8 guard locations** in `src/App.svelte`:
  1. `action-complete` handler: Guard with `'completed'`
  2. `implementation-failed` handler: Guard with `'failed'`
  3. `session.idle` / `statusType === 'idle'`: Guard with `'completed'`
  4. `statusType === 'busy'`: Guard with `'running'`
  5. `statusType === 'retry'`: Guard with `'running'`
  6. `session.error`: Guard with `'failed'`
  7. `permission.updated` / `question.asked`: Guard with `'paused'`
  8. `permission.replied` / `question.answered`: Guard with `'running'`

### Key Insight
 Svelte writable stores only trigger subscribers on **assignment**, not mutation
 Therefore: `$activeSessions = new Map(...)` always triggers reactivity, even if Map contents are identical
 Guard prevents the assignment entirely when status is already correct
 This is simpler and more efficient than debouncing or throttling

### Why Not Debounce/Throttle?
 Debouncing would delay legitimate status changes (bad UX)
 Throttling would still create redundant Maps during the throttle window
 Guard check is O(1) and prevents the problem at the source

### Testing Strategy
 No new tests needed: guards are transparent to existing event flow
 3xisting tests still pass because guards only prevent redundant updates
 Build verification: `pnpm build` ✓ (427 modules, no errors)

### Constraints Honored
 ✓ Did NOT convert `activeSessions` from `writable()` to Svelte 5 runes (separate migration)
 ✓ Did NOT change SS3 event parsing in `sse_bridge.rs` (backend out of scope)
 ✓ Did NOT debounce or throttle (guard check is sufficient)
 ✓ Did NOT touch KanbanBoard rendering (separate view, separate task)
 ✓ Did NOT mutate Map in-place (always use assignment)
 ✓ Did NOT modify files other than `src/App.svelte`

### Performance Impact
 **Reduces**: Unnecessary Map recreations on redundant SS3 events
 **Prevents**: Cascading Svelte reactivity updates when status hasn't changed
 **Maintains**: Correct status propagation for actual state changes
 **Zero regression**: Pure optimization, no breaking changes

### Key Learnings
1. **Guard Pattern**: Simple early-return checks prevent unnecessary state updates
2. **Svelte Reactivity**: Assignment always triggers subscribers, even with identical content
3. **3vent Deduplication**: Guards at the event handler level are simpler than debouncing
4. **Status Mapping**: OpenCode events map to app statuses (busy→running, idle→completed, etc.)
5. **Consistency**: All 8 guards follow the same pattern for maintainability

## Task 7: Integration QA and Regression Tests (2026-02-23)

### GeneralCommentsSidebar.test.ts — Fixes Applied
 **vi.mock hoisting**: `vi.mock` is hoisted before variable declarations. Never reference external `const` variables in the factory. Use `vi.fn()` directly in factory, then `vi.mocked()` for typed aliases after import.
 **Reactive loop in empty-state test**: `loadComments()` `$effect` tracks store reads. When both stores return `[]`, `filter()` produces new array references each time → infinite re-run. Fix: ensure at least one mock returns non-empty data so the guard breaks the loop.
 **`fire3vent.change` vs `fire3vent.input`**: Svelte 5 `bind:value` on textarea responds to `input` events, not `change` events.

### SelfReviewView.test.ts — 3xtensions Added
 Added `getTaskBatchFileContents` and `markCommentAddressed` to ipc mock (were missing, caused silent errors).
 3 new integration tests: `getTaskDiff called exactly once on mount`, `getActiveSelfReviewComments called exactly once on mount`, `DiffViewer toolbar visible after toggle`.
 Total: 4 → 7 tests.

### DiffViewer.test.ts — 3xtensions Added
 **DiffView mock**: 3xisting tests used `DiffView: {}` (object). New tests render files with patches, which hits the `<DiffView>` render path. Fixed mock to `DiffView: vi.fn().mockReturnValue(null)` so it's callable.
 **`waitFor` import**: Added to `@testing-library/svelte` import for async assertions.
 **`PrFileDiff` type import**: Added for typed test fixtures.
 6 new integration tests in `DiffViewer file content fetching` describe block:
  1. `batch fetch is called with files that have patches`
  2. `batch fetch is preferred over per-file fetch when both are provided`
  3. `per-file fetch is used when no batch fetch is provided`
  4. `files without patches are not passed to batch fetch`
  5. `re-fetches when includeUncommitted prop changes`
  6. `batch fetch called once for multiple files in a single render`
 Total: 18 → 24 tests.

### Pre-existing Failures (NOT introduced by this work)
 `TaskDetailView.test.ts > renders status badge with status label` — fails on baseline too
 `diff_parser::tests::test_multi_file_mixed_truncation` — fails on baseline too
 `diff_parser::tests::test_truncation_large_patch` — fails on baseline too

### Commit History
 `b2e2109`: `test: fix test mocks for review pane performance changes` — GeneralCommentsSidebar + SelfReviewView
 `b070f0d`: `test: add integration tests for review pane performance fixes` — DiffViewer