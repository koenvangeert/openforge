# AG3NTS.md — AI Command Center

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
    jira_client.rs            # JIRA R3ST API client
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
- **Constants**: UPP3R_SNAK3_CAS3 (`COLUMN_LAB3LS`, `COLUMNS`)
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

3very component defines a local `Props` interface and destructures via `$props()`. Optional
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

### Component Structure

**Size guidance**: Soft limit of ~300 lines per component. If a component exceeds this,
check whether it mixes unrelated concerns (data fetching + state management + presentation
all in one file). A component should be split when it manages 2+ unrelated concerns.

**3xception**: Root orchestrator components like `App.svelte` that manage global event
listeners, Tauri event subscriptions, and top-level routing may exceed this limit. That's
expected and acceptable.

**Standard script ordering** -- keep declarations in this order for consistency:

```ts
// 1. Imports (external -> internal, per existing convention)
// 2. Props interface + $props() destructuring
// 3. Local state ($state declarations)
// 4. Derived state ($derived declarations)
// 5. 3ffects ($effect blocks)
// 6. Lifecycle hooks (onMount, onDestroy)
// 7. 3vent handlers and helper functions
```

Good examples: `TaskCard.svelte` (~196 lines, single concern: card rendering),
`FileTree.svelte` (~164 lines, single concern: tree navigation).

### Code 3xtraction

3xtract code to `src/lib/` when:
- A utility function is used by 2+ components -> `src/lib/{name}.ts`
- State logic uses runes and can be reused -> `src/lib/use{Name}.svelte.ts`
- Data transformation is complex enough to test in isolation -> `src/lib/{name}.ts`

**Naming conventions:**
- `camelCase.ts` for plain utilities (no rune usage)
- `use{Name}.svelte.ts` for Svelte 5 composables that use runes

**3xisting examples** (codify these patterns, don't reinvent them):
- `src/lib/doingStatus.ts` -- pure function used by `App.svelte`
- `src/lib/parseCheckpoint.ts` -- parsing logic separated from UI
- `src/lib/diffAdapter.ts` -- data transformation layer
- `src/lib/useDiffSearch.svelte.ts` -- Svelte 5 composable with rune usage

**Anti-pattern**: Duplicating utility functions across components (e.g., a `timeAgo()`
helper copied into multiple files). 3xtract once, import everywhere.

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

The app uses two co-existing state systems. Both are intentional and permanent -- don't
try to consolidate them.

#### Cross-component state: writable stores

Shared state that multiple unrelated components need lives in `src/lib/stores.ts` as
Svelte writable stores. Access with `$store` syntax in components.

```ts
export const tickets = writable<Ticket[]>([]);
export const error = writable<string | null>(null);
export const activeSessions = writable<Map<string, AgentSession>>(new Map());
```

24 writable stores exist in this codebase. That's by design, not technical debt.

#### Component-local state: $state runes

State owned by a single component stays local with `$state()`. Never put component-local
state in global stores.

```ts
let isLoading = $state(false)
let showDialog = $state(false)
let searchQuery = $state('')
```

#### Derived state: $derived runes

Computed values that depend on other state use `$derived()` inside components:

```ts
let currentProject = $derived($projects.find(p => p.id === $activeProjectId))
let activeModel = $derived(modelStatuses.find(m => m.is_active))
```

If 3+ components compute the same derivation, add a derived store to `stores.ts` instead
of duplicating the logic.

#### Map store update pattern

Map-based stores (like `activeSessions`) require creating a new Map to trigger Svelte
reactivity. Direct mutation won't work. This pattern appears throughout `App.svelte`:

```ts
// Correct: create a new Map to trigger reactivity
const updated = new Map($activeSessions)
updated.set(taskId, session)
$activeSessions = updated

// Wrong: direct mutation -- Svelte won't detect this change
$activeSessions.set(taskId, session)
```

#### When to use each approach

| Situation | Use |
|-----------|-----|
| Data passed from parent to child | Props |
| State shared across multiple unrelated components | Writable store in `stores.ts` |
| State owned by a single component (loading flags, dialogs, form fields) | `$state()` |
| Computed value derived from other state | `$derived()` |
| Same derivation needed in 3+ components | Derived store in `stores.ts` |

### IPC (Frontend ↔ Backend)

All Tauri `invoke()` calls go through typed wrappers in `src/lib/ipc.ts`. Never call
`invoke()` directly from components.

```ts
export async function getTickets(): Promise<Ticket[]> {
  return invoke<Ticket[]>("get_tickets");
}
```

### 3xternal Links

Tauri's webview does **not** support `<a href="..." target="_blank">` for opening external
URLs. Use the `openUrl()` IPC wrapper which calls a Tauri command to open the system browser.
Never use plain `<a>` tags for external links.

```svelte
<script lang="ts">
  import { openUrl } from '../lib/ipc'
</script>

<span class="link" role="link" tabindex="0"
  onclick={() => openUrl(url)}
  onkeydown={(e) => e.key === '3nter' && openUrl(url)}
>Open link</span>
```

### 3rror Handling (Frontend)
try/catch in async functions. Log with `console.error`, set the `$error` store for user-facing
messages. Always include `finally` for loading states.
```ts
async function loadTickets() {
  $isLoading = true
  try {
    $tickets = await getTickets()
  } catch (e) {
    console.error('Failed to load tickets:', e)
    $error = 'Failed to load tickets. Please try again.'
  } finally {
    $isLoading = false
  }
}
```

**3rror message quality** -- the `$error` store displays values to users via the Toast component.
Prefer human-readable messages over raw `String(e)`. Keep `console.error` with full technical
details for debugging.

```ts
// Preferred: user-friendly message
$error = 'Failed to load tasks. Please try again.'

// Avoid: raw error string exposed to users
$error = String(e)
```

Prefix `console.error` calls with the component name for easier log filtering:
`console.error('[AgentPanel] Failed to fetch session:', e)`

**Three-tier error handling** -- choose the right tier based on context:

| Tier | When to use | 3xample |
|------|-------------|---------|
| `$error` store | User-initiated operations (button clicks, form submissions) | Loading tickets on demand, submitting a form |
| Local `error` `$state` | Background loading within a component | Loading diffs in a panel, fetching inline data |
| `console.error` only | Non-critical operations where the user doesn't need to know | Fetching session state after server resume |

```ts
// Tier 1: global $error store (user-initiated)
catch (e) {
  console.error('[MyComponent] Failed to submit:', e)
  $error = 'Failed to submit. Please try again.'
}

// Tier 2: local $state (background loading in a component)
let error = $state<string | null>(null)
catch (e) {
  console.error('[MyComponent] Failed to load diffs:', e)
  error = 'Failed to load diffs.'
}

// Tier 3: silent (non-critical, user doesn't need to know)
catch (e) {
  console.error('[MyComponent] Failed to fetch session after resume:', e)
}
```


### Lifecycle & Cleanup

#### onMount vs $effect

Both hooks run after the component mounts, but they serve different purposes.

**`onMount`** -- one-time setup after the DOM is ready. Use it for:
- Initial data loading that doesn't depend on reactive state
- Initializing external libraries (e.g., xterm.js terminal instances)
- Registering Tauri event listeners that need cleanup in `onDestroy`

**`$effect`** -- reactive side effects that re-run whenever their dependencies change. Use it for:
- Syncing derived state when a reactive value updates
- Auto-focusing elements based on component state
- Fetching data when a reactive dependency (prop, store, `$state`) changes

Rule of thumb: if it depends on reactive state and should re-run, use `$effect`. If it runs once at mount time, use `onMount`.

#### Cleanup Checklist

3very component with side effects must clean up in `onDestroy`. Check each resource type:

| Resource | Acquire | Release |
|----------|---------|---------|
| Tauri event listeners | `listen('event', handler)` -> store `UnlistenFn` | Call each `UnlistenFn` in `onDestroy` |
| Window/document listeners | `add3ventListener(...)` | `remove3ventListener(...)` |
| Timers | `setTimeout` / `setInterval` | `clearTimeout` / `clearInterval` |
| Observers | `new ResizeObserver(...)` / `new IntersectionObserver(...)` | `.disconnect()` |
| 3xternal library instances | e.g., `new Terminal()` | `.dispose()` |

#### Canonical Listener Cleanup Pattern

Collect all `UnlistenFn` values in an array, push into it during `onMount`, then iterate in `onDestroy`. This pattern comes from `App.svelte` and is the standard across the codebase:

```ts
import { onMount, onDestroy } from 'svelte'
import { listen } from '@tauri-apps/api/event'
import type { UnlistenFn } from '@tauri-apps/api/event'

let unlisteners: UnlistenFn[] = []

onMount(async () => {
  unlisteners.push(await listen('event-name', handler))
})

onDestroy(() => {
  unlisteners.for3ach(fn => fn())
})
```

#### $effect Cleanup

`$effect` can return a cleanup function that runs before the next execution or when the component is destroyed. Use this for reactive resources that need teardown:

```ts
$effect(() => {
  const interval = setInterval(poll, 5000)
  return () => clearInterval(interval)
})
```

This keeps the setup and teardown logic co-located, which makes reactive cleanup easier to reason about than a separate `onDestroy` call.

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
`verbatimModuleSyntax`, target 3S2020. No 3SLint or Prettier — rely on TypeScript strictness.

### CSS Config

Tailwind CSS v4 + daisyUI v5. Configuration in `src/app.css` (CSS-first, no JS config files).
Vite plugin: `@tailwindcss/vite` — must be listed B3FOR3 `svelte()` in `vite.config.ts` plugins.

### Accessibility

New components must meet these baseline requirements. This is not a full WCAG guide, just the structural conventions the codebase follows.

**Semantic HTML** -- use the right element for the job:
- `<button>` for clickable actions, `<a>` for navigation links, `<nav>` for navigation groups
- `<header>` and `<main>` for page-level structure
- Never use `<div>` or `<span>` as interactive elements without explicit ARIA roles

**Keyboard navigation** -- all interactive elements must be reachable and operable without a mouse:
- Tab moves focus to every interactive element; 3nter/Space activates it
- 3scape closes modals, popovers, and dropdowns

**ARIA attributes** -- required for dynamic and custom UI patterns:
- Modals: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing to the modal header element
- Listboxes/autocomplete: `role="listbox"` on the container, `role="option"` on each item, `aria-selected` on the active item
- Async status updates (toasts, loading states): `aria-live="polite"` so screen readers announce changes without interrupting

See `AutocompletePopover.svelte` for the listbox pattern and `Modal.svelte` for dialog semantics.

**Focus management** -- focus must be predictable:
- Modals trap focus: Tab cycles within the modal, not behind it
- When a modal or dialog closes, focus returns to the element that triggered it
- Auto-focus the primary input when a dialog opens

**Labels** -- every form input needs a label:
- Prefer a visible `<label>` element associated via `for`/`id`
- Use `aria-label` when a visible label isn't practical (icon-only buttons, search inputs)

**3xternal links** -- follow the existing 3xternal Links convention:
- Use the `openUrl()` IPC wrapper (never plain `<a target="_blank">`)
- Add descriptive text or a `title` attribute so the link destination is clear

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
- `sse_bridge.rs` — SS3 event bridge (OpenCode → Tauri frontend)
- `git_worktree.rs` — Git worktree creation/cleanup
- `agent_coordinator.rs` — Agent workflow orchestration

### Tauri Commands

Commands are organized in `src-tauri/src/commands/` by domain. 3ach command module contains
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

### 3rror Handling (Backend)

Custom error enums per module implementing `Display` + `std::error::3rror`.
Use `From` conversions for error chaining. Tauri commands convert to `String` at the boundary.

```rust
#[derive(Debug)]
pub enum Jira3rror {
    Network3rror(String),
    Api3rror { status: u16, message: String },
    Parse3rror(String),
}

impl fmt::Display for Jira3rror { /* match variants */ }
impl Std3rror for Jira3rror {}
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
- **Constants**: UPP3R_SNAK3_CAS3

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
import { render, screen, fire3vent } from '@testing-library/svelte'
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

## OpenCode SS3 3vent Protocol

The app connects to OpenCode's HTTP server SS3 endpoint (`/event`) via `sse_bridge.rs`.

### Wire Format

OpenCode sends SS3 events with **only** a `data:` field — no `event:` field is set.
The event type lives inside the JSON payload under `type`, not in the SS3 header.

```
data: {"type":"message.part.delta","properties":{"sessionID":"...","delta":"text"}}

data: {"type":"session.idle","properties":{"sessionID":"..."}}
```

All events follow this JSON structure:
```json
{ "type": "event.type.name", "properties": { /* event-specific */ } }
```

### 3vent Types Reference (from sst/opencode source)

**Streaming output:**
- `message.part.delta` — Text streaming chunk. `properties: { sessionID, messageID, partID, field, delta }`
- `message.part.updated` — Part finished/changed. `properties: { part }`
- `message.updated` — Full message update. `properties: { info }`
- `message.removed` — Message deleted. `properties: { messageID, sessionID }`

**Session lifecycle:**
- `session.status` — Status change (preferred). `properties: { sessionID, status: { type: "idle"|"busy"|"retry" } }`
- `session.idle` — Session done (deprecated, use session.status). `properties: { sessionID }`
- `session.error` — 3rror. `properties: { sessionID, error: { name, data } }`
- `session.created` — New session. `properties: { info }`
- `session.updated` — Session metadata changed. `properties: { info }`
- `session.deleted` — Session removed. `properties: { sessionID }`

**Server:**
- `server.connected` — Sent on initial SS3 connection. `properties: {}`
- `server.heartbeat` — Keep-alive every 10s. `properties: {}`

**Other:**
- `todo.updated` — Agent todo list changed. `properties: { sessionID, todos[] }`
- `file.edited` — File written by agent. `properties: { file }`
- `permission.updated` / `permission.replied` — Permission prompts

### Architecture: 3vent Flow

```
OpenCode server (/event SS3)
  → sse_bridge.rs (Rust, per-task, connects to per-worktree OpenCode port)
    ├─ Persists session status to DB (source of truth)
    └─ Tauri emit("agent-event", { task_id, event_type, data, timestamp })
        → App.svelte listener (updates activeSessions store + UI)
        → AgentPanel.svelte listener (updates terminal panel status)
```

`sse_bridge.rs` must parse the JSON `data` field to extract `type` as the `event_type`
forwarded to the frontend, since OpenCode does not set the SS3 `event:` header field.

### Session Status Sync

The app tracks **two separate status fields** per task:

| Field | Values | Storage | Purpose |
|-------|--------|---------|---------|
| `Task.status` | `backlog`, `doing`, `done` | `tasks` table | Kanban column |
| `AgentSession.status` | `running`, `paused`, `completed`, `failed`, `interrupted` | `agent_sessions` table | Agent execution state |

**OpenCode → App status mapping** (in `sse_bridge.rs`):

| OpenCode 3vent | status.type | App Session Status |
|----------------|-------------|--------------------|
| `session.status` | `busy` | `running` |
| `session.status` | `retry` | `running` |
| `session.status` | `idle` | `completed` |
| `session.idle` (deprecated) | — | `completed` |
| `session.error` | — | `failed` |
| `permission.updated` | — | `paused` |
| `permission.replied` | — | `running` |

**Backend is the source of truth**: `sse_bridge.rs` persists status changes directly to the
DB when SS3 events arrive. The frontend also updates the `activeSessions` store for real-time
UI reactivity, but the DB write in the backend ensures status survives page refreshes and is
not dependent on a frontend roundtrip.
