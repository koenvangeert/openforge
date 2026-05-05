Electron desktop app: Svelte 5 + TypeScript renderer (`src/`), Electron main/preload shell (`src/electron/`), Rust sidecar backend currently in `src-tauri/`, SQLite.
Commands: `pnpm dev` (Vite-only renderer), `pnpm electron:dev` (full Electron app with Rust sidecar), `pnpm electron:build`, `pnpm electron:package`, `pnpm electron:install`, `pnpm test` (vitest), `pnpm exec tsc --noEmit`, `cargo test` (from `src-tauri/`).
All frontend backend calls go through typed wrappers in `src/lib/ipc.ts`; Svelte code must not call raw Electron, preload, HTTP sidecar, or invoke-like transport APIs directly.
Electron main owns shell-level IPC, windowing, external URL opening, renderer security, and Rust sidecar supervision. External links must use the `openUrl()` IPC wrapper so Electron main handles `open_url` consistently.
Svelte 5 runes only: `$state`, `$derived`, `$effect`, `$props()` with a local `Props` interface. Use `on`-prefixed callback props, never the legacy event dispatcher.
Styling: daisyUI v5 + Tailwind CSS v4 (CSS-first config in `src/app.css`, no `tailwind.config.js`). Prefer Tailwind utilities and daisyUI semantic classes for layout and styling. `<style>` blocks are allowed for component-scoped `@keyframes` animations and `:global()` resets for rendered HTML content. No hardcoded hex colors.
Map-based stores require `new Map()` to trigger Svelte reactivity — direct `.set()` mutation won't work.
Types in `src/lib/types.ts`. `import type` enforced by `verbatimModuleSyntax`. Nullable fields use `T | null`, not optional.
Rust sidecar command boundaries return `Result<T, String>` with `.map_err(|e| format!(...))`. DB domain files use `impl super::Database`.
`T-<number>` references (e.g. T-438) are this app's own task IDs. Do not use any external issue tracker tooling to look them up.
Always use TDD: write or update tests first, verify they fail, then implement the code to make them pass.
Tests must cover business logic only — do not assert on CSS classes, Tailwind utilities, or visual styling. Keep visual aspects out of unit tests.
Task context menus must use `TaskContextMenu` (`src/components/TaskContextMenu.svelte`) which provides Start Task, Move to, and Delete actions. For non-task context menus, use the lower-level `ContextMenu` + `ContextMenuItem` primitives — never build inline context menu markup.
Vim navigation uses `useVimNavigation` composable from `src/lib/useVimNavigation.svelte.ts` for j/k/G/gg/Enter/Escape/q/x/h/l. All plain-key vim bindings must check `isInputFocused()` from `src/lib/domUtils.ts`. View navigation uses CMD+letter shortcuts handled in App.svelte: ⌘H (Board), ⌘G (PR Review), ⌘L (Skills), ⌘, (Settings). Hold ⌘ to see inline shortcut hints next to navigation icons. Visual focus uses `ring-2 ring-primary rounded` (daisyUI semantic, no hex).
For Rust sidecar command args, JS/TS IPC payloads must use camelCase property names that match the generated frontend API shape, even if Rust handler params are snake_case. Example: `pty_spawn_shell` must receive `terminalIndex` from `src/lib/ipc.ts`, not `terminal_index`, or Shell 2+ will silently collapse onto Shell 0.
Multi-shell PTY sessions must be keyed per shell tab end-to-end (`${taskId}-shell-${index}`) in frontend pool state, event names, backend session maps, output buffers, and PID/process bookkeeping. Never use task-scoped shell PID filenames like `${taskId}-shell.pid` for indexed shells; use shell-key-scoped filenames instead.
Terminal lifecycle ownership should live in `src/lib/terminalPool.ts`, not be split across `TaskTerminal.svelte` and the pool. Shell liveness/exited state, current PTY instance id, and tab session state must have one authoritative owner in the pool; component-local state should only mirror/render pool state, not invent parallel lifecycle truth.
`needsClear` is reset/replay state, not a second liveness source. Do not leave entries in contradictory states like `ptyActive = true` with an exited flag still latched. Stale PTY `output` and `exit` events must always be filtered by current `instance_id` in the pool.
Never use `$effect` return-cleanup to release resources keyed by a prop value. Svelte 5 re-runs the effect (and fires its cleanup) whenever the prop signal changes — including when the parent passes a new object reference with the same logical identity (e.g. `$derived($tasks.find(...))` after a store refresh). Use explicit previous-value comparison inside the effect body, and `onDestroy` for component teardown, so cleanup only fires on actual value change or unmount.

## Babysitter

At the start of every task in this repository, load the Babysitter `call` skill and follow its instructions, including loading any skill it delegates to.

For implementation tasks, loading the Babysitter skill is not enough. Before editing files, create and drive an actual Babysitter CLI run:
- Run `babysitter run:create ... --harness pi` from the project root using an absolute `--entry` path.
- Report the created run id before implementation work begins.
- Continue with `babysitter run:iterate`, execute/post effects with `babysitter task:post`, and keep iterating until the run reaches a terminal state or requires explicit user input.
- Do not bypass the Babysitter orchestration model with direct implementation. If `run:create` or iteration cannot proceed, stop and ask the user instead of continuing.

Project profile: Open Forge is an Electron desktop command center with a Rust sidecar for coordinating multiple projects and AI coding agents while keeping the user focused on one active thing at a time. Babysitter guidance should preserve that product goal: timely nudges for meaningful handoffs, blocked agents, review readiness, CI failures, and destructive decisions; otherwise stay quiet.

Recommended local Babysitter usage:
- Use `/babysitter:project-install` to refresh `.a5c/project-profile.json` and `.a5c/project-profile.md` after major architecture, workflow, or product-direction changes.
- Use TDD-driven iterative convergence for implementation work: write/update focused business-logic tests first, implement incrementally, run the relevant checks, then refine.
- Use repo mapping before broad changes touching high-churn integration points such as `src/App.svelte`, `src/electron/main.ts`, `src-tauri/src/main.rs`, `src/lib/ipc.ts`, `src/lib/types.ts`, `src-tauri/src/github_poller.rs`, or `src/lib/terminalPool.ts`.

Recommended verification gates:
- Frontend/type changes: `pnpm exec tsc --noEmit` and `pnpm test`.
- Electron shell changes: targeted `pnpm test -- src/electron` or relevant `scripts/electron-*.test.mjs` tests.
- Rust sidecar/backend changes: `cargo test` from `src-tauri/`.
- Plugin platform changes: include built-in plugin build/runtime verification where relevant (`pnpm build:plugins` plus targeted tests).

Recommended specialties/processes:
- `rust` skill for Rust sidecar/backend work.
- `ui-ux-pro-max` for focus-mode, attention queue, notification/nudge, and low-distraction UX decisions.
- Electron desktop, Rust sidecar, Svelte/TypeScript/Vitest, and iterative TDD processes for most implementation tasks.

CI/CD note: Babysitter GitHub Actions integration was intentionally skipped during project install. Do not add CI babysitter automation unless a future task explicitly asks for a focused workflow such as PR failure diagnosis or scheduled project health checks.
