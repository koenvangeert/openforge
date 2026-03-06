# Learnings — mcp-dynamic-titles

## 2026-03-06 Plan Start
- V5 migration uses `M::up_with_hook` pattern (not plain SQL). Follow the same for V6.
- `title TEXT NOT NULL` — keep constraint, use empty string `""` default
- `build_task_prompt()` is at orchestration.rs:5-28, uses `task.title` on line 15
- Existing `create_task.ts` plugin has auth bug (no bearer token) — moot since replacing with MCP
- Both providers (OpenCode + Claude Code) support MCP servers
- Token regenerates each app start — MCP server must read from env at invocation, not config parse time
- AGENTS.md mandates TDD: RED → GREEN → REFACTOR

## 2026-03-06 Task 3 — MCP server scaffold
- `@modelcontextprotocol/sdk` v1.12.0 installed; imports via `@modelcontextprotocol/sdk/server/mcp.js` and `/server/stdio.js`
- `McpServer` (high-level API) preferred over low-level `Server` class — simpler tool registration later
- Entry point is plain `.js` with `"type":"module"` in package.json — no TS build step needed
- `OPENFORGE_HTTP_PORT` (default `17422`) + `OPENFORGE_HTTP_TOKEN` read at top of module (invocation time)
- `console.error()` for server logs — stdout is reserved exclusively for JSON-RPC wire protocol
- `server.connect(transport)` must be awaited before the server handles messages
- Initialize response includes `serverInfo.name` + `serverInfo.version` from `new McpServer({name, version})`
- Tool-less server responds to `initialize` with `capabilities: {}` — no negotiation errors

## 2026-03-06 V6 Migration Implementation
- V6 migration successfully added with M::up_with_hook pattern (lines 420-432 in mod.rs)
- Both new columns (prompt, summary) are nullable TEXT fields
- Backfill hook copies title → prompt for all existing rows
- Test pattern: create V5 db, set user_version=5, insert test data, run migration, verify backfill
- rusqlite_migration automatically increments user_version based on migration count
- No explicit CURRENT_VERSION constant needed — version is implicit in Migrations::new(vec![...]) length
- All 71 db tests pass with no regressions

## 2026-03-06 Task 2 — TaskRow struct fields
- TaskRow struct now has `prompt: Option<String>` and `summary: Option<String>` fields
- All 4 SELECT queries in tasks.rs updated to include prompt, summary columns (indices 11, 12)
- create_task() signature extended: added `prompt: Option<&str>` parameter
- Backward compat: if prompt is None, defaults to title (line 32 in tasks.rs)
- New function: update_task_title_and_summary() with conditional UPDATE logic
- TDD approach: wrote 3 new tests first, then implemented code
- Test helpers across 8 files updated to include prompt, summary in INSERT/TaskRow
- All 13 db::tasks tests pass; no regressions
- Prompt field enables MCP server to store custom prompts per task (Task 5)
- Summary field enables task summaries from agent output (Task 12)

## 2026-03-06 Task 3 — HTTP /update_task endpoint
- TDD approach: wrote struct tests first (10 tests), then implemented handler
- UpdateTaskRequest struct: `task_id: String`, `title: Option<String>`, `summary: Option<String>`
- UpdateTaskResponse struct: `task_id: String`, `status: String`
- Handler validates at least one of title/summary is Some — returns 400 BAD_REQUEST if both None
- Handler pattern mirrors create_task_handler: lock DB → call method → drop lock → emit event → return JSON
- Event emitted: `{"action": "updated", "task_id": task_id}` on "task-changed" channel
- Route registered: `.route("/update_task", post(update_task_handler))` after /create_task
- All 51 http_server tests pass; full suite: 398 tests pass with no regressions
- Struct serialization tests cover: all fields, title only, summary only, neither (deserialize fails), roundtrip
- Response tests cover: creation, serialization, JSON structure
