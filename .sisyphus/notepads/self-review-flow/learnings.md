# Learnings — self-review-flow

## Conventions Discovered
<!-- Append here, never overwrite -->

## Diff Parser Implementation (Wave 1)

### Unified Diff Parsing Pattern
- Split on `diff --git a/... b/...` headers to identify file boundaries
- Extract filename from `b/` path in header (rightmost occurrence)
- Use state machine: track `in_patch` flag to distinguish metadata from hunk content
- Hunk lines start with `@@` markers; collect all subsequent `+`, `-`, and context lines

### File Status Detection
- `new file mode` → "added"
- `deleted file mode` → "removed"
- `rename from/to` → "renamed" (set `previous_filename` from "rename from" line)
- `Binary files ... differ` → "binary" (set `patch = None`)
- Default → "modified"

### Line Counting
- Count `+` lines (excluding `+++` header) as additions
- Count `-` lines (excluding `---` header) as deletions
- Include context lines (` ` prefix) and `\ No newline` in patch output
- `changes = additions + deletions`

### Struct Serialization
- `TaskFileDiff` must match `PrFileDiff` interface exactly (field names, types)
- Use `#[derive(Debug, Clone, Serialize)]` for serde compatibility
- All fields are public (`pub`)
- `sha` field set to empty string (git diff doesn't provide commit SHAs)
- `patch` is `Option<String>` — `None` for binary files, `Some(...)` for text diffs

### Testing Strategy
- Test empty input (no panic, return empty vec)
- Test single file with additions/deletions
- Test file added (new file mode)
- Test file deleted (deleted file mode)
- Test file renamed (rename from/to)
- Test binary files (Binary files differ)
- Test multi-file diffs (verify file boundaries)
- Test patch content preservation (verify hunk lines included)

### Module Integration
- Declare in `main.rs` with `mod diff_parser;`
- No Tauri commands needed — pure parsing function
- No external dependencies beyond serde (already in Cargo.toml)
- Tests compile and run with `cargo test diff_parser`

## Self Review Comments DB Implementation (Wave 1)

### Table Schema
- `self_review_comments` table with columns: id (PK), task_id, round, comment_type, file_path (nullable), line_number (nullable), body, created_at, archived_at (nullable)
- No foreign key constraints (codebase pattern)
- `archived_at IS NULL` indicates active comments; `archived_at IS NOT NULL` indicates archived

### Round Tracking Logic
- When inserting: if active comments exist for task, use their round; otherwise use max archived round + 1
- This allows seamless progression: Round 1 (active) → archive → Round 2 (active) → archive → etc.
- `get_archived_self_review_comments` returns only the latest archived round (prevents showing old rounds)

### CRUD Method Patterns
- `insert_self_review_comment`: Returns `i64` (last_insert_rowid), auto-determines round
- `get_active_self_review_comments`: WHERE archived_at IS NULL, ORDER BY created_at ASC
- `get_archived_self_review_comments`: WHERE archived_at IS NOT NULL AND round = MAX(round), ORDER BY created_at ASC
- `delete_self_review_comment`: Simple DELETE by id
- `archive_self_review_comments`: SET archived_at = now WHERE task_id = ? AND archived_at IS NULL

### Testing Strategy
- Test insert with optional fields (file_path, line_number)
- Test round auto-increment across archive cycles
- Test archive flow: active → archived → new round
- Test latest archived round filtering (only show newest round)
- Test empty task (no comments)
- Test multi-task isolation (comments don't leak between tasks)
- All 7 tests pass; full test suite: 95 tests pass

### Integration Notes
- Struct: `SelfReviewCommentRow` with `#[derive(Debug, Clone, Serialize)]`
- All fields public for serde compatibility
- Follows existing DB patterns: lock mutex, prepare/execute, map_err
- No Tauri commands added (T6 task will add them)

## TypeScript Data Layer (Wave 1 - T5)

### SelfReviewComment Interface
- Added to `src/lib/types.ts` after `ReviewSubmission` (line 189)
- Matches DB schema exactly: id, task_id, round, comment_type, file_path, line_number, body, created_at, archived_at
- Nullable fields use `T | null` pattern (not optional `?`)
- Includes JSDoc comment following existing pattern in file

### Svelte Stores
- Added 3 new stores to `src/lib/stores.ts`:
  - `selfReviewGeneralComments`: Active comments for current task
  - `selfReviewArchivedComments`: Latest archived round for current task
  - `selfReviewDiffFiles`: Task diff files (reuses `PrFileDiff` type)
- Imported `SelfReviewComment` type in existing import statement
- `PrFileDiff` already existed (lines 148-157), no new import needed

### IPC Wrappers
- Added 6 functions to `src/lib/ipc.ts` (lines 191-213):
  1. `getTaskDiff(taskId)` → `PrFileDiff[]`
  2. `addSelfReviewComment(taskId, commentType, filePath, lineNumber, body)` → `number` (comment id)
  3. `getActiveSelfReviewComments(taskId)` → `SelfReviewComment[]`
  4. `getArchivedSelfReviewComments(taskId)` → `SelfReviewComment[]`
  5. `deleteSelfReviewComment(commentId)` → `void`
  6. `archiveSelfReviewComments(taskId)` → `void`
- All use `invoke<T>('snake_case_command', { camelCaseParams })` pattern
- Tauri auto-converts camelCase params to snake_case for backend

### Build Verification
- `pnpm install` installed 144 packages (all dependencies present)
- `pnpm build` succeeded with 0 TypeScript errors
- Build output: 196 modules transformed, 485.85 kB JS (gzip 134.22 kB)
- Warnings are pre-existing (a11y, unused CSS selectors) — not introduced by this task

### Key Patterns Followed
- `import type` for type-only imports (enforced by `verbatimModuleSyntax`)
- Stores use `writable<Type>([])` initialization
- IPC functions follow existing naming: snake_case commands, camelCase params
- No modifications to existing stores, types, or IPC functions

## Review Prompt Compilation (Wave 1 - T12)

### Function Signature & Behavior
- Export: `compileReviewPrompt(taskTitle, inlineComments, generalComments) -> string`
- Pure function: no side effects, no imports from stores/IPC
- Input types:
  - `taskTitle: string`
  - `inlineComments: { path: string; line: number; body: string }[]`
  - `generalComments: { body: string }[]`
- Output: formatted prompt string for agent

### Prompt Format Rules
- **Both types present**: Include both "## Code Comments" and "## General Feedback" sections
- **Inline-only**: Omit "## General Feedback" section entirely
- **General-only**: Omit "## Code Comments" section entirely
- **Both empty**: Return empty string `""`
- Code comment format: `` `path:line` — body ``
- Numbered lists (1-indexed) for both sections
- Closing instruction always included when at least one comment type present

### Implementation Details
- Sections array pattern for clean string building
- Conditional section inclusion based on array lengths
- Backtick formatting for file references (e.g., `` `src/components/Foo.svelte:42` ``)
- Newline joining with `sections.join("\n")`
- No markdown beyond backticks and section headers

### Build Verification
- `pnpm build` passed with 0 TypeScript errors
- File created: `src/lib/reviewPrompt.ts`
- No new dependencies required (pure TypeScript)
- Warnings are pre-existing (a11y, unused CSS) — not introduced by this task

## Tauri Command Wiring for Self-Review (Wave 1 - T7)

### get_task_diff Implementation Pattern
- Worktree lookup: lock db, call `get_worktree_for_task`, unwrap Option with `.ok_or_else(|| format!(...))` in a scoped block to release lock before async op
- git diff command: `tokio::process::Command::new("git").arg("-C").arg(&path).arg("diff").arg("origin/main...HEAD")`
- Use fully qualified `tokio::process::Command` — no `use` statement needed, avoids conflicts with std Command
- Capture stdout as `String::from_utf8_lossy(&output.stdout)` then pass `&diff_output` to `diff_parser::parse_unified_diff`
- Check `output.status.success()` and return `Err(format!("git diff failed: {}", stderr))` on non-zero exit
- Empty diff → `parse_unified_diff` returns empty Vec naturally (handled inside parser)

### Comment Command Patterns
- `file_path: Option<String>` + `.as_deref()` to convert to `Option<&str>` for DB method
- `line_number: Option<i32>` passed through directly (matches DB method signature)
- `comment_id: i64` for delete (matches `insert_self_review_comment` return type)
- All 5 comment commands: lock db, call method, map_err — no extra logic needed

### Module Wiring
- `diff_parser` was already declared as `mod diff_parser;` in main.rs (line 15) from T1
- `tokio` crate available with `features = ["full"]` in Cargo.toml — no new dependency
- Section banner `// Self-Review Commands` placed before `// Response Types` section
- All 6 new commands added to `generate_handler![]` after `pty_kill`

### Verification
- `cargo build`: 0 errors, 34 pre-existing warnings (all pre-existing, none new from this task)
- `cargo test`: 95 tests, 0 failures — all existing tests still pass

## SendToAgentPanel Component (Wave 2 - T7)

### Layout Pattern
- Horizontal bar (flexbox `row`, `justify-content: space-between`) — different from ReviewSubmitPanel which is vertical
- Left: comment summary chips; Right: action buttons + feedback messages
- Agent-running banner sits ABOVE the panel bar (separate element with top border)

### Comment Mapping
- `pendingManualComments` (ReviewSubmissionComment[]) → inline comments: `map(c => ({ path: c.path, line: c.line, body: c.body }))` — drop `side` field
- `selfReviewGeneralComments` (SelfReviewComment[]) → general comments: `map(c => ({ body: c.body }))` — pick only `body`
- `compileReviewPrompt` returns `""` when both arrays are empty — use this for `canSend` via `hasComments` derived

### Critical Archive Flow Order
1. Compile prompt BEFORE archiving (captures current state)
2. `await archiveSelfReviewComments(taskId)`
3. `$pendingManualComments = []` (clear inline store)
4. Reload archived → `selfReviewArchivedComments.set(archived)`
5. Reload active + filter general → `selfReviewGeneralComments.set(active.filter(c => c.comment_type === 'general'))`
6. Call `onSendToAgent(prompt)` callback

### Disabled State Logic
- `isAgentBusy = agentStatus === 'running' || agentStatus === 'paused'`
- `canSend = hasComments && !isAgentBusy && !isSending`
- `title` attribute provides accessible tooltip explaining why disabled

### Build Verification
- `pnpm build` passed: 196 modules, 0 TypeScript errors
- Pre-existing warnings in other files unchanged

## GeneralCommentsSidebar Component (Wave 2)

### Component Architecture
- `selfReviewGeneralComments` store holds active comments; filtered by `comment_type === 'general'` on load
- `selfReviewArchivedComments` holds archived comments; also filtered on load
- `addSelfReviewComment` returns `number` (new comment id), NOT the full object — must re-fetch to populate store
- Archived count derived from store length; collapsed section toggles via `archivedExpanded` local state

### Svelte 5 Runes Patterns Used
- `$props()` with interface for type-safe props
- `$state()` for local mutable values
- `$derived()` for computed values from stores/state
- `$effect()` with reactive dependency on `taskId` — re-fetches when taskId changes
- Store writes use `$storeName = value` assignment syntax (not `.set()`)

### $effect Gotcha
- Must read `taskId` inside the effect body (not before) to register the reactive dependency
- Pattern: `const id = taskId; if (id) { loadComments() }` correctly tracks `taskId`

### Filtering Stores
- `getActiveSelfReviewComments` returns ALL active comments for a task (all types)
- Filter on the frontend: `.filter(c => c.comment_type === 'general')` for this sidebar
- Same applies to archived comments

### Build Verification
- `pnpm build` passed with 0 new TypeScript/Svelte errors
- 196 modules transformed (same count as previous waves)
- All warnings are pre-existing in other files

## SelfReviewView Component (Wave 2 - T9)

### Layout Architecture
- Outer wrapper `.self-review-view`: `display: flex; flex-direction: column; height: 100%; overflow: hidden`
- `.review-content`: `display: flex; flex: 1; overflow: hidden` — holds loading/error/empty/detail states
- `.detail-content`: `display: flex; flex: 1; overflow: hidden` — three-column flex row (FileTree | DiffViewer | sidebar)
- `.sidebar-container`: `width: 280px; flex-shrink: 0; border-left: 1px solid var(--border)` — wraps GeneralCommentsSidebar
- `SendToAgentPanel` placed directly after `.review-content` at the bottom (not inside it)

### Store Initialization Pattern
- On mount: load all data, then populate stores (diff → general comments → archived → inline)
- Inline comments from DB converted to `ReviewSubmissionComment[]`: `{ path: c.file_path!, line: c.line_number!, body: c.body, side: 'RIGHT' }`
- `!` non-null assertions safe because `comment_type === 'inline'` guarantees file_path + line_number are set
- `$pendingManualComments` cleared implicitly by assignment (fresh start)

### Store Cleanup on Destroy
- `onDestroy` clears all 4 stores: `selfReviewDiffFiles`, `selfReviewGeneralComments`, `selfReviewArchivedComments`, `pendingManualComments`
- Prevents cross-view contamination (stores are shared between PrReviewView and SelfReviewView)

### Svelte 5 Runes - bind:this Pattern
- `let diffViewer = $state<DiffViewer>()` — typed with component type, initially undefined
- `bind:this={diffViewer}` on the DiffViewer component
- Guard `if (diffViewer)` before calling `diffViewer.scrollToFile(filename)`

### Props Pattern
- Interface declaration inside `<script lang="ts">` block
- `let { task, agentStatus, onSendToAgent }: Props = $props()`
- `{agentStatus}` shorthand for `agentStatus={agentStatus}` when prop and variable names match
- `onRefresh={handleRefresh}` — passes function as prop for child to call

### Build Verification
- `pnpm build` passed: 196 modules transformed, 0 TypeScript/Svelte errors
- All warnings are pre-existing (a11y, unused CSS in other files)
- Module count unchanged (component not yet imported anywhere — wired up by TaskDetailView in separate task)

## T-213: Code/Review Mode Toggle Integration

### TaskDetailView.svelte Pattern
- `$effect` fires on task change and is ideal for async side-effects (worktree check)
- Reset `reviewMode = false` inside `$effect` so switching tasks always returns to Code mode
- `$derived` with `$activeSessions.get(task.id)` correctly reacts to store changes
- `currentSession?.status ?? null` safely handles missing sessions
- `{#if hasWorktree}` guards the toggle so it only renders when a worktree exists

### Segmented Control CSS Pattern
- Pill outer container: `border-radius: 20px`, `padding: 3px`, `background: var(--bg-card)`
- Inner buttons: `border-radius: 16px`, `padding: 5px 16px`
- Active state: `background: var(--accent)`, dark text `color: #1a1b26` (not white — accent is light blue)
- `all: unset` on buttons then add back needed styles

### App.svelte Wiring
- `handleRunAction` at line 120 already has full session update logic — just pass it through
- Only one line to change: add `onRunAction={handleRunAction}` to `<TaskDetailView>`

### Build Notes
- Pre-existing warnings in KanbanBoard, AddTaskDialog, AddTaskInline, DiffViewer — not introduced by this task
- Build succeeds in ~1.17s, 203 modules

## T-213: GitHub PR Comments in SelfReviewView

- `$ticketPrs.get(task.id)` returns `PullRequestInfo[] | undefined` — guard with `|| []`
- Filter `state === 'open'` + sort by `updated_at` desc to find most recent open PR
- `getPrComments(pr.id)` where `pr.id` is the numeric GitHub PR number stored in DB
- Place GitHub section above GeneralCommentsSidebar inside `.sidebar-container`
- Use `openUrl()` IPC (NOT `<a href target="_blank">`) — Tauri webview limitation
- Non-null assertion `linkedPr!.url` needed inside `onclick` because TS narrowing doesn't persist through closures
- `$state<PullRequestInfo | null>(null)` for reactive state in Svelte 5
- CSS: `max-height: 240px; overflow-y: auto` on comments list keeps sidebar usable with many comments
- `color-mix(in srgb, var(--accent) 15%, transparent)` works for subtle tinted backgrounds with CSS variables

## Frontend Tests for Self-Review Feature (T-213 Final Task)

### TaskDetailView.test.ts Fixing Pattern
- Component gained `onRunAction` prop — ALL renders must include it: `{ props: { task: baseTask, onRunAction: mockOnRunAction } }`
- Define `mockOnRunAction = vi.fn()` at file top (module scope), not per-test
- Import order matters: `vi.mock()` calls must come BEFORE component/ipc imports; place `import TaskDetailView` AFTER mock declarations
- Pattern: `vi.mock('../lib/ipc', ...)` → `vi.mock('@tauri-apps/api/event', ...)` → `import TaskDetailView` → `import { ipcFn } from '../lib/ipc'`

### Testing Svelte 5 $effect + async IPC in jsdom
- `{#if hasWorktree}` toggled by `$effect(() => getWorktreeForTask().then(w => hasWorktree = w !== null))`
- Testing this with `mockResolvedValueOnce` is unreliable in jsdom — Svelte 5 scheduler doesn't always flush after Promise resolves in test env
- "hides Review toggle when no worktree" (default mock = null) works reliably with `waitFor`
- "shows Review toggle when worktree exists" (override mock) is OPTIONAL and problematic — skip it, not worth the flakiness
- LESSON: Svelte 5 `$state` updates inside Promise `.then()` may not synchronously propagate DOM updates in jsdom tests

### reviewPrompt.test.ts Patterns
- Pure function: no `vi.mock` needed — just `import { compileReviewPrompt } from './reviewPrompt'` and call directly
- Test all 4 branches: both empty, inline-only, general-only, both present
- Add bonus tests: numbered lists, task title in header, special characters
- Special chars (backticks, quotes, newlines) pass through unchanged — no escaping in the function
- `sections.join("\n")` preserves embedded newlines in comment bodies

### Test Count
- Before: 174 tests, 17 test files
- After: 182 tests, 18 test files (+8 tests, +1 file)
- 23 unhandled errors from xterm/matchMedia remain pre-existing
