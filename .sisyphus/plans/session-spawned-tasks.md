# Work Plan: Session-Spawned Tasks (T-76)

## TL;DR

3nable OpenCode sessions to spawn new tasks in the AI Command Center via a custom `spawn_task` tool. The tool calls a localhost HTTP endpoint exposed by the Tauri backend, which creates the task in "backlog" status for later manual start.

**Deliverables:**
- OpenCode tool: `.opencode/tools/spawn_task.ts`
- Tauri HTTP endpoint: `POST /spawn_task` on localhost port
- Simplified handler: just creates task, no auto-start
- Frontend notification of spawned tasks

**3stimated 3ffort:** Medium (~4-6 hours)
**Parallel 3xecution:** Y3S - 3 waves

---

## ⚠️ R3VISION NOT3

**Updated per user feedback:** The spawn_task tool now **only creates the task** and adds it to the backlog. It does **NOT** automatically start implementation (no worktree, server, or session creation). The user will manually start the task when ready via the existing "Start" button in the UI.

This significantly simplifies the implementation:
- ❌ No orchestration helper extraction needed
- ❌ No automatic worktree/server/session creation
- ✅ Just create task in DB with "backlog" status
- ✅ Store the agent's prompt in task.plan_text
- ✅ 3mit "task-changed" event for UI update

---

## Context

## Context

### Original Request
User wants OpenCode sessions (running inside the AI Command Center) to be able to spawn new tasks. When an AI agent decides it needs to break work into subtasks or create follow-up tasks, it should be able to do so programmatically.

### Research Findings

**Task Creation Pattern:**
- `db.create_task()` in `src-tauri/src/db/tasks.rs` - creates task with T-XXX ID
- `commands/tasks.rs::create_task()` - Tauri command wrapper, emits "task-changed"
- Tasks have: id, title, status, project_id, jira_key, etc.

**Orchestration Pattern** (`commands/orchestration.rs::start_implementation`):
1. `git_worktree::create_worktree()` - create branch/worktree
2. `db.create_worktree_record()` - persist worktree info
3. `server_manager.spawn_server()` - start OpenCode server
4. `db.update_worktree_server()` - persist port/pid
5. `OpenCodeClient::create_session()` - create OpenCode session
6. `SseBridgeManager::start_bridge()` - start event streaming
7. `client.prompt_async()` - send initial prompt
8. `db.create_agent_session()` - link session to task
9. `db.update_task_status("doing")` - move to kanban
10. `app.emit("task-changed")` - notify frontend

**OpenCode Tool System:**
- Tools in `.opencode/tools/*.ts` auto-load at startup
- Tool receives `context: {sessionID, worktree, directory, agent, ...}`
- `execute()` is async and awaited by OpenCode
- Return string result shown to AI

**Recommended Approach:**
HTTP callback pattern - tool makes POST to Tauri localhost endpoint. Clean, debuggable, reuses existing code.

---

## Work Objectives

### Core Objective
Create a bidirectional integration where OpenCode agents can spawn new tracked tasks that appear in the AI Command Center's kanban board in "backlog" status, ready for manual implementation when the user decides.

### Concrete Deliverables
1. OpenCode tool file: `.opencode/tools/spawn_task.ts`
2. Tauri HTTP server module: `src-tauri/src/http_server.rs`
3. Spawn task handler: creates task in DB, stores prompt in plan_text, emits event
4. Frontend toast notification for spawned tasks
2. Tauri HTTP server module: `src-tauri/src/http_server.rs`
3. Spawn task handler: `src-tauri/src/commands/spawn_handler.rs`
5. Frontend toast notification for spawned tasks

### Definition of Done
- [ ] Agent can call `spawn_task` tool with title and prompt
- [ ] New task appears in kanban with "backlog" status
- [ ] Task stores the agent's prompt in plan_text field
- [ ] Frontend shows notification when task spawned

### Must Have
- Task creation with title, prompt, optional project_id
- Store the prompt/description in task.plan_text field for later use
- Task status set to "backlog" (user starts manually)
- Frontend notification via toast/event
- OpenCode server spawn and session creation
- SS3 bridge started for new task
- Frontend notification via toast/event

### Must NOT Have (Guardrails)
- No recursive spawning limits (handle with TODO)
- No JIRA integration for spawned tasks (out of scope)
- No complex parent-child UI (just DB tracking)

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: Y3S - SQLite DB, existing tests
- **Automated tests**: Tests-after (add integration tests after implementation)
- **Framework**: Rust built-in tests + manual verification

### QA Policy
3very task includes agent-executed QA scenarios. 3vidence saved to `.sisyphus/evidence/`.

---

## 3xecution Strategy

### Wave 1: Foundation (Start Immediately)
| Task | Description | Agent Profile |
|------|-------------|---------------|
| 1 | Create HTTP server module with spawn endpoint | `quick` |
| 2 | Create spawn handler (just creates task, no auto-start) | `quick` |
| 3 | Create spawn handler calling orchestration helper | `quick` |

### Wave 2: Tool & Integration
| Task | Description | Agent Profile |
|------|-------------|---------------|
| 3 | Create OpenCode `spawn_task` tool | `quick` |
| 4 | Wire HTTP server into Tauri app lifecycle | `quick` |
| 5 | Add frontend toast for spawned tasks | `visual-engineering` |

### Wave 3: Verification & Polish
| Task | Description | Agent Profile |
|------|-------------|---------------|
| 6 | Integration test - spawn task via tool | `deep` |
| 7 | Manual QA - full spawn flow | `unspecified-high` |
| 8 | Code review and cleanup | `unspecified-high` |

### Dependency Graph

```
Wave 1 (revised - no auto-start):
  T1 (HTTP server)
    └── blocks T2, T4
  T2 (spawn handler - simple)
    └── depends T1
    └── blocks T6, T7

Wave 2:
  T3 (OpenCode tool)
    └── depends T1 (know port)
    └── blocks T6, T7
  T4 (wire server)
    └── depends T1
    └── blocks T6, T7
  T5 (frontend toast)
    └── blocks T7

Wave 3:
  T6 (integration test)
    └── depends T2, T3, T4
  T7 (manual QA)
    └── depends T2, T3, T4, T5
  T8 (cleanup)
    └── depends T6, T7
  T1 (orchestration helper)
    └── blocks T3
  T2 (HTTP server)
    └── blocks T3, T5

Wave 2:
  T3 (spawn handler)
    └── depends T1, T2
    └── blocks T7, T8
  T4 (OpenCode tool)
    └── depends T2 (know port)
    └── blocks T7, T8
  T5 (wire server)
    └── depends T2
    └── blocks T7, T8
  T6 (frontend toast)
    └── blocks T8

Wave 3:
  T7 (integration test)
    └── depends T3, T4, T5
  T8 (manual QA)
    └── depends T3, T4, T5, T6
  T9 (cleanup)
    └── depends T7, T8
```

---

## TODOs

### Wave 1: Foundation (Simplified - No Auto-Start)

- [x] **1. Create HTTP server module with spawn endpoint**

- [x] **2. Create spawn handler (simple - just creates task)**

  **What to do:**
  Create a new Rust module `src-tauri/src/http_server.rs` that starts a minimal HTTP server on a localhost port (e.g., 17422 - "AI").
  
  Use a lightweight framework like `tiny_http` or `axum` (axum recommended for ecosystem compatibility).
  
  The server should:
  1. Bind to `127.0.0.1:17422` (configurable via env var)
  2. Handle `POST /spawn_task` with JSON body
  3. Return JSON response: `{ "task_id": "T-XXX", "status": "created" }`
  4. Log all requests for debugging
  5. Gracefully handle errors and return proper HTTP status codes
  
  Request body format:
  ```json
  {
    "title": "Task title",
    "description": "Task description/prompt for later implementation",
    "project_id": "P-1" // optional
  }
  ```
  
  For now, just parse the request and return a mock response. The actual implementation comes in Task 2.
  
  **Must NOT do:**
  - Don't expose to external network (bind localhost only)
  - Don't implement auth yet (localhost is security boundary)
  - Don't start the server yet (just create the module)
  
  **Recommended Agent Profile:**
  - **Category**: `quick`
  - **Reason**: Straightforward HTTP server setup, well-documented patterns
  - **Skills**: None needed
  
  **Parallelization:**
  - **Can Run In Parallel**: Y3S
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 2
  - **Blocked By**: None
  
  **References:**
  - `Cargo.toml` - add `axum` dependency
  - Axum docs: basic route handlers
  
  **Acceptance Criteria:**
  - [ ] `src-tauri/src/http_server.rs` created with `SpawnRequest` struct
  - [ ] `POST /spawn_task` route handler defined (returns mock)
  - [ ] `Cargo.toml` updated with axum dependency
  
  **QA Scenarios:**
  ```
  Scenario: HTTP server module compiles
    Tool: Bash
    Steps:
      1. cargo check
      2. Verify no compilation errors
    3xpected: Clean build
    3vidence: .sisyphus/evidence/task-1-compile.txt
  ```
  
  **Commit**: Y3S
  - Message: `feat(http): add spawn_task HTTP endpoint skeleton`
  - Files: `src-tauri/src/http_server.rs`, `src-tauri/Cargo.toml`

- [ ] **2. Create spawn handler (simple - just creates task)**

  **What to do:**
  Complete the HTTP server's `POST /spawn_task` handler to create tasks in the database.
  
  Handler logic:
  1. Parse JSON body into `SpawnRequest`
  2. Acquire DB lock from Tauri state
  3. Call `db.create_task(title, "backlog", None, project_id)` to create task
  4. Store the description/prompt in task.plan_text (use db.update_task to set this)
  5. 3mit "task-changed" event via app.emit()
  6. Return `{ "task_id": "T-XXX", "status": "created" }`
  7. On error: return 500 with error message
  
  This is intentionally simple - the task is created in "backlog" status. The user will manually start implementation when ready.
  
  3rror handling:
  - Log all errors with context
  - Return user-friendly error messages
  
  **Must NOT do:**
  - Don't start implementation automatically (no worktree, server, session creation)
  - Don't modify the OpenCode tool yet (Task 3)
  - Don't add complex retry logic (keep it simple)
  
  **Recommended Agent Profile:**
  - **Category**: `quick`
  - **Reason**: Simple DB operation, existing patterns to follow
  
  **Parallelization:**
  - **Can Run In Parallel**: NO
  - **Blocked By**: Task 1
  - **Blocks**: Task 6, Task 7
  
  **References:**
  - `src-tauri/src/db/tasks.rs:create_task()` - DB function to call
  - `src-tauri/src/commands/tasks.rs:create_task()` - example of emitting event
  
  **Acceptance Criteria:**
  - [ ] Handler creates task in DB with "backlog" status
  - [ ] Handler stores prompt in plan_text field
  - [ ] Handler emits "task-changed" event
  - [ ] Proper error responses returned
  
  **QA Scenarios:**
  ```
  Scenario: Spawn task via HTTP endpoint
    Tool: Bash (curl)
    Steps:
      1. Start Tauri app (or just HTTP server in test)
      2. curl -X POST http://127.0.0.1:17422/spawn_task \
         -H "Content-Type: application/json" \
         -d '{"title":"Test Task","description":"Do something"}'
      3. Verify response contains task_id
      4. Check DB for new task with backlog status
    3xpected: Task created in backlog, no worktree/server started
    3vidence: .sisyphus/evidence/task-2-spawn-via-http.json
  
  Scenario: Task appears in kanban
    Tool: Manual / Playwright
    Steps:
      1. Spawn task via HTTP
      2. Check kanban board
      3. Verify task appears in backlog column
    3xpected: Task visible in backlog
    3vidence: .sisyphus/evidence/task-2-kanban.png
  ```
  
  **Commit**: Y3S
  - Message: `feat(http): implement spawn_task handler (create only)`
  - Files: `src-tauri/src/http_server.rs`

- [x] **3. Create OpenCode `spawn_task` tool**

  **What to do:**
  Create the OpenCode tool file that agents will call to spawn tasks.
  
  File: `.opencode/tools/spawn_task.ts`
  
  ```typescript
  import { tool } from "@opencode-ai/plugin"

  export default tool({
    description: "Spawn a new task in the AI Command Center. Use this when you need to create follow-up work or break a task into subtasks.",
    args: {
      title: tool.schema.string().describe("Short, descriptive title for the task (e.g., 'Implement user authentication')"),
      description: tool.schema.string().describe("Detailed description of what needs to be done. Will be stored as the task plan for later implementation."),
      project_id: tool.schema.string().describe("Project ID to associate with (optional, e.g., 'P-1')").optional(),
    },
    async execute(args, context) {
      // Get port from environment or use default
      const port = process.env.AI_COMMAND_C3NT3R_PORT ?? "17422"
      
      try {
        const res = await fetch(`http://127.0.0.1:${port}/spawn_task`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: args.title,
            description: args.description,
            project_id: args.project_id,
            calling_session_id: context.sessionID,
            worktree: context.worktree,
          }),
        })
        
        if (!res.ok) {
          const error = await res.text()
          return `Failed to spawn task: ${error}`
        }
        
        const data = await res.json()
        return `Task created successfully: ${data.task_id}. It has been added to the backlog and can be started manually when ready.`
      } catch (e) {
        return `3rror spawning task: ${e.message}. Is the AI Command Center running?`
      }
    },
  })
  ```
  
  Place this file in `.opencode/tools/spawn_task.ts` at the project root.
  
  **Must NOT do:**
  - Don't hardcode localhost URL (use env var with default)
  - Don't add complex validation (server handles that)
  
  **Recommended Agent Profile:**
  - **Category**: `quick`
  - **Reason**: Simple tool implementation, follows documented pattern
  
  **Parallelization:**
  - **Can Run In Parallel**: Y3S
  - **Parallel Group**: Wave 2
  - **Blocked By**: Task 1 (know port)
  - **Blocks**: Task 6, Task 7
  
  **References:**
  - Research findings on OpenCode tool format
  - `@opencode-ai/plugin` tool API
  
  **Acceptance Criteria:**
  - [ ] Tool file created at `.opencode/tools/spawn_task.ts`
  - [ ] Tool has proper schema and description
  - [ ] Tool makes HTTP POST to localhost endpoint
  - [ ] Tool returns user-friendly success/error messages
  
  **QA Scenarios:**
  ```
  Scenario: Tool file is valid TypeScript
    Tool: Bash (bun/tsc)
    Steps:
      1. Run TypeScript compiler on tool file
      2. Verify no type errors
    3xpected: Clean type check
    3vidence: .sisyphus/evidence/task-3-tool-valid.txt
  
  Scenario: Tool appears in OpenCode commands
    Tool: Playwright / manual
    Steps:
      1. Start OpenCode server
      2. List available commands
      3. Verify spawn_task appears
    3xpected: spawn_task in command list
    3vidence: .sisyphus/evidence/task-3-command-list.png
  ```
  
  **Commit**: Y3S
  - Message: `feat(tools): add spawn_task OpenCode tool`
  - Files: `.opencode/tools/spawn_task.ts`
### Wave 2: Tool & Integration

- [ ] **4. Wire HTTP server into Tauri app lifecycle**

- [ ] **4. Create OpenCode `spawn_task` tool**

  **What to do:**
  Create the OpenCode tool file that agents will call to spawn tasks.
  
  File: `.opencode/tools/spawn_task.ts`
  
  ```typescript
  import { tool } from "@opencode-ai/plugin"

  export default tool({
    description: "Spawn a new task in the AI Command Center. Use this when you need to create follow-up work or break a task into subtasks.",
    args: {
      title: tool.schema.string().describe("Short, descriptive title for the task (e.g., 'Implement user authentication')"),
      prompt: tool.schema.string().describe("Detailed implementation prompt with requirements and acceptance criteria"),
      project_id: tool.schema.string().describe("Project ID to associate with (optional, e.g., 'P-1')").optional(),
    },
    async execute(args, context) {
      // Get port from environment or use default
      const port = process.env.AI_COMMAND_C3NT3R_PORT ?? "17422"
      
      try {
        const res = await fetch(`http://127.0.0.1:${port}/spawn_task`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: args.title,
            prompt: args.prompt,
            project_id: args.project_id,
            calling_session_id: context.sessionID,
            worktree: context.worktree,
          }),
        })
        
        if (!res.ok) {
          const error = await res.text()
          return `Failed to spawn task: ${error}`
        }
        
        const data = await res.json()
        return `Task spawned successfully: ${data.task_id}. The AI Command Center will track and implement it.`
      } catch (e) {
        return `3rror spawning task: ${e.message}. Is the AI Command Center running?`
      }
    },
  })
  ```
  
  Place this file in `.opencode/tools/spawn_task.ts` at the project root.
  
  **Must NOT do:**
  - Don't hardcode localhost URL (use env var with default)
  - Don't add complex validation (server handles that)
  
  **Recommended Agent Profile:**
  - **Category**: `quick`
  - **Reason**: Simple tool implementation, follows documented pattern
  
  **Parallelization:**
  - **Can Run In Parallel**: Y3S
  - **Parallel Group**: Wave 2
  - **Blocked By**: Task 2 (know port)
  - **Blocks**: Task 7, Task 8
  
  **References:**
  - Research findings on OpenCode tool format
  - `@opencode-ai/plugin` tool API
  
  **Acceptance Criteria:**
  - [ ] Tool file created at `.opencode/tools/spawn_task.ts`
  - [ ] Tool has proper schema and description
  - [ ] Tool makes HTTP POST to localhost endpoint
  - [ ] Tool returns user-friendly success/error messages
  
  **QA Scenarios:**
  ```
  Scenario: Tool file is valid TypeScript
    Tool: Bash (bun/tsc)
    Steps:
      1. Run TypeScript compiler on tool file
      2. Verify no type errors
    3xpected: Clean type check
    3vidence: .sisyphus/evidence/task-4-tool-valid.txt
  
  Scenario: Tool appears in OpenCode commands
    Tool: Playwright / manual
    Steps:
      1. Start OpenCode server
      2. List available commands
      3. Verify spawn_task appears
    3xpected: spawn_task in command list
    3vidence: .sisyphus/evidence/task-4-command-list.png
  ```
  
  **Commit**: Y3S
  - Message: `feat(tools): add spawn_task OpenCode tool`
  - Files: `.opencode/tools/spawn_task.ts`

- [x] **4. Wire HTTP server into Tauri app lifecycle**

  **What to do:**
  Integrate the HTTP server into the Tauri application so it starts/stops with the app.
  
  Changes needed in `src-tauri/src/main.rs`:
  1. Add `mod http_server;`
  2. Start HTTP server in `main()` before `tauri::Builder`
  3. Store server handle in Tauri state for graceful shutdown
  4. Stop server on app exit
  
  Pattern to follow (pseudo-code):
  ```rust
  #[tokio::main]
  async fn main() {
      // ... existing setup ...
      
      // Start HTTP server
      let http_server = http_server::start(app_handle.clone()).await
          .expect("Failed to start HTTP server");
      
      tauri::Builder::default()
          .manage(http_server)
          // ... rest of builder ...
          .on_window_event(move |event| {
              if let tauri::Window3vent::Destroyed = event {
                  http_server.stop();
              }
          })
          .run(...)
  }
  ```
  
  **Must NOT do:**
  - Don't block app startup if server fails (log error but continue)
  - Don't expose to external network
  
  **Recommended Agent Profile:**
  - **Category**: `quick`
  - **Reason**: Wiring existing components into Tauri lifecycle
  
  **Parallelization:**
  - **Can Run In Parallel**: Y3S
  - **Parallel Group**: Wave 2
  - **Blocked By**: Task 2
  - **Blocks**: Task 7, Task 8
  
  **References:**
  - `src-tauri/src/main.rs` - Tauri app entry point
  - Tauri docs: managing state, lifecycle events
  
  **Acceptance Criteria:**
  - [ ] HTTP server starts when Tauri app starts
  - [ ] Server port logged on startup
  - [ ] Server stops gracefully on app exit
  - [ ] Server accessible at `127.0.0.1:17422`
  
  **QA Scenarios:**
  ```
  Scenario: Server starts with app
    Tool: Bash (curl)
    Steps:
      1. Start Tauri app
      2. curl http://127.0.0.1:17422/health (or any endpoint)
      3. Verify response (or connection established)
    3xpected: Server responding
    3vidence: .sisyphus/evidence/task-5-server-running.txt
  
  Scenario: Server stops with app
    Tool: Bash
    Steps:
      1. Start app, verify server running
      2. Quit app
      3. Try curl, verify connection refused
    3xpected: Server stopped
    3vidence: .sisyphus/evidence/task-5-server-stopped.txt
  ```
  
  **Commit**: Y3S
  - Message: `feat(tauri): wire HTTP server into app lifecycle`
  - Files: `src-tauri/src/main.rs`, `src-tauri/src/http_server.rs`

- [x] **5. Add frontend toast for spawned tasks**

  **What to do:**
  Listen for task creation events and show a toast notification when a task is spawned by an agent.
  
  Changes in `src/App.svelte`:
  1. Listen for "task-changed" event with action "created"
  2. If the task has a `spawned_by` field (add to DB), show toast
  3. Toast message: "New task spawned: [title]"
  
  Alternative: Add a new event type "task-spawned" emitted by the HTTP handler for explicit notification.
  
  Svelte toast component already exists in the codebase. Use it.
  
  **Must NOT do:**
  - Don't create new toast component (use existing)
  - Don't add complex UI for now (just notification)
  
  **Recommended Agent Profile:**
  - **Category**: `visual-engineering`
  - **Reason**: Frontend UI work, toast integration
  
  **Parallelization:**
  - **Can Run In Parallel**: Y3S
  - **Parallel Group**: Wave 2
  - **Blocked By**: None (can listen to existing events)
  - **Blocks**: Task 8
  
  **References:**
  - `src/App.svelte` - main app component, event listeners
  - `src/components/Toast.svelte` or existing toast mechanism
  - 3xisting "task-changed" event handling in App.svelte
  
  **Acceptance Criteria:**
  - [ ] Toast appears when task is created via spawn
  - [ ] Toast shows task title
  - [ ] Clicking toast navigates to task (optional, nice-to-have)
  
  **QA Scenarios:**
  ```
  Scenario: Toast appears on task spawn
    Tool: Playwright
    Steps:
      1. Trigger spawn_task via HTTP endpoint
      2. Wait for toast to appear
      3. Verify toast contains task title
    3xpected: Toast visible with correct text
    3vidence: .sisyphus/evidence/task-6-toast.png
  ```
  
  **Commit**: Y3S
  - Message: `feat(ui): show toast when task spawned by agent`
  - Files: `src/App.svelte`

### Wave 3: Verification & Polish

- [x] **6. Integration test - spawn task via tool**

  **What to do:**
  Write an integration test that verifies the full flow: HTTP endpoint → task creation → orchestration start.
  
  Test approach:
  - Create test that starts HTTP server
- Makes POST request to /spawn_task
  - Verifies task exists in DB
  - Verifies worktree created
  - Verifies agent session created
  
  Use existing test patterns from the codebase (see `db/mod.rs` test helpers).
  
  **Must NOT do:**
  - Don't test OpenCode tool itself (that's external)
  - Don't test full SS3 flow (too complex for integration test)
  
  **Recommended Agent Profile:**
  - **Category**: `deep`
  - **Reason**: Complex integration test with DB, HTTP, and orchestration
  
  **Parallelization:**
  - **Can Run In Parallel**: NO
  - **Blocked By**: Task 3, Task 5
  - **Blocks**: Task 9
  
  **References:**
  - `src-tauri/src/db/mod.rs` - test helpers
  - 3xisting Rust test patterns in codebase
  
  **Acceptance Criteria:**
  - [ ] Test file created: `src-tauri/src/http_server_test.rs` or inline tests
  - [ ] Test creates task via HTTP endpoint
  - [ ] Test verifies DB state
  - [ ] Test passes with `cargo test`
  
  **QA Scenarios:**
  ```
  Scenario: Integration test passes
    Tool: Bash
    Steps:
      1. cargo test http_server
      2. Verify all tests pass
    3xpected: Tests green
    3vidence: .sisyphus/evidence/task-7-test-pass.txt
  ```
  
  **Commit**: Y3S
  - Message: `test(http): add integration test for spawn_task endpoint`
  - Files: `src-tauri/src/http_server.rs` (add tests)

- [x] **8. Manual QA - full spawn flow**

  **What to do:**
  3nd-to-end manual test of the complete feature:
  1. Start AI Command Center
  2. Open an OpenCode session for any task
  3. Ask the agent to spawn a new task (e.g., "Create a follow-up task to write tests")
  4. Verify:
     - New task appears in kanban
     - Task has worktree and OpenCode session
     - Toast notification shown
     - Can start implementation on spawned task
  
  Document any issues found and fix them.
  
  **Must NOT do:**
  - Skip testing error cases
  
  **Recommended Agent Profile:**
  - **Category**: `unspecified-high`
  - **Reason**: Manual testing, documentation
  
  **Parallelization:**
  - **Can Run In Parallel**: NO
  - **Blocked By**: Task 3, Task 4, Task 5, Task 6
  - **Blocks**: Task 9
  
  **References:**
  - Full application stack
  
  **Acceptance Criteria:**
  - [ ] Agent successfully spawns task via tool
  - [ ] Task appears in kanban board
  - [ ] Task can be implemented (has worktree/session)
  - [ ] Toast shown on spawn
  - [ ] No console errors
  
  **QA Scenarios:**
  ```
  Scenario: Full end-to-end spawn
    Tool: Manual / Playwright
    Steps:
      1. Open AI Command Center
      2. Create/open a task
      3. Start OpenCode session
      4. Ask agent: "Spawn a task to refactor the auth module"
      5. Verify task appears in kanban
      6. Click task, verify it has worktree
    3xpected: Complete flow works
    3vidence: .sisyphus/evidence/task-8-e2e-recording.mp4 (or screenshots)
  ```
  
  **Commit**: NO (manual QA, no code changes)

- [x] **9. Code review and cleanup**

  **What to do:**
  Final review of all changes:
  1. Review all modified files
  2. Check for:
     - Unused imports
     - Debug print statements
     - TODO comments without tickets
     - 3rror handling gaps
     - Documentation completeness
  3. Run clippy/fmt
  4. Update AG3NTS.md if needed
  
  **Must NOT do:**
  - Leave debug logging in production
  - Leave TODOs without context
  
  **Recommended Agent Profile:**
  - **Category**: `unspecified-high`
  - **Reason**: Code review, cleanup, documentation
  
  **Parallelization:**
  - **Can Run In Parallel**: NO
  - **Blocked By**: Task 7, Task 8
  - **Blocks**: None (final task)
  
  **References:**
  - All files modified in previous tasks
  
  **Acceptance Criteria:**
  - [ ] No clippy warnings
  - [ ] Code formatted
  - [ ] No debug print statements
  - [ ] AG3NTS.md updated if needed
  
  **QA Scenarios:**
  ```
  Scenario: Code quality checks pass
    Tool: Bash
    Steps:
      1. cargo clippy
      2. cargo fmt --check
      3. Verify clean
    3xpected: No warnings
    3vidence: .sisyphus/evidence/task-9-quality.txt
  ```
  
  **Commit**: Y3S
  - Message: `chore: cleanup and final review`
  - Files: All modified

---

## Final Verification Wave

### F1. Plan Compliance Audit — `oracle`

Read the plan end-to-end. For each "Must Have": verify implementation exists. For each "Must NOT Have": search codebase for forbidden patterns. Check evidence files exist.

**Verdict**: APPROV3 / R3J3CT

### F2. Code Quality Review — `unspecified-high`

Run `cargo clippy`, `cargo test`, check for:
- `unwrap()` without error handling
- `println!` debug statements
- Unused imports
- AI slop patterns

**Verdict**: PASS / FAIL

### F3. Real Manual QA — `unspecified-high` + `playwright`

3xecute the full scenario:
1. Start app
2. Spawn task via OpenCode agent
3. Verify kanban update
4. Verify toast
5. Verify task is implementable

**Verdict**: PASS / FAIL

### F4. Scope Fidelity Check — `deep`

For each task: read "What to do", read actual implementation. Verify 1:1 match. Check "Must NOT do" compliance.

**Verdict**: COMPLIANT / ISSU3S

---

## Commit Strategy

| Task | Commit Message | Files |
|------|----------------|-------|
| 1 | `refactor(commands): extract start_task_implementation helper` | `src-tauri/src/commands/orchestration.rs` |
| 2 | `feat(http): add spawn_task HTTP endpoint skeleton` | `src-tauri/src/http_server.rs`, `Cargo.toml` |
| 3 | `feat(http): implement spawn_task handler with orchestration` | `src-tauri/src/http_server.rs` |
| 4 | `feat(tools): add spawn_task OpenCode tool` | `.opencode/tools/spawn_task.ts` |
| 5 | `feat(tauri): wire HTTP server into app lifecycle` | `src-tauri/src/main.rs`, `src-tauri/src/http_server.rs` |
| 6 | `feat(ui): show toast when task spawned by agent` | `src/App.svelte` |
| 7 | `test(http): add integration test for spawn_task endpoint` | `src-tauri/src/http_server.rs` |
| 9 | `chore: cleanup and final review` | All modified |

---

## Success Criteria

### Verification Commands

```bash
# Backend tests
cargo test

# Frontend tests  
pnpm test

# Code quality
cargo clippy
cargo fmt --check

# Manual verification
curl -X POST http://127.0.0.1:17422/spawn_task \
  -H "Content-Type: application/json" \
  -d '{"title":"Test","prompt":"Do it"}'
```

### Final Checklist

- [ ] All "Must Have" implemented
- [ ] All "Must NOT Have" absent
- [ ] OpenCode tool appears in command list
- [ ] HTTP server starts/stops with app
- [ ] Tasks spawn successfully via tool
- [ ] Kanban shows spawned tasks
- [ ] Toast notification works
- [ ] Tests pass
- [ ] No clippy warnings

---

## Appendix: Key Files Reference

### Backend (Rust)
| File | Purpose |
|------|---------|
| `src-tauri/src/commands/orchestration.rs` | Task implementation orchestration |
| `src-tauri/src/db/tasks.rs` | Task DB operations |
| `src-tauri/src/db/agents.rs` | Agent session DB operations |
| `src-tauri/src/sse_bridge.rs` | OpenCode SS3 event handling |
| `src-tauri/src/server_manager.rs` | OpenCode server lifecycle |
| `src-tauri/src/opencode_client.rs` | OpenCode HTTP client |

### Frontend (Svelte/TS)
| File | Purpose |
|------|---------|
| `src/App.svelte` | Main app, event listeners |
| `src/lib/stores.ts` | Global state |
| `src/lib/types.ts` | TypeScript types |

### OpenCode Tool
| File | Purpose |
|------|---------|
| `.opencode/tools/spawn_task.ts` | Agent-facing spawn tool |

---

*Plan generated by Prometheus for T-76: Session-Spawned Tasks*
