# AGENTS.md — AI Command Center

Tauri v2 desktop app: Svelte 5 + TypeScript frontend, Rust backend, SQLite database.
Manages JIRA tickets on a Kanban board with AI agent orchestration via OpenCode.

## Build & Run Commands

```bash
# Frontend
pnpm dev                 # Vite dev server (port 1420)
pnpm build               # Vite production build
pnpm test                # vitest run (all frontend tests)
pnpm vitest run src/components/Toast.test.ts         # single test file
pnpm vitest run -t "renders ticket id"               # single test by name

# Tauri (full desktop app)
pnpm tauri:dev           # Dev mode (starts Vite + Rust)
pnpm tauri:build         # Production build

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
    main.rs                   # App entry, main(), startup, command registration
    commands/                 # Tauri command handlers (by domain)
      mod.rs                  # Module declarations
      opencode.rs             # OpenCode server commands (4)
      tasks.rs                # Task CRUD commands (7)
      projects.rs             # Project management commands (8)
      orchestration.rs        # Implementation lifecycle + shared helpers (3)
      jira.rs                 # JIRA integration command (1)
      github.rs               # GitHub PR/sync commands (5)
      agents.rs               # Agent session commands (6)
      pty.rs                  # PTY terminal commands (4)
      review.rs               # GitHub PR review commands (9)
      self_review.rs          # Self-review comment commands (7)
      config.rs               # Config/utility commands (3)
    db/                       # SQLite database layer (by domain)
      mod.rs                  # Database struct, migrations, re-exports
      tasks.rs                # Task table operations
      projects.rs             # Project + project config operations
      worktrees.rs            # Worktree operations
      pull_requests.rs        # PR + comment operations
      agents.rs               # Agent session + log operations
      config.rs               # Global config operations
      review.rs               # Review PR operations
      self_review.rs          # Self-review comment operations
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
  import type { Snippet } from 'svelte'
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
- **CSS classes**: daisyUI semantic classes (`btn`, `badge`, `modal-box`) + Tailwind utilities (`flex`, `gap-2`, `p-4`)

### Svelte 5 Runes

Svelte 5 uses runes for reactivity. The codebase uses all four core runes consistently.

**`$state`** — Local component state:

```ts
let isLoading = $state(false)
let error = $state<string | null>(null)
let actions = $state<Action[]>([])
```

**`$derived`** — Computed values that update automatically when their dependencies change:

```ts
let activeModel = $derived(modelStatuses.find(m => m.is_active))
let currentProject = $derived($projects.find(p => p.id === $activeProjectId))
```

**`$effect`** — Side effects that re-run when reactive dependencies change:

```ts
$effect(() => {
  if (hasAutoCollapsed) return
  if (files.length === 0) return

  const largeFiles = new Set<string>()
  for (const file of files) {
    if (file.additions + file.deletions > 500 || file.is_truncated === true) {
      largeFiles.add(file.filename)
    }
  }
  collapsedFiles = largeFiles
  hasAutoCollapsed = true
})
```

`$effect` is NOT a replacement for `onMount`. Use `$effect` when you need to react to
changing reactive dependencies. Use `onMount` for one-time setup after DOM mount (e.g.,
subscribing to Tauri events, initializing a terminal). Both are valid in Svelte 5.

**`$props`** — Declare component inputs with a typed `Props` interface:

```ts
interface Props {
  task: Task
  onRunAction: (data: { taskId: string; actionPrompt: string; agent: string | null }) => void
}
let { task, onRunAction }: Props = $props()
```

Every component defines a local `Props` interface and destructures via `$props()`. Optional
props use `?` in the interface (e.g., `maxWidth?: string`).

**Callback props over events** — Use `on`-prefixed callback props instead of
Svelte's legacy event dispatcher. Never use the legacy dispatcher API in this codebase.

```ts
// Correct: callback prop with on prefix
interface Props {
  onClose: () => void
  onSave: (value: string) => void
}

// Wrong: do not use the legacy event dispatcher pattern
```

**Snippets** — For flexible child content in composable components:

```ts
import type { Snippet } from 'svelte'

interface Props {
  children: Snippet
  header?: Snippet  // optional snippet slot
}
```

Used in `Modal.svelte` and `DiffViewer.svelte` to pass structured markup as props.

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

export type KanbanColumn = "backlog" | "doing" | "done";
```

### State Management

Svelte writable stores in `src/lib/stores.ts`. Access with `$store` syntax in components.

```ts
export const tickets = writable<Ticket[]>([]);
export const error = writable<string | null>(null);
```

For component-local state, use `$state()` runes. See the [Svelte 5 Runes](#svelte-5-runes) section above.

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
  onclick={() => openUrl(url)}
  onkeydown={(e) => e.key === 'Enter' && openUrl(url)}
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

daisyUI v5 component classes + Tailwind CSS v4 utilities in markup. No component-scoped
`<style>` blocks (except for custom `@keyframes` animations and xterm-specific CSS).
Light "light" theme configured in `src/app.css` via `@plugin "daisyui"`.
No `tailwind.config.js` — Tailwind v4 uses CSS-first configuration.

**Theme**: `light` (daisyUI default light theme). Set via `data-theme="light"` on `<html>`.
Add explicit `shadow-*` utilities where visual depth is needed.

**Color mapping** (daisyUI semantic colors):
- Backgrounds: `bg-base-100` (primary), `bg-base-200` (secondary), `bg-base-300` (tertiary)
- Text: `text-base-content` (primary), `text-base-content/50` (secondary/muted)
- Accent: `text-primary`, `bg-primary`, `border-primary`
- Status: `text-success`/`text-error`/`text-warning` + `bg-success`/`bg-error`/`bg-warning`
- Borders: `border-base-300`

**Common daisyUI components used**: `btn`, `badge`, `modal`, `card`, `alert`, `toast`,
`input`, `textarea`, `select`, `checkbox`, `toggle`, `tabs`, `loading`, `status`, `navbar`.

**Rules**:
- No `@apply` in component files — use classes directly in markup
- No hardcoded hex color values — use daisyUI semantic colors
- No `all: unset` button patterns — use daisyUI `btn` classes
- No CSS custom properties on `:root` — use daisyUI theme tokens
- Custom `@keyframes` animations allowed in `<style>` blocks with `:global()` wrapper

### TypeScript Config

Strict mode enabled. Key settings: `noUnusedLocals`, `noUnusedParameters`,
`verbatimModuleSyntax`, target ES2020. No ESLint or Prettier — rely on TypeScript strictness.

### CSS Config

Tailwind CSS v4 + daisyUI v5. Configuration in `src/app.css` (CSS-first, no JS config files).
Vite plugin: `@tailwindcss/vite` — must be listed BEFORE `svelte()` in `vite.config.ts` plugins.

## Rust Conventions

### Module Organization

Two directory modules group related code by domain; everything else is a single file.

**Directory modules** (declared in `main.rs` with `mod commands;` and `mod db;`):
- `commands/` — all Tauri command handlers, one file per domain, with `commands/mod.rs` declaring sub-modules
- `db/` — all database operations, one file per domain, with `db/mod.rs` owning the `Database` struct, migrations, and re-exports

**Single-file modules** (declared in `main.rs` with `mod name;`):
- `orchestrator.rs`, `opencode_client.rs`, `opencode_manager.rs`, `jira_client.rs`, `jira_sync.rs`, `github_client.rs`, `github_poller.rs`

Additional single-file modules not in the original structure:
- `server_manager.rs` — OpenCode server process lifecycle per worktree
- `sse_bridge.rs` — SSE event bridge (OpenCode → Tauri frontend)
- `git_worktree.rs` — Git worktree creation/cleanup
- `agent_coordinator.rs` — Agent workflow orchestration

### Tauri Commands

Commands are organized in `src-tauri/src/commands/` by domain. Each command module contains
`pub async fn` handlers annotated with `#[tauri::command]`. They accept `State<'_>` parameters
and return `Result<T, String>`. Convert internal errors with `.map_err(|e| format!(...))`.

Commands are registered in `main.rs` via `commands::module::fn_name` in `generate_handler!`:

```rust
// In commands/tasks.rs
#[tauri::command]
pub async fn get_tickets(
    db: State<'_, Mutex<db::Database>>,
) -> Result<Vec<db::TaskRow>, String> {
    let db = db.lock().unwrap();
    db.get_all_tickets()
        .map_err(|e| format!("Failed to get tickets: {}", e))
}

// In main.rs
tauri::generate_handler![
    commands::tasks::get_tickets,
    // ...
]
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

`db/mod.rs` owns the `Database` struct, runs migrations, and re-exports all public types so
`db::TaskRow` etc. still work from call sites. Domain sub-modules (`db/tasks.rs`,
`db/projects.rs`, etc.) each implement methods via `impl super::Database`, accessing the
connection through the `pub(crate) conn` field.

Structs use `#[derive(Debug, Clone, Serialize)]` with public fields for rows. Doc comments
(`///`) on all public methods with argument descriptions. Test helpers (`make_test_db`,
`insert_test_task`) live in `db/mod.rs` under `#[cfg(test)] pub mod test_helpers`.

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
| `Task.status` | `backlog`, `doing`, `done` | `tasks` table | Kanban column |
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
