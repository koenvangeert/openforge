# Remove Subfolder Scanning — Simplify Project Model

## TL;DR

> **Quick Summary**: Remove the repo subfolder scanning feature so each project points directly to a single git repo folder. Rename `repos_root_path` → `path` across the full stack, delete `scan_repos`/`RepoPickerDialog`/`RepoInfo`, and wire "Implement" to use the project path directly.
> 
> **Deliverables**:
> - DB migration + column rename `repos_root_path` → `path`
> - Deleted: `scan_repos` command, `git_worktree::scan_repos()`, `RepoInfo` struct/interface
> - Deleted: `RepoPickerDialog.svelte`, `scanRepos` IPC wrapper
> - Updated: `ProjectSetupDialog`, `SettingsPanel`, `App.svelte` to use new field name
> - Updated: "Implement" click goes directly to worktree creation (no picker dialog)
> 
> **Estimated Effort**: Short
> **Parallel Execution**: YES - 2 waves parallel, then 2 sequential
> **Critical Path**: Task 1 → Task 3 → Task 4 → Task 5

---

## Context

### Original Request
User wants to remove subfolder scanning from the project feature. Currently a project has a `repos_root_path` pointing to a parent folder; clicking "Implement" scans subfolders for git repos and shows a picker. User wants it to work like VS Code — one project = one folder.

### Interview Summary
**Key Discussions**:
- Keep project name field (user still types a name manually)
- Rename `repos_root_path` → `path` across the entire stack
- When clicking "Implement", skip repo picker — go straight to worktree creation
- JIRA/GitHub config is completely untouched

**Research Findings**:
- DB has no migration infrastructure — uses `CREATE TABLE IF NOT EXISTS` on startup
- Existing migration pattern found at `db.rs:302-316` (column existence check + ALTER TABLE)
- `git2` crate only used by `scan_repos` — becomes dead dependency after removal (out of scope to remove from Cargo.toml)
- `RepoPickerDialog.svelte` only imported by `App.svelte`
- 39 occurrences of `repos_root_path`/`reposRootPath` across 8 files

### Metis Review
**Identified Gaps** (addressed):
- DB migration needed for existing databases (added migration step using existing pattern from db.rs:302-316)
- Path validation gap: `scan_repos` implicitly validated repos via `git2::Repository::discover()` — after removal, no validation at project creation. Default: no validation added (matches VS Code behavior, errors surface at implementation time)
- `git2` crate becomes unused — out of scope, noted for follow-up
- Null `activeProject` guard needed when clicking "Implement" — added to plan

---

## Work Objectives

### Core Objective
Simplify the project model from "parent folder containing repos" to "single repo folder", removing all scanning infrastructure.

### Concrete Deliverables
- Renamed DB column and all code references: `repos_root_path` → `path`
- Deleted Rust code: `scan_repos` command, `git_worktree::scan_repos()`, `RepoInfo` struct
- Deleted frontend code: `RepoPickerDialog.svelte`, `scanRepos()` IPC wrapper, `RepoInfo` interface
- Updated UI labels: "Repositories Root Path" → "Repository Path"
- Updated App.svelte flow: "Implement" → direct `startImplementation(taskId, activeProject.path)`

### Definition of Done
- [ ] `cargo build` and `npm run build` succeed with zero errors
- [ ] `cargo test` and `npm run test` pass
- [ ] Zero occurrences of `repos_root_path` / `reposRootPath` / `RepoPickerDialog` / `scanRepos` / `RepoInfo` remain in source
- [ ] `RepoPickerDialog.svelte` file no longer exists

### Must Have
- DB migration step for existing databases (ALTER TABLE RENAME COLUMN)
- Null guard on `activeProject` when clicking "Implement"
- All 39 occurrences of `repos_root_path`/`reposRootPath` renamed

### Must NOT Have (Guardrails)
- MUST NOT touch `worktrees.repo_path` column — different concept (specific repo for a worktree)
- MUST NOT change `start_implementation` Tauri command signature — still takes `repo_path: String`
- MUST NOT touch `agent_coordinator.rs` — no `repos_root_path` references there
- MUST NOT remove `git2` from `Cargo.toml` — separate scope, follow-up task
- MUST NOT add path validation at project creation (matches VS Code model)
- MUST NOT add confirmation dialog when clicking "Implement"
- MUST NOT touch JIRA/GitHub configuration
- MUST NOT touch `ProjectSwitcher.svelte` (only displays name, no path references)

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (vitest for frontend, cargo test for Rust)
- **Automated tests**: Tests-after (update existing tests if they break, no new TDD)
- **Framework**: vitest (frontend), cargo test (Rust)

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

| Deliverable Type | Verification Tool | Method |
|------------------|-------------------|--------|
| Rust backend | Bash (cargo build/test) | Compile, run tests, grep for dead references |
| Frontend types/IPC | Bash (npm run build/test) | Compile, run tests, grep for dead references |
| Component changes | Bash (npm run build/test) | Compile, run tests, verify file deletion |

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — independent backend changes):
├── Task 1: DB migration + schema rename in db.rs [deep]
└── Task 2: Remove scan_repos + RepoInfo from Rust [quick]

Wave 2 (After Wave 1 — Tauri command layer):
└── Task 3: Update Tauri command params in main.rs [quick]

Wave 3 (After Wave 2 — frontend types + IPC):
└── Task 4: Update types.ts + ipc.ts, remove scanRepos/RepoInfo [quick]

Wave 4 (After Wave 3 — components + flow):
└── Task 5: Update components + App.svelte, delete RepoPickerDialog [unspecified-low]

Wave FINAL (After ALL tasks):
├── Task F1: Plan compliance audit [oracle]
├── Task F2: Code quality review [unspecified-high]
├── Task F3: Real QA verification [unspecified-high]
└── Task F4: Scope fidelity check [deep]

Critical Path: Task 1 → Task 3 → Task 4 → Task 5 → F1-F4
Parallel Speedup: Tasks 1+2 run simultaneously
Max Concurrent: 2 (Wave 1)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|------------|--------|------|
| 1 | — | 3 | 1 |
| 2 | — | 3 | 1 |
| 3 | 1, 2 | 4 | 2 |
| 4 | 3 | 5 | 3 |
| 5 | 4 | F1-F4 | 4 |
| F1-F4 | 5 | — | FINAL |

### Agent Dispatch Summary

| Wave | # Parallel | Tasks → Agent Category |
|------|------------|----------------------|
| 1 | **2** | T1 → `deep`, T2 → `quick` |
| 2 | **1** | T3 → `quick` |
| 3 | **1** | T4 → `quick` |
| 4 | **1** | T5 → `unspecified-low` |
| FINAL | **4** | F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep` |

---

## TODOs

- [x] 1. DB migration + schema rename `repos_root_path` → `path` in db.rs

  **What to do**:
  - Add migration in `Database::new()` BEFORE the `CREATE TABLE IF NOT EXISTS projects` statement: check if `repos_root_path` column exists in `projects` table, if so run `ALTER TABLE projects RENAME COLUMN repos_root_path TO path`. Use the existing migration pattern from db.rs:302-316 (`project_id_exists` column check) as a template.
  - Change `CREATE TABLE IF NOT EXISTS projects` statement (db.rs:265-272) to use `path` instead of `repos_root_path`
  - Rename `ProjectRow` struct field `repos_root_path` → `path` (db.rs:28)
  - Update ALL db methods that reference `repos_root_path`:
    - `create_project()` — parameter name, SQL INSERT column, struct field (db.rs:359-396)
    - `get_all_projects()` — SQL SELECT column index, struct field (db.rs:399-420)
    - `get_project()` — SQL SELECT column index, struct field (db.rs:423-443)
    - `update_project()` — parameter name, SQL UPDATE SET, WHERE clause (db.rs:445-463)

  **Must NOT do**:
  - MUST NOT touch `worktrees.repo_path` column — different concept
  - MUST NOT change any worktree-related methods
  - MUST NOT remove `git2` from Cargo.toml

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: DB migration logic requires careful handling of existing vs fresh databases
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `golang`: Not a Go project

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 2)
  - **Blocks**: Task 3
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References** (existing code to follow):
  - `src-tauri/src/db.rs:302-316` — Existing column migration pattern: checks if column exists with `pragma_table_info`, then ALTER TABLE. Copy this exact pattern for `repos_root_path` → `path` rename.
  - `src-tauri/src/db.rs:25-31` — `ProjectRow` struct definition, field to rename

  **API/Type References** (contracts to implement against):
  - `src-tauri/src/db.rs:265-272` — Current CREATE TABLE statement for projects
  - `src-tauri/src/db.rs:359-463` — All four CRUD methods (`create_project`, `get_all_projects`, `get_project`, `update_project`) that reference `repos_root_path`

  **WHY Each Reference Matters**:
  - db.rs:302-316 is THE template — it shows how to safely check for column existence and ALTER TABLE in this codebase's migration approach
  - db.rs:25-31 defines the struct that Serde serializes to JSON — the field name here determines the JSON key the frontend receives

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Rust compiles after rename
    Tool: Bash
    Preconditions: All changes applied to db.rs
    Steps:
      1. Run `cargo build 2>&1`
      2. Check exit code
    Expected Result: Exit code 0, no errors
    Failure Indicators: Any line containing "error[E"
    Evidence: .sisyphus/evidence/task-1-cargo-build.txt

  Scenario: All Rust tests pass
    Tool: Bash
    Preconditions: Cargo build succeeds
    Steps:
      1. Run `cargo test 2>&1`
      2. Check for "test result: ok"
    Expected Result: All tests pass, "test result: ok" in output
    Failure Indicators: "FAILED" or "test result: FAILED"
    Evidence: .sisyphus/evidence/task-1-cargo-test.txt

  Scenario: Zero traces of repos_root_path in db.rs
    Tool: Bash
    Preconditions: All changes applied
    Steps:
      1. Run `grep -c "repos_root_path" src-tauri/src/db.rs`
    Expected Result: Output is "0"
    Failure Indicators: Output is any number > 0
    Evidence: .sisyphus/evidence/task-1-grep-verify.txt
  ```

  **Commit**: YES (groups with Task 2)
  - Message: `refactor(db): rename repos_root_path to path and remove scan_repos`
  - Files: `src-tauri/src/db.rs`
  - Pre-commit: `cargo build && cargo test`

- [x] 2. Remove scan_repos command + git_worktree::scan_repos + RepoInfo from Rust

  **What to do**:
  - Delete `RepoInfo` struct from `git_worktree.rs:59-63`
  - Delete the "Repository Scanning" section comment (git_worktree.rs:87-89) and the entire `scan_repos()` function (git_worktree.rs:91-127)
  - Remove `use git2;` or any `git2` import from `git_worktree.rs` (only used by `scan_repos`)
  - Delete `scan_repos` Tauri command from `main.rs:229-235`
  - Remove `scan_repos` from the `invoke_handler![]` macro list in `main.rs` (around line 889)
  - Check for and remove any now-unused `use` imports in both files

  **Must NOT do**:
  - MUST NOT remove `git2` from `Cargo.toml`
  - MUST NOT touch worktree operations (`create_worktree`, `delete_worktree`, etc.)
  - MUST NOT touch any other Tauri commands

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Straightforward code deletion — no logic changes, just removing functions and structs
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 1)
  - **Blocks**: Task 3
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src-tauri/src/git_worktree.rs:59-63` — `RepoInfo` struct to delete
  - `src-tauri/src/git_worktree.rs:87-127` — `scan_repos()` function + section comment to delete
  - `src-tauri/src/main.rs:229-235` — `scan_repos` Tauri command to delete
  - `src-tauri/src/main.rs:883-895` — `invoke_handler![]` macro — remove `scan_repos` entry

  **WHY Each Reference Matters**:
  - git_worktree.rs:59-63 is the `RepoInfo` struct also referenced by the Tauri command — both must go together
  - main.rs invoke_handler is easy to miss — forgetting it causes a compile error referencing a deleted function

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Rust compiles after deletion
    Tool: Bash
    Preconditions: RepoInfo and scan_repos deleted from both files
    Steps:
      1. Run `cargo build 2>&1`
      2. Check exit code
    Expected Result: Exit code 0, no errors
    Failure Indicators: Any line containing "error[E"
    Evidence: .sisyphus/evidence/task-2-cargo-build.txt

  Scenario: No traces of scan_repos or RepoInfo in Rust source
    Tool: Bash
    Preconditions: All deletions applied
    Steps:
      1. Run `grep -c "scan_repos" src-tauri/src/main.rs`
      2. Run `grep -c "RepoInfo" src-tauri/src/git_worktree.rs`
      3. Run `grep -c "git2" src-tauri/src/git_worktree.rs`
    Expected Result: All three output "0"
    Failure Indicators: Any output > 0
    Evidence: .sisyphus/evidence/task-2-grep-verify.txt

  Scenario: Worktree operations still intact
    Tool: Bash
    Preconditions: Deletions applied
    Steps:
      1. Run `grep -c "create_worktree" src-tauri/src/git_worktree.rs`
    Expected Result: Output > 0 (function still exists)
    Failure Indicators: Output is "0"
    Evidence: .sisyphus/evidence/task-2-worktree-intact.txt
  ```

  **Commit**: YES (groups with Task 1)
  - Message: `refactor(db): rename repos_root_path to path and remove scan_repos`
  - Files: `src-tauri/src/git_worktree.rs`, `src-tauri/src/main.rs`
  - Pre-commit: `cargo build && cargo test`

- [ ] 3. Update Tauri command params in main.rs (`repos_root_path` → `path`)

  **What to do**:
  - In `create_project` Tauri command (main.rs:165-173): rename parameter `repos_root_path: String` → `path: String`, update call to `db.create_project(&name, &path)`
  - In `update_project` Tauri command (main.rs:185-194): rename parameter `repos_root_path: String` → `path: String`, update call to `db.update_project(&id, &name, &path)`

  **Must NOT do**:
  - MUST NOT change `start_implementation` command signature (still takes `repo_path: String`)
  - MUST NOT touch any other Tauri commands

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Two simple parameter renames in Tauri commands
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (sequential after Wave 1)
  - **Blocks**: Task 4
  - **Blocked By**: Task 1 (needs `ProjectRow.path` field), Task 2 (needs `scan_repos` gone from invoke_handler)

  **References**:

  **Pattern References**:
  - `src-tauri/src/main.rs:165-173` — `create_project` command: parameter + db call to update
  - `src-tauri/src/main.rs:185-194` — `update_project` command: parameter + db call to update

  **WHY Each Reference Matters**:
  - Tauri's `invoke()` matches JSON keys to Rust parameter names via serde — renaming the Rust param from `repos_root_path` to `path` means the frontend must send `{ path: "..." }` instead of `{ reposRootPath: "..." }`. This is why Task 4 (frontend) depends on this task.

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Rust compiles with renamed params
    Tool: Bash
    Preconditions: Tasks 1 and 2 complete, main.rs params updated
    Steps:
      1. Run `cargo build 2>&1`
    Expected Result: Exit code 0, no errors
    Failure Indicators: Any "error[E" in output
    Evidence: .sisyphus/evidence/task-3-cargo-build.txt

  Scenario: Zero repos_root_path in main.rs
    Tool: Bash
    Preconditions: All renames applied
    Steps:
      1. Run `grep -c "repos_root_path" src-tauri/src/main.rs`
    Expected Result: Output is "0"
    Failure Indicators: Output > 0
    Evidence: .sisyphus/evidence/task-3-grep-verify.txt
  ```

  **Commit**: NO (groups with Task 4 + 5)

- [ ] 4. Update frontend types.ts + ipc.ts — rename field, remove scanRepos/RepoInfo

  **What to do**:
  - In `src/lib/types.ts`:
    - Rename `Project.repos_root_path` → `Project.path` (line 74)
    - Delete `RepoInfo` interface entirely (lines 93-96)
  - In `src/lib/ipc.ts`:
    - Remove `RepoInfo` from the import on line 2
    - In `createProject()` (lines 32-33): rename param `reposRootPath` → `path`, change invoke to `{ name, path }`
    - In `updateProject()` (lines 40-41): rename param `reposRootPath` → `path`, change invoke to `{ id, name, path }`
    - Delete `scanRepos()` function entirely (lines 56-58)

  **Must NOT do**:
  - MUST NOT touch `startImplementation()` — it takes `repoPath` which is a different field
  - MUST NOT touch `getProjectConfig` / `setProjectConfig`

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple type rename and function deletion in two files
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (after Task 3)
  - **Blocks**: Task 5
  - **Blocked By**: Task 3 (Rust params must be renamed first — serde key matching)

  **References**:

  **Pattern References**:
  - `src/lib/types.ts:71-77` — `Project` interface, field to rename on line 74
  - `src/lib/types.ts:93-96` — `RepoInfo` interface to delete
  - `src/lib/ipc.ts:2` — Import line that includes `RepoInfo`
  - `src/lib/ipc.ts:32-33` — `createProject()` function with `reposRootPath` param
  - `src/lib/ipc.ts:40-41` — `updateProject()` function with `reposRootPath` param
  - `src/lib/ipc.ts:56-58` — `scanRepos()` function to delete

  **WHY Each Reference Matters**:
  - types.ts:74 `repos_root_path` must match the Rust serde output exactly (`path`) — mismatch means the field silently becomes `undefined`
  - ipc.ts invoke keys must match Rust parameter names — `{ name, path }` maps to Rust `name: String, path: String`

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Frontend compiles after type/IPC changes
    Tool: Bash
    Preconditions: types.ts and ipc.ts updated
    Steps:
      1. Run `npm run build 2>&1`
    Expected Result: Exit code 0, no errors
    Failure Indicators: Any "error" in output
    Evidence: .sisyphus/evidence/task-4-npm-build.txt

  Scenario: Zero traces of removed identifiers
    Tool: Bash
    Preconditions: All changes applied
    Steps:
      1. Run `grep -c "RepoInfo" src/lib/types.ts`
      2. Run `grep -c "scanRepos" src/lib/ipc.ts`
      3. Run `grep -c "reposRootPath\|repos_root_path" src/lib/ipc.ts`
    Expected Result: All three output "0"
    Failure Indicators: Any output > 0
    Evidence: .sisyphus/evidence/task-4-grep-verify.txt
  ```

  **Commit**: NO (groups with Task 3 + 5)

- [ ] 5. Update components + App.svelte — delete RepoPickerDialog, bypass repo picker

  **What to do**:
  - **Delete** `src/components/RepoPickerDialog.svelte` entirely (267 lines)
  - In `src/App.svelte`:
    - Remove import of `RepoPickerDialog` (line 15)
    - Remove state variables `showRepoPicker` and `repoPickerTaskId` (lines 24-25)
    - Keep `activeProject` reactive derivation (line 36 area) — still needed for `activeProject.path`
    - Replace `handleStartImplementation` function (lines 89-92) to call `startImplementation` directly:
      ```typescript
      async function handleStartImplementation(event: CustomEvent<{ taskId: string }>) {
        if (!activeProject) {
          $error = 'No active project selected'
          return
        }
        try {
          await startImplementation(event.detail.taskId, activeProject.path)
          await loadTasks()
        } catch (e) {
          console.error('Failed to start implementation:', e)
          $error = String(e)
        }
      }
      ```
    - Delete `handleRepoSelected` function entirely (lines 94-104)
    - Delete the RepoPickerDialog template block (lines 208-210)
    - Remove any now-unused imports or variables
  - In `src/components/ProjectSetupDialog.svelte`:
    - Rename variable `reposRootPath` → `path` (line 8)
    - Update validation: `!path.trim()` (line 20)
    - Update create call: `createProject(projectName.trim(), path.trim())` (line 24)
    - Update label: `"Repositories Root Path"` → `"Repository Path"` (line 94 area)
    - Update placeholder: `"/Users/you/workspace"` → `"/Users/you/workspace/my-project"` (line 98)
    - Update `bind:value={path}` (line 97)
    - Update disabled check: `!path.trim()` (line 200)
  - In `src/components/SettingsPanel.svelte`:
    - Rename variable `reposRootPath` → `path` (line 9)
    - Update reactive assignment: `currentProject?.path` (line 26)
    - Update save call: `updateProject($activeProjectId, projectName, path)` (line 47)
    - Update label: change to `"Repository Path"` (line 106)
    - Update placeholder: `"/path/to/repos"` → `"/path/to/repo"` (line 107)
    - Update `bind:value={path}` (line 107)

  **Must NOT do**:
  - MUST NOT touch `ProjectSwitcher.svelte`
  - MUST NOT add any new dialog or confirmation step
  - MUST NOT add path validation logic
  - MUST NOT touch JIRA/GitHub config sections in ProjectSetupDialog or SettingsPanel

  **Recommended Agent Profile**:
  - **Category**: `unspecified-low`
    - Reason: Multiple small edits across Svelte components, no complex logic
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (after Task 4)
  - **Blocks**: Final Verification Wave
  - **Blocked By**: Task 4 (needs `Project.path` type and updated IPC wrappers)

  **References**:

  **Pattern References**:
  - `src/App.svelte:15` — RepoPickerDialog import to remove
  - `src/App.svelte:24-25` — `showRepoPicker`, `repoPickerTaskId` state to remove
  - `src/App.svelte:36` — `activeProject` reactive derivation — KEEP THIS
  - `src/App.svelte:89-104` — `handleStartImplementation` + `handleRepoSelected` — replace/delete
  - `src/App.svelte:208-210` — RepoPickerDialog template block to delete

  **API/Type References**:
  - `src/components/ProjectSetupDialog.svelte:8,20,24,94,97,200` — All `reposRootPath` references
  - `src/components/SettingsPanel.svelte:9,26,47,106-107` — All `reposRootPath` references
  - `src/lib/ipc.ts:64` — `startImplementation(taskId, repoPath)` — signature NOT changing, but now called with `activeProject.path`

  **WHY Each Reference Matters**:
  - App.svelte:36 `activeProject` reactive derivation MUST be kept — it's how we access `activeProject.path` in the new direct implementation flow
  - App.svelte:89-92 is the key behavior change: instead of opening a picker, call `startImplementation` directly
  - The null guard (`if (!activeProject)`) is essential — Metis flagged this as a risk

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Frontend compiles after all component changes
    Tool: Bash
    Preconditions: All component changes applied, RepoPickerDialog deleted
    Steps:
      1. Run `npm run build 2>&1`
    Expected Result: Exit code 0, no errors
    Failure Indicators: Any "error" in output
    Evidence: .sisyphus/evidence/task-5-npm-build.txt

  Scenario: Frontend tests pass
    Tool: Bash
    Preconditions: npm run build succeeds
    Steps:
      1. Run `npm run test 2>&1`
    Expected Result: All tests pass
    Failure Indicators: "FAIL" in output
    Evidence: .sisyphus/evidence/task-5-npm-test.txt

  Scenario: RepoPickerDialog file is deleted
    Tool: Bash
    Preconditions: File deletion applied
    Steps:
      1. Run `ls src/components/RepoPickerDialog.svelte 2>&1`
    Expected Result: "No such file or directory"
    Failure Indicators: File exists
    Evidence: .sisyphus/evidence/task-5-file-deleted.txt

  Scenario: Zero traces of all removed identifiers across entire frontend
    Tool: Bash
    Preconditions: All changes applied
    Steps:
      1. Run `grep -rc "repos_root_path\|reposRootPath\|RepoPickerDialog\|scanRepos\|RepoInfo\|showRepoPicker\|repoPickerTaskId" src/ --include="*.ts" --include="*.svelte" | grep -v ":0$"`
    Expected Result: No output (all traces removed)
    Failure Indicators: Any line with count > 0
    Evidence: .sisyphus/evidence/task-5-full-grep-verify.txt
  ```

  **Commit**: YES (groups with Task 3 + 4)
  - Message: `refactor(ui): update frontend for simplified project model`
  - Files: `src/lib/types.ts`, `src/lib/ipc.ts`, `src/App.svelte`, `src/components/ProjectSetupDialog.svelte`, `src/components/SettingsPanel.svelte`, `-src/components/RepoPickerDialog.svelte`
  - Pre-commit: `npm run build && npm run test`

---

## Final Verification Wave

> 4 review agents run in PARALLEL. ALL must APPROVE. Rejection → fix → re-run.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (grep codebase, check DB migration). For each "Must NOT Have": search codebase for forbidden patterns (worktrees.repo_path changes, git2 Cargo.toml removal, path validation additions) — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `cargo build` + `npm run build` + `cargo test` + `npm run test`. Review all changed files for: unused imports, dead code references to removed features, `as any`/`@ts-ignore` hacks. Check no traces of `repos_root_path`, `reposRootPath`, `RepoPickerDialog`, `scanRepos`, `RepoInfo` remain in source.
  Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Dead Code [CLEAN/N issues] | VERDICT`

- [ ] F3. **Real QA Verification** — `unspecified-high`
  Start from clean state. Run `cargo build` and `npm run build`. Verify `RepoPickerDialog.svelte` file doesn't exist. Run full grep across `src/` and `src-tauri/src/` for all removed identifiers. Run `cargo test` and `npm run test`. Save all output to `.sisyphus/evidence/final-qa/`.
  Output: `Build [PASS/FAIL] | Tests [PASS/FAIL] | Dead References [CLEAN/N] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (`git diff`). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance: `worktrees.repo_path` untouched, `agent_coordinator.rs` untouched, `git2` still in Cargo.toml, no path validation added, no confirmation dialog added. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Scope Creep [CLEAN/N issues] | VERDICT`

---

## Commit Strategy

| After Task(s) | Message | Key Files | Verification |
|---------------|---------|-----------|--------------|
| 1 + 2 | `refactor(db): rename repos_root_path to path and remove scan_repos` | db.rs, git_worktree.rs, main.rs | `cargo build && cargo test` |
| 3 + 4 + 5 | `refactor(ui): update frontend for simplified project model` | types.ts, ipc.ts, App.svelte, ProjectSetupDialog.svelte, SettingsPanel.svelte, -RepoPickerDialog.svelte | `npm run build && npm run test` |

---

## Success Criteria

### Verification Commands
```bash
cargo build          # Expected: compiles with 0 errors
cargo test           # Expected: all tests pass
npm run build        # Expected: compiles with 0 errors
npm run test         # Expected: all tests pass

# Zero dead references
grep -rc "repos_root_path\|reposRootPath\|RepoPickerDialog\|scanRepos\|RepoInfo" src/ src-tauri/src/ --include="*.ts" --include="*.svelte" --include="*.rs" | grep -v ":0$"
# Expected: no output

# File deleted
ls src/components/RepoPickerDialog.svelte 2>&1
# Expected: No such file or directory
```

### Final Checklist
- [ ] All "Must Have" present (DB migration, null guard, all 39 renames)
- [ ] All "Must NOT Have" absent (no worktree.repo_path changes, no git2 removal, no validation, no confirmation dialog)
- [ ] All tests pass (`cargo test` + `npm run test`)
- [ ] All builds succeed (`cargo build` + `npm run build`)
