# Electron cutover rollback and data backup

Open Forge is now launched and packaged through Electron. The Rust backend still stores user data in the same Open Forge application data directory, so rollback planning is mostly about preserving SQLite data and generated workspace state before replacing an app bundle.

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
