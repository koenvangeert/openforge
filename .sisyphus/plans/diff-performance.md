# T-216: Git Diff Performance Overhaul

## TL;DR

> **Quick Summary**: Replace diff2html (which dumps megabytes of innerHTML with zero virtualization) with `@git-diff-view/svelte` — a purpose-built GitHub-style diff viewer with collapsed context lines, declarative Svelte 5 rendering, Web Worker support, and native inline comment APIs. Fixes both SelfReview and PrReview views.
> 
> **Deliverables**:
> - New `DiffViewer.svelte` using `@git-diff-view/svelte` `<DiffView>` component
> - Data adapter: `PrFileDiff[]` → `@git-diff-view` format
> - ExtendData builder: comments → per-file inline annotations
> - Comment snippets (display + input widgets) for both view types
> - Tokyo Night dark theme CSS overrides
> - Vitest tests for adapter utilities
> - diff2html fully removed
> 
> **Estimated Effort**: Medium
> **Parallel Execution**: YES — 5 waves
> **Critical Path**: Task 1 → Task 4 → Task 6/7 → Task 10

---

## Context

### Original Request
> The performance of the git diff is abysmal — find a solution for it but I still want a GitHub-like experience.

### Interview Summary
**Key Discussions**:
- Scope: Both SelfReview AND PrReview diff views (they share the same DiffViewer component)
- Backend: Keep current `git diff` shell-out — frontend rendering is the bottleneck, not the backend
- Tests: After implementation (vitest), plus agent QA scenarios

**Research Findings**:
- diff2html has documented issues: #434 (excessive DOM 3458+ elements), #117 (OOM on 12MB), #89 (20-second Chrome freeze), #561 (stack overflow)
- Current code uses `matching: 'lines'` which diff2html docs explicitly warn causes slow/OOM
- The pipeline double-parses: Rust parses diff → JSON → frontend reconstructs unified diff string → diff2html parses again
- `container.innerHTML = html` dumps entire diff DOM at once — zero virtualization
- `attachLineHandlers()` does O(n) DOM mutations on every line number cell
- GitHub engineering blog (June 2023): naive render of 18K lines = 27s; after virtualization = <1s
- `@git-diff-view/svelte` is purpose-built for this: collapsed context, declarative Svelte 5, Web Worker, ExtendData API for comments

### Metis Review
**Identified Gaps** (addressed):
- **No virtual scrolling in @git-diff-view**: Library does NOT use virtual scrolling. Performance gain comes from collapsed context lines (unchanged lines are hidden by default) + declarative Svelte rendering + per-file components. Honest documentation required.
- **Svelte 5 Snippets, not function props**: `renderExtendLine` and `renderWidgetLine` are `Snippet<[{...}]>` types, requiring `{#snippet}` block syntax.
- **Svelte ≥5.2 required**: Library uses `{@attach}` syntax from Svelte 5.2. Must verify after install.
- **Import pure CSS**: Use `@git-diff-view/svelte/styles/diff-view-pure.css` (no Tailwind — project doesn't use it).
- **Shiki deferred**: Default Shiki themes are github-light/dark. Custom Tokyo Night highlighter is out of scope for MVP. Syntax highlighting without custom theme is acceptable.
- **hunks format validated**: Current patch reconstruction (`--- a/${f.filename}\n+++ b/${f.filename}\n${f.patch}`) is valid input for the library's parser.
- **SplitSide enum mapping**: Library uses `SplitSide.old = 1`, `SplitSide.new = 2` — must map to/from current `side: 'LEFT' | 'RIGHT'` strings.

---

## Work Objectives

### Core Objective
Replace diff2html with `@git-diff-view/svelte` to eliminate innerHTML-based rendering, reduce DOM node count by 90%+, and provide a GitHub-like diff experience with collapsed context, expandable hunks, and native inline comment support.

### Concrete Deliverables
- `src/lib/diffAdapter.ts` — Transform `PrFileDiff[]` to `@git-diff-view` data format
- `src/lib/diffComments.ts` — Build ExtendData objects from comment arrays
- `src/components/DiffViewer.svelte` — Complete rewrite using `<DiffView>` component
- `src/components/DiffViewerTheme.css` — Tokyo Night overrides for diff-view-pure.css
- Updated `src/components/SelfReviewView.svelte` — Wire new DiffViewer with local DB comments
- Updated `src/components/PrReviewView.svelte` — Wire new DiffViewer with GitHub API comments
- `src/lib/diffAdapter.test.ts` — Vitest tests for data adapter
- `src/lib/diffComments.test.ts` — Vitest tests for comment builder
- `package.json` — diff2html removed, @git-diff-view/svelte added

### Definition of Done
- [ ] `pnpm build` succeeds with zero errors
- [ ] `pnpm test` passes all new + existing tests
- [ ] Diff view renders files with collapsed context (not all lines)
- [ ] Split and unified view modes work
- [ ] Inline comments display correctly in both SelfReview and PrReview
- [ ] Comment form (add comment widget) works in both views
- [ ] No references to diff2html remain in codebase
- [ ] No `innerHTML` usage for diff rendering

### Must Have
- GitHub-like diff rendering with collapsed unchanged lines
- Split (side-by-side) and unified (line-by-line) view toggle
- Inline comment display for both self-review and PR review
- Comment input widget (add new inline comment)
- File tree navigation (scrollToFile)
- Dark theme compatible with existing Tokyo Night palette
- Pending comment display with delete capability

### Must NOT Have (Guardrails)
- NO virtual scrolling claims in code comments — performance is from collapsed context + declarative rendering
- NO @git-diff-view/shiki with custom Tokyo Night theme — out of scope, use default highlighting or none
- NO backend changes — keep current `git diff` shell-out and `diff_parser.rs`
- NO changes to `PrFileDiff` type or IPC layer — adapt in frontend only
- NO Monaco or CodeMirror dependencies
- NO manual DOM manipulation (no `innerHTML`, no `querySelectorAll`, no `document.createElement` for diff content)
- NO changes to comment storage (DB schema, GitHub API calls)

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (vitest + testing-library)
- **Automated tests**: Tests after implementation
- **Framework**: vitest
- **Scope**: Unit tests for adapter utilities; component tests deferred to Playwright QA

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Frontend/UI**: Use Playwright (playwright skill) — Navigate, interact, assert DOM, screenshot
- **Library/Module**: Use Bash (pnpm vitest) — Import, call functions, compare output

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — 3 parallel, start immediately):
├── Task 1: Install @git-diff-view/svelte + verify Svelte ≥5.2 + remove diff2html [quick]
├── Task 2: Data adapter utility (PrFileDiff → DiffView data) [quick]
└── Task 3: Comment ExtendData builder utility [quick]

Wave 2 (New Component — depends on Wave 1, 2 parallel):
├── Task 4: Rewrite DiffViewer.svelte with <DiffView> + comment snippets [visual-engineering]
└── Task 5: Tokyo Night theme CSS overrides [visual-engineering]

Wave 3 (Integration — depends on Wave 2, 2 parallel):
├── Task 6: Wire SelfReviewView.svelte with new DiffViewer [unspecified-high]
└── Task 7: Wire PrReviewView.svelte with new DiffViewer [unspecified-high]

Wave 4 (Tests & Cleanup — depends on Wave 3, 3 parallel):
├── Task 8: Vitest tests for adapters [quick]
├── Task 9: Remove diff2html, dead code cleanup [quick]
└── Task 10: Build verification + smoke test [quick]

Wave FINAL (Verification — 4 parallel):
├── Task F1: Plan compliance audit [oracle]
├── Task F2: Code quality review [unspecified-high]
├── Task F3: Real manual QA [unspecified-high]
└── Task F4: Scope fidelity check [deep]

Critical Path: Task 1 → Task 4 → Task 6/7 → Task 10 → F1-F4
Parallel Speedup: ~60% faster than sequential
Max Concurrent: 3 (Wave 1)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | — | 4, 5 | 1 |
| 2 | — | 4, 6, 7 | 1 |
| 3 | — | 4, 6, 7 | 1 |
| 4 | 1, 2, 3 | 6, 7 | 2 |
| 5 | 1 | 6, 7 | 2 |
| 6 | 4, 5 | 8, 9, 10 | 3 |
| 7 | 4, 5 | 8, 9, 10 | 3 |
| 8 | 6, 7 | F1-F4 | 4 |
| 9 | 6, 7 | F1-F4 | 4 |
| 10 | 6, 7 | F1-F4 | 4 |

### Agent Dispatch Summary

- **Wave 1**: 3 tasks — T1 → `quick`, T2 → `quick`, T3 → `quick`
- **Wave 2**: 2 tasks — T4 → `visual-engineering`, T5 → `visual-engineering`
- **Wave 3**: 2 tasks — T6 → `unspecified-high`, T7 → `unspecified-high`
- **Wave 4**: 3 tasks — T8 → `quick`, T9 → `quick`, T10 → `quick`
- **FINAL**: 4 tasks — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. Install @git-diff-view/svelte, verify Svelte ≥5.2, remove diff2html

  **What to do**:
  - Run `pnpm add @git-diff-view/svelte @git-diff-view/core`
  - Run `pnpm remove diff2html`
  - Run `pnpm list svelte` to verify Svelte version is ≥5.2.0 (required for `{@attach}` syntax used by the library)
  - If Svelte < 5.2, run `pnpm update svelte` to upgrade
  - Verify `pnpm install` completes without peer dependency conflicts
  - Do NOT touch any `.svelte` or `.ts` source files yet — this is package management only

  **Must NOT do**:
  - Do NOT modify any component files
  - Do NOT add @git-diff-view/shiki (out of scope — use default or no syntax highlighting)
  - Do NOT add Monaco, CodeMirror, or any other editor dependency

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Package install + version check — single terminal operation
  - **Skills**: []
    - No special skills needed for npm operations

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: Tasks 4, 5
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `package.json:15-19` — Current dependencies section showing `diff2html` to remove and `svelte` version to verify

  **External References**:
  - `@git-diff-view/svelte` npm: https://www.npmjs.com/package/@git-diff-view/svelte
  - Svelte 5.2 changelog for `{@attach}` syntax

  **WHY Each Reference Matters**:
  - `package.json` — Know exactly which dep to remove and verify Svelte semver range
  - npm page — Confirm package name and latest version

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Dependencies installed correctly
    Tool: Bash
    Preconditions: Clean working directory
    Steps:
      1. Run `pnpm list @git-diff-view/svelte` — verify package is listed
      2. Run `pnpm list @git-diff-view/core` — verify package is listed
      3. Run `pnpm list diff2html` — verify package is NOT listed (should fail/show empty)
      4. Run `pnpm list svelte` — verify version is ≥5.2.0
      5. Run `pnpm install --frozen-lockfile` — verify no errors
    Expected Result: @git-diff-view packages present, diff2html absent, Svelte ≥5.2
    Failure Indicators: diff2html still in dependencies, Svelte < 5.2, peer dep conflicts
    Evidence: .sisyphus/evidence/task-1-deps-installed.txt

  Scenario: No source files modified
    Tool: Bash
    Preconditions: After package changes
    Steps:
      1. Run `git diff --name-only` — check which files changed
      2. Verify only `package.json` and `pnpm-lock.yaml` are modified
    Expected Result: Only package files changed, no .svelte or .ts files
    Failure Indicators: Any .svelte or .ts file in the diff
    Evidence: .sisyphus/evidence/task-1-no-source-changes.txt
  ```

  **Commit**: YES (group with Wave 1)
  - Message: `feat(deps): replace diff2html with @git-diff-view/svelte`
  - Files: `package.json`, `pnpm-lock.yaml`
  - Pre-commit: `pnpm install --frozen-lockfile`

- [x] 2. Data adapter utility — PrFileDiff[] to @git-diff-view format

  **What to do**:
  - Create `src/lib/diffAdapter.ts`
  - Implement `toGitDiffViewData(file: PrFileDiff)` function that transforms a single `PrFileDiff` into the data format expected by `<DiffView>`:
    ```typescript
    {
      oldFile: { fileName: file.previous_filename || file.filename },
      newFile: { fileName: file.filename },
      hunks: file.patch ? [`--- a/${file.previous_filename || file.filename}\n+++ b/${file.filename}\n${file.patch}`] : []
    }
    ```
  - Handle edge cases: binary files (patch is null), renamed files (previous_filename set), added/deleted files
  - Implement `getFileLanguage(filename: string): string` helper that extracts file extension and maps to language names (e.g., `.ts` → `typescript`, `.rs` → `rust`, `.svelte` → `svelte`)
  - Export both functions as named exports
  - Use `import type` for PrFileDiff (verbatimModuleSyntax compliance)

  **Must NOT do**:
  - Do NOT change the PrFileDiff type definition in types.ts
  - Do NOT change any IPC functions
  - Do NOT import @git-diff-view at runtime — this is pure data transformation

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single utility file with pure functions, no UI, no side effects
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3)
  - **Blocks**: Tasks 4, 6, 7
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/lib/types.ts:166-176` — `PrFileDiff` interface definition (fields: sha, filename, status, additions, deletions, changes, patch, previous_filename)
  - `src/components/DiffViewer.svelte:32-38` — Current reconstruction logic showing how patch is currently combined with header (THIS IS WHAT WE'RE EXTRACTING INTO A PROPER UTILITY)

  **API/Type References**:
  - `@git-diff-view/svelte` data prop expects: `{ oldFile: { fileName, fileLang?, content? }, newFile: { fileName, fileLang?, content? }, hunks: string[] }`
  - The library's parser (`diff-parse.ts`) accepts standard unified diff format in hunks array

  **External References**:
  - @git-diff-view README: https://github.com/MrWangJustToDo/git-diff-view/blob/main/packages/svelte/README.md

  **WHY Each Reference Matters**:
  - `types.ts:166-176` — Exact shape of input data we're transforming FROM
  - `DiffViewer.svelte:32-38` — Existing reconstruction pattern to replicate in the adapter
  - Library README — Exact shape of data we're transforming TO

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Transforms modified file correctly
    Tool: Bash (node/bun REPL or inline script)
    Preconditions: diffAdapter.ts exists
    Steps:
      1. Import toGitDiffViewData from diffAdapter.ts
      2. Call with: { filename: "src/main.ts", status: "modified", patch: "@@ -1,3 +1,4 @@\n line1\n+added\n line2", additions: 1, deletions: 0, changes: 1, sha: "abc", previous_filename: null }
      3. Assert result.newFile.fileName === "src/main.ts"
      4. Assert result.hunks[0] starts with "--- a/src/main.ts"
      5. Assert result.hunks[0] contains the patch content
    Expected Result: Properly formatted data object with hunks array
    Failure Indicators: Missing hunks, wrong filename, missing --- +++ headers
    Evidence: .sisyphus/evidence/task-2-modified-file.txt

  Scenario: Handles binary file (null patch)
    Tool: Bash
    Preconditions: diffAdapter.ts exists
    Steps:
      1. Call toGitDiffViewData with: { filename: "image.png", status: "binary", patch: null, ... }
      2. Assert result.hunks is empty array []
      3. Assert result.newFile.fileName === "image.png"
    Expected Result: Empty hunks array, no crash
    Failure Indicators: TypeError on null patch, non-empty hunks
    Evidence: .sisyphus/evidence/task-2-binary-file.txt

  Scenario: Handles renamed file
    Tool: Bash
    Preconditions: diffAdapter.ts exists
    Steps:
      1. Call toGitDiffViewData with: { filename: "new.ts", previous_filename: "old.ts", status: "renamed", patch: null, ... }
      2. Assert result.oldFile.fileName === "old.ts"
      3. Assert result.newFile.fileName === "new.ts"
    Expected Result: Old file name used for oldFile, new for newFile
    Failure Indicators: Both using same filename
    Evidence: .sisyphus/evidence/task-2-renamed-file.txt
  ```

  **Commit**: NO (groups with Wave 2/3 commit)

- [x] 3. Comment ExtendData builder utility

  **What to do**:
  - Create `src/lib/diffComments.ts`
  - Implement `buildExtendData(filename: string, existingComments: ReviewComment[], pendingComments: ReviewSubmissionComment[])` that returns an ExtendData-compatible object for `@git-diff-view`:
    ```typescript
    // Return type: { oldFile: Record<string, { data: CommentData }>, newFile: Record<string, { data: CommentData }> }
    // where CommentData = { comments: Array<{ body: string; author?: string; type: 'existing' | 'pending'; createdAt?: string; index?: number }> }
    ```
  - Filter comments by `filename` (match `comment.path` to the file being rendered)
  - Map `ReviewComment` (line, side, body, author, created_at) to comment display data
  - Map `ReviewSubmissionComment` (line, side, body) to pending comment display data with index for deletion
  - Handle `SplitSide` mapping: current code uses `side: 'LEFT' | 'RIGHT'` strings, library uses `SplitSide.old = 1` / `SplitSide.new = 2` — implement bidirectional mapping helpers
  - Export the `CommentData` interface for use in snippet rendering
  - Use `import type` for ReviewComment, ReviewSubmissionComment (verbatimModuleSyntax)

  **Must NOT do**:
  - Do NOT change ReviewComment or ReviewSubmissionComment types
  - Do NOT change comment storage/retrieval logic
  - Do NOT import Svelte or any UI library — this is pure data transformation

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single utility file with pure functions, no UI
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2)
  - **Blocks**: Tasks 4, 6, 7
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/components/DiffViewer.svelte:152-209` — Current `renderExistingComments()` and `renderPendingComments()` showing how comments are matched to lines by path+line number (THIS IS WHAT WE'RE REPLACING with declarative ExtendData)
  - `src/components/DiffViewer.svelte:211-228` — `findLineRow()` showing path matching logic (`comment.path === fileName || path.endsWith(fileName) || fileName.endsWith(path)`)

  **API/Type References**:
  - `src/lib/types.ts:178-191` — `ReviewComment` interface (id, pr_number, repo_owner, repo_name, path, line, side, body, author, created_at, in_reply_to_id)
  - `src/lib/types.ts:193-199` — `ReviewSubmissionComment` interface (path, line, side, body)
  - `@git-diff-view/core` — `SplitSide` enum: `SplitSide.old = 1`, `SplitSide.new = 2`

  **External References**:
  - @git-diff-view extendData usage: https://github.com/MrWangJustToDo/git-diff-view — see React advanced example with custom data extension

  **WHY Each Reference Matters**:
  - `DiffViewer.svelte:152-228` — Contains the exact comment-to-line matching logic we need to replicate declaratively
  - `types.ts:178-199` — Input types we're transforming FROM
  - `SplitSide` enum — Required for correct side mapping

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Builds ExtendData for file with existing and pending comments
    Tool: Bash
    Preconditions: diffComments.ts exists
    Steps:
      1. Import buildExtendData
      2. Call with filename="src/main.ts", existingComments=[{path:"src/main.ts", line:5, side:"RIGHT", body:"Fix this", author:"alice", ...}], pendingComments=[{path:"src/main.ts", line:10, side:"RIGHT", body:"TODO"}]
      3. Assert result.newFile["5"].data.comments[0].body === "Fix this"
      4. Assert result.newFile["5"].data.comments[0].type === "existing"
      5. Assert result.newFile["10"].data.comments[0].body === "TODO"
      6. Assert result.newFile["10"].data.comments[0].type === "pending"
    Expected Result: Comments correctly bucketed by line number in newFile
    Failure Indicators: Missing comments, wrong line mapping, wrong type
    Evidence: .sisyphus/evidence/task-3-extend-data.txt

  Scenario: Filters comments to only matching file
    Tool: Bash
    Preconditions: diffComments.ts exists
    Steps:
      1. Call buildExtendData with filename="src/a.ts", comments for both "src/a.ts" and "src/b.ts"
      2. Assert only "src/a.ts" comments appear in result
      3. Assert "src/b.ts" comments are excluded
    Expected Result: Only matching file's comments in output
    Failure Indicators: Comments from other files leaking in
    Evidence: .sisyphus/evidence/task-3-file-filter.txt
  ```

  **Commit**: NO (groups with Wave 2/3 commit)

- [x] 4. Rewrite DiffViewer.svelte with `<DiffView>` component and comment snippets

  **What to do**:
  - **Complete rewrite** of `src/components/DiffViewer.svelte` (currently 566 lines of diff2html + manual DOM manipulation → replace with declarative @git-diff-view component)
  - Import `DiffView` and `DiffModeEnum` from `@git-diff-view/svelte`
  - Import `@git-diff-view/svelte/styles/diff-view-pure.css` (pure CSS, NOT Tailwind variant)
  - Import `toGitDiffViewData` from `../lib/diffAdapter`
  - Import `buildExtendData` and `CommentData` from `../lib/diffComments`
  - **Props interface** (keep compatible with current consumers):
    ```typescript
    interface Props {
      files?: PrFileDiff[]
      existingComments?: ReviewComment[]
      repoOwner?: string
      repoName?: string
    }
    ```
  - **Reactive state**:
    - `outputFormat` state toggling between `DiffModeEnum.Split` and `DiffModeEnum.Unified`
    - `activeCommentLine` state for tracking which line has open comment widget
    - `commentText` state for textarea content
  - **Render each file as a separate `<DiffView>`**: Iterate over `files`, call `toGitDiffViewData(file)` for each, render individual `<DiffView>` components. This gives per-file collapse and avoids one monolithic render.
  - **Comment display via `{#snippet renderExtendLine}`**: Define a Svelte 5 snippet block that receives `{ lineNumber, side, data }` and renders existing + pending comments. Use the `CommentData` type for `data`. Style comments to match current look (author name, body, pending badge, delete button).
  - **Comment input via `{#snippet renderWidgetLine}`**: Define a snippet block that receives `{ lineNumber, side, onClose }` and renders a textarea + Cancel/Submit buttons. On submit, dispatch to `$pendingManualComments` store. On cancel, call `onClose()`.
  - **`onAddWidgetClick` handler**: Set to open the comment widget when user clicks the "+" on a line
  - **`scrollToFile(filename)` export**: Keep the exported function. Implement by finding the file's container element (by data attribute or class) and calling `scrollIntoView()`.
  - **Remove ALL**: diff2html imports, innerHTML usage, `attachLineHandlers()`, `renderExistingComments()`, `renderPendingComments()`, `findLineRow()`, `insertCommentForm()`, `extractLineNumber()`, `getFilePathForElement()`, `escapeHtml()` — all of this manual DOM code is replaced by the declarative component.

  **Must NOT do**:
  - Do NOT change the Props interface shape (keep backward compatible with SelfReviewView and PrReviewView)
  - Do NOT use `innerHTML` anywhere
  - Do NOT use `document.createElement` or `document.querySelector` for diff content
  - Do NOT import diff2html
  - Do NOT add @git-diff-view/shiki — skip syntax highlighting for this task
  - Do NOT change pendingManualComments store behavior

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Core UI component rewrite requiring visual design decisions, Svelte 5 runes expertise, and careful CSS work
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: Needed for UI/UX decisions on comment rendering, layout, and styling

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 5)
  - **Parallel Group**: Wave 2
  - **Blocks**: Tasks 6, 7
  - **Blocked By**: Tasks 1, 2, 3

  **References**:

  **Pattern References**:
  - `src/components/DiffViewer.svelte` (ENTIRE FILE) — Current implementation to understand ALL functionality being replaced. Pay special attention to: Props (line 9-14), renderDiffs (line 29-59), attachLineHandlers (line 61-91), comment form (line 107-150), existing comments (line 152-177), pending comments (line 179-209), scrollToFile (line 236-249), format toggle (line 258-266)
  - `src/lib/stores.ts:25` — `pendingManualComments` store that the comment widget must write to

  **API/Type References**:
  - `src/lib/types.ts:166-199` — PrFileDiff, ReviewComment, ReviewSubmissionComment types
  - `@git-diff-view/svelte` — DiffView component: `data`, `diffViewMode`, `diffViewTheme`, `diffViewHighlight`, `diffViewAddWidget`, `extendData`, `renderExtendLine`, `renderWidgetLine`, `onAddWidgetClick` props
  - `@git-diff-view/core` — `DiffModeEnum.Split`, `DiffModeEnum.Unified`, `SplitSide`

  **External References**:
  - @git-diff-view Svelte demo: https://github.com/MrWangJustToDo/git-diff-view/blob/main/packages/svelte/src/routes/+page.svelte — Shows real usage with snippets, data binding, theme
  - @git-diff-view advanced React example (for extendData/widget pattern): https://github.com/MrWangJustToDo/git-diff-view — Shows renderExtendLine with custom data, renderWidgetLine with textarea

  **WHY Each Reference Matters**:
  - `DiffViewer.svelte` — MUST understand every feature of the current component to ensure nothing is lost in the rewrite
  - `stores.ts:25` — pendingManualComments store is the integration point for comment persistence
  - Library demo — Correct Svelte 5 snippet syntax and prop usage patterns
  - Types — Input/output contracts that must not break

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: DiffViewer renders files with collapsed context
    Tool: Playwright (playwright skill)
    Preconditions: App running with pnpm dev (or test harness)
    Steps:
      1. Render DiffViewer with a mock PrFileDiff[] containing a modified file with a patch
      2. Assert the diff container contains rendered diff lines (not empty)
      3. Assert NO innerHTML dump — check that the component uses <DiffView> elements, not raw HTML string
      4. Assert context lines are collapsed (not all lines of the file visible, only changed hunks)
      5. Take screenshot
    Expected Result: Diff renders with collapsed context lines, visible changed lines
    Failure Indicators: Empty render, full file visible (no collapse), innerHTML in source
    Evidence: .sisyphus/evidence/task-4-renders-collapsed.png

  Scenario: Format toggle switches between split and unified
    Tool: Playwright
    Preconditions: DiffViewer rendered with files
    Steps:
      1. Verify initial mode is split (side-by-side)
      2. Click "Unified" button
      3. Assert the diff layout changes to unified (single column)
      4. Click "Split" button
      5. Assert layout returns to side-by-side
      6. Take screenshots of both modes
    Expected Result: Clean toggle between split and unified views
    Failure Indicators: Toggle does nothing, layout doesn't change, errors in console
    Evidence: .sisyphus/evidence/task-4-format-toggle.png

  Scenario: No diff2html or innerHTML usage
    Tool: Bash (grep)
    Preconditions: Task 4 complete
    Steps:
      1. Run `grep -n "diff2html" src/components/DiffViewer.svelte`
      2. Run `grep -n "innerHTML" src/components/DiffViewer.svelte`
      3. Run `grep -n "document.createElement" src/components/DiffViewer.svelte`
      4. Run `grep -n "querySelector" src/components/DiffViewer.svelte`
    Expected Result: ALL grep commands return no results
    Failure Indicators: Any match found
    Evidence: .sisyphus/evidence/task-4-no-dom-manipulation.txt
  ```

  **Commit**: YES
  - Message: `feat(diff): rewrite DiffViewer with @git-diff-view/svelte component`
  - Files: `src/components/DiffViewer.svelte`, `src/lib/diffAdapter.ts`, `src/lib/diffComments.ts`
  - Pre-commit: `pnpm build`

- [x] 5. Tokyo Night dark theme CSS overrides for @git-diff-view

  **What to do**:
  - Create `src/components/DiffViewerTheme.css` with CSS overrides for `@git-diff-view/svelte/styles/diff-view-pure.css`
  - Map existing Tokyo Night CSS variables to @git-diff-view's CSS classes/variables:
    - Background: `--bg-primary`, `--bg-secondary`, `--bg-card`
    - Text: `--text-primary`, `--text-secondary`
    - Additions: `rgba(158, 206, 106, 0.15)` (current green tint from DiffViewer.svelte:367)
    - Deletions: `rgba(247, 118, 142, 0.15)` (current red tint from DiffViewer.svelte:371)
    - Borders: `--border`
    - Accent: `--accent`
    - Line numbers: `--text-secondary` on `--bg-card` background
    - Hunk headers: `--bg-card` with `--text-secondary`
  - Import this CSS file from the new DiffViewer.svelte
  - Target @git-diff-view's CSS classes (inspect the library's DOM structure to find correct selectors)
  - Ensure the diff looks cohesive with the rest of the app's dark theme
  - Style the comment display (existing + pending) to match current look:
    - Existing: left border accent color, author name bold
    - Pending: left border warning color, "Pending" badge

  **Must NOT do**:
  - Do NOT modify `App.svelte` global styles or CSS variables
  - Do NOT use Tailwind utilities
  - Do NOT add new CSS variables — use existing ones from `:root`

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Pure CSS/theming work requiring visual design sense
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: CSS theming and visual consistency

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 4)
  - **Parallel Group**: Wave 2
  - **Blocks**: Tasks 6, 7
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src/components/DiffViewer.svelte:275-564` — Current `<style>` block with ALL Tokyo Night overrides for diff2html. Contains exact color values for additions, deletions, line numbers, file headers, comments. THIS IS THE STYLE SPEC to replicate.
  - `src/App.svelte` — `:root` CSS variable definitions (search for `--bg-primary`, `--bg-secondary`, etc.)

  **External References**:
  - @git-diff-view pure CSS: `node_modules/@git-diff-view/svelte/styles/diff-view-pure.css` — after install, inspect this file for available CSS classes and variable hooks

  **WHY Each Reference Matters**:
  - `DiffViewer.svelte:275-564` — Contains exact Tokyo Night color mappings that MUST be preserved in the new theme
  - `App.svelte` — CSS variable names to reference

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Dark theme applied correctly
    Tool: Playwright
    Preconditions: DiffViewer rendered with theme CSS imported
    Steps:
      1. Render diff with modified file containing additions and deletions
      2. Screenshot the rendered diff
      3. Verify visually: dark background, green-tinted additions, red-tinted deletions, muted line numbers
      4. Compare color consistency with rest of the app (same bg-primary, same border color)
    Expected Result: Diff blends seamlessly with existing Tokyo Night dark theme
    Failure Indicators: White/light backgrounds, jarring color contrast, unreadable text
    Evidence: .sisyphus/evidence/task-5-dark-theme.png

  Scenario: Comment styling matches existing design
    Tool: Playwright
    Preconditions: DiffViewer with comments rendered
    Steps:
      1. Render a diff with existing comments and pending comments
      2. Assert existing comments have accent-colored left border
      3. Assert pending comments have warning-colored left border and "Pending" badge
      4. Screenshot
    Expected Result: Comments visually match current design
    Failure Indicators: Unstyled comments, wrong colors, missing badge
    Evidence: .sisyphus/evidence/task-5-comment-styles.png
  ```

  **Commit**: NO (groups with Task 4 commit)

- [ ] 6. Wire SelfReviewView.svelte with new DiffViewer

  **What to do**:
  - Update `src/components/SelfReviewView.svelte` to work with the new DiffViewer
  - The component currently passes `files={$selfReviewDiffFiles}` and `existingComments={[]}` — these props should still work with the new DiffViewer interface
  - **Inline comments from local DB**: The current code loads `activeComments.filter(c => c.comment_type === 'inline')` and maps them to `pendingManualComments` store entries. The new DiffViewer should display these via ExtendData. Verify the comment data flow:
    1. `onMount` loads inline comments from DB → `$pendingManualComments`
    2. DiffViewer receives these through the store and displays them
    3. New comments added via widget are written to `$pendingManualComments`
  - **Verify scrollToFile**: `handleFileSelect` calls `diffViewer.scrollToFile(filename)` — ensure this still works with the new DiffViewer's exported function
  - **Verify refresh**: `handleRefresh()` reloads `$selfReviewDiffFiles` — ensure the new DiffViewer re-renders reactively
  - Remove any diff2html-specific workarounds if present
  - Test with the running app: navigate to a task with a worktree, open self-review view

  **Must NOT do**:
  - Do NOT change the data loading logic (getTaskDiff IPC call)
  - Do NOT change the comment loading/saving logic (DB operations)
  - Do NOT change the GeneralCommentsSidebar or SendToAgentPanel
  - Do NOT change the layout structure (FileTree | DiffViewer | Sidebar)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Integration work requiring understanding of data flow between multiple components and stores
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 7)
  - **Parallel Group**: Wave 3
  - **Blocks**: Tasks 8, 9, 10
  - **Blocked By**: Tasks 4, 5

  **References**:

  **Pattern References**:
  - `src/components/SelfReviewView.svelte` (ENTIRE FILE) — Current integration code. Pay attention to: onMount data loading (line 45-92), handleFileSelect (line 25-29), handleRefresh (line 31-43), DiffViewer usage (line 123-127), pendingManualComments mapping (line 62-69)
  - `src/lib/stores.ts:25-29` — `pendingManualComments` and `selfReviewDiffFiles` stores

  **API/Type References**:
  - `src/lib/ipc.ts:191-193` — `getTaskDiff(taskId)` returns `PrFileDiff[]`
  - `src/lib/ipc.ts:195-197` — `addSelfReviewComment()` for persisting comments
  - New DiffViewer props interface (from Task 4)

  **WHY Each Reference Matters**:
  - `SelfReviewView.svelte` — Full context of how data flows to/from DiffViewer in self-review mode
  - Stores — Integration points between components
  - IPC — Data sources that must not change

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Self-review diff loads and renders
    Tool: Playwright (playwright skill)
    Preconditions: App running with `pnpm tauri:dev`, a task exists with a worktree that has commits
    Steps:
      1. Navigate to the task detail view
      2. Open the self-review tab
      3. Wait for loading spinner to disappear
      4. Assert diff content is visible (not empty state, not error state)
      5. Assert FileTree shows files with +/- stats
      6. Click a file in FileTree
      7. Assert DiffViewer scrolls to that file
      8. Take screenshot
    Expected Result: Diff loads, files listed, scroll-to-file works
    Failure Indicators: Loading forever, error state, empty diff, scroll doesn't work
    Evidence: .sisyphus/evidence/task-6-selfreview-loads.png

  Scenario: Inline comment widget works in self-review
    Tool: Playwright
    Preconditions: Self-review diff is rendered
    Steps:
      1. Hover over a line number in the diff
      2. Click the "+" button to open comment widget
      3. Type "Test comment" in the textarea
      4. Click "Add Comment" / submit button
      5. Assert the comment appears as a pending comment in the diff
      6. Assert the pending comment has the warning-colored styling
      7. Take screenshot
    Expected Result: Comment added and displayed inline
    Failure Indicators: No "+" button, widget doesn't open, comment doesn't appear
    Evidence: .sisyphus/evidence/task-6-selfreview-comment.png
  ```

  **Commit**: YES
  - Message: `feat(diff): integrate new DiffViewer into SelfReview and PrReview views`
  - Files: `src/components/SelfReviewView.svelte`, `src/components/PrReviewView.svelte`
  - Pre-commit: `pnpm build`

- [ ] 7. Wire PrReviewView.svelte with new DiffViewer

  **What to do**:
  - Update `src/components/PrReviewView.svelte` to work with the new DiffViewer
  - The component currently passes `files={$prFileDiffs}`, `existingComments={$reviewComments}`, `repoOwner`, `repoName` — verify these props still work
  - **GitHub review comments**: The new DiffViewer should display `$reviewComments` via ExtendData. These are `ReviewComment[]` from the GitHub API with `path`, `line`, `side`, `body`, `author` fields.
  - **Pending review comments**: User-added comments go to `$pendingManualComments` store, displayed as pending. These are later submitted via `ReviewSubmitPanel`.
  - **Verify the full flow**: User opens PR → diffs load → existing GitHub comments appear inline → user can add new comments → pending comments display with badge → user submits review via ReviewSubmitPanel
  - Remove any diff2html-specific workarounds if present
  - Verify `repoOwner` and `repoName` props are still passed correctly (used by comment submission)

  **Must NOT do**:
  - Do NOT change getPrFileDiffs or getReviewComments IPC calls
  - Do NOT change ReviewSubmitPanel
  - Do NOT change the PR list view or PR card components
  - Do NOT change GitHub API integration

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Integration work with GitHub API data flow
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 6)
  - **Parallel Group**: Wave 3
  - **Blocks**: Tasks 8, 9, 10
  - **Blocked By**: Tasks 4, 5

  **References**:

  **Pattern References**:
  - `src/components/PrReviewView.svelte` (ENTIRE FILE) — Current integration code. Pay attention to: selectPr (line 58-72), DiffViewer usage (line 144-150), store updates (line 63-65)
  - `src/components/ReviewSubmitPanel.svelte` — Reads `$pendingManualComments` to submit review. Must not break this contract.
  - `src/lib/stores.ts:22-25` — `prFileDiffs`, `reviewComments`, `pendingManualComments` stores

  **API/Type References**:
  - `src/lib/ipc.ts:155-157` — `getPrFileDiffs(owner, repo, prNumber)` returns `PrFileDiff[]`
  - `src/lib/ipc.ts:167-169` — `getReviewComments(owner, repo, prNumber)` returns `ReviewComment[]`
  - `src/lib/types.ts:178-199` — ReviewComment, ReviewSubmissionComment types

  **WHY Each Reference Matters**:
  - `PrReviewView.svelte` — Full context of PR review data flow including store wiring
  - `ReviewSubmitPanel.svelte` — Downstream consumer of pendingManualComments — must not break
  - Types — Exact shape of GitHub API comments that feed into ExtendData

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: PR diff loads with existing GitHub comments
    Tool: Playwright (playwright skill)
    Preconditions: App running, at least one PR requesting review exists with comments
    Steps:
      1. Navigate to PR Review tab
      2. Click on a PR card to open it
      3. Wait for diffs to load
      4. Assert diff content is visible
      5. Assert existing GitHub comments appear inline at the correct lines
      6. Assert comment shows author name
      7. Take screenshot
    Expected Result: PR diff renders with inline GitHub comments
    Failure Indicators: Missing comments, comments at wrong lines, empty diff
    Evidence: .sisyphus/evidence/task-7-prreview-comments.png

  Scenario: PR diff works without comments (empty PR)
    Tool: Playwright
    Preconditions: App running
    Steps:
      1. Open a PR that has no review comments
      2. Assert diff renders correctly without errors
      3. Assert no comment-related errors in console
    Expected Result: Clean diff rendering, no errors
    Failure Indicators: TypeError from empty comments array, blank screen
    Evidence: .sisyphus/evidence/task-7-prreview-no-comments.png
  ```

  **Commit**: NO (groups with Task 6 commit)

- [ ] 8. Vitest tests for adapter utilities

  **What to do**:
  - Create `src/lib/diffAdapter.test.ts` — tests for `toGitDiffViewData` and `getFileLanguage`:
    - Modified file with patch → correct hunks format
    - Binary file (null patch) → empty hunks
    - Renamed file → correct oldFile/newFile names
    - Added file → correct status handling
    - Deleted file → correct status handling
    - Language detection for common extensions (.ts, .rs, .svelte, .css, .json)
  - Create `src/lib/diffComments.test.ts` — tests for `buildExtendData`:
    - Existing comments mapped to correct line numbers
    - Pending comments mapped with index for deletion
    - File filtering (only matching file's comments)
    - Empty comments → empty ExtendData
    - Side mapping (LEFT/RIGHT → SplitSide)
    - Comments with null line (general comments) excluded from ExtendData
  - Follow existing test patterns: `describe`, `it`, `expect`, typed fixtures at top

  **Must NOT do**:
  - Do NOT write tests that require DOM/browser (that's Playwright's job)
  - Do NOT mock @git-diff-view internals
  - Do NOT write snapshot tests

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Standard unit tests for pure functions, well-defined inputs/outputs
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 9, 10)
  - **Parallel Group**: Wave 4
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 6, 7

  **References**:

  **Pattern References**:
  - `src/components/AgentPanel.test.ts` — Existing test patterns in this project (import style, describe/it structure, fixture objects)
  - `vitest.config.ts` — Test configuration and path aliases

  **API/Type References**:
  - `src/lib/diffAdapter.ts` — Functions to test (from Task 2)
  - `src/lib/diffComments.ts` — Functions to test (from Task 3)
  - `src/lib/types.ts` — PrFileDiff, ReviewComment, ReviewSubmissionComment for fixture creation

  **WHY Each Reference Matters**:
  - `AgentPanel.test.ts` — Follow established test conventions in the project
  - Adapter/comments modules — The units under test

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: All adapter tests pass
    Tool: Bash
    Preconditions: Test files created
    Steps:
      1. Run `pnpm vitest run src/lib/diffAdapter.test.ts`
      2. Assert all tests pass (0 failures)
      3. Run `pnpm vitest run src/lib/diffComments.test.ts`
      4. Assert all tests pass (0 failures)
    Expected Result: All tests green
    Failure Indicators: Any test failure
    Evidence: .sisyphus/evidence/task-8-tests-pass.txt

  Scenario: Tests cover edge cases
    Tool: Bash
    Preconditions: Test files exist
    Steps:
      1. Run `pnpm vitest run --reporter=verbose src/lib/diffAdapter.test.ts src/lib/diffComments.test.ts`
      2. Assert at minimum 10 test cases across both files
      3. Verify edge cases are named in output (binary, renamed, empty, null line, etc.)
    Expected Result: ≥10 tests with meaningful names covering edge cases
    Failure Indicators: Fewer than 10 tests, missing edge cases
    Evidence: .sisyphus/evidence/task-8-test-coverage.txt
  ```

  **Commit**: YES
  - Message: `test(diff): add unit tests for diff adapters`
  - Files: `src/lib/diffAdapter.test.ts`, `src/lib/diffComments.test.ts`
  - Pre-commit: `pnpm test`

- [ ] 9. Remove diff2html, dead code cleanup

  **What to do**:
  - Verify diff2html is already removed from `package.json` (done in Task 1)
  - Search entire codebase for any remaining diff2html references: `grep -r "diff2html" src/`
  - Remove `import 'diff2html/bundles/css/diff2html.min.css'` if it somehow survived
  - Remove any diff2html type imports
  - Check `src/components/DiffViewer.svelte` for any leftover old code (should be clean from Task 4, but verify)
  - Remove unused imports flagged by TypeScript strict mode (`reviewComments` import in old DiffViewer if carried over)
  - Run `pnpm build` to verify no dead code errors
  - Check for any TODO/FIXME comments that reference the old diff2html approach

  **Must NOT do**:
  - Do NOT remove `src-tauri/src/diff_parser.rs` — it's still used by the backend `get_task_diff` command
  - Do NOT remove any backend Rust code
  - Do NOT modify stores or types

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Search-and-remove cleanup, no new logic
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 8, 10)
  - **Parallel Group**: Wave 4
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 6, 7

  **References**:

  **Pattern References**:
  - `package.json:18` — Verify diff2html line is gone
  - `src/components/DiffViewer.svelte:3-5` — Old diff2html imports that should be gone

  **WHY Each Reference Matters**:
  - Know exactly what to search for and verify is removed

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: No diff2html references remain
    Tool: Bash
    Preconditions: All previous tasks complete
    Steps:
      1. Run `grep -r "diff2html" src/` — should return empty
      2. Run `grep -r "diff2html" package.json` — should return empty
      3. Run `grep -r "d2h-" src/` — should return empty (diff2html CSS classes)
      4. Run `pnpm list diff2html` — should show "not found" or error
    Expected Result: Zero references to diff2html anywhere
    Failure Indicators: Any grep match found
    Evidence: .sisyphus/evidence/task-9-cleanup-complete.txt

  Scenario: Build succeeds after cleanup
    Tool: Bash
    Preconditions: Cleanup complete
    Steps:
      1. Run `pnpm build`
      2. Assert exit code 0
      3. Assert no TypeScript errors about missing imports
    Expected Result: Clean build
    Failure Indicators: Build failure, missing module errors
    Evidence: .sisyphus/evidence/task-9-build-clean.txt
  ```

  **Commit**: YES
  - Message: `chore(cleanup): remove diff2html remnants and dead code`
  - Files: Any files with remaining diff2html references
  - Pre-commit: `pnpm build`

- [ ] 10. Build verification and smoke test

  **What to do**:
  - Run full build pipeline: `pnpm build`
  - Run full test suite: `pnpm test`
  - Run TypeScript check: verify no type errors
  - Run Cargo build for backend: `cargo build` (in src-tauri/) — ensure no Rust code was accidentally changed
  - Verify the final state:
    - `grep -r "diff2html" src/` returns nothing
    - `grep -r "innerHTML" src/components/DiffViewer.svelte` returns nothing
    - `@git-diff-view/svelte` is in dependencies
    - `src/lib/diffAdapter.ts` exists
    - `src/lib/diffComments.ts` exists
    - `src/lib/diffAdapter.test.ts` exists
    - `src/lib/diffComments.test.ts` exists
  - If any check fails, document the failure for the Final Verification Wave

  **Must NOT do**:
  - Do NOT fix issues found — just document them (Final Verification Wave handles fixes)
  - Do NOT modify any files

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Running commands and checking output, no code changes
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 8, 9)
  - **Parallel Group**: Wave 4
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 6, 7

  **References**:

  **Pattern References**:
  - `package.json:6-13` — Build and test scripts

  **WHY Each Reference Matters**:
  - Know the exact commands to run

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Full build pipeline passes
    Tool: Bash
    Preconditions: All implementation tasks complete
    Steps:
      1. Run `pnpm build` — assert exit code 0
      2. Run `pnpm test` — assert all tests pass
      3. Run `cargo build` in src-tauri/ — assert exit code 0
    Expected Result: All three commands succeed
    Failure Indicators: Any non-zero exit code
    Evidence: .sisyphus/evidence/task-10-build-verification.txt

  Scenario: Deliverables checklist
    Tool: Bash
    Preconditions: All tasks complete
    Steps:
      1. Verify file exists: src/lib/diffAdapter.ts
      2. Verify file exists: src/lib/diffComments.ts
      3. Verify file exists: src/components/DiffViewerTheme.css (or equivalent)
      4. Verify file exists: src/lib/diffAdapter.test.ts
      5. Verify file exists: src/lib/diffComments.test.ts
      6. Run `grep -c "DiffView" src/components/DiffViewer.svelte` — assert ≥1
      7. Run `grep -c "diff2html" src/` — assert 0
    Expected Result: All deliverables present, no diff2html remnants
    Failure Indicators: Missing files, diff2html references
    Evidence: .sisyphus/evidence/task-10-deliverables-check.txt
  ```

  **Commit**: NO (only if fixes needed)

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Rejection → fix → re-run.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, check component props, check rendered output). For each "Must NOT Have": search codebase for forbidden patterns (innerHTML in DiffViewer, diff2html imports, Monaco/CodeMirror deps). Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `pnpm build` + `pnpm test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp). Verify no `innerHTML` usage for diff rendering. Verify diff2html is fully removed from package.json and all imports.
  Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill)
  Start the app with `pnpm tauri:dev`. Navigate to a task with changes, open self-review view. Verify: diff renders with collapsed context, split/unified toggle works, file tree scrolls to file, inline comments display, comment widget opens on line click. Take screenshots. Then navigate to PR review (if PRs available) and repeat. Test edge cases: empty diff, binary files, renamed files. Save evidence to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance — no backend changes, no diff_parser.rs changes, no PrFileDiff type changes, no DB schema changes. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **After Wave 1**: `feat(deps): replace diff2html with @git-diff-view/svelte` — package.json, pnpm-lock.yaml
- **After Wave 2**: `feat(diff): rewrite DiffViewer with git-diff-view component` — DiffViewer.svelte, DiffViewerTheme.css
- **After Wave 3**: `feat(diff): integrate new DiffViewer into SelfReview and PrReview` — SelfReviewView.svelte, PrReviewView.svelte, diffAdapter.ts, diffComments.ts
- **After Wave 4**: `chore(cleanup): remove diff2html, add adapter tests` — cleanup + tests
- **Pre-commit**: `pnpm build && pnpm test`

---

## Success Criteria

### Verification Commands
```bash
pnpm build           # Expected: Build succeeds, no errors
pnpm test            # Expected: All tests pass
grep -r "diff2html" src/  # Expected: No results
grep -r "innerHTML" src/components/DiffViewer.svelte  # Expected: No results
```

### Final Checklist
- [ ] All "Must Have" present (GitHub-like diff, split/unified, inline comments, comment widget, file tree nav, dark theme, pending comments)
- [ ] All "Must NOT Have" absent (no diff2html, no innerHTML, no backend changes, no manual DOM manipulation)
- [ ] All tests pass
- [ ] Build succeeds
- [ ] Performance visibly improved (collapsed context instead of full DOM dump)
