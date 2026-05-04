# Electron Migration Plan

Task: KVG-915
Status: Proposed plan
Related ADR: `docs/adr/0001-replace-tauri-with-electron-shell.md`

## Goal

Migrate Open Forge from a Tauri/WebKit shell to an Electron/Chromium shell while preserving current app behavior and retaining the Rust backend as a supervised sidecar.

Milestone 1 is shell parity only. Per-task embedded browser workspaces are a later feature and must not be implemented during the parity milestone.

## Current architecture summary

Frontend:

- Svelte 5 + TypeScript UI in `src/`.
- Vite-based build/dev scripts in `package.json`.
- `src/lib/ipc.ts` is the typed frontend backend-call boundary and currently delegates to Tauri `invoke()`.
- `src/lib/appTauriEventListeners.ts` centralizes Tauri event listener registration for app and backend events.

Desktop shell:

- Tauri v2 configured by `src-tauri/tauri.conf.json`.
- Current scripts include `tauri:dev`, `tauri:build`, and `tauri:install`.
- The Tauri config sets app identity, macOS bundle values, CSP, one main window, and plugin URI/CSP allowances.

Rust backend:

- Located under `src-tauri/` today.
- `src-tauri/src/main.rs` owns startup, app data directory lookup, DB initialization, stale state cleanup, HTTP hook server startup, GitHub polling, PTY/server/plugin/Whisper managers, startup resume, Tauri command registration, plugin URI protocol handling, and shutdown cleanup.
- `src-tauri/Cargo.toml` mixes Tauri dependencies with backend dependencies such as SQLite, Git, PTY, Whisper/Metal, HTTP, keychain, and async runtime.
- `src-tauri/src/http_server.rs` already provides a loopback Axum server for OpenForge automation/hook endpoints. It is a useful starting point, not a complete IPC replacement.

## Target architecture

```text
Svelte renderer
  |
  | narrow preload API, no Node access
  v
Electron preload
  |
  | contextBridge API mirroring src/lib/ipc.ts semantics
  v
Electron main
  |\
  | \ shell-owned commands: window, open URL, permissions, browser surfaces later
  |
  | local HTTP + SSE/WebSocket with per-launch token
  v
Rust backend sidecar
  |
  | domain logic: DB, tasks, GitHub, PTY, plugins, Whisper, files, providers
  v
Local data: SQLite, config, keychain, worktrees, plugin data, sessions
```

Ownership rules:

- Renderer owns UI only.
- Preload exposes a narrow typed bridge; it does not expose raw Node or raw HTTP.
- Electron main owns the renderer-facing IPC boundary, shell lifecycle, sidecar supervision, app paths, windowing, external URL opening, Chromium permissions, and later browser surface management.
- Rust sidecar owns backend domain logic and event production.
- `src/lib/ipc.ts` remains the frontend import surface; its internals are replaced to call the preload/Electron API.

## Explicit non-goals for milestone 1

- Do not implement per-task browser workspaces yet.
- Do not rewrite Rust backend domain logic in Node/TypeScript.
- Do not redesign all frontend call sites.
- Do not expose raw Electron, Node, or backend HTTP APIs to Svelte components.
- Do not support Windows/Linux in milestone 1.
- Do not add signing/notarization requirements for milestone 1 beyond producing runnable unsigned local macOS builds.
- Do not keep Tauri as a hidden fallback after merge-time cutover.

## Migration phases

### Phase 0: Inventory and contract lock

Purpose: freeze current behavior before architecture changes.

Actions:

1. Enumerate all `src/lib/ipc.ts` exports and map each export to its current Tauri command name and payload shape.
2. Enumerate all events currently listened to in `src/lib/appTauriEventListeners.ts` and other `@tauri-apps/api/event` imports.
3. Enumerate backend event producers in Rust by searching for `emit(...)` and stream bridges.
4. Classify each command/event:
   - backend-owned request/response command,
   - shell-owned command,
   - backend event stream,
   - shell lifecycle event,
   - deferred/obsolete Tauri-only behavior.
5. Add contract tests/fixtures for command payload names, return shapes, and event payload shapes before porting.
6. Document data path assumptions and current macOS app data/keychain identifiers.

Acceptance gate:

- A command/event inventory exists and is reviewed.
- Contract tests fail if exported `ipc.ts` names, command payload keys, or event payload shapes drift unintentionally.
- No Electron implementation starts until high-risk contracts are locked: tasks/projects, PTY/session streaming, GitHub/PR review, plugins, Whisper, and file access.

### Phase 1: Repository and build skeleton

Purpose: create the Electron + sidecar shape without porting feature domains yet.

Initial skeleton status:

- Electron TypeScript sources live under `src/electron/` and compile separately with `tsconfig.electron.json`, so the current Tauri shell remains usable during migration.
- `src/electron/windowConfig.ts` locks the first BrowserWindow configuration to strict renderer security (`contextIsolation`, `sandbox`, and no `nodeIntegration`).
- `src/electron/preloadApi.ts` defines the narrow preload bridge shape (`version`, `invoke`, `onEvent`) without exposing raw Node, Electron, or HTTP primitives to Svelte.
- `src/electron/sidecar.ts` contains the testable Rust sidecar supervision contract: loopback command construction, per-launch token environment, authenticated health polling, and graceful/force shutdown.
- The current slice intentionally does not add a Rust sidecar binary yet. The Rust backend is still coupled to Tauri startup and app state; adding a fake or partial Rust binary now would create a misleading second backend. The next backend slice should extract a real health endpoint from the existing Rust backend lifecycle and compile it with the existing `src-tauri` tests.

Actions:

1. Add Electron main/preload source directories.
2. Add dev scripts for Electron shell startup while preserving main usability until cutover.
3. Split Rust backend packaging identity from Tauri:
   - move or prepare moving backend code out of `src-tauri` into a backend crate/service directory,
   - isolate Tauri-specific dependencies from backend dependencies,
   - keep backend Rust tests runnable.
4. Add a minimal Rust sidecar binary entrypoint with a health endpoint.
5. Add Electron main supervision for sidecar launch, health polling, shutdown, and error reporting.
6. Generate a per-launch backend token and pass backend URL/token to preload only.

Acceptance gate:

- Electron shell can launch the existing Svelte UI on macOS in development.
- Electron main starts the Rust sidecar, waits for health readiness, and shuts it down.
- Renderer has no Node access (`nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`).
- No product domain has been partially ported without tests.

### Phase 2: API transport foundation

Purpose: replace Tauri invoke/listen primitives with stable Electron/preload/backend transport.

Actions:

1. Implement a typed preload API used only by `src/lib/ipc.ts` and event listener adapter modules.
2. Implement Electron main request dispatch:
   - shell-owned calls handled in Electron main,
   - backend-owned calls forwarded to Rust sidecar over authenticated local HTTP.
3. Implement backend event streaming over SSE or WebSocket.
4. Replace direct Tauri event listening with an app event adapter while keeping event names/payloads stable where practical.
5. Define error normalization so frontend callers see consistent failures.

Acceptance gate:

- Contract tests pass for a minimal command group through the new stack.
- Unauthorized backend requests without the launch token fail.
- Event subscription/unsubscription behavior is covered by tests.
- Frontend component imports still go through wrappers/adapters, not raw Electron APIs.

### Phase 3: Vertical domain slices

Purpose: port feature domains one at a time behind the preserved frontend API.

Recommended order:

1. **Config, projects, tasks**
   - Lower streaming complexity.
   - Establish DB access, app data path, and task event refresh behavior.
2. **Agent/session orchestration and PTY**
   - High risk due to streaming, process lifecycle, shell tabs, PID cleanup, and terminal pool expectations.
   - Preserve multi-shell PTY keying and stale event filtering semantics.
3. **GitHub and PR review**
   - Includes polling, rate-limit events, PR review data, comments, CI status, and external URL opening.
4. **Files and self-review/agent-review**
   - Includes filesystem access, diffs, commits, comments, and review workflows.
5. **Plugins**
   - Includes plugin host sidecar lifecycle, plugin protocol replacement, storage, enabled plugin state, and plugin invocation.
6. **Whisper/audio**
   - Electron/Chromium renderer captures microphone audio with `getUserMedia`.
   - Rust sidecar keeps Whisper model management and transcription.
7. **Authored PRs, skills, provider/model discovery, and remaining commands**
   - Port remaining lower-risk command groups after core daily workflow is stable.

Acceptance gate for each slice:

- Existing Vitest business-logic tests remain green.
- New or updated contract/API tests cover the slice.
- Rust handler tests cover backend-owned HTTP endpoints.
- Manual smoke test passes in Electron dev shell.
- No frontend component bypasses `src/lib/ipc.ts` or event adapters.

### Phase 4: Data preservation and migration validation

Purpose: ensure hard cutover does not lose local state.

Actions:

1. Identify current Tauri app data directory for dev and prod DB names (`openforge_dev.db`, `openforge.db`).
2. Preserve or migrate SQLite database location.
3. Preserve config values including Whisper model selection and project settings.
4. Preserve keychain entries used by `keyring` with the existing service/account model or provide a tested migration.
5. Preserve task worktree paths, workspace paths, server/session references, plugin storage, and agent session records.
6. Validate stale state cleanup still runs on startup.
7. Validate startup resume still emits equivalent frontend events.

Acceptance gate:

- A migration dry run on a copy of existing local app data preserves tasks, projects, sessions, plugin settings, config, and credentials.
- Rollback instructions exist for local data before cutover.
- Electron build can open an existing database without schema drift or data loss.

### Phase 5: Remove Tauri and cut over

Purpose: complete the hard merge-time cutover.

Actions:

1. Remove Tauri runtime dependencies and Tauri scripts from `package.json`.
2. Remove or archive `src-tauri/tauri.conf.json` and Tauri-specific build configuration.
3. Move Rust backend code out of `src-tauri` into its final backend crate/service location.
4. Remove direct imports of `@tauri-apps/api/*` from `src/`.
5. Replace Tauri plugin URI protocol usage with an Electron/main-owned equivalent or a backend-served local protocol with equivalent CSP controls.
6. Update developer documentation and scripts for Electron dev/build.
7. Keep unsigned local macOS packaging sufficient for milestone 1.

Acceptance gate:

- `grep -R "@tauri-apps/api\|tauri" src package.json` has only intentional historical/documentation references.
- Electron app boots on macOS from a clean checkout.
- Electron app boots on macOS with existing user data.
- All contract, frontend, and backend tests pass.
- A manual daily-driver smoke test passes.

## Command and event contract strategy

Contract-lock before porting.

### Command inventory sources

- Frontend exported API: `src/lib/ipc.ts`.
- Rust Tauri command registration: `tauri::generate_handler![...]` in `src-tauri/src/main.rs`.
- Backend command modules: `src-tauri/src/commands/*`.

For every command, record:

- frontend wrapper function name,
- current Tauri command name,
- parameter names as sent by TypeScript,
- return type,
- owner after migration (`electron-main` or `rust-sidecar`),
- target HTTP route or shell handler,
- event side effects,
- tests/fixtures.

Important payload rule: preserve the generated frontend camelCase API shape unless deliberately changing a contract. The existing project notes call out that wrong casing in Tauri payloads can silently break PTY shell behavior.

### Event inventory sources

- Frontend listeners in `src/lib/appTauriEventListeners.ts` and any other `@tauri-apps/api/event` imports.
- Rust `emit(...)` calls in `src-tauri/src`.
- PTY and SSE bridge paths.

For every event, record:

- event name,
- payload schema,
- producer owner after migration,
- transport (`preload event`, SSE, WebSocket, shell lifecycle),
- replay/ordering expectations,
- stale-event filtering requirements.

High-risk events include agent/session status, PTY exit/output/lifecycle, GitHub sync/rate-limit, task changes, startup resume, and plugin changes.

## Testing strategy

Use TDD for implementation phases. Documentation-only planning does not require product tests, but implementation tasks must add failing tests before code changes.

Recommended gates:

- Frontend/type changes: `pnpm exec tsc --noEmit` and `pnpm test`.
- Rust/backend changes: `cargo test` from the backend crate directory.
- Plugin platform changes: `pnpm build:plugins` plus targeted plugin tests.
- Electron security checks: automated assertions for `contextIsolation`, `sandbox`, `nodeIntegration: false`, and absence of raw Node globals in renderer.
- Sidecar tests: launch, health readiness, token rejection, graceful shutdown, restart/error path.
- Contract tests: command payload/return shapes and event payload schemas.
- Data migration tests: copied app data fixture opens correctly and preserves state.

Manual smoke test checklist before cutover:

1. Launch Electron app on macOS.
2. Existing tasks/projects load.
3. Create/update/delete task.
4. Start an implementation session.
5. PTY shell tabs output, resize, write, exit, and cleanup correctly.
6. GitHub sync updates PR/review state.
7. Open external URL through shell-owned API.
8. Plugin list/storage/invoke paths work.
9. Whisper model status/transcription path works with Chromium microphone capture.
10. Quit app; sidecar, PTYs, plugin host, SSE bridges, and OpenCode servers shut down cleanly.
11. Relaunch app; startup resume and stale cleanup behave as expected.

## Security requirements

- Renderer must not have Node integration.
- Renderer must not receive raw backend token except through a narrow preload implementation detail; Svelte code should call typed APIs only.
- Backend binds to loopback only.
- Backend requires a per-launch token for app IPC routes.
- External hook endpoints must be reviewed separately; do not accidentally expose privileged app IPC routes to unauthenticated local callers.
- Electron main validates and normalizes all renderer requests before forwarding to Rust.
- Browser workspace surfaces, when implemented later, must be isolated from the app renderer and must not inherit privileged preload APIs.

## Data preservation checklist

- SQLite DB: preserve dev/prod filenames or migrate with backup.
- Config table: preserve project settings, app settings, Whisper model selection, GitHub preferences.
- Keychain: preserve service/account naming or implement migration.
- Worktrees/workspaces: preserve absolute paths and branch/session references.
- Agent sessions: preserve provider-specific session IDs, checkpoint data, statuses, and resume behavior.
- Plugins: preserve installed plugin metadata, enabled state, storage, and sidecar artifacts.
- Logs/cache: either preserve intentionally or document that they can be regenerated.

## Risk register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Command/event contract drift | Frontend regressions and silent workflow breakage | Contract-lock `ipc.ts` functions and event schemas before porting |
| PTY streaming lifecycle regressions | Broken agent terminals and shell tabs | Port PTY as a dedicated high-risk slice with stale event filtering tests |
| Data path mismatch | Apparent data loss on first Electron launch | Test with copied existing app data and preserve/migrate paths deliberately |
| Keychain identity mismatch | Credentials need re-entry or auth breaks | Inventory keyring service/account identifiers and test migration |
| Electron security shortcut | Privileged renderer attack surface | Enforce strict defaults and test for no raw Node access |
| Sidecar launch failure | App appears dead or partially functional | Health readiness, user-visible failure state, logs, graceful shutdown tests |
| Plugin protocol replacement breaks plugins | File/plugin rendering regressions | Treat plugins as a separate migration slice with plugin-specific tests |
| Whisper/microphone behavior differs | Voice feature still unreliable | Use Chromium `getUserMedia`; keep Rust transcription; test permission persistence on macOS |
| Bigger Electron footprint | Higher memory/disk usage | Accept as tradeoff for Chromium capabilities; measure before cutover |
| Hard cutover pressure | Merge delayed or rushed | Keep main usable until all acceptance gates pass |

## Follow-up implementation task breakdown

Suggested tasks after this ADR/plan is accepted:

1. Create IPC/event contract inventory and tests.
2. Prototype Electron main/preload skeleton with strict security settings.
3. Extract Rust backend sidecar health endpoint and launch supervision.
4. Implement authenticated local backend transport and event stream adapter.
5. Port config/projects/tasks command slice.
6. Port PTY/session streaming slice.
7. Port GitHub/PR review slice.
8. Port files/self-review/agent-review slice.
9. Port plugins slice and replace plugin protocol handling.
10. Port Whisper/audio capture path.
11. Validate data preservation with existing local data copy.
12. Remove Tauri runtime/config and complete merge-time cutover.

## Definition of done for milestone 1

Milestone 1 is done when a macOS unsigned local Electron build can replace the Tauri app for daily Open Forge use without data loss, while preserving current frontend API behavior and backend domain functionality. The per-task browser workspace feature remains deferred until after this milestone.
