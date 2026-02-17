# Draft: OpenCode + oh-my-opencode + Git Worktree Integration

## Requirements (confirmed)
- Switch from generic "opencode" to oh-my-opencode's agent model (Sisyphus, Oracle, Librarian, etc.)
- Use git worktrees so agent works in isolation while user keeps their checkout clean
- Allow the app to check out repos (clone)
- Reserve a dedicated folder in user's home directory for all agent workspaces
- Users can commit and edit in their own checkout independently

## Research Findings

### Current System
- OpenCode v1.2.6 installed, oh-my-opencode plugin active in `~/.config/opencode/opencode.json`
- Current codebase spawns `opencode serve --port 4096 --hostname 127.0.0.1` at app startup
- Single shared server for all operations, hardcoded port
- Simple orchestrator with 4 stages: read_ticket → implement → create_pr → address_comments
- Blocking prompt/response model (no streaming)
- Works in whatever directory opencode was started from (currently the app directory)

### OpenCode Serve API (v1.2.6) - Much Richer Than Currently Used
- Full session CRUD with parentID support
- **Message endpoint supports `agent` parameter** — can specify which agent handles the prompt
- **`prompt_async`** — non-blocking message sending
- **SSE event stream** at `/event` and `/global/event`
- **Command endpoint** — execute slash commands (`/start-work`, etc.)
- **Session diff** — get file diffs per session
- **Session abort** — proper abort support
- **Project/Path/VCS** endpoints — project awareness
- **Agent listing** — `/agent` endpoint lists available agents

### oh-my-opencode Agent Model
- **Sisyphus**: Main coding agent (Opus 4.6)
- **Prometheus**: Strategic planner (interview → plan → execute)
- **Atlas**: Orchestrator that executes plans
- **Oracle**: Architecture/debugging consultant (GPT-5.2)
- **Librarian**: Docs/OSS research (GLM-4.7)
- **Explore**: Fast codebase grep (Grok Code)
- **Categories**: visual-engineering, ultrabrain, deep, quick, etc.
- **Workflow**: Prometheus interviews → generates plan → /start-work → Atlas orchestrates → Junior executes

### Git Worktree Concept
- `git worktree add <path> <branch>` creates an isolated working directory
- Agent works in worktree → user's main checkout untouched
- Can have multiple worktrees per repo (one per ticket)
- Worktree shares .git history with main repo

## Technical Decisions (CONFIRMED)
- **Home directory**: `~/.ai-command-center` — contains worktrees, config, etc.
- **Server model**: One OpenCode server per active worktree (dynamic ports, full isolation)
- **Repo source**: User points app at a folder containing multiple git repos (subfolders). One JIRA project = one repo.
- **Orchestration**: Replace current 4-stage checkpoint flow with oh-my-opencode native. Backend becomes thin coordinator: create sessions, pass ticket context, monitor via SSE.
- **Agent model**: Use oh-my-opencode's agents (Sisyphus, Oracle, Librarian, etc.) and categories

## Repo Model (CONFIRMED)
User's exact words: "It actually doesn't need to map anything. Per task I want to select where it needs to make code modifications."

→ User has a "repos root" folder (e.g. `~/workspace/`) with multiple git repo subfolders
→ App scans for repos, presents them as choices
→ When starting a task on a ticket, user SELECTS which repo to work in (no auto-mapping)
→ Worktree created per ticket inside `~/.ai-command-center/worktrees/{repo-name}/{ticket-id}/`

## Agent Progress UI (CONFIRMED)
- Live SSE stream from OpenCode: tool calls, messages, thinking, events
- Real-time in the app
- User can abort
- Replaces old checkpoint approve/reject panels

## Worktree Lifecycle (CONFIRMED)
- Created when agent starts work on a ticket + repo
- Lives until PR is merged
- Auto-cleanup when PR merge detected (from GitHub poller)

## Task Start Flow (CONFIRMED)
1. Right-click ticket → "Start Implementation"
2. Dialog shows discovered repos from repos root
3. User picks a repo
4. App creates worktree + branch, spawns OpenCode serve in worktree dir
5. Sends ticket context (title, description, acceptance criteria) as initial prompt
6. Agent starts working, SSE events stream into UI

## Branch Naming (CONFIRMED)
Pattern: `{ticket-id}/{short-description}` (e.g. `PROJ-42/add-auth-module`)
Description auto-generated from ticket title (slugified)

## Repos Root (CONFIRMED)
Single path in Settings. App scans subdirectories for git repos.

## Test Strategy (CONFIRMED)
No tests for now. Ship the feature first.

## NEW REQUIREMENT: Multi-Project Support (in discussion)
User wants to work across multiple repositories, each with its own JIRA project.
Needs a "project" concept that scopes: tickets, kanban board, JIRA config, GitHub repo, worktrees.
Currently everything is scoped to ONE flat config (one jira_board_id, one github_default_repo).

### Options Under Consideration
- **Option A: Projects table in single DB** — Add `projects` table, FK everything to project_id, project switcher in UI
- **Option B: Separate DB per project** — Each project = own SQLite file, app loads one at a time
- **Option C: Repos root scan + auto-project** — Scan folder, each repo auto-becomes a project

### Impact on Previous Decisions
- Repos root scanning is STILL needed (for discovering repos)
- But now each discovered repo becomes a "project" with its own JIRA config
- JIRA sync must be per-project
- GitHub poller must be per-project
- Kanban board is per-project (filtered)
- Settings become per-project (JIRA creds, GitHub repo, etc.) + some global (repos root path)

## Plan Strategy (CONFIRMED)
- Execute `decouple-jira.md` plan FIRST (14 tasks, already written)
- Then generate this worktree/multi-project plan as a FOLLOW-UP
- This plan assumes decouple-jira is complete: local tasks with T-N IDs, optional JIRA links, TaskRow struct

## Settings Model (CONFIRMED)
- **ALL settings per-project** — every setting lives at the project level
- No global settings except maybe repos root path (implicit from app state)
- Each project stores: JIRA credentials, JIRA board ID, GitHub repo, GitHub token, OpenCode config
- This means different JIRA instances per project are supported
- Settings UI: per-project settings panel (shown when project is selected)

## Scope Boundaries
- INCLUDE: Multi-project support (projects table, project switcher UI), git worktree management, per-worktree OpenCode server lifecycle, oh-my-opencode native agent integration, SSE streaming UI, repos root scanning, project setup flow, per-project settings
- EXCLUDE: Automated tests, Prometheus planning UI, multi-root-path support, drag-and-drop, anything already covered by decouple-jira plan
