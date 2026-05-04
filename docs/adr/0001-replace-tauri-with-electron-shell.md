# ADR 0001: Replace Tauri/WebKit shell with Electron/Chromium shell

Status: Proposed
Date: 2026-05-01
Task: KVG-915

## Context

Open Forge is currently a Tauri v2 desktop app with a Svelte 5 + TypeScript frontend and a substantial Rust backend under `src-tauri/`.

Current-state evidence:

- `package.json` exposes Vite frontend scripts plus Tauri lifecycle scripts: `tauri:dev`, `tauri:build`, and `tauri:install`.
- `src/lib/ipc.ts` is the frontend boundary for backend calls and currently imports `invoke` from `@tauri-apps/api/core`. It exports the typed API used by Svelte components for tasks, projects, GitHub/PR review, PTY, Whisper, plugins, file access, and agent review.
- `src/lib/appTauriEventListeners.ts` registers Tauri event listeners for app lifecycle and backend events such as `github-sync-complete`, `task-changed`, `agent-event`, `agent-status-changed`, and `startup-resume-complete`.
- `src-tauri/Cargo.toml` includes Tauri dependencies, but also domain/backend dependencies that should not be discarded during a shell migration: `rusqlite`, `reqwest`, `git2`, `portable-pty`, `whisper-rs` with Metal support, `axum`, `keyring`, `tokio`, and related infrastructure crates.
- `src-tauri/tauri.conf.json` defines the current app identity (`com.opencode.openforge`), macOS app bundle configuration, CSP, dev/build commands, and the current single main window shape.
- `src-tauri/src/main.rs` wires Tauri startup, app data directory resolution, SQLite initialization, stale session/worktree cleanup, OpenForge CLI installation, HTTP hook server startup, GitHub polling, PTY/server/plugin/Whisper managers, startup resume, Tauri command registration, plugin URI protocol handling, and shutdown cleanup.
- `src-tauri/src/http_server.rs` already contains an Axum loopback HTTP server for OpenForge automation/hooks and task/project endpoints. This is useful evidence that a Rust HTTP surface already exists, but it is not yet a complete replacement for the Tauri command/event API.

The user’s primary motivation is WebKit/webview and permission limitations in Tauri on macOS. Electron’s embedded Chromium runtime is expected to remove those WebKit-specific limitations and create a better foundation for future per-task browser workspaces.

## Decision

Replace the Tauri/WebKit shell with a secure Electron/Chromium shell while retaining the Rust backend domain logic as a bundled sidecar for the first migration milestone.

The first milestone is Electron shell parity only:

- macOS first.
- Hard cutover at merge time: the migration branch may be broken while work is in progress, but main must stay usable until the Electron shell reaches acceptance criteria.
- The Svelte frontend should remain the primary UI.
- Preserve the exported API shape of `src/lib/ipc.ts`; replace its internals rather than rewriting component call sites up front.
- Electron main owns the renderer-facing security and IPC boundary.
- Rust retains backend domain ownership for database, tasks, projects, GitHub/PR review, PTY/session management, plugin host integration, file access, Whisper transcription, secure storage, and provider/server orchestration.
- Electron main launches and supervises the bundled Rust sidecar, waits for health readiness, injects a loopback backend URL and per-launch token into preload, and shuts the sidecar down on app exit.
- Electron main communicates with the Rust sidecar using local HTTP for request/response commands and SSE or WebSocket for event streams.
- Use strict Electron security from day one: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, a narrow typed preload API, no raw Node access from Svelte, and an authenticated loopback backend.
- Preserve or migrate existing local data: SQLite DB, config, keychain credentials, task worktrees, plugin data, and agent session references.
- Unsigned local macOS builds are acceptable for milestone 1, but packaging must still bundle and launch the Rust sidecar reliably for local use.

## Non-goals

- Do not implement per-task browser workspaces in milestone 1.
- Do not rewrite the Rust backend into Node/TypeScript as part of milestone 1.
- Do not expose raw HTTP clients throughout Svelte components.
- Do not enable `nodeIntegration` in the renderer for migration speed.
- Do not keep a hidden Tauri runtime fallback after cutover.
- Do not use Electron as a general-purpose browser replacement in milestone 1.
- Do not require sharing cookies or sessions with the user’s external browser.
- Do not redesign the entire frontend API layer before parity.

## Future direction: per-task browser workspaces

After shell migration, Open Forge should be able to add manual-only per-task browser workspaces using Electron `WebContentsView` / BrowserView-style surfaces managed by Electron main. These browser surfaces should be per-task by default. They are intentionally deferred until after shell parity so the platform migration and browser feature do not compound risk.

## Alternatives considered

### Keep Tauri/WebKit

Pros:

- Lowest immediate migration cost.
- Existing Tauri command/event code continues to work.
- Smaller runtime footprint than Electron.

Cons:

- Does not address the motivating WebKit/webview and permission limitations.
- Keeps future embedded browser workspace work tied to the same platform limitations.
- Continues investing in a shell the user no longer trusts for this product direction.

Rejected because the platform limitations are the primary reason for the decision.

### Rewrite the backend in Electron main / Node.js

Pros:

- Single-language TypeScript-heavy stack.
- Direct access to Node/Electron ecosystem APIs.

Cons:

- Rewrites substantial proven backend code: SQLite, PTY management, provider orchestration, Git/GitHub logic, plugin host integration, Whisper/Metal transcription, secure storage, and server lifecycle management.
- Increases migration risk and delays shell parity.
- Conflicts with the decision to preserve current behavior first.

Rejected for milestone 1. Backend ownership remains in Rust.

### Build a parallel Electron shell while keeping Tauri runnable indefinitely

Pros:

- Strong fallback during migration.
- Easier incremental comparison.

Cons:

- Creates two supported shells and two IPC stacks.
- Increases maintenance burden and can hide incomplete migration work.

Rejected as a long-term strategy. A temporary branch may be broken, but cutover should remove Tauri runtime/dependencies once acceptance gates pass.

### Use a native Node addon / N-API binding to Rust

Pros:

- Potentially fast in-process calls.
- Avoids a local HTTP server for command dispatch.

Cons:

- More coupling between Electron and Rust build systems.
- Harder process supervision and failure isolation.
- Less natural for existing event streams and external hook integrations.

Rejected for milestone 1 in favor of a supervised sidecar with local HTTP plus SSE/WebSocket.

### JSON-RPC over stdio to a Rust sidecar

Pros:

- Avoids binding a local port.
- Simple process model for command/response calls.

Cons:

- Less aligned with existing Axum server evidence.
- Streaming, hooks, and dev inspection are less convenient.
- Requires custom multiplexing for events.

Not chosen for milestone 1.

## Consequences

Positive consequences:

- Removes Tauri/WebKit as the app shell dependency and moves the app to Chromium.
- Preserves the Rust backend investment and reduces rewrite risk.
- Keeps the Svelte component surface relatively stable by preserving `src/lib/ipc.ts` exports.
- Creates a platform foundation for later per-task browser workspaces.
- Makes the backend contract explicit and testable.

Negative consequences / costs:

- Electron increases app size and memory footprint.
- The migration requires a new Electron main/preload architecture and sidecar supervision.
- All Tauri command/event contracts must be re-expressed and tested.
- Tauri-specific APIs in startup, events, open-url, app paths, plugin protocol handling, and shutdown must be replaced deliberately.
- App data path compatibility and keychain continuity become critical migration risks.

## Acceptance criteria for the decision implementation

Before merge-time cutover:

1. Electron shell boots the existing Svelte UI on macOS.
2. Rust backend runs as a supervised bundled sidecar with health readiness and graceful shutdown.
3. `src/lib/ipc.ts` exports remain stable for current frontend consumers.
4. Tauri command/event behavior is contract-locked before migration and green after migration.
5. Current daily behavior reaches parity, including tasks/projects, agent lifecycle, PTY/session streaming, GitHub/PR review, plugins, file access, config, secure credentials, and Whisper transcription.
6. Existing data is preserved or explicitly migrated: SQLite DB, config, keychain credentials, task worktrees, plugin data, and agent session references.
7. Renderer security is strict: no raw Node access, narrow preload API, sandbox/context isolation enabled, and local backend token enforced.
8. Tauri runtime/dependencies/config are removed at cutover, while Rust backend code is moved/renamed out of `src-tauri` into a backend crate/service location.
9. Unsigned local macOS builds can be produced and run with the sidecar bundled.

## Notes

This ADR approves planning toward an Electron migration. It does not approve implementing the browser workspace feature, rewriting backend domain logic in Node, or relaxing renderer security for speed.
