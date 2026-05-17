---
name: openforge-app-operator
description: Launch, click through, and smoke-check the OpenForge Electron desktop app, Rust sidecar, plugins, terminal, and CLI bridge while validating fixes.
---

# openforge-app-operator

Use this when a fix needs validation in the running OpenForge app rather than only unit tests. Keep default smoke checks read-only and non-destructive: do not create, update, delete, move, or start tasks/agents unless the task explicitly requires that behavior or the user approves it.

## Start the dev app

From the repository root:

```bash
pnpm i
pnpm electron:dev
```

`pnpm electron:dev` starts Vite, builds/launches the Rust sidecar, builds Electron main/preload, then opens the desktop shell.

If you need automation or screenshots, run the same app with an Electron remote debugging port after building the Electron main process:

```bash
pnpm exec vite --host 127.0.0.1
pnpm electron:build
OPENFORGE_BACKEND_PORT=17645 \
OPENFORGE_HTTP_PORT=17645 \
OPENFORGE_SIDECAR_PATH=/path/to/openforge-sidecar \
OPENFORGE_ELECTRON_SIDECAR=1 \
ELECTRON_RENDERER_URL=http://127.0.0.1:1420 \
pnpm exec electron --remote-debugging-port=9224 .
```

Use a free backend/debugging port if those are already taken.

## Confirm the CLI bridge

In a second shell, use the installed launcher only:

```bash
openforge list-projects
# fallback when PATH is not loaded:
"$HOME/.openforge/bin/openforge" list-projects
```

If the dev app uses a non-default bridge port, set it before invoking the launcher:

```bash
OPENFORGE_HTTP_PORT=17645 openforge list-projects
```

Do not call the underlying `cli.js` directly.

Read-only CLI checks are safe defaults. Discover IDs first, then use the relevant project/task for the current app context:

```bash
openforge list-projects
openforge list-tasks --project-id <project-id> --state doing
openforge get-task --task-id <current-task-id>
```

Skip task-specific lookups when no current task id is known. Avoid CLI commands that mutate data (`create-task`, `update-task`, deletes, provider starts) unless the validation specifically requires them.

## Basic click-through map

Click around only enough to prove the changed area works. Prefer observation over mutation.

### Sidebar and projects

- Click project/avatar dots in the left rail and confirm the selected project changes or project context remains coherent.
- Click the main navigation icons: Board, Files, PR/GitHub review, Skills, Terminal, and Settings where present.
- Check that the active icon, page title, and content agree after navigation.

### Board and task detail

- Board should load with task columns/counts and no blocking renderer errors.
- Select an existing task card and confirm the detail pane updates with prompt, summary, comments/review context, and status.
- Use “Open full view” only as a read-only navigation check; return to the board afterward.
- If task context menus are involved, verify the menu opens and contains Start Task, Move to, and Delete, but do not choose destructive actions.

### Settings

- Open Settings and confirm global and project settings render.
- For provider or GitHub settings changes, verify fields/sections appear, but do not overwrite credentials during smoke validation.

### Skills

- Open Skills (`Cmd+L` when shortcuts are enabled) and confirm project/personal skills are grouped by source.
- Select the edited skill and verify name, description, source, and markdown content render.
- For skill discovery changes, also run:

```bash
find .agents/skills -maxdepth 2 -name SKILL.md | sort
```

### PR/GitHub review

- Open the PR/GitHub review view and confirm assigned PRs, diffs, comments, or empty states render.
- For GitHub polling/comment changes, verify status text and errors are visible without submitting reviews unless requested.

### Files

- Open Files and expand a project tree if available.
- Select a safe text/markdown file and confirm the viewer renders content.
- Do not edit or delete files from the app during a smoke check.

### Terminal and provider runtime

- Open Terminal or task terminal areas only when the change touches shells, PTY, provider sessions, hooks, or streaming events.
- For shell-tab changes, verify output streams, exit state, tab switching, and stale event filtering.
- Do not start or stop agents unless the task explicitly requires provider lifecycle validation.
- Remember provider/runtime cautions: frontend invoke payloads use camelCase keys, multi-shell PTY state is shell-key scoped (`${taskId}-shell-${index}`), and terminal lifecycle ownership belongs in `src/lib/terminalPool.ts`.

### Shortcuts and focus

- Use app shortcuts when validating navigation: `Cmd+H` Board, `Cmd+G` PR Review, `Cmd+L` Skills, `Cmd+,` Settings.
- Check plain-key vim bindings only when relevant and never while an input is focused.
- Confirm Escape/back navigation returns to a stable view when that behavior is in scope.

## Screenshots and CDP

Prefer native screenshots when available:

```bash
screencapture -x /tmp/openforge-dev-app.png
```

If native screenshots are unavailable in the harness, use Electron/Chromium DevTools Protocol via the remote debugging port:

1. Start Electron with `--remote-debugging-port=<port>`.
2. Before CDP calls, poll `http://127.0.0.1:<debug-port>/json/list` until a page target exists.
3. Verify the OpenForge HTTP bridge port responds before app assertions.
4. Connect to the page target WebSocket.
5. Use `Runtime.evaluate`, `Input.dispatchMouseEvent`, and `Page.captureScreenshot` for read-only click-through and screenshots.

Initial `ECONNREFUSED` during startup is not an app failure until readiness polling times out. Record the screenshot path and the views clicked.

## Conditional verification gates

Choose gates based on changed files and risk:

- Frontend/shared TypeScript: `pnpm exec tsc --noEmit` and focused `pnpm test <path-or-pattern>` or `pnpm exec vitest run <path-or-pattern>`. Do not use separator forms such as `pnpm test -- <path>` or `pnpm test -- --run <path>`.
- Broad frontend behavior: `pnpm test`.
- Rust/backend sidecar: `cd src-tauri && cargo test`; use `cargo check` for quick Rust-only validation.
- IPC/Electron bridge: IPC contract, backend bridge, preload, event forwarder, and TypeScript tests.
- Plugins/Skills view: Skills view tests, plugin SDK tests, plugin protocol/views tests, and `pnpm build:plugins` when packaging/runtime changes.
- Terminal/PTY/provider runtime: terminal pool/session tests plus app runtime smoke checks for shells and exits.
- UI-only changes: validate behavior/accessibility; do not assert Tailwind/daisyUI class names.

## Cleanup

- Stop `pnpm electron:dev` with `Ctrl+C`.
- If you launched separate Vite/Electron/CDP processes, kill only the dev processes you started.
- Ensure provider agents, shells, or sidecars started for validation are stopped before finishing.

## Reporting

Include:

- Files changed.
- Commands run and pass/fail status.
- CLI bridge check and port used.
- App sections clicked and what was observed.
- Screenshot path if captured.
- Cleanup performed.
- Any skipped gates with a brief reason.
- Open risks requiring a human, credentials, network, or broader environment.
