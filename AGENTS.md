# AGENTS.md — AI Command Center

Tauri v2 desktop app: Svelte 4 + TypeScript frontend, Rust backend, SQLite database.
Manages JIRA tickets on a Kanban board with AI agent orchestration via OpenCode.

## Build & Run Commands

```bash
# Frontend
npm run dev              # Vite dev server (port 1420)
npm run build            # Vite production build
npm run test             # vitest run (all frontend tests)
npx vitest run src/components/Toast.test.ts          # single test file
npx vitest run -t "renders ticket id"                # single test by name

# Tauri (full desktop app)
npm run tauri:dev        # Dev mode (starts Vite + Rust)
npm run tauri:build      # Production build

# Rust backend (run from src-tauri/)
cargo build              # Build backend
cargo test               # All Rust tests
cargo test test_config_operations                     # single Rust test by name
cargo test --lib db::tests::test_config_operations    # fully qualified
```

## Project Structure

```
src/                          # Svelte frontend
  main.ts                     # App entry point
  App.svelte                  # Root component, global styles, event listeners
  components/                 # UI components (PascalCase.svelte)
    *.test.ts                 # Colocated test files
  lib/
    types.ts                  # All shared TypeScript interfaces and types
    stores.ts                 # Svelte writable stores (global state)
    ipc.ts                    # Typed wrappers around Tauri invoke()
  __mocks__/
    @tauri-apps/api/          # Vitest mocks for Tauri APIs

src-tauri/                    # Rust backend
  Cargo.toml                  # Rust dependencies
  tauri.conf.json             # Tauri window/build configuration
  src/
    main.rs                   # Tauri commands + app setup
    db.rs                     # SQLite database layer (rusqlite)
    orchestrator.rs           # AI agent workflow orchestration
    opencode_client.rs        # OpenCode API client
    opencode_manager.rs       # OpenCode server lifecycle
    jira_client.rs            # JIRA REST API client
    jira_sync.rs              # Background JIRA polling
    github_client.rs          # GitHub API client
    github_poller.rs          # Background GitHub PR polling
```

## TypeScript / Svelte Conventions

### Imports

Order: external packages, then internal modules. Use `import type` for type-only imports
(enforced by `verbatimModuleSyntax` in tsconfig).

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { listen } from '@tauri-apps/api/event'
  import type { UnlistenFn } from '@tauri-apps/api/event'
  import { tickets, selectedTicketId } from './lib/stores'
  import { getTickets } from './lib/ipc'
  import type { PullRequestInfo } from './lib/types'
  import KanbanBoard from './components/KanbanBoard.svelte'
```

### Naming

- **Files**: `PascalCase.svelte` for components, `camelCase.ts` for modules
- **Components**: PascalCase (`KanbanBoard`, `DetailPanel`)
- **Functions/variables**: camelCase (`loadTickets`, `selectedTicket`)
- **Types/interfaces**: PascalCase (`Ticket`, `AgentSession`, `KanbanColumn`)
- **Constants**: UPPER_SNAKE_CASE (`COLUMN_LABELS`, `COLUMNS`)
- **CSS classes**: kebab-case (`card-header`, `status-dot`)

### Types

All shared types live in `src/lib/types.ts` as exported interfaces. Use `interface` for
object shapes and `type` for unions/aliases. Nullable fields use `T | null`, not `T?`.

```ts
export interface Ticket {
  id: string;
  title: string;
  description: string | null;   // nullable, not optional
  status: string;
  created_at: number;           // Unix timestamps as numbers
}

export type KanbanColumn = "todo" | "in_progress" | "in_review" | "testing" | "done";
```

### State Management

Svelte writable stores in `src/lib/stores.ts`. Access with `$store` syntax in components.

```ts
export const tickets = writable<Ticket[]>([]);
export const error = writable<string | null>(null);
```

### IPC (Frontend ↔ Backend)

All Tauri `invoke()` calls go through typed wrappers in `src/lib/ipc.ts`. Never call
`invoke()` directly from components.

```ts
export async function getTickets(): Promise<Ticket[]> {
  return invoke<Ticket[]>("get_tickets");
}
```

### External Links

Tauri's webview does **not** support `<a href="..." target="_blank">` for opening external
URLs. Use the `openUrl()` IPC wrapper which calls a Tauri command to open the system browser.
Never use plain `<a>` tags for external links.

```svelte
<script lang="ts">
  import { openUrl } from '../lib/ipc'
</script>

<span class="link" role="link" tabindex="0"
  on:click={() => openUrl(url)}
  on:keydown={(e) => e.key === 'Enter' && openUrl(url)}
>Open link</span>
```

### Error Handling (Frontend)

try/catch in async functions. Log with `console.error`, set the `error` store for user-facing
messages. Always include `finally` for loading states.

```ts
async function loadTickets() {
  $isLoading = true
  try {
    $tickets = await getTickets()
  } catch (e) {
    console.error('Failed to load tickets:', e)
    $error = String(e)
  } finally {
    $isLoading = false
  }
}
```

### Styling

Component-scoped `<style>` blocks. Global CSS variables defined in `App.svelte` on `:root`.
Dark theme with Tokyo Night-inspired palette. No CSS framework — plain CSS with variables.

Key variables: `--bg-primary`, `--bg-secondary`, `--bg-card`, `--text-primary`,
`--text-secondary`, `--accent`, `--success`, `--warning`, `--error`, `--border`.

### TypeScript Config

Strict mode enabled. Key settings: `noUnusedLocals`, `noUnusedParameters`,
`verbatimModuleSyntax`, target ES2020. No ESLint or Prettier — rely on TypeScript strictness.

## Rust Conventions

### Module Organization

One file per module, declared in `main.rs` with `mod name;`. No nested module directories.
Additional modules not in original structure:
- `server_manager.rs` — OpenCode server process lifecycle per worktree
- `sse_bridge.rs` — SSE event bridge (OpenCode → Tauri frontend)
- `git_worktree.rs` — Git worktree creation/cleanup
- `agent_coordinator.rs` — Agent workflow orchestration

### Tauri Commands

All `#[tauri::command]` functions live in `main.rs`. They accept `State<'_>` parameters and
return `Result<T, String>`. Convert internal errors with `.map_err(|e| format!(...))`.

```rust
#[tauri::command]
async fn get_tickets(
    db: State<'_, Mutex<db::Database>>,
) -> Result<Vec<TicketRow>, String> {
    let db = db.lock().unwrap();
    db.get_all_tickets()
        .map_err(|e| format!("Failed to get tickets: {}", e))
}
```

### Error Handling (Backend)

Custom error enums per module implementing `Display` + `std::error::Error`.
Use `From` conversions for error chaining. Tauri commands convert to `String` at the boundary.

```rust
#[derive(Debug)]
pub enum JiraError {
    NetworkError(String),
    ApiError { status: u16, message: String },
    ParseError(String),
}

impl fmt::Display for JiraError { /* match variants */ }
impl StdError for JiraError {}
```

### Database Layer

`db.rs` owns all SQL. Structs with `#[derive(Debug, Clone, Serialize)]` and public fields
for rows. Database struct wraps `Arc<Mutex<Connection>>`. Methods take `&self` and lock
internally. Doc comments (`///`) on all public methods with argument descriptions.

### Naming (Rust)

- **Functions/variables**: snake_case
- **Types/structs/enums**: PascalCase
- **Files**: snake_case.rs
- **Constants**: UPPER_SNAKE_CASE

### Serde Patterns

Use `#[serde(flatten)] pub extra: serde_json::Value` on API response types to capture
unknown fields without failing deserialization. Use `#[serde(default)]` for optional fields.

### Section Separators

Use comment banners to separate logical sections in large files:
```rust
// ============================================================================
// Section Name
// ============================================================================
```

## Testing

### Frontend Tests (Vitest + Testing Library)

Colocated as `ComponentName.test.ts` next to the component. Tauri APIs auto-mocked via
`vitest.config.ts` path aliases pointing to `src/__mocks__/`.

```ts
import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import TicketCard from './TicketCard.svelte'
import type { Ticket } from '../lib/types'

const baseTicket: Ticket = { /* typed fixture */ }

describe('TicketCard', () => {
  it('renders ticket id and title', () => {
    render(TicketCard, { props: { ticket: baseTicket } })
    expect(screen.getByText('PROJ-42')).toBeTruthy()
  })
})
```

- Mock IPC functions with `vi.mock('../lib/ipc', () => ({ fn: vi.fn() }))`
- Use typed fixture objects at file top, spread for variants: `{ ...base, status: 'failed' }`
- Test environment: jsdom

### Rust Tests

Inline `#[cfg(test)] mod tests` at bottom of each file. Helper functions for common setup
(`make_test_db`, `insert_test_ticket`). Tests create temp SQLite databases and clean up after.

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_operations() {
        let (db, path) = make_test_db("config_ops");
        // ... assertions ...
        drop(db);
        let _ = fs::remove_file(&path);
    }
}
```

## OpenCode SSE Event Protocol

The app connects to OpenCode's HTTP server SSE endpoint (`/event`) via `sse_bridge.rs`.

### Wire Format

OpenCode sends SSE events with **only** a `data:` field — no `event:` field is set.
The event type lives inside the JSON payload under `type`, not in the SSE header.

```
data: {"type":"message.part.delta","properties":{"sessionID":"...","delta":"text"}}

data: {"type":"session.idle","properties":{"sessionID":"..."}}
```

All events follow this JSON structure:
```json
{ "type": "event.type.name", "properties": { /* event-specific */ } }
```

### Event Types Reference (from sst/opencode source)

**Streaming output:**
- `message.part.delta` — Text streaming chunk. `properties: { sessionID, messageID, partID, field, delta }`
- `message.part.updated` — Part finished/changed. `properties: { part }`
- `message.updated` — Full message update. `properties: { info }`
- `message.removed` — Message deleted. `properties: { messageID, sessionID }`

**Session lifecycle:**
- `session.status` — Status change (preferred). `properties: { sessionID, status: { type: "idle"|"busy"|"retry" } }`
- `session.idle` — Session done (deprecated, use session.status). `properties: { sessionID }`
- `session.error` — Error. `properties: { sessionID, error: { name, data } }`
- `session.created` — New session. `properties: { info }`
- `session.updated` — Session metadata changed. `properties: { info }`
- `session.deleted` — Session removed. `properties: { sessionID }`

**Server:**
- `server.connected` — Sent on initial SSE connection. `properties: {}`
- `server.heartbeat` — Keep-alive every 10s. `properties: {}`

**Other:**
- `todo.updated` — Agent todo list changed. `properties: { sessionID, todos[] }`
- `file.edited` — File written by agent. `properties: { file }`
- `permission.updated` / `permission.replied` — Permission prompts

### Architecture: Event Flow

```
OpenCode server (/event SSE)
  → sse_bridge.rs (Rust, per-task, connects to per-worktree OpenCode port)
    ├─ Persists session status to DB (source of truth)
    └─ Tauri emit("agent-event", { task_id, event_type, data, timestamp })
        → App.svelte listener (updates activeSessions store + UI)
        → AgentPanel.svelte listener (updates terminal panel status)
```

`sse_bridge.rs` must parse the JSON `data` field to extract `type` as the `event_type`
forwarded to the frontend, since OpenCode does not set the SSE `event:` header field.

### Session Status Sync

The app tracks **two separate status fields** per task:

| Field | Values | Storage | Purpose |
|-------|--------|---------|---------|
| `Task.status` | `todo`, `in_progress`, `in_review`, `testing`, `done` | `tasks` table | Kanban column |
| `AgentSession.status` | `running`, `paused`, `completed`, `failed`, `interrupted` | `agent_sessions` table | Agent execution state |

**OpenCode → App status mapping** (in `sse_bridge.rs`):

| OpenCode Event | status.type | App Session Status |
|----------------|-------------|--------------------|
| `session.status` | `busy` | `running` |
| `session.status` | `retry` | `running` |
| `session.status` | `idle` | `completed` |
| `session.idle` (deprecated) | — | `completed` |
| `session.error` | — | `failed` |
| `permission.updated` | — | `paused` |
| `permission.replied` | — | `running` |

**Backend is the source of truth**: `sse_bridge.rs` persists status changes directly to the
DB when SSE events arrive. The frontend also updates the `activeSessions` store for real-time
UI reactivity, but the DB write in the backend ensures status survives page refreshes and is
not dependent on a frontend roundtrip.
