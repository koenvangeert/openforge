Tauri v2 desktop app: Svelte 5 + TypeScript frontend (`src/`), Rust backend (`src-tauri/`), SQLite.
Commands: `pnpm dev` (Vite), `pnpm test` (vitest), `pnpm tauri:dev` (full app), `cargo test` (from src-tauri/).
All Tauri `invoke()` calls go through typed wrappers in `src/lib/ipc.ts` — never call `invoke()` directly.
External links must use `openUrl()` IPC wrapper — Tauri webview doesn't support `<a target="_blank">`.
Svelte 5 runes only: `$state`, `$derived`, `$effect`, `$props()` with a local `Props` interface. Use `on`-prefixed callback props, never the legacy event dispatcher.
Styling: daisyUI v5 + Tailwind CSS v4 (CSS-first config in `src/app.css`, no `tailwind.config.js`). No `<style>` blocks, no hardcoded hex colors — use daisyUI semantic classes.
Map-based stores require `new Map()` to trigger Svelte reactivity — direct `.set()` mutation won't work.
Types in `src/lib/types.ts`. `import type` enforced by `verbatimModuleSyntax`. Nullable fields use `T | null`, not optional.
Rust commands: `Result<T, String>` with `.map_err(|e| format!(...))`. DB domain files use `impl super::Database`.
`T-<number>` references (e.g. T-438) are this app's own task IDs — they are NOT Jira tickets. Do not use acli or any Jira tool to look them up.
Always use TDD: write or update tests first, verify they fail, then implement the code to make them pass.
Tests must cover business logic only — do not assert on CSS classes, Tailwind utilities, or visual styling. Keep visual aspects out of unit tests.
Task context menus must use `TaskContextMenu` (`src/components/TaskContextMenu.svelte`) which provides Start Task, Move to, and Delete actions. For non-task context menus, use the lower-level `ContextMenu` + `ContextMenuItem` primitives — never build inline context menu markup.
Vim navigation uses `useVimNavigation` composable from `src/lib/useVimNavigation.svelte.ts` for j/k/G/gg/Enter/Escape/q/x/h/l. All plain-key vim bindings must check `isInputFocused()` from `src/lib/domUtils.ts`. View navigation uses CMD+letter shortcuts handled in App.svelte: ⌘H (Board), ⌘G (PR Review), ⌘L (Skills), ⌘R (Work Queue), ⌘, (Settings). Hold ⌘ to see inline shortcut hints next to navigation icons. Visual focus uses `ring-2 ring-primary rounded` (daisyUI semantic, no hex).
