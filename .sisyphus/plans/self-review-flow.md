# Self-Review Flow: AI Feedback Loop

## TL;DR

> **Quick Summary**: Add a "Review" mode inside the task detail view that shows local git diffs (worktree vs main), lets the user collect inline code comments and general comment cards, then bundles everything into a single prompt sent to the AI agent for iteration.
> 
> **Deliverables**:
> - Rust diff parser + `get_task_diff` Tauri command (git diff on worktree)
> - DB table + CRUD for self-review comments with round-based archiving
> - `SelfReviewView` component: FileTree + DiffViewer + general comments sidebar
> - `SendToAgentPanel`: compiles all comments into a prompt, triggers agent
> - TaskDetailView mode toggle: "Code" (agent) ↔ "Review" (diffs)
> - GitHub PR comment overlay in sidebar when PR is linked
> - Tests: Rust unit tests + frontend vitest
> 
> **Estimated Effort**: Medium-Large
> **Parallel Execution**: YES — 5 waves
> **Critical Path**: T1 (diff parser) → T5 (get_task_diff) → T9 (SelfReviewView) → T10 (TaskDetailView integration) → T12/T13 (tests)

---

## Context

### Original Request
"I want to have a better flow for reviewing my own tickets. I have a github pr view. Can I somehow use that one? Brainstorm with me."

### Interview Summary
**Key Discussions**:
- **Scenario**: Self-review of AI-generated code before requesting external review — an AI feedback loop
- **UI placement**: Full-page replacement inside TaskDetailView (not tabs within the existing layout)
- **Diff source**: Local `git diff origin/main...HEAD` on task worktree — always available, even without a GitHub PR
- **Comments**: Inline code comments (on diff lines) + general comment cards (sidebar, from manual testing)
- **Action**: "Send to Agent" bundles all comments into one LLM prompt, starts new agent session
- **Lifecycle**: Comments archived per round — old comments collapse into "Previous Round" section
- **GitHub overlay**: When a PR exists, show teammate review comments in a sidebar list
- **Timing**: Always accessible, even while agent is running (diff is a snapshot, manual refresh)

**Research Findings**:
- Two disconnected PR systems exist: task-linked PRs (simple links) and cross-repo review (full DiffViewer + FileTree UI)
- DiffViewer uses diff2html which parses raw unified diff — can directly consume `git diff` output converted to `PrFileDiff[]` format
- DiffViewer already has inline comment UI (click "+" on line numbers → form → writes to `pendingManualComments` store)
- Task worktree info (branch name, worktree path) already tracked per task
- `runAction` IPC can be reused for "Send to Agent" — takes `(taskId, repoPath, actionPrompt, agent)`
- `PullRequestInfo.id` in the DB is actually the GitHub PR number — no separate `pr_number` field needed
- Existing code uses `origin/main` for worktree creation (not `main`) — diff should match

### Metis Review
**Identified Gaps** (addressed):
- **Diff scope**: Use `origin/main...HEAD` (committed changes only) — stable for commenting. Stale diff banner when agent is running.
- **No worktree case**: Show empty state "No worktree — run an action first"
- **Round boundaries**: "Send to Agent" click triggers archive
- **Base branch**: Use `origin/main` (matches existing worktree creation code in `main.rs:368,559`)
- **After Send to Agent**: Show success toast, stay in review mode. User manually switches to agent view.
- **DiffViewer store sharing**: Since PrReviewView and TaskDetailView are mutually exclusive views (routed via `currentView`), sharing `pendingManualComments` store is safe — clear on mount/unmount.
- **GitHub comments**: V1 shows in sidebar list only, NOT inline on diff (line numbers may mismatch between local and GitHub diffs)
- **Multiple PRs per task**: Use most recently updated open PR for GitHub comment overlay
- **Large diffs**: Truncate at reasonable file count, show "N more files not shown"
- **Binary files**: Show in FileTree, display "Binary file changed" instead of patch

---

## Work Objectives

### Core Objective
Enable a self-review feedback loop: user reviews AI code diffs inside the task view, collects comments, sends them to the agent as a single prompt, and iterates until satisfied.

### Concrete Deliverables
- `src-tauri/src/diff_parser.rs` — Parse unified diff output into per-file structs
- `get_task_diff` Tauri command — Run `git diff origin/main...HEAD` on task worktree
- `self_review_comments` DB table — Store inline + general comments with round archiving
- CRUD + archive Tauri commands for self-review comments
- `src/lib/reviewPrompt.ts` — Pure function: compile comments into agent prompt
- `src/components/SelfReviewView.svelte` — Main review layout: FileTree + DiffViewer + sidebar
- `src/components/GeneralCommentsSidebar.svelte` — Comment cards for manual testing notes
- `src/components/SendToAgentPanel.svelte` — Bundle comments + trigger agent
- TaskDetailView mode toggle ("Code" ↔ "Review")
- GitHub PR comments in review sidebar (when PR linked)
- Rust tests + frontend tests

### Definition of Done
- [ ] User can open any task with a worktree → see "Review" toggle → view diff vs main
- [ ] User can add inline comments on diff lines + add general comment cards
- [ ] User can click "Send to Agent" → agent receives compiled prompt → runs
- [ ] Previous round comments archived and visible in collapsed section
- [ ] When task has a GitHub PR, teammate comments shown in sidebar
- [ ] `cargo test` passes (diff parser, DB, commands)
- [ ] `pnpm vitest` passes (components, prompt compilation)
- [ ] `pnpm build && cargo build` succeeds

### Must Have
- Local git diff (no GitHub dependency for base case)
- Inline code comments on diff lines
- General comment cards from manual testing
- Single-prompt "Send to Agent" action
- Comment archiving per round
- Mode toggle in TaskDetailView header
- Refresh button for diff (snapshot, not live)

### Must NOT Have (Guardrails)
- **DO NOT modify** `DiffViewer.svelte`, `FileTree.svelte`, `PrReviewView.svelte`, or `ReviewSubmitPanel.svelte` — reuse as-is
- **DO NOT build** comment editing, threading, markdown rendering, or categories
- **DO NOT build** real-time diff watching — manual Refresh button only
- **DO NOT build** inline GitHub comment overlay on diff (V1 = sidebar list only)
- **DO NOT build** multi-round archive navigation (V1 = one previous round, collapsed)
- **DO NOT build** suggested code changes or code block formatting in comments
- **DO NOT auto-navigate** after "Send to Agent" — show toast, user decides when to switch view
- **DO NOT use** `git2` crate — use `tokio::process::Command` (matches existing patterns)
- **DO NOT modify** the existing PR Review tab or cross-repo review workflow

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (vitest + @testing-library/svelte for frontend, cargo test for Rust)
- **Automated tests**: Tests after implementation
- **Framework**: vitest (frontend), cargo test (Rust)

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

| Deliverable Type | Verification Tool | Method |
|------------------|-------------------|--------|
| Rust diff parser | Bash (cargo test) | Unit tests with known diff inputs |
| Rust DB operations | Bash (cargo test) | CRUD + archive tests with temp DB |
| Rust Tauri commands | Bash (cargo test) | Command tests |
| Svelte components | Bash (pnpm vitest) | Component render + interaction tests |
| Prompt compilation | Bash (pnpm vitest) | Pure function unit tests |
| Integration | Bash (pnpm build && cargo build) | Full build succeeds |

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — 4 parallel, all independent):
├── T1: Rust diff parser module [quick]
├── T2: Rust DB table + CRUD for self_review_comments [quick]
├── T3: Frontend foundations: types, stores, IPC wrappers [quick]
└── T4: Frontend reviewPrompt.ts [quick]

Wave 2 (Backend commands + Frontend components — 4 parallel):
├── T5: Rust get_task_diff Tauri command (depends: T1) [unspecified-high]
├── T6: Rust self-review comment Tauri commands (depends: T2) [quick]
├── T7: Frontend GeneralCommentsSidebar component (depends: T3) [visual-engineering]
└── T8: Frontend SendToAgentPanel component (depends: T3, T4) [visual-engineering]

Wave 3 (Main composition — 1 task):
└── T9: Frontend SelfReviewView component (depends: T5, T6, T7, T8) [visual-engineering]

Wave 4 (Integration + GitHub overlay — 2 parallel):
├── T10: TaskDetailView mode toggle + onRunAction wiring (depends: T9) [unspecified-high]
└── T11: GitHub PR comments sidebar in review view (depends: T6, T9) [unspecified-high]

Wave 5 (Tests — 2 parallel):
├── T12: Rust tests (depends: T5, T6) [unspecified-high]
└── T13: Frontend tests (depends: T9, T10) [unspecified-high]

Wave 6 (Build verification — 1 task):
└── T14: Build verification + integration check (depends: all) [quick]

Wave FINAL (After ALL tasks — 4 parallel):
├── F1: Plan compliance audit (oracle)
├── F2: Code quality review (unspecified-high)
├── F3: Real manual QA (unspecified-high)
└── F4: Scope fidelity check (deep)

Critical Path: T1 → T5 → T9 → T10 → T13 → T14 → FINAL
Parallel Speedup: ~60% faster than sequential
Max Concurrent: 4 (Waves 1 & 2)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|------------|--------|------|
| T1 | — | T5 | 1 |
| T2 | — | T6 | 1 |
| T3 | — | T5, T6, T7, T8 | 1 |
| T4 | — | T8 | 1 |
| T5 | T1, T3 | T9 | 2 |
| T6 | T2, T3 | T9, T11 | 2 |
| T7 | T3 | T9 | 2 |
| T8 | T3, T4 | T9 | 2 |
| T9 | T5, T6, T7, T8 | T10, T11 | 3 |
| T10 | T9 | T13 | 4 |
| T11 | T6, T9 | T13 | 4 |
| T12 | T5, T6 | T14 | 5 |
| T13 | T9, T10, T11 | T14 | 5 |
| T14 | T12, T13 | FINAL | 6 |

### Agent Dispatch Summary

| Wave | # Parallel | Tasks → Agent Category |
|------|------------|----------------------|
| 1 | **4** | T1 → `quick`, T2 → `quick`, T3 → `quick`, T4 → `quick` |
| 2 | **4** | T5 → `unspecified-high`, T6 → `quick`, T7 → `visual-engineering`, T8 → `visual-engineering` |
| 3 | **1** | T9 → `visual-engineering` |
| 4 | **2** | T10 → `unspecified-high`, T11 → `unspecified-high` |
| 5 | **2** | T12 → `unspecified-high`, T13 → `unspecified-high` |
| 6 | **1** | T14 → `quick` |
| FINAL | **4** | F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep` |

---

## TODOs

- [x] 1. Rust Diff Parser Module

  **What to do**:
  - Create `src-tauri/src/diff_parser.rs` — a new module with a pure function `parse_unified_diff(diff_output: &str) -> Vec<TaskFileDiff>`
  - Define `TaskFileDiff` struct matching the frontend `PrFileDiff` shape: `{ sha: String, filename: String, status: String, additions: i32, deletions: i32, changes: i32, patch: Option<String>, previous_filename: Option<String> }`
  - Parse by splitting on `diff --git a/... b/...` headers
  - Extract filename from the `diff --git` line (handle renames: `rename from X` / `rename to Y`)
  - Extract hunk content (everything after `@@` lines) as the `patch` field
  - Count `+` and `-` lines for additions/deletions
  - Handle binary files: detect `Binary files ... differ` → set `patch = None`, `status = "binary"`
  - Handle file status: `new file mode` → "added", `deleted file mode` → "removed", `rename` → "renamed", else → "modified"
  - Handle empty diff input → return empty `Vec`
  - Register module in `main.rs` with `mod diff_parser;`

  **Must NOT do**:
  - Do NOT use `git2` crate — parse the CLI output string only
  - Do NOT add any Tauri commands in this task — just the parser module
  - Do NOT handle executing git commands — that's T5

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Pure string parsing function, single file, well-defined input/output
  - **Skills**: []
    - No special skills needed — standard Rust text processing
  - **Skills Evaluated but Omitted**:
    - `golang`: Not relevant — this is Rust

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T2, T3, T4)
  - **Blocks**: T5 (get_task_diff command uses this parser)
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src-tauri/src/github_client.rs:1-50` — Module structure pattern: struct definitions with `#[derive(Debug, Clone, Serialize)]`, error enum, impl block
  - `src-tauri/src/main.rs:1-10` — Where to add `mod diff_parser;` declaration

  **API/Type References**:
  - `src/lib/types.ts:148-157` — `PrFileDiff` interface — the Rust struct MUST serialize to match this shape exactly (field names, types, nullability)

  **External References**:
  - Unified diff format: `diff --git a/file b/file` header, `--- a/file` / `+++ b/file`, `@@ -n,m +n,m @@` hunks

  **WHY Each Reference Matters**:
  - `PrFileDiff` type is the contract — DiffViewer.svelte expects exactly this shape. Mismatch = broken rendering.
  - `github_client.rs` shows the codebase pattern for Rust structs that serialize to the frontend.
  - `main.rs` mod declarations — new module must be registered here.

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Parse multi-file diff with additions, modifications, and deletions
    Tool: Bash (cargo test)
    Preconditions: diff_parser.rs exists with parse_unified_diff function
    Steps:
      1. Create test with sample unified diff containing 3 files (1 added, 1 modified, 1 deleted)
      2. Run `cargo test -p ai-command-center test_parse_multi_file_diff -- --nocapture`
      3. Assert: returns Vec of 3 items
      4. Assert: added file has status="added", patch contains "+lines", additions > 0
      5. Assert: modified file has status="modified", additions > 0, deletions > 0
      6. Assert: deleted file has status="removed"
    Expected Result: All assertions pass, correct file count and status mapping
    Failure Indicators: Wrong file count, incorrect status, patch content missing
    Evidence: .sisyphus/evidence/task-1-parse-multi-file.txt

  Scenario: Parse empty diff (no changes)
    Tool: Bash (cargo test)
    Preconditions: diff_parser.rs exists
    Steps:
      1. Create test passing empty string to parse_unified_diff
      2. Run `cargo test -p ai-command-center test_parse_empty_diff -- --nocapture`
      3. Assert: returns empty Vec
    Expected Result: Empty vec returned, no panic
    Failure Indicators: Panic, non-empty result
    Evidence: .sisyphus/evidence/task-1-parse-empty.txt

  Scenario: Parse diff with binary file and renamed file
    Tool: Bash (cargo test)
    Preconditions: diff_parser.rs exists
    Steps:
      1. Create test with diff containing "Binary files ... differ" and "rename from/to" entries
      2. Run `cargo test -p ai-command-center test_parse_binary_and_rename -- --nocapture`
      3. Assert: binary file has patch=None, status="binary"
      4. Assert: renamed file has previous_filename set, status="renamed"
    Expected Result: Binary and rename cases handled correctly
    Failure Indicators: Panic on binary, missing previous_filename
    Evidence: .sisyphus/evidence/task-1-parse-binary-rename.txt
  ```

  **Evidence to Capture:**
  - [ ] task-1-parse-multi-file.txt — cargo test output
  - [ ] task-1-parse-empty.txt — cargo test output
  - [ ] task-1-parse-binary-rename.txt — cargo test output

  **Commit**: YES (groups with T2)
  - Message: `feat(backend): add diff parser and self-review DB schema`
  - Files: `src-tauri/src/diff_parser.rs`, `src-tauri/src/main.rs` (mod declaration)
  - Pre-commit: `cargo build`

- [x] 2. Rust DB Table + CRUD for Self-Review Comments

  **What to do**:
  - Add `self_review_comments` table creation to the `initialize()` method in `db.rs`:
    ```sql
    CREATE TABLE IF NOT EXISTS self_review_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      round INTEGER NOT NULL DEFAULT 1,
      comment_type TEXT NOT NULL,  -- 'inline' or 'general'
      file_path TEXT,              -- NULL for general comments
      line_number INTEGER,         -- NULL for general comments
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      archived_at INTEGER          -- NULL = active, set when archived
    )
    ```
  - Add CRUD methods to `Database` impl:
    - `insert_self_review_comment(&self, task_id, comment_type, file_path, line_number, body) -> Result<i64>` — inserts with current round (max round for task where archived_at IS NULL, or 1)
    - `get_active_self_review_comments(&self, task_id) -> Result<Vec<SelfReviewCommentRow>>` — WHERE archived_at IS NULL
    - `get_archived_self_review_comments(&self, task_id) -> Result<Vec<SelfReviewCommentRow>>` — WHERE archived_at IS NOT NULL, latest round only
    - `delete_self_review_comment(&self, comment_id) -> Result<()>`
    - `archive_self_review_comments(&self, task_id) -> Result<()>` — SET archived_at = now WHERE task_id = ? AND archived_at IS NULL
  - Define `SelfReviewCommentRow` struct with `#[derive(Debug, Clone, Serialize)]`

  **Must NOT do**:
  - Do NOT add Tauri commands — just DB methods (T6 adds commands)
  - Do NOT add foreign key constraint on task_id (tasks table uses different patterns)
  - Do NOT build multi-round browsing — archive method sets archived_at, that's it

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single file, follows existing DB patterns exactly, SQL + Rust struct
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `golang`: Not relevant

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1, T3, T4)
  - **Blocks**: T6 (Tauri commands use these DB methods)
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src-tauri/src/db.rs:1-80` — `Database` struct, `initialize()` method with CREATE TABLE statements, `Arc<Mutex<Connection>>` pattern
  - `src-tauri/src/db.rs` search for `pub fn insert_` — Insert method pattern: lock mutex, prepare statement, execute, return id
  - `src-tauri/src/db.rs` search for `pub fn get_all_` — Query method pattern: lock, prepare, query_map, collect into Vec
  - `src-tauri/src/db.rs` bottom of file — `#[cfg(test)] mod tests` with `make_test_db` helper

  **API/Type References**:
  - `src-tauri/src/db.rs` search for `Row` structs — Pattern: `pub struct XxxRow` with `pub` fields, derives

  **WHY Each Reference Matters**:
  - `initialize()` is where ALL table creation lives — add the new table here
  - Existing CRUD methods show the exact locking, error handling, and return patterns to follow
  - Test section shows `make_test_db` helper for creating temp test databases

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: CRUD operations for self-review comments
    Tool: Bash (cargo test)
    Preconditions: self_review_comments table added to initialize()
    Steps:
      1. Create test_self_review_comment_crud test using make_test_db
      2. Insert an inline comment (file_path + line_number set)
      3. Insert a general comment (file_path = NULL, line_number = NULL)
      4. Query get_active_self_review_comments — assert 2 comments returned
      5. Delete one comment — assert 1 remaining
      6. Run `cargo test -p ai-command-center test_self_review_comment_crud -- --nocapture`
    Expected Result: All CRUD operations succeed, correct counts
    Failure Indicators: SQL errors, wrong count, missing fields
    Evidence: .sisyphus/evidence/task-2-crud.txt

  Scenario: Archive and round management
    Tool: Bash (cargo test)
    Preconditions: CRUD methods exist
    Steps:
      1. Create test_archive_self_review_comments test
      2. Insert 3 active comments for task "T-1"
      3. Call archive_self_review_comments("T-1")
      4. Assert: get_active returns 0
      5. Assert: get_archived returns 3, all have archived_at set
      6. Insert 2 new comments for task "T-1" (new round)
      7. Assert: get_active returns 2 (new round)
      8. Run `cargo test -p ai-command-center test_archive_self_review_comments -- --nocapture`
    Expected Result: Archive sets archived_at, new comments are in new round
    Failure Indicators: Active comments still returned after archive, archived_at NULL
    Evidence: .sisyphus/evidence/task-2-archive.txt
  ```

  **Evidence to Capture:**
  - [ ] task-2-crud.txt
  - [ ] task-2-archive.txt

  **Commit**: YES (groups with T1)
  - Message: `feat(backend): add diff parser and self-review DB schema`
  - Files: `src-tauri/src/db.rs`
  - Pre-commit: `cargo build`

- [x] 3. Frontend Foundations: Types, Stores, IPC Wrappers

  **What to do**:
  - **Types** (`src/lib/types.ts`):
    - Add `SelfReviewComment` interface:
      ```ts
      export interface SelfReviewComment {
        id: number;
        task_id: string;
        round: number;
        comment_type: string;  // 'inline' | 'general'
        file_path: string | null;
        line_number: number | null;
        body: string;
        created_at: number;
        archived_at: number | null;
      }
      ```
    - Add `"review"` to the existing `AppView` type — but WAIT: review mode is within TaskDetailView, not a top-level view. So do NOT change AppView. Instead, the mode toggle is local state in TaskDetailView.

  - **Stores** (`src/lib/stores.ts`):
    - Add: `export const selfReviewGeneralComments = writable<SelfReviewComment[]>([]);`
    - Add: `export const selfReviewArchivedComments = writable<SelfReviewComment[]>([]);`
    - Add: `export const selfReviewDiffFiles = writable<PrFileDiff[]>([]);`
    - NOTE: Inline comments reuse `pendingManualComments` store (DiffViewer writes to it). This is safe because PrReviewView and TaskDetailView are mutually exclusive views.

  - **IPC** (`src/lib/ipc.ts`):
    - Add: `export async function getTaskDiff(taskId: string): Promise<PrFileDiff[]> { return invoke('get_task_diff', { taskId }); }`
    - Add: `export async function addSelfReviewComment(taskId: string, commentType: string, filePath: string | null, lineNumber: number | null, body: string): Promise<number> { return invoke('add_self_review_comment', { taskId, commentType, filePath, lineNumber, body }); }`
    - Add: `export async function getActiveSelfReviewComments(taskId: string): Promise<SelfReviewComment[]> { return invoke('get_active_self_review_comments', { taskId }); }`
    - Add: `export async function getArchivedSelfReviewComments(taskId: string): Promise<SelfReviewComment[]> { return invoke('get_archived_self_review_comments', { taskId }); }`
    - Add: `export async function deleteSelfReviewComment(commentId: number): Promise<void> { return invoke('delete_self_review_comment', { commentId }); }`
    - Add: `export async function archiveSelfReviewComments(taskId: string): Promise<void> { return invoke('archive_self_review_comments', { taskId }); }`

  **Must NOT do**:
  - Do NOT modify `AppView` type — review mode is local state in TaskDetailView
  - Do NOT modify existing stores or IPC functions
  - Do NOT create components — just the data layer

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Adding interfaces, store declarations, and typed function wrappers to existing files
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: No UI work here, just data layer

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1, T2, T4)
  - **Blocks**: T5, T6, T7, T8 (all frontend work depends on types + IPC)
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/lib/types.ts:43-53` — `PrComment` interface — follow this pattern for `SelfReviewComment` (same field style: `snake_case`, `number | null` for nullable)
  - `src/lib/stores.ts:1-24` — Existing store declarations — follow the writable<Type> pattern
  - `src/lib/ipc.ts` search for `export async function` — IPC wrapper pattern: typed params, typed return, invoke with snake_case command name

  **API/Type References**:
  - `src/lib/types.ts:148-157` — `PrFileDiff` — reuse this type for `getTaskDiff` return value (diff parser outputs same shape)

  **WHY Each Reference Matters**:
  - Types must match Rust serialization exactly — field names are snake_case in Rust serde, must match TS interface
  - IPC wrappers use `invoke('snake_case_command_name', { camelCaseParams })` — Tauri auto-converts
  - Stores pattern must be consistent with existing codebase

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: TypeScript compilation succeeds with new types and IPC
    Tool: Bash (pnpm build)
    Preconditions: types.ts, stores.ts, ipc.ts updated
    Steps:
      1. Run `pnpm build`
      2. Assert: no TypeScript errors related to new types/stores/IPC
    Expected Result: Build succeeds
    Failure Indicators: Type errors, missing imports, undefined references
    Evidence: .sisyphus/evidence/task-3-build.txt

  Scenario: Types match expected shape
    Tool: Bash (grep)
    Preconditions: types.ts updated
    Steps:
      1. Grep for `SelfReviewComment` in types.ts
      2. Verify interface has: id, task_id, round, comment_type, file_path, line_number, body, created_at, archived_at
      3. Verify nullable fields use `| null` pattern
    Expected Result: Interface matches specification
    Failure Indicators: Missing fields, wrong types
    Evidence: .sisyphus/evidence/task-3-types.txt
  ```

  **Evidence to Capture:**
  - [ ] task-3-build.txt
  - [ ] task-3-types.txt

  **Commit**: YES (groups with T4)
  - Message: `feat(frontend): add self-review types, stores, IPC, prompt compiler`
  - Files: `src/lib/types.ts`, `src/lib/stores.ts`, `src/lib/ipc.ts`
  - Pre-commit: `pnpm build`

- [x] 4. Frontend reviewPrompt.ts — Compile Comments into Agent Prompt

  **What to do**:
  - Create `src/lib/reviewPrompt.ts` with a pure function:
    ```ts
    export function compileReviewPrompt(
      taskTitle: string,
      inlineComments: { path: string; line: number; body: string }[],
      generalComments: { body: string }[]
    ): string
    ```
  - Prompt format:
    ```
    Please address the following review feedback for task "{taskTitle}":

    ## Code Comments
    {numbered list of inline comments, each with file:line reference}
    1. `src/components/Foo.svelte:42` — The animation is janky, use CSS transitions instead
    2. `src/lib/ipc.ts:15` — Missing error handling

    ## General Feedback
    {numbered list of general comments}
    1. The button hover state doesn't work
    2. Error message shows raw error instead of user-friendly text

    Please address ALL items above. For code comments, fix the issue at the referenced location.
    For general feedback, investigate and fix the described behavior.
    ```
  - Handle edge cases: inline-only (no general section), general-only (no code section), empty comments (return empty string)
  - Escape special characters in comment bodies (backticks, quotes) that might confuse the LLM

  **Must NOT do**:
  - Do NOT add any UI or IPC — pure function only
  - Do NOT import from stores — function takes data as parameters
  - Do NOT add markdown formatting beyond the template — keep it simple plain text

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single pure function, no dependencies, straightforward string template
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1, T2, T3)
  - **Blocks**: T8 (SendToAgentPanel uses this function)
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src-tauri/src/main.rs` search for `build_task_prompt` (around line 319-332) — Shows how existing prompts are structured for the agent. Follow a similar style: clear sections, numbered items.

  **External References**:
  - No external deps — pure TypeScript string template

  **WHY Each Reference Matters**:
  - `build_task_prompt` in main.rs shows what prompt structures the agent already handles — match the style for consistency

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Compile prompt with both inline and general comments
    Tool: Bash (pnpm vitest)
    Preconditions: reviewPrompt.ts exists
    Steps:
      1. Create reviewPrompt.test.ts with test: 2 inline + 2 general comments
      2. Call compileReviewPrompt and assert output contains numbered items
      3. Assert file:line references present for inline comments
      4. Assert both sections present
      5. Run `pnpm vitest run src/lib/reviewPrompt.test.ts`
    Expected Result: Prompt contains all comments, properly formatted
    Failure Indicators: Missing comments, wrong numbering, missing sections
    Evidence: .sisyphus/evidence/task-4-prompt-both.txt

  Scenario: Handle inline-only and general-only cases
    Tool: Bash (pnpm vitest)
    Preconditions: reviewPrompt.ts exists
    Steps:
      1. Test with empty generalComments array — assert no "General Feedback" section
      2. Test with empty inlineComments array — assert no "Code Comments" section
      3. Test with both empty — assert returns empty string
      4. Run `pnpm vitest run src/lib/reviewPrompt.test.ts`
    Expected Result: Graceful handling of partial/empty inputs
    Failure Indicators: Empty sections rendered, crash on empty arrays
    Evidence: .sisyphus/evidence/task-4-prompt-edge.txt
  ```

  **Evidence to Capture:**
  - [ ] task-4-prompt-both.txt
  - [ ] task-4-prompt-edge.txt

  **Commit**: YES (groups with T3)
  - Message: `feat(frontend): add self-review types, stores, IPC, prompt compiler`
  - Files: `src/lib/reviewPrompt.ts`, `src/lib/reviewPrompt.test.ts`
  - Pre-commit: `pnpm build`

- [x] 5. Rust get_task_diff Tauri Command

  **What to do**:
  - Add `get_task_diff` Tauri command to `main.rs`:
    ```rust
    #[tauri::command]
    async fn get_task_diff(
        task_id: String,
        db: State<'_, Mutex<db::Database>>,
    ) -> Result<Vec<diff_parser::TaskFileDiff>, String>
    ```
  - Implementation:
    1. Look up worktree for task: `db.get_worktree_for_task(&task_id)` — if None, return error "No worktree found for task"
    2. Run `git -C <worktree_path> diff origin/main...HEAD` using `tokio::process::Command`
    3. Capture stdout as string
    4. Pass to `diff_parser::parse_unified_diff(&output)` 
    5. Return the parsed `Vec<TaskFileDiff>`
  - Handle edge cases:
    - No worktree → clear error message
    - Empty diff (no changes) → return empty Vec (not an error)
    - Git command fails → return error with stderr message
    - Large diff → no truncation in V1 (but consider adding later)
  - Register command in `.invoke_handler(tauri::generate_handler![..., get_task_diff])`

  **Must NOT do**:
  - Do NOT use `git2` crate — use `tokio::process::Command` (matches `git_worktree.rs` patterns)
  - Do NOT add `git fetch` before diff — accept potentially stale base (user can refresh)
  - Do NOT truncate large diffs in V1

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Involves async Tauri command, subprocess execution, error handling, and integration with diff parser
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T6, T7, T8)
  - **Blocks**: T9 (SelfReviewView calls this)
  - **Blocked By**: T1 (uses diff parser), T3 (frontend types define the contract)

  **References**:

  **Pattern References**:
  - `src-tauri/src/git_worktree.rs:105-130` — Pattern for running git commands with `tokio::process::Command`, `-C` flag for directory, capturing output
  - `src-tauri/src/main.rs` search for `async fn get_` — Tauri command pattern: State parameters, Result<T, String>, .map_err(|e| format!(...))
  - `src-tauri/src/main.rs` search for `get_worktree_for_task` — How to look up worktree info for a task ID

  **API/Type References**:
  - `src-tauri/src/diff_parser.rs` (from T1) — `TaskFileDiff` struct and `parse_unified_diff` function
  - `src-tauri/src/db.rs` search for `WorktreeRow` — Worktree struct with `worktree_path` field

  **WHY Each Reference Matters**:
  - `git_worktree.rs` shows the exact pattern for running git subprocesses — reuse the same error handling and `-C` flag approach
  - `get_worktree_for_task` already exists — no need to write custom DB lookup
  - `WorktreeRow.worktree_path` is the directory to run `git diff` in

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: get_task_diff returns error when no worktree exists
    Tool: Bash (cargo test)
    Preconditions: get_task_diff command registered
    Steps:
      1. Create test calling get_task_diff with a task ID that has no worktree
      2. Assert: returns Err containing "No worktree found"
      3. Run `cargo test -p ai-command-center test_get_task_diff_no_worktree -- --nocapture`
    Expected Result: Clear error message, no panic
    Failure Indicators: Panic, generic error, success with empty data
    Evidence: .sisyphus/evidence/task-5-no-worktree.txt

  Scenario: cargo build succeeds with new command registered
    Tool: Bash (cargo build)
    Preconditions: Command added to main.rs invoke_handler
    Steps:
      1. Run `cargo build`
      2. Assert: no compilation errors
    Expected Result: Clean build
    Failure Indicators: Type mismatches, missing imports, unregistered command
    Evidence: .sisyphus/evidence/task-5-build.txt
  ```

  **Evidence to Capture:**
  - [ ] task-5-no-worktree.txt
  - [ ] task-5-build.txt

  **Commit**: YES (groups with T6)
  - Message: `feat(backend): add get_task_diff and self-review comment commands`
  - Files: `src-tauri/src/main.rs`
  - Pre-commit: `cargo build`

- [x] 6. Rust Self-Review Comment Tauri Commands

  **What to do**:
  - Add Tauri commands to `main.rs` that wrap the DB methods from T2:
    - `add_self_review_comment(task_id, comment_type, file_path, line_number, body, db) -> Result<i64, String>`
    - `get_active_self_review_comments(task_id, db) -> Result<Vec<SelfReviewCommentRow>, String>`
    - `get_archived_self_review_comments(task_id, db) -> Result<Vec<SelfReviewCommentRow>, String>`
    - `delete_self_review_comment(comment_id, db) -> Result<(), String>`
    - `archive_self_review_comments(task_id, db) -> Result<(), String>`
  - Register all commands in `.invoke_handler(tauri::generate_handler![...])`
  - Each command: lock db mutex, call db method, map_err to String

  **Must NOT do**:
  - Do NOT add business logic — just thin wrappers around DB methods
  - Do NOT add validation beyond what the DB layer provides

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Thin wrapper functions following exact existing patterns
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T5, T7, T8)
  - **Blocks**: T9 (SelfReviewView), T11 (GitHub PR comments sidebar)
  - **Blocked By**: T2 (DB methods), T3 (frontend types define the contract)

  **References**:

  **Pattern References**:
  - `src-tauri/src/main.rs` search for `async fn get_tickets` — Exact pattern to follow: State<'_, Mutex<db::Database>>, lock, call, map_err
  - `src-tauri/src/main.rs` search for `generate_handler!` — Where to register new commands

  **WHY Each Reference Matters**:
  - Every Tauri command follows the same structure — lock, call, map_err. Copy this pattern exactly.

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: All Tauri commands compile and register
    Tool: Bash (cargo build)
    Preconditions: All 5 commands added to main.rs
    Steps:
      1. Run `cargo build`
      2. Assert: no errors about unregistered commands or type mismatches
    Expected Result: Clean build with all commands registered
    Failure Indicators: Missing from generate_handler, wrong parameter types
    Evidence: .sisyphus/evidence/task-6-build.txt
  ```

  **Evidence to Capture:**
  - [ ] task-6-build.txt

  **Commit**: YES (groups with T5)
  - Message: `feat(backend): add get_task_diff and self-review comment commands`
  - Files: `src-tauri/src/main.rs`
  - Pre-commit: `cargo build`

- [x] 7. Frontend GeneralCommentsSidebar Component

  **What to do**:
  - Create `src/components/GeneralCommentsSidebar.svelte` — a sidebar that shows general comment cards and lets the user add new ones
  - Layout: vertical stack of comment cards + "Add Comment" input at the bottom
  - Each comment card shows:
    - Comment body text
    - Delete button (×) to remove the comment
    - Subtle timestamp or order number
  - "Add Comment" area: a textarea + "Add" button. On submit:
    - Call `addSelfReviewComment(taskId, 'general', null, null, body)` IPC
    - Add the returned comment to `selfReviewGeneralComments` store
    - Clear the textarea
  - Show archived comments in a collapsed "Previous Round ({count})" section at the top
    - Collapsed by default, click to expand
    - Archived comments shown dimmed/muted, no delete button
  - Props: `taskId: string`
  - On mount: load active + archived comments via IPC, populate stores
  - Empty state: "No comments yet. Add notes from manual testing."

  **Must NOT do**:
  - Do NOT add comment editing — delete and re-create only
  - Do NOT add categories, tags, or markdown
  - Do NOT add multi-round navigation — just one "Previous Round" section
  - Do NOT build comment threading or replies

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: UI component with card layout, animations, empty state — visual polish matters
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: Designing the comment card layout, empty state, collapsed section needs UX sensibility
  - **Skills Evaluated but Omitted**:
    - `playwright`: No browser testing in this task

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T5, T6, T8)
  - **Blocks**: T9 (SelfReviewView composes this)
  - **Blocked By**: T3 (types, stores, IPC wrappers)

  **References**:

  **Pattern References**:
  - `src/components/TaskInfoPanel.svelte:186-228` — PR Comments section pattern: iterating comments, showing author/body, action buttons. Follow this card layout style.
  - `src/components/ReviewSubmitPanel.svelte:74-128` — Textarea + submit button layout pattern. Follow the `.summary-input` and `.action-buttons` styling.

  **API/Type References**:
  - `src/lib/types.ts` — `SelfReviewComment` interface (from T3)
  - `src/lib/stores.ts` — `selfReviewGeneralComments`, `selfReviewArchivedComments` stores (from T3)
  - `src/lib/ipc.ts` — `addSelfReviewComment`, `deleteSelfReviewComment`, `getActiveSelfReviewComments`, `getArchivedSelfReviewComments` (from T3)

  **WHY Each Reference Matters**:
  - TaskInfoPanel comment section is the closest existing UI to what we're building — same card-in-list pattern
  - ReviewSubmitPanel has the textarea+button pattern for the "Add Comment" area
  - Must use the stores/IPC from T3 — not create new ones

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Add and display a general comment
    Tool: Bash (pnpm build)
    Preconditions: GeneralCommentsSidebar.svelte created, T3 complete
    Steps:
      1. Verify component imports correct types, stores, and IPC functions
      2. Verify component has textarea + Add button
      3. Verify component iterates selfReviewGeneralComments store for card display
      4. Run `pnpm build`
    Expected Result: Component compiles without errors
    Failure Indicators: Missing imports, type errors, store reference errors
    Evidence: .sisyphus/evidence/task-7-build.txt

  Scenario: Delete button and archived section exist
    Tool: Bash (grep)
    Preconditions: Component created
    Steps:
      1. Grep for delete/remove handler in GeneralCommentsSidebar.svelte
      2. Grep for "Previous Round" or archived section
      3. Verify collapsed section uses selfReviewArchivedComments store
    Expected Result: Both features present in component
    Failure Indicators: Missing delete handler, no archive section
    Evidence: .sisyphus/evidence/task-7-features.txt
  ```

  **Evidence to Capture:**
  - [ ] task-7-build.txt
  - [ ] task-7-features.txt

  **Commit**: YES (groups with T8)
  - Message: `feat(ui): add GeneralCommentsSidebar and SendToAgentPanel components`
  - Files: `src/components/GeneralCommentsSidebar.svelte`
  - Pre-commit: `pnpm build`

- [x] 8. Frontend SendToAgentPanel Component

  **What to do**:
  - Create `src/components/SendToAgentPanel.svelte` — bottom panel with "Send to Agent" action + refresh
  - Layout: horizontal bar at bottom of review view (similar to ReviewSubmitPanel position)
  - Left side: comment summary counts
    - "N inline comments, M general comments"
    - If no comments: "No feedback collected yet"
  - Right side: action buttons
    - **"Refresh Diff"** button — calls `getTaskDiff(taskId)` and updates `selfReviewDiffFiles` store
    - **"Send to Agent"** button (primary, prominent):
      - Disabled when: no comments OR agent session is `running`/`paused`
      - On click:
        1. Read inline comments from `pendingManualComments` store
        2. Read general comments from `selfReviewGeneralComments` store
        3. Call `compileReviewPrompt()` from reviewPrompt.ts
        4. Call `archiveSelfReviewComments(taskId)` to archive current round
        5. Clear both stores
        6. Call `onSendToAgent(prompt)` callback prop — parent handles the actual runAction
        7. Show success toast: "Review feedback sent to agent"
  - Show banner when agent is running: "Agent is working — diff may be stale. Refresh when ready."
  - Props: `taskId: string`, `agentStatus: string | null`, `onSendToAgent: (prompt: string) => void`, `onRefresh: () => void`

  **Must NOT do**:
  - Do NOT call `runAction` directly — use callback prop (parent handles IPC)
  - Do NOT auto-navigate to agent view after sending
  - Do NOT build suggested actions or prompt editing

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: UI component with state-dependent button styling, banner, summary display
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: Button states, disabled state messaging, stale-diff banner need visual polish
  - **Skills Evaluated but Omitted**:
    - `playwright`: No browser testing here

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T5, T6, T7)
  - **Blocks**: T9 (SelfReviewView composes this)
  - **Blocked By**: T3 (types, stores, IPC), T4 (reviewPrompt.ts)

  **References**:

  **Pattern References**:
  - `src/components/ReviewSubmitPanel.svelte:74-128` — Exact layout pattern: bottom panel with header, body, action buttons. Follow this structure.
  - `src/components/ReviewSubmitPanel.svelte:131-280` — CSS styles for bottom panel: `.review-submit-panel`, `.panel-header`, `.action-buttons`. Reuse similar styling.

  **API/Type References**:
  - `src/lib/reviewPrompt.ts` (from T4) — `compileReviewPrompt()` function
  - `src/lib/stores.ts` — `pendingManualComments` (inline comments from DiffViewer), `selfReviewGeneralComments`
  - `src/lib/ipc.ts` — `archiveSelfReviewComments`, `getTaskDiff`

  **WHY Each Reference Matters**:
  - ReviewSubmitPanel is the direct analog — same position, similar actions, same visual language
  - Must read from both comment stores to compile the full prompt
  - `archiveSelfReviewComments` must be called BEFORE clearing stores (persist first)

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Panel renders with correct button states
    Tool: Bash (pnpm build)
    Preconditions: SendToAgentPanel.svelte created, T3 + T4 complete
    Steps:
      1. Verify component has "Refresh Diff" and "Send to Agent" buttons
      2. Verify "Send to Agent" checks for empty comments (disabled state)
      3. Verify agent running banner exists (conditional on agentStatus prop)
      4. Run `pnpm build`
    Expected Result: Component compiles, correct conditional rendering
    Failure Indicators: Type errors, missing props, missing conditional logic
    Evidence: .sisyphus/evidence/task-8-build.txt

  Scenario: Send flow calls archive then clears stores
    Tool: Bash (grep)
    Preconditions: Component created
    Steps:
      1. Verify component imports archiveSelfReviewComments from ipc
      2. Verify component imports compileReviewPrompt from reviewPrompt
      3. Verify the send handler calls archive BEFORE clearing stores
      4. Verify onSendToAgent callback is called with compiled prompt
    Expected Result: Correct order of operations in send handler
    Failure Indicators: Archive called after clear (data loss), missing callback
    Evidence: .sisyphus/evidence/task-8-send-flow.txt
  ```

  **Evidence to Capture:**
  - [ ] task-8-build.txt
  - [ ] task-8-send-flow.txt

  **Commit**: YES (groups with T7)
  - Message: `feat(ui): add GeneralCommentsSidebar and SendToAgentPanel components`
  - Files: `src/components/SendToAgentPanel.svelte`
  - Pre-commit: `pnpm build`

- [ ] 9. Frontend SelfReviewView Component (Main Composition)

  **What to do**:
  - Create `src/components/SelfReviewView.svelte` — the main review layout composing all sub-components
  - Layout (full-page, replaces TaskDetailView body):
    ```
    ┌─────────────────────────────────────────────────────┐
    │ FileTree (left) │ DiffViewer (center)  │ Comments   │
    │ ~200px fixed    │ flex: 1              │ ~280px     │
    │                 │                      │ (sidebar)  │
    │                 │                      │            │
    ├─────────────────┴──────────────────────┴────────────┤
    │ SendToAgentPanel (bottom bar)                       │
    └─────────────────────────────────────────────────────┘
    ```
  - Props: `task: Task`, `agentStatus: string | null`, `onSendToAgent: (prompt: string) => void`
  - On mount:
    1. Call `getTaskDiff(task.id)` → populate `selfReviewDiffFiles` store
    2. Call `getActiveSelfReviewComments(task.id)` → populate `selfReviewGeneralComments` store (filter comment_type === 'general')
    3. Call `getArchivedSelfReviewComments(task.id)` → populate `selfReviewArchivedComments` store
    4. Clear `pendingManualComments` store (fresh start for inline comments)
    5. Load inline comments from DB (comment_type === 'inline') → convert to `ReviewSubmissionComment[]` → set `pendingManualComments`
  - On unmount: clear all self-review stores + `pendingManualComments`
  - Refresh handler: re-call `getTaskDiff(task.id)` and update store
  - Pass `selfReviewDiffFiles` as `files` prop to DiffViewer
  - Pass task's GitHub PR comments (if any) to DiffViewer as `existingComments` — but only if task has linked PRs in `ticketPrs` store. Fetch via `getReviewComments(pr.repo_owner, pr.repo_name, pr.id)`.
  - FileTree gets `selfReviewDiffFiles` as `files` prop, `onSelectFile` scrolls DiffViewer
  - GeneralCommentsSidebar gets `taskId`
  - SendToAgentPanel gets `taskId`, `agentStatus`, `onSendToAgent`, `onRefresh`
  - Handle loading state: show spinner while diff loads
  - Handle error state: show error message if git diff fails
  - Handle empty state (no changes): show "No changes on this branch yet" message

  **Must NOT do**:
  - Do NOT modify DiffViewer.svelte or FileTree.svelte — use their existing props/interfaces
  - Do NOT attempt to inject GitHub comments inline on the diff (sidebar only in V1)
  - Do NOT auto-refresh diff — manual refresh only
  - Do NOT add syntax highlighting beyond what diff2html provides

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Complex layout composition, loading/error/empty states, visual integration of 4 sub-components
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: Layout composition, responsive design, state transitions need visual polish
  - **Skills Evaluated but Omitted**:
    - `playwright`: No browser testing here

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (solo — bottleneck task)
  - **Blocks**: T10 (TaskDetailView integration), T11 (GitHub PR sidebar)
  - **Blocked By**: T5 (get_task_diff), T6 (comment commands), T7 (GeneralCommentsSidebar), T8 (SendToAgentPanel)

  **References**:

  **Pattern References**:
  - `src/components/PrReviewView.svelte:131-153` — FileTree + DiffViewer composition pattern: `<FileTree files={$prFileDiffs} onSelectFile={handleFileSelect} />` + `<DiffViewer bind:this={diffViewer} files={$prFileDiffs} ... />`. Copy this exact composition approach.
  - `src/components/PrReviewView.svelte:110-160` — Detail view layout: `.detail-view`, `.detail-content` flexbox with FileTree + DiffViewer side by side
  - `src/components/PrReviewView.svelte:58-71` — `selectPr()` function: pattern for loading diffs + comments on selection. Adapt for task loading.

  **API/Type References**:
  - `src/lib/types.ts` — `Task`, `PrFileDiff`, `SelfReviewComment`, `ReviewComment`
  - `src/lib/stores.ts` — `selfReviewDiffFiles`, `selfReviewGeneralComments`, `selfReviewArchivedComments`, `pendingManualComments`, `ticketPrs`
  - `src/lib/ipc.ts` — `getTaskDiff`, `getActiveSelfReviewComments`, `getArchivedSelfReviewComments`, `getReviewComments`
  - `src/components/DiffViewer.svelte:9-16` — DiffViewer props interface: `files`, `existingComments`, `repoOwner`, `repoName`
  - `src/components/FileTree.svelte` — FileTree props: `files`, `onSelectFile`

  **WHY Each Reference Matters**:
  - PrReviewView is the closest existing analog — same components, same layout. Follow its patterns exactly.
  - DiffViewer props interface is the contract — must provide data in exactly the expected shape.
  - Store management must clear on mount/unmount to prevent cross-view contamination.

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: SelfReviewView renders with all sub-components
    Tool: Bash (pnpm build)
    Preconditions: All sub-components (T7, T8) and data layer (T3) complete
    Steps:
      1. Verify SelfReviewView imports FileTree, DiffViewer, GeneralCommentsSidebar, SendToAgentPanel
      2. Verify layout has three columns (file tree, diff, comments) + bottom panel
      3. Verify onMount calls getTaskDiff and comment loading IPC
      4. Run `pnpm build`
    Expected Result: Component compiles with correct layout structure
    Failure Indicators: Missing imports, layout errors, type mismatches
    Evidence: .sisyphus/evidence/task-9-build.txt

  Scenario: Store cleanup on mount and unmount
    Tool: Bash (grep)
    Preconditions: Component created
    Steps:
      1. Verify onMount clears pendingManualComments store
      2. Verify onDestroy/cleanup clears all self-review stores
      3. Verify no direct imports from PrReviewView-specific stores
    Expected Result: Clean store lifecycle, no cross-view contamination
    Failure Indicators: Missing cleanup, shared store pollution
    Evidence: .sisyphus/evidence/task-9-stores.txt
  ```

  **Evidence to Capture:**
  - [ ] task-9-build.txt
  - [ ] task-9-stores.txt

  **Commit**: YES
  - Message: `feat(ui): add SelfReviewView component`
  - Files: `src/components/SelfReviewView.svelte`
  - Pre-commit: `pnpm build`

- [ ] 10. TaskDetailView Mode Toggle + onRunAction Wiring

  **What to do**:
  - Modify `src/components/TaskDetailView.svelte`:
    1. Add local state: `let reviewMode = $state(false)`
    2. Add mode toggle buttons in the header (next to the status badge):
       - "Code" button (active when `!reviewMode`) — shows current AgentPanel + TaskInfoPanel
       - "Review" button (active when `reviewMode`) — shows SelfReviewView
       - "Review" button only visible when task has a worktree (check via `getWorktreeForTask`)
    3. Conditional rendering in `.detail-body`:
       ```svelte
       {#if reviewMode}
         <SelfReviewView task={task} agentStatus={...} onSendToAgent={handleSendToAgent} />
       {:else}
         <div class="left-column"><AgentPanel .../></div>
         <div class="divider"></div>
         <div class="right-column"><TaskInfoPanel .../></div>
       {/if}
       ```
    4. Determine `agentStatus` from `activeSessions` store — look up session for this task
  - Add `onRunAction` prop to TaskDetailView:
    - Type: `(data: { taskId: string; actionPrompt: string; agent: string | null }) => void`
    - `handleSendToAgent` in this component calls `onRunAction({ taskId: task.id, actionPrompt: prompt, agent: null })`
  - Modify `src/App.svelte`:
    - Pass `onRunAction={handleRunAction}` to `<TaskDetailView>` (same handler used by KanbanBoard)
    - The `handleRunAction` function already exists in App.svelte

  **Must NOT do**:
  - Do NOT auto-switch to review mode
  - Do NOT show the toggle when there's no worktree
  - Do NOT add new Kanban columns or status changes

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Modifying two existing components (TaskDetailView + App.svelte), threading callbacks, conditional rendering
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: Toggle button styling, conditional layout swapping
  - **Skills Evaluated but Omitted**:
    - `playwright`: No browser testing here

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with T11)
  - **Blocks**: T13 (frontend tests)
  - **Blocked By**: T9 (SelfReviewView must exist)

  **References**:

  **Pattern References**:
  - `src/components/TaskDetailView.svelte:38-62` — Current detail-body layout that gets wrapped in conditional
  - `src/components/TaskDetailView.svelte:44-50` — Header info section where toggle buttons should go
  - `src/App.svelte` search for `handleRunAction` — Existing function that handles runAction calls
  - `src/App.svelte:419-420` — Where `<TaskDetailView task={selectedTask} />` is rendered — add `onRunAction` prop here

  **API/Type References**:
  - `src/lib/stores.ts:9` — `activeSessions` store — look up agent session status for this task
  - `src/lib/ipc.ts` — `getWorktreeForTask(taskId)` — check if worktree exists for toggle visibility

  **WHY Each Reference Matters**:
  - TaskDetailView layout is the exact code being modified — understand current structure
  - App.svelte handleRunAction is the callback to thread through — must match its signature
  - activeSessions store needed to determine agent status (for stale-diff banner + disable send button)

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Mode toggle renders and switches views
    Tool: Bash (pnpm build)
    Preconditions: TaskDetailView modified, SelfReviewView exists
    Steps:
      1. Verify "Code" and "Review" toggle buttons exist in header
      2. Verify conditional rendering: reviewMode=false shows AgentPanel+TaskInfoPanel
      3. Verify conditional rendering: reviewMode=true shows SelfReviewView
      4. Run `pnpm build`
    Expected Result: Clean build, toggle logic present
    Failure Indicators: Type errors on new props, missing imports, layout break
    Evidence: .sisyphus/evidence/task-10-build.txt

  Scenario: onRunAction prop threaded from App.svelte
    Tool: Bash (grep)
    Preconditions: Both TaskDetailView and App.svelte modified
    Steps:
      1. Grep App.svelte for `onRunAction` prop on TaskDetailView
      2. Verify TaskDetailView declares onRunAction in Props interface
      3. Verify handleSendToAgent calls onRunAction with correct shape
    Expected Result: Callback chain: App → TaskDetailView → SelfReviewView → SendToAgentPanel
    Failure Indicators: Missing prop, wrong signature, broken chain
    Evidence: .sisyphus/evidence/task-10-wiring.txt
  ```

  **Evidence to Capture:**
  - [ ] task-10-build.txt
  - [ ] task-10-wiring.txt

  **Commit**: YES (groups with T11)
  - Message: `feat(ui): integrate review mode in TaskDetailView with GitHub PR comments`
  - Files: `src/components/TaskDetailView.svelte`, `src/App.svelte`
  - Pre-commit: `pnpm build`

- [ ] 11. GitHub PR Comments Sidebar in Review View

  **What to do**:
  - Enhance `SelfReviewView.svelte` to show GitHub PR comments when a task has linked PRs:
    1. On mount, check `ticketPrs` store for this task's PRs
    2. If PRs exist, find the most recently updated open PR
    3. Fetch its review comments via `getReviewComments(pr.repo_owner, pr.repo_name, pr.id)`
    4. Display in the GeneralCommentsSidebar area (or a separate section above/below general comments)
  - GitHub comments section:
    - Header: "GitHub PR Comments" with PR number badge
    - Each comment shows: author, file path reference, body
    - Comments are read-only (no "Mark Addressed" here — that's in TaskInfoPanel)
    - Link to "View on GitHub" for the PR
  - If no PR linked: don't show this section at all
  - If PR exists but no comments: show "No review comments on this PR yet"

  **Must NOT do**:
  - Do NOT inject GitHub comments inline on the diff (line numbers may mismatch between local and GitHub diffs)
  - Do NOT add "Mark Addressed" functionality here (that lives in TaskInfoPanel)
  - Do NOT fetch PR diffs from GitHub (we use local git diff)
  - Do NOT modify the existing PR Review tab

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Integration task connecting existing data (ticketPrs store, review comments IPC) into the review view
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: Comment display layout within the sidebar

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with T10)
  - **Blocks**: T13 (frontend tests)
  - **Blocked By**: T6 (comment commands exist), T9 (SelfReviewView exists to enhance)

  **References**:

  **Pattern References**:
  - `src/components/TaskInfoPanel.svelte:186-228` — PR Comments section: iterating comments, showing author/file_path/body. Reuse this card pattern.
  - `src/components/TaskInfoPanel.svelte:32-44` — `loadPrComments()` function: how to fetch comments for task-linked PRs

  **API/Type References**:
  - `src/lib/stores.ts:11` — `ticketPrs: Map<string, PullRequestInfo[]>` — task-to-PR mapping
  - `src/lib/types.ts:55-65` — `PullRequestInfo` — has `id` (which is PR number), `repo_owner`, `repo_name`
  - `src/lib/ipc.ts` — `getReviewComments(owner, repo, prNumber)` — fetches inline review comments

  **WHY Each Reference Matters**:
  - TaskInfoPanel already fetches and displays PR comments — reuse the same data fetching pattern
  - `ticketPrs` store is the bridge between tasks and their GitHub PRs
  - `PullRequestInfo.id` is the GitHub PR number (confirmed in github_poller.rs)

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: GitHub comments section renders when PR exists
    Tool: Bash (pnpm build)
    Preconditions: SelfReviewView enhanced with GitHub comment section
    Steps:
      1. Verify SelfReviewView checks ticketPrs store for task PRs
      2. Verify conditional rendering: section hidden when no PR
      3. Verify comment cards show author, file path, body
      4. Run `pnpm build`
    Expected Result: Component compiles, conditional section present
    Failure Indicators: Type errors, missing store access, always-visible section
    Evidence: .sisyphus/evidence/task-11-build.txt

  Scenario: No PR linked shows no GitHub section
    Tool: Bash (grep)
    Preconditions: Component enhanced
    Steps:
      1. Verify conditional check: `{#if taskPrs.length > 0}` or similar
      2. Verify the section is fully hidden (not just empty state) when no PR
    Expected Result: Clean conditional, no empty section rendered
    Failure Indicators: Empty section visible, unconditional rendering
    Evidence: .sisyphus/evidence/task-11-no-pr.txt
  ```

  **Evidence to Capture:**
  - [ ] task-11-build.txt
  - [ ] task-11-no-pr.txt

  **Commit**: YES (groups with T10)
  - Message: `feat(ui): integrate review mode in TaskDetailView with GitHub PR comments`
  - Files: `src/components/SelfReviewView.svelte`
  - Pre-commit: `pnpm build`

- [ ] 12. Rust Tests

  **What to do**:
  - Add comprehensive tests for all new Rust code:
  - **Diff parser tests** (in `diff_parser.rs` `#[cfg(test)] mod tests`):
    - `test_parse_multi_file_diff` — 3 files (added, modified, deleted), verify count + status + patch content
    - `test_parse_empty_diff` — empty input returns empty Vec
    - `test_parse_binary_file` — "Binary files ... differ" → patch=None, status="binary"
    - `test_parse_renamed_file` — rename from/to → previous_filename set, status="renamed"
    - `test_parse_additions_deletions_count` — verify +/- line counting is accurate
  - **DB tests** (in `db.rs` `#[cfg(test)] mod tests`):
    - `test_self_review_comment_crud` — insert inline + general, query, delete
    - `test_archive_self_review_comments` — insert, archive, verify archived_at set, new round works
    - `test_get_archived_returns_latest_round` — multiple archive rounds, only latest returned
    - `test_delete_nonexistent_comment` — no panic on invalid ID
  - Run all tests: `cargo test`

  **Must NOT do**:
  - Do NOT modify existing tests
  - Do NOT add integration tests that require a running Tauri app

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Multiple test suites across two files, edge case coverage, test data construction
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5 (with T13)
  - **Blocks**: T14 (build verification)
  - **Blocked By**: T5 (get_task_diff), T6 (comment commands)

  **References**:

  **Pattern References**:
  - `src-tauri/src/db.rs` bottom — `#[cfg(test)] mod tests` with `make_test_db` helper, `fs::remove_file` cleanup
  - Existing Rust tests in db.rs — follow the same pattern: create temp DB, test operations, clean up

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: All Rust tests pass
    Tool: Bash (cargo test)
    Preconditions: All test functions added
    Steps:
      1. Run `cargo test -p ai-command-center -- --nocapture`
      2. Assert: 0 failures
      3. Assert: new tests appear in output (test_parse_multi_file_diff, test_self_review_comment_crud, etc.)
    Expected Result: All tests pass, including new ones
    Failure Indicators: Any test failure, compilation error
    Evidence: .sisyphus/evidence/task-12-rust-tests.txt

  Scenario: Edge cases handled
    Tool: Bash (cargo test)
    Preconditions: Edge case tests added
    Steps:
      1. Run `cargo test -p ai-command-center test_parse_empty_diff -- --nocapture`
      2. Run `cargo test -p ai-command-center test_parse_binary_file -- --nocapture`
      3. Run `cargo test -p ai-command-center test_delete_nonexistent_comment -- --nocapture`
      4. All should pass
    Expected Result: Edge cases handled gracefully
    Failure Indicators: Panic, unexpected error
    Evidence: .sisyphus/evidence/task-12-edge-cases.txt
  ```

  **Evidence to Capture:**
  - [ ] task-12-rust-tests.txt
  - [ ] task-12-edge-cases.txt

  **Commit**: YES (groups with T13)
  - Message: `test: add self-review tests (Rust + frontend)`
  - Files: `src-tauri/src/diff_parser.rs`, `src-tauri/src/db.rs`
  - Pre-commit: `cargo test`

- [ ] 13. Frontend Tests

  **What to do**:
  - Add comprehensive frontend tests:
  - **reviewPrompt.test.ts** (`src/lib/reviewPrompt.test.ts`):
    - `compiles prompt with inline and general comments` — 2 inline + 2 general, verify both sections
    - `handles inline-only` — no general → no "General Feedback" section
    - `handles general-only` — no inline → no "Code Comments" section
    - `returns empty string for no comments` — both empty
    - `handles special characters in comment body` — backticks, quotes, newlines preserved
  - **SelfReviewView.test.ts** (`src/components/SelfReviewView.test.ts`):
    - `renders loading state while diff loads` — mock getTaskDiff to be slow, verify spinner
    - `renders empty state when no changes` — mock getTaskDiff returning [], verify message
    - `renders error state on diff failure` — mock getTaskDiff to throw, verify error display
    - `clears stores on mount` — verify pendingManualComments cleared
  - **TaskDetailView.test.ts** (`src/components/TaskDetailView.test.ts` — extend existing or create):
    - `shows Review toggle when worktree exists` — mock getWorktreeForTask, verify button
    - `hides Review toggle when no worktree` — mock getWorktreeForTask returning null, verify no button
    - `toggles between Code and Review modes` — click toggle, verify correct component rendered
  - Mock IPC functions with `vi.mock('../lib/ipc', ...)`
  - Use typed fixture objects following existing test patterns

  **Must NOT do**:
  - Do NOT modify existing test files
  - Do NOT add Playwright/browser tests — vitest component tests only

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Multiple test files, mocking IPC + stores, component rendering tests
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5 (with T12)
  - **Blocks**: T14 (build verification)
  - **Blocked By**: T9 (SelfReviewView), T10 (TaskDetailView toggle), T11 (GitHub sidebar)

  **References**:

  **Pattern References**:
  - `src/components/Toast.test.ts` — Existing component test pattern: import render/screen/fireEvent, describe/it/expect, typed fixtures
  - `src/__mocks__/@tauri-apps/api/` — Tauri API mock location
  - Existing test files — `vi.mock('../lib/ipc', () => ({ fn: vi.fn() }))` pattern

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: All frontend tests pass
    Tool: Bash (pnpm vitest)
    Preconditions: All test files created
    Steps:
      1. Run `pnpm vitest run`
      2. Assert: 0 failures
      3. Assert: new test files appear in output
    Expected Result: All tests pass, no regressions
    Failure Indicators: Test failures, missing mocks, import errors
    Evidence: .sisyphus/evidence/task-13-frontend-tests.txt
  ```

  **Evidence to Capture:**
  - [ ] task-13-frontend-tests.txt

  **Commit**: YES (groups with T12)
  - Message: `test: add self-review tests (Rust + frontend)`
  - Files: `src/lib/reviewPrompt.test.ts`, `src/components/SelfReviewView.test.ts`, `src/components/TaskDetailView.test.ts`
  - Pre-commit: `pnpm vitest run`

- [ ] 14. Build Verification + Integration Check

  **What to do**:
  - Run full build pipeline and verify everything works together:
    1. `cargo build` — Rust backend compiles
    2. `cargo test` — All Rust tests pass (including new diff parser + DB tests)
    3. `pnpm build` — Frontend builds (TypeScript compilation + Vite bundle)
    4. `pnpm vitest run` — All frontend tests pass
  - Verify no regressions:
    - Check that existing PR Review tab components are UNMODIFIED: `DiffViewer.svelte`, `FileTree.svelte`, `PrReviewView.svelte`, `ReviewSubmitPanel.svelte`
    - Check no new TypeScript errors in existing files
    - Check no new Rust warnings in existing modules
  - Verify new files exist:
    - `src-tauri/src/diff_parser.rs`
    - `src/lib/reviewPrompt.ts`
    - `src/components/SelfReviewView.svelte`
    - `src/components/GeneralCommentsSidebar.svelte`
    - `src/components/SendToAgentPanel.svelte`

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Just running build commands and checking output
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 6 (solo, after all implementation + tests)
  - **Blocks**: Final Verification Wave
  - **Blocked By**: T12, T13

  **References**:
  - AGENTS.md Build & Run Commands section — all build/test commands

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Full build + test pipeline passes
    Tool: Bash
    Preconditions: All implementation and test tasks complete
    Steps:
      1. Run `cargo build` — assert exit code 0
      2. Run `cargo test` — assert 0 failures
      3. Run `pnpm build` — assert exit code 0
      4. Run `pnpm vitest run` — assert 0 failures
    Expected Result: All four commands succeed
    Failure Indicators: Any non-zero exit code
    Evidence: .sisyphus/evidence/task-14-full-build.txt

  Scenario: Protected files are unmodified
    Tool: Bash (git diff)
    Preconditions: All changes committed
    Steps:
      1. Run `git diff origin/main -- src/components/DiffViewer.svelte` — assert empty
      2. Run `git diff origin/main -- src/components/FileTree.svelte` — assert empty
      3. Run `git diff origin/main -- src/components/PrReviewView.svelte` — assert empty
      4. Run `git diff origin/main -- src/components/ReviewSubmitPanel.svelte` — assert empty
    Expected Result: All four files unchanged
    Failure Indicators: Any diff output = guardrail violation
    Evidence: .sisyphus/evidence/task-14-protected-files.txt
  ```

  **Evidence to Capture:**
  - [ ] task-14-full-build.txt
  - [ ] task-14-protected-files.txt

  **Commit**: NO (verification only)

---

## Final Verification Wave

> 4 review agents run in PARALLEL. ALL must APPROVE. Rejection → fix → re-run.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `pnpm build` + `cargo build` + `pnpm vitest` + `cargo test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp). Verify DiffViewer.svelte, FileTree.svelte, PrReviewView.svelte, ReviewSubmitPanel.svelte are UNMODIFIED.
  Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill if needed)
  Start the app with `pnpm tauri:dev`. Create a task, run an action to create a worktree. Open task detail. Toggle to Review mode. Verify diff loads. Add inline comments on diff lines. Add general comment cards. Click "Send to Agent". Verify prompt includes all comments. Verify comments archive. Refresh diff. Test edge cases: no worktree (empty state), agent running (stale banner), empty diff.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built, nothing beyond spec was built. Check "Must NOT do" compliance — specifically verify DiffViewer/FileTree/PrReviewView/ReviewSubmitPanel are untouched. Detect cross-task contamination. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

| After Task(s) | Message | Key Files | Verification |
|---------------|---------|-----------|--------------|
| T1, T2 | `feat(backend): add diff parser and self-review DB schema` | diff_parser.rs, db.rs | `cargo build` |
| T3, T4 | `feat(frontend): add self-review types, stores, IPC, prompt compiler` | types.ts, stores.ts, ipc.ts, reviewPrompt.ts | `pnpm build` |
| T5, T6 | `feat(backend): add get_task_diff and self-review comment commands` | main.rs | `cargo build` |
| T7, T8 | `feat(ui): add GeneralCommentsSidebar and SendToAgentPanel components` | *.svelte | `pnpm build` |
| T9 | `feat(ui): add SelfReviewView component` | SelfReviewView.svelte | `pnpm build` |
| T10, T11 | `feat(ui): integrate review mode in TaskDetailView with GitHub PR comments` | TaskDetailView.svelte, App.svelte | `pnpm build` |
| T12, T13 | `test: add self-review tests (Rust + frontend)` | *.test.ts, db.rs, diff_parser.rs | `pnpm vitest && cargo test` |
| T14 | `chore: verify full build` | — | `pnpm build && cargo build` |

---

## Success Criteria

### Verification Commands
```bash
cargo build              # Expected: compiles without errors
cargo test               # Expected: all tests pass including new diff parser + DB tests
pnpm build               # Expected: builds without errors
pnpm vitest              # Expected: all tests pass including new component + prompt tests
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent (especially: DiffViewer/FileTree/PrReviewView/ReviewSubmitPanel UNMODIFIED)
- [ ] All tests pass
- [ ] Review mode toggle visible in TaskDetailView header
- [ ] Diff loads from local git (no GitHub dependency)
- [ ] Inline + general comments collected
- [ ] "Send to Agent" compiles prompt and triggers agent
- [ ] Comments archived per round
- [ ] GitHub PR comments shown in sidebar when PR linked
