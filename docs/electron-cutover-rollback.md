# Electron cutover rollback and data backup

Open Forge is now launched and packaged through Electron. The Rust backend still stores user data in the same Open Forge application data directory, so rollback planning is mostly about preserving SQLite data and generated workspace state before replacing an app bundle. The shared `openforge-data-identity.json` manifest is the source of truth for this split: Electron package identity is `com.openforge.app.electron`, while durable app data identity remains `com.opencode.openforge` for data preservation.

## Before installing a new Electron build

1. Quit Open Forge and confirm no `openforge-sidecar`, `opencode`, or provider agent process is actively working on a task.
2. Back up the app data directory:
   - Production database: `openforge.db`
   - Development database: `openforge_dev.db`
   - Plugin storage, task workspaces, hook settings, and sidecar metadata in the same Open Forge data directory.
3. Keep the previous `/Applications/Open Forge.app` bundle until the new build has opened Settings, task details, terminal tabs, plugins, and PR review successfully.

On macOS, the data directory is under the user application support directory for Open Forge. A safe backup can be made with the app closed, for example:

```bash
mkdir -p ~/OpenForgeBackups
cp -a "$HOME/Library/Application Support/com.opencode.openforge" ~/OpenForgeBackups/openforge-$(date +%Y%m%d-%H%M%S)
```

If your local build uses a different app identifier or data root, back up the directory printed by the sidecar startup log before installing.

## Testing a dev Electron build with existing data

`pnpm electron:dev` intentionally uses temporary Electron `userData` plus a worktree-local sidecar app-data directory by default, which avoids accidental live sharing while preserving state across launches in the same worktree. The reusable sidecar path is recorded in `.openforge-dev/electron-dev-runtime.json`; the default path is `.openforge-dev/sidecar-app-data`. If the normal Open Forge app-data directory already contains `openforge_dev.db`, the dev launcher snapshots that development database into the worktree-local sidecar directory on first use. To force an empty dev run, use `OPENFORGE_ELECTRON_DEV_DISABLE_AUTO_SEED=1 pnpm electron:dev`.

For an isolated test run from a non-default development data directory, seed the worktree-local sidecar app-data directory instead of pointing the dev sidecar at a live directory:

```bash
OPENFORGE_ELECTRON_DEV_SEED_APP_DATA_DIR="$HOME/Library/Application Support/com.opencode.openforge" pnpm electron:dev
```

The dev launcher only copies `openforge_dev.db` from that directory into the worktree-local sidecar directory as `openforge_dev.db`; it never copies `openforge.db`. You can also seed from a specific development database or backup file with `OPENFORGE_ELECTRON_DEV_SEED_DB_PATH=/path/to/openforge_dev.db`. This is a snapshot copy for the worktree; changes made in the dev app are kept in `.openforge-dev/sidecar-app-data` and are not written back to the source. Explicit seed settings apply before the worktree DB exists; to reseed, reset, or clean up that per-worktree state, stop `pnpm electron:dev` and delete `.openforge-dev/`. Quit other dev Open Forge builds before snapshotting their data for the most consistent SQLite copy.

## Rollback procedure

1. Quit Open Forge.
2. Restore the previous app bundle or reinstall the last known-good release.
3. If the new build modified data unexpectedly, restore the backed-up data directory while the app is closed.
4. Start Open Forge and verify:
   - Settings load and provider/GitHub configuration is present.
   - The task board and task detail panes show existing tasks.
   - Terminal tabs reconnect or fail closed without stale PTY state.
   - Plugins load their enabled state and storage.
   - PR review data and authored PR status still render.

Do not run two Open Forge builds against the same `openforge.db` or `openforge_dev.db` at the same time.
