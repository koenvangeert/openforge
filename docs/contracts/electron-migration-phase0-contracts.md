# Electron Migration Phase 0 Contracts

Task: KVG-915

This document points to the contract inventory added before Electron runtime work begins.

## Machine-readable inventory

- `src/lib/electronMigrationContracts.ts`

The inventory records:

- every public runtime function exported by `src/lib/ipc.ts`,
- the current Tauri command name each wrapper invokes,
- the current top-level payload keys sent to Tauri,
- the intended migration owner (`rust-sidecar` or `electron-main`),
- the broad migration domain used for vertical slices,
- app shell event channel names currently registered by `registerAppTauriEventListeners()`,
- high-risk dynamic event patterns used outside `registerAppTauriEventListeners()`: PTY output/exit channels, shell-tab PTY channels, Whisper download progress, plugin sidecar lifecycle events, and plugin-defined host events.

## Contract tests

- `src/lib/electronMigrationContracts.test.ts` verifies that the inventory stays aligned with `src/lib/ipc.ts` exports, Tauri command names, and top-level payload keys.
- `src/lib/appTauriEventListeners.test.ts` now verifies registered app event names against `appShellEventContracts`, so listener drift requires an explicit contract inventory update.
- `src/lib/electronMigrationContracts.test.ts` also locks dynamic PTY/plugin/Whisper event patterns and non-obvious payloads such as `agent-pty-exited` using `{ task_id: string; success: boolean }`, the `task-changed` union for single-task changes versus `cleared_done`, PTY output/exit instance ids, Whisper download progress counters, and plugin sidecar retry counts.

These tests intentionally lock the current Tauri boundary before porting. If a command name, wrapper export, payload key, registered app event, dynamic event pattern, or event payload changes, update the inventory and migration documentation deliberately rather than allowing silent drift.

## Phase 2 transport foundation

`src/lib/desktopIpc.ts` now provides the frontend transport seam for the Electron migration:

- `invokeDesktopCommand()` uses `window.openforge.invoke()` when the Electron preload bridge is present.
- It falls back to Tauri `invoke()` when running in the existing Tauri shell.
- `listenDesktopEvent()` provides the same Electron-first/Tauri-fallback event adapter and returns a plain unsubscriber.
- `src/lib/ipc.ts` keeps its public API and command names, but delegates through this transport seam instead of importing Tauri invoke directly.
- `registerAppTauriEventListeners()` uses the event adapter by default while retaining dependency injection for tests.

This foundation does **not** port backend product domains, remove Tauri, implement browser workspaces, or expose raw Node/HTTP to the renderer.

## Sidecar config/projects/tasks slice

The Electron bridge now has a first low-risk request/response sidecar slice:

- `src/electron/backendBridge.ts` keeps `open_url` shell-owned and forwards only approved config/projects/tasks commands to the Rust sidecar.
- Electron main forwards sidecar-backed commands to `POST /app/invoke` with the per-launch bearer token from `SidecarLaunchConfig`.
- `src-tauri/src/http_server.rs` exposes authenticated `GET /app/health` and `POST /app/invoke` routes for config, project, and task request/response operations that do not require shell-owned cleanup managers.
- Out-of-scope commands such as PTY, GitHub, plugins, and Whisper remain rejected until their vertical slices are implemented.

This slice still does **not** remove Tauri, implement browser workspaces, or port high-risk streaming/product domains.

## Phase 1 skeleton contract

The first Electron skeleton adds `src/electron/` without replacing Tauri yet:

- `windowConfig.ts` owns strict BrowserWindow security defaults.
- `preloadApi.ts` exposes only `version`, `invoke`, and `onEvent`; it does not expose Node, Electron, raw HTTP, or a browser workspace API.
- `sidecar.ts` owns sidecar launch/readiness/shutdown business logic and requires loopback host plus a per-launch bearer token.
- Product commands remain unported. The generic `openforge:invoke` preload channel is only a bridge skeleton; command ownership remains governed by `src/lib/electronMigrationContracts.ts`.
