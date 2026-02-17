# AI Command Center - v1 MVP Plan

## Vision
A local-first desktop cockpit (Tauri + Svelte) that orchestrates AI-powered development workflows. Shows JIRA tickets flowing through automated stages (Implement → Review → Test), with full visibility and control over AI agents working on each ticket.

---

## Technical Stack

### Frontend
- **Framework**: Svelte + TypeScript
- **UI Library**: TailwindCSS + shadcn-svelte (or similar component library)
- **State Management**: Svelte stores + Tauri IPC
- **HTTP Client**: Fetch API for OpenCode REST API

### Backend (Tauri - Rust)
- **Desktop Framework**: Tauri 2.0
- **Process Management**: Spawn `opencode web` as child process
- **Database**: SQLite (via `rusqlite` or Tauri SQL plugin)
- **HTTP Client**: `reqwest` for JIRA/GitHub API calls
- **Async Runtime**: Tokio

### External Services
- **AI Agent**: OpenCode (assumes installed on system)
- **Project Management**: JIRA Cloud (API tokens)
- **Version Control**: GitHub (gh CLI + REST API)

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Tauri App (Desktop)                   │
├─────────────────────────────────────────────────────────┤
│  Frontend (Svelte)                                       │
│  ├─ Kanban Board (ticket cards in stage columns)        │
│  ├─ Live Log Viewer (streaming agent output)            │
│  ├─ Checkpoint Approval UI (pause points)               │
│  └─ PR Comment Batch UI (select which to address)       │
├─────────────────────────────────────────────────────────┤
│  Backend (Rust)                                          │
│  ├─ OpenCode Process Manager (spawn/monitor/kill)       │
│  ├─ Orchestrator (checkpoint-based agent control)       │
│  ├─ JIRA Sync Service (poll tickets every 60s)          │
│  ├─ GitHub Poller (poll PR comments every 30-60s)       │
│  ├─ SQLite Database (state persistence)                 │
│  └─ Tauri Commands (IPC bridge to frontend)             │
└─────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
   OpenCode Server      JIRA Cloud API      GitHub REST API
   (localhost:4096)     (api tokens)        (gh CLI / API)
```

---

## Data Model

### SQLite Schema

```sql
-- Tickets tracked by the cockpit
CREATE TABLE tickets (
  id TEXT PRIMARY KEY,              -- JIRA ticket key (e.g., "PROJ-123")
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,             -- "todo", "in_progress", "in_review", "testing", "done"
  jira_status TEXT,                 -- Original JIRA status name
  assignee TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Agent sessions (one per ticket implementation)
CREATE TABLE agent_sessions (
  id TEXT PRIMARY KEY,              -- UUID
  ticket_id TEXT NOT NULL,          -- FK to tickets.id
  opencode_session_id TEXT,         -- OpenCode session ID
  stage TEXT NOT NULL,              -- "read_ticket", "implement", "create_pr", "address_comments"
  status TEXT NOT NULL,             -- "running", "paused", "completed", "failed"
  checkpoint_data TEXT,             -- JSON: data shown at checkpoint (diff, PR details, etc.)
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (ticket_id) REFERENCES tickets(id)
);

-- Agent logs (streaming output from OpenCode)
CREATE TABLE agent_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  log_type TEXT NOT NULL,          -- "stdout", "stderr", "event", "checkpoint"
  content TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES agent_sessions(id)
);

-- Pull requests linked to tickets
CREATE TABLE pull_requests (
  id INTEGER PRIMARY KEY,           -- GitHub PR number
  ticket_id TEXT NOT NULL,
  repo_owner TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  state TEXT NOT NULL,              -- "open", "closed", "merged"
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (ticket_id) REFERENCES tickets(id)
);

-- PR comments (for batch & present)
CREATE TABLE pr_comments (
  id INTEGER PRIMARY KEY,           -- GitHub comment ID
  pr_id INTEGER NOT NULL,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  comment_type TEXT NOT NULL,       -- "review_comment", "issue_comment"
  file_path TEXT,                   -- For inline comments
  line_number INTEGER,              -- For inline comments
  addressed BOOLEAN DEFAULT 0,      -- User marked as addressed
  created_at INTEGER NOT NULL,
  FOREIGN KEY (pr_id) REFERENCES pull_requests(id)
);

-- App configuration
CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Default config values
INSERT INTO config (key, value) VALUES
  ('jira_api_token', ''),
  ('jira_board_id', ''),
  ('jira_username', ''),                    -- For "assigned to me" filter
  ('filter_assigned_to_me', 'true'),        -- Default: only show my tickets
  ('exclude_done_tickets', 'true'),         -- Default: hide Done tickets
  ('custom_jql', ''),                       -- Advanced: custom JQL filter
  ('github_token', ''),
  ('github_default_repo', ''),
  ('opencode_port', '4096'),
  ('opencode_auto_start', 'true'),
  ('jira_poll_interval', '60'),             -- seconds
  ('github_poll_interval', '30');           -- seconds
```

---

## Core Workflows

### 1. Ticket Implementation (Checkpoint-Based)

**User Action**: Drag ticket from "To Do" to "In Progress" (or click "Start Implementation")

**Orchestrator Flow**:

```
1. Create agent_session (stage="read_ticket", status="running")
2. Spawn OpenCode session via REST API:
   POST /sessions { title: "Implement PROJ-123" }
3. Send prompt:
   POST /sessions/{id}/prompt
   {
     parts: [{ type: "text", text: "Read JIRA ticket PROJ-123 and propose implementation approach" }]
   }
4. Subscribe to SSE stream: GET /events
5. Stream logs to agent_logs table + frontend (live viewer)
6. Detect completion (parse SSE events for assistant message end)
7. Update session: stage="read_ticket", status="paused"
8. Extract proposal from response, store in checkpoint_data
9. Show checkpoint in UI: "Agent proposes: [approach]. Approve?"

--- USER APPROVES ---

10. Update session: stage="implement", status="running"
11. Continue OpenCode session:
    POST /sessions/{id}/prompt
    {
      parts: [{ type: "text", text: "Approved. Implement the solution." }]
    }
12. Stream logs, wait for completion
13. Update session: stage="implement", status="paused"
14. Extract diff summary, store in checkpoint_data
15. Show checkpoint: "Implementation complete. Changes: [summary]. Approve?"

--- USER APPROVES ---

16. Update session: stage="create_pr", status="running"
17. Continue OpenCode session:
    POST /sessions/{id}/prompt
    {
      parts: [{ type: "text", text: "Create PR with title and description" }]
    }
18. Stream logs, wait for PR creation
19. Parse PR URL from logs, create pull_requests record
20. Update session: stage="create_pr", status="completed"
21. Auto-transition JIRA: In Progress → In Review (if enabled)
22. Show success: "PR created: [url]"
```

**Error Handling**:
- If any step fails → status="failed", store error_message, show in UI
- User can retry from last checkpoint or abort

---

### 2. PR Comment Response (Batch & Present)

**Trigger**: GitHub poller detects new comments on PR

**Orchestrator Flow**:

```
1. Poller runs every 30-60s:
   - For each open PR in pull_requests table
   - GET /repos/{owner}/{repo}/pulls/{number}/comments
   - Compare with pr_comments table, insert new comments
2. Frontend shows badge: "3 new comments on PROJ-123"
3. User clicks ticket → sees comment list
4. User selects comments to address (checkboxes)
5. User clicks "Address Selected Comments"
6. Orchestrator:
   - Find existing agent_session for ticket
   - Create new session stage="address_comments", status="running"
   - Resume OpenCode session (same opencode_session_id):
     POST /sessions/{opencode_session_id}/prompt
     {
       parts: [{
         type: "text",
         text: "Address these PR comments:\n\n[comment 1]\n[comment 2]\n\nFix valid issues, respond to invalid ones."
       }]
     }
7. Stream logs, wait for completion
8. Update session: status="completed"
9. Mark comments as addressed=1
10. Show success: "Comments addressed. Check PR for updates."
```

---

### 3. JIRA Sync (Polling)

**Background Service** (runs every 60s):

```rust
async fn sync_jira_tickets(db: &Database, jira_client: &JiraClient, config: &AppConfig) {
    // 1. Build JQL query based on config
    let jql = build_jql_query(config);
    // Example: "assignee = currentUser() AND status IN ('To Do', 'In Progress', 'In Review', 'Testing')"
    
    // 2. Fetch tickets from JIRA using JQL
    let jira_tickets = jira_client.search_issues(&jql).await?;
    
    // 3. For each ticket:
    for jira_ticket in jira_tickets {
        // 4. Upsert into tickets table
        db.upsert_ticket(Ticket {
            id: jira_ticket.key,
            title: jira_ticket.fields.summary,
            description: jira_ticket.fields.description,
            status: map_jira_status(&jira_ticket.fields.status.name),
            jira_status: jira_ticket.fields.status.name,
            assignee: jira_ticket.fields.assignee.map(|a| a.display_name),
            updated_at: now(),
        }).await?;
    }
    
    // 5. Emit event to frontend: "jira-sync-complete"
    app.emit("jira-sync-complete", ())?;
}

fn build_jql_query(config: &AppConfig) -> String {
    let mut clauses = vec![];
    
    // Filter by assignee if enabled (default: ON)
    if config.filter_assigned_to_me {
        clauses.push("assignee = currentUser()".to_string());
    }
    
    // Filter by board/project if configured
    if let Some(board_id) = &config.jira_board_id {
        clauses.push(format!("project = {}", board_id));
    }
    
    // Exclude "Done" tickets by default (configurable)
    if config.exclude_done_tickets {
        clauses.push("status != Done".to_string());
    }
    
    // Custom JQL from config (advanced users)
    if let Some(custom_jql) = &config.custom_jql {
        clauses.push(custom_jql.clone());
    }
    
    // Combine with AND
    clauses.join(" AND ")
}

fn map_jira_status(jira_status: &str) -> String {
    match jira_status {
        "To Do" => "todo",
        "In Progress" => "in_progress",
        "In Review" | "Code Review" => "in_review",
        "Testing" | "QA" => "testing",
        "Done" | "Closed" => "done",
        _ => "todo", // Default
    }
}
```

---

### 4. GitHub PR Comment Polling

**Background Service** (runs every 30-60s):

```rust
async fn poll_pr_comments(db: &Database, github_client: &GitHubClient) {
    // 1. Get all open PRs from pull_requests table
    let prs = db.get_open_prs().await?;
    
    for pr in prs {
        // 2. Fetch comments from GitHub
        let comments = github_client.get_pr_comments(&pr.repo_owner, &pr.repo_name, pr.id).await?;
        
        // 3. For each comment:
        for comment in comments {
            // 4. Check if already in pr_comments table
            if db.comment_exists(comment.id).await? {
                continue;
            }
            
            // 5. Insert new comment
            db.insert_pr_comment(PrComment {
                id: comment.id,
                pr_id: pr.id,
                author: comment.user.login,
                body: comment.body,
                comment_type: detect_comment_type(&comment),
                file_path: comment.path,
                line_number: comment.line,
                addressed: false,
                created_at: comment.created_at.timestamp(),
            }).await?;
            
            // 6. Emit event to frontend: "new-pr-comment"
            app.emit("new-pr-comment", NewCommentEvent {
                ticket_id: pr.ticket_id,
                comment_id: comment.id,
            })?;
        }
    }
}
```

---

## UI Components

### 1. Kanban Board

**Layout**:
```
┌─────────────────────────────────────────────────────────────────┐
│  To Do  │  In Progress  │  In Review  │  Testing  │  Done       │
├─────────┼───────────────┼─────────────┼───────────┼─────────────┤
│ ┌─────┐ │ ┌─────────┐   │ ┌─────────┐ │           │             │
│ │PROJ │ │ │ PROJ-124│   │ │ PROJ-125│ │           │             │
│ │ -123│ │ │ ⚙️ Running│   │ │ 💬 3 new│ │           │             │
│ └─────┘ │ └─────────┘   │ └─────────┘ │           │             │
└─────────┴───────────────┴─────────────┴───────────┴─────────────┘
```

**Card States**:
- **Idle**: Just ticket title
- **Running**: Spinner + current stage ("Implementing...")
- **Paused (checkpoint)**: ⏸️ icon + "Awaiting approval"
- **Failed**: ❌ icon + "Error: [message]"
- **New comments**: 💬 badge with count

**Interactions**:
- Click card → Open detail panel (right side)
- Drag card between columns → Trigger transition (if manual)
- Right-click → Context menu (Start, Abort, Retry, View PR)

---

### 2. Detail Panel (Right Side)

**Tabs**:
- **Overview**: Ticket title, description, status, assignee, PR link
- **Agent Logs**: Live streaming output from OpenCode (auto-scroll)
- **Checkpoints**: List of checkpoints with approve/reject buttons
- **PR Comments**: List of comments with checkboxes (batch & present)

**Checkpoint UI**:
```
┌─────────────────────────────────────────────────────────┐
│ Checkpoint: After Reading Ticket                        │
├─────────────────────────────────────────────────────────┤
│ Agent proposes:                                         │
│ 1. Add authentication middleware to /api/users          │
│ 2. Update User model with password hashing              │
│ 3. Write integration tests                              │
│                                                         │
│ [Approve] [Reject] [Edit Approach]                      │
└─────────────────────────────────────────────────────────┘
```

**PR Comments UI**:
```
┌─────────────────────────────────────────────────────────┐
│ PR Comments (3 new)                                     │
├─────────────────────────────────────────────────────────┤
│ ☐ @reviewer: "Consider using bcrypt instead of sha256"  │
│    src/auth.rs:45                                       │
│                                                         │
│ ☐ @reviewer: "Add error handling for null user"        │
│    src/api/users.rs:12                                  │
│                                                         │
│ ☐ @reviewer: "Nit: rename getUserById to getUser"      │
│    src/api/users.rs:8                                   │
│                                                         │
│ [Address Selected (2)] [Dismiss All]                    │
└─────────────────────────────────────────────────────────┘
```

---

### 3. Settings Panel

**Configuration**:
- **JIRA**: 
  - API token
  - Board ID or JQL filter
  - Your JIRA username/email (for "assigned to me" filter)
  - Status mapping (JIRA status → cockpit stage)
- **GitHub**: Personal access token, default repo
- **OpenCode**: Port (default 4096), auto-start toggle
- **Polling**: JIRA interval (default 60s), GitHub interval (default 30s)
- **Filters**: Toggle "Show only tickets assigned to me" (default: ON)

---

## Implementation Tasks

### Phase 1: Foundation (Tauri + OpenCode Integration)

- [x] **Task 1.1**: Initialize Tauri project with Svelte frontend
  - Parallelizable: No
  - Estimated effort: 1 hour
  - Deliverable: `tauri init` scaffold, Svelte app renders "Hello World"

- [x] **Task 1.2**: Set up SQLite database with schema
  - Parallelizable: No (depends on 1.1)
  - Estimated effort: 2 hours
  - Deliverable: Rust module with SQLite connection, migrations for all tables

- [x] **Task 1.3**: Implement OpenCode process manager (Rust)
  - Parallelizable: Yes (can work alongside 1.2)
  - Estimated effort: 3 hours
  - Deliverable: Rust module that spawns `opencode web`, polls `/health`, kills on exit

- [x] **Task 1.4**: Create OpenCode REST API client (Rust)
  - Parallelizable: Yes (can work alongside 1.3)
  - Estimated effort: 2 hours
  - Deliverable: Rust module with functions: `create_session()`, `send_prompt()`, `subscribe_events()`

- [x] **Task 1.5**: Implement Tauri commands for OpenCode control
  - Parallelizable: No (depends on 1.3, 1.4)
  - Estimated effort: 2 hours
  - Deliverable: Tauri commands: `start_opencode`, `stop_opencode`, `create_agent_session`, `send_prompt`

---

### Phase 2: JIRA Integration

- [ ] **Task 2.1**: Implement JIRA API client (Rust)
  - Parallelizable: Yes (independent of Phase 1)
  - Estimated effort: 3 hours
  - Deliverable: Rust module with functions: `search_issues(jql)`, `get_ticket_details()`, `transition_ticket()`

- [ ] **Task 2.2**: Implement JIRA sync service (background polling)
  - Parallelizable: No (depends on 2.1)
  - Estimated effort: 2 hours
  - Deliverable: Tokio task that polls JIRA every 60s with JQL filter (assignee = currentUser()), upserts tickets to DB, emits events

- [ ] **Task 2.3**: Create Tauri commands for JIRA operations
  - Parallelizable: No (depends on 2.1)
  - Estimated effort: 1 hour
  - Deliverable: Tauri commands: `sync_jira_now`, `get_tickets`, `transition_ticket`

---

### Phase 3: GitHub Integration

- [ ] **Task 3.1**: Implement GitHub API client (Rust)
  - Parallelizable: Yes (independent of Phase 1, 2)
  - Estimated effort: 3 hours
  - Deliverable: Rust module with functions: `get_pr_comments()`, `post_pr_comment()`, `get_pr_details()`

- [ ] **Task 3.2**: Implement GitHub PR comment poller (background)
  - Parallelizable: No (depends on 3.1)
  - Estimated effort: 2 hours
  - Deliverable: Tokio task that polls GitHub every 30-60s, inserts new comments to DB, emits events

- [ ] **Task 3.3**: Create Tauri commands for GitHub operations
  - Parallelizable: No (depends on 3.1)
  - Estimated effort: 1 hour
  - Deliverable: Tauri commands: `poll_pr_comments_now`, `get_pr_comments`, `mark_comment_addressed`

---

### Phase 4: Orchestrator (Checkpoint-Based Agent Control)

- [ ] **Task 4.1**: Implement orchestrator state machine (Rust)
  - Parallelizable: No (depends on 1.5, 2.3)
  - Estimated effort: 4 hours
  - Deliverable: Rust module with functions: `start_implementation()`, `approve_checkpoint()`, `handle_error()`

- [ ] **Task 4.2**: Implement checkpoint detection logic
  - Parallelizable: No (depends on 4.1)
  - Estimated effort: 2 hours
  - Deliverable: Logic to parse OpenCode responses, extract checkpoint data (proposal, diff, PR details)

- [ ] **Task 4.3**: Implement PR comment response orchestration
  - Parallelizable: No (depends on 4.1, 3.3)
  - Estimated effort: 2 hours
  - Deliverable: Function to resume OpenCode session with selected PR comments

- [ ] **Task 4.4**: Create Tauri commands for orchestrator control
  - Parallelizable: No (depends on 4.1, 4.2, 4.3)
  - Estimated effort: 1 hour
  - Deliverable: Tauri commands: `start_ticket_implementation`, `approve_checkpoint`, `address_pr_comments`

---

### Phase 5: Frontend (Svelte UI)

- [ ] **Task 5.1**: Build Kanban board component
  - Parallelizable: Yes (can start early with mock data)
  - Estimated effort: 4 hours
  - Deliverable: Svelte component with 5 columns, drag-and-drop, ticket cards

- [ ] **Task 5.2**: Build detail panel component
  - Parallelizable: Yes (can work alongside 5.1)
  - Estimated effort: 3 hours
  - Deliverable: Svelte component with tabs: Overview, Agent Logs, Checkpoints, PR Comments

- [ ] **Task 5.3**: Implement live log viewer (SSE streaming)
  - Parallelizable: No (depends on 5.2, 1.4)
  - Estimated effort: 2 hours
  - Deliverable: Svelte component that subscribes to OpenCode SSE stream, displays logs with auto-scroll

- [ ] **Task 5.4**: Build checkpoint approval UI
  - Parallelizable: No (depends on 5.2, 4.2)
  - Estimated effort: 2 hours
  - Deliverable: Svelte component showing checkpoint data with Approve/Reject buttons

- [ ] **Task 5.5**: Build PR comment batch UI
  - Parallelizable: No (depends on 5.2, 3.3)
  - Estimated effort: 2 hours
  - Deliverable: Svelte component with comment list, checkboxes, "Address Selected" button

- [ ] **Task 5.6**: Build settings panel
  - Parallelizable: Yes (independent)
  - Estimated effort: 2 hours
  - Deliverable: Svelte component with forms for JIRA (API token, board ID, username, filters), GitHub, OpenCode config

- [ ] **Task 5.7**: Implement Tauri IPC client (Svelte)
  - Parallelizable: No (depends on all Tauri commands)
  - Estimated effort: 2 hours
  - Deliverable: TypeScript module wrapping all Tauri commands with type-safe API

- [ ] **Task 5.8**: Wire up frontend to backend (state sync)
  - Parallelizable: No (depends on 5.1-5.7)
  - Estimated effort: 3 hours
  - Deliverable: Svelte stores synced with Tauri events, real-time UI updates

---

### Phase 6: Polish & Testing

- [ ] **Task 6.1**: Add error handling and user feedback
  - Parallelizable: No (depends on all phases)
  - Estimated effort: 2 hours
  - Deliverable: Toast notifications, error modals, loading states

- [ ] **Task 6.2**: Add OpenCode installation check
  - Parallelizable: Yes (independent)
  - Estimated effort: 1 hour
  - Deliverable: On startup, check if `opencode` CLI exists, show setup instructions if not

- [ ] **Task 6.3**: Write integration tests (Rust)
  - Parallelizable: Yes (can write alongside implementation)
  - Estimated effort: 3 hours
  - Deliverable: Tests for orchestrator, JIRA client, GitHub client

- [ ] **Task 6.4**: Write E2E tests (Playwright)
  - Parallelizable: Yes (can write alongside implementation)
  - Estimated effort: 3 hours
  - Deliverable: Tests for full workflow: start ticket → checkpoint → approve → PR created

- [ ] **Task 6.5**: Package and test distribution
  - Parallelizable: No (depends on all phases)
  - Estimated effort: 2 hours
  - Deliverable: Tauri build for macOS, test on clean machine

---

## Total Estimated Effort

- **Phase 1**: 10 hours
- **Phase 2**: 6 hours
- **Phase 3**: 6 hours
- **Phase 4**: 9 hours
- **Phase 5**: 20 hours
- **Phase 6**: 11 hours

**Total**: ~62 hours (roughly 8 full days of work)

---

## Success Criteria (v1 MVP)

1. ✅ User can see JIRA tickets in Kanban board
2. ✅ User can start ticket implementation from dashboard
3. ✅ Agent pauses at checkpoints (read ticket, after implementation, before PR)
4. ✅ User can approve/reject checkpoints from UI
5. ✅ Agent creates PR automatically after approval
6. ✅ User can see live agent logs streaming in real-time
7. ✅ User can see new PR comments in dashboard
8. ✅ User can select comments and trigger agent to address them
9. ✅ App persists state across restarts (SQLite)
10. ✅ App handles errors gracefully (shows error, allows retry)

---

## Future Enhancements (v2+)

- **JIRA write operations**: Move tickets between stages from dashboard
- **Automated testing phase**: AI runs test suite after PR approval
- **System tray + notifications**: Background running, desktop notifications
- **GitHub webhooks**: Replace polling with real-time webhook receiver
- **Multi-repo support**: Track tickets across multiple GitHub repos
- **Team features**: Share cockpit state, collaborate on tickets
- **Cloud deployment**: Run on always-on server, access from anywhere
- **Custom agent prompts**: Configure agent behavior per ticket type
- **Analytics dashboard**: Track agent success rate, time per stage, etc.

---

## Open Questions / Risks

1. **OpenCode stability**: Is the OpenCode server stable enough for long-running sessions? (Mitigation: Add auto-restart on crash)
2. **OpenCode session limits**: How many concurrent sessions can OpenCode handle? (Mitigation: Queue tickets if >5 concurrent)
3. **JIRA rate limits**: Will polling every 60s hit rate limits? (Mitigation: Exponential backoff, configurable interval)
4. **GitHub rate limits**: Will polling every 30s hit rate limits? (Mitigation: Use conditional requests with ETags)
5. **Checkpoint detection**: How reliable is parsing OpenCode responses for checkpoints? (Mitigation: Use structured output format if available)
6. **Error recovery**: What happens if OpenCode crashes mid-implementation? (Mitigation: Store session state, allow resume from last checkpoint)

---

## Next Steps

1. **Validate plan with user** — Confirm scope, architecture, and priorities
2. **Set up development environment** — Install Tauri, Rust, Svelte tooling
3. **Start with Phase 1** — Build foundation (Tauri + OpenCode integration)
4. **Iterate in phases** — Complete each phase, test, then move to next
5. **Deploy v1 MVP** — Package for macOS, test on user's machine
6. **Gather feedback** — Use for real work, identify pain points
7. **Plan v2** — Prioritize enhancements based on usage

---

**Ready to build?** Let me know if you want to refine any part of this plan, or if you're ready to start implementation!