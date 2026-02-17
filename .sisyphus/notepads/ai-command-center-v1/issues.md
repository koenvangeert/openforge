# Issues & Gotchas

This file documents problems encountered and their solutions.

---

## Task 1.1: Tauri 2.0 + Svelte + TypeScript Scaffold

### Issues Encountered & Resolved

1. **Tauri CLI not installed globally**
   - Solution: `npm install -g @tauri-apps/cli@latest` (installed 2.10.0)

2. **`tauri create` command doesn't exist**
   - Tauri 2.10.0 doesn't have `create` subcommand
   - Solution: Manually created project structure instead of using scaffolder

3. **Rust version incompatibility (1.86.0 vs 1.88.0)**
   - `time` crate v0.3.47 requires Rust 1.88.0+
   - Solution: `rustup update` → upgraded to 1.93.1

4. **Invalid `tauri.conf.json` configuration**
   - Initially placed `identifier` in bundle section (wrong)
   - Solution: Moved to top-level config object

5. **Missing `frontendDist` directory**
   - Tauri macro validates path exists at compile time
   - Solution: Created `dist/` directory before cargo check

6. **Missing icon files**
   - Tauri requires valid PNG/ICO/ICNS files referenced in config
   - Solution: Created minimal 1x1 transparent PNG files for scaffold

7. **TypeScript not recognized in Svelte components**
   - `lang="ts"` in `<script>` tag failed without preprocessor
   - Solution: Installed `svelte-preprocess` and configured in `vite.config.ts`

8. **Missing `verbatimModuleSyntax` in tsconfig.json**
   - Svelte + TypeScript requires this flag
   - Solution: Added `"verbatimModuleSyntax": true` to compiler options

### Unresolved

- None at this stage. All blockers resolved.


## Task 1.5: Tauri Commands Implementation (2026-02-17)

### Issues Encountered

**None** - Implementation was straightforward.

### Warnings (Expected)
- Database methods (connection, get_config, set_config) unused - Will be used in Phase 2 (JIRA sync)
- OpenCodeManager::shutdown() unused - Will be called from app exit handler in future task
- OpenCodeClient::subscribe_events() unused - Will be used in Phase 4 (Orchestrator) for SSE streaming
- EventStream struct unused - Will be used when subscribe_events is called

### Design Decisions

1. **Error Type Choice**: Used `Result<T, String>` instead of custom error type
   - Rationale: Frontend expects simple string errors, no need for structured error types
   - Alternative: Could use custom error type with serde::Serialize, but adds complexity

2. **State Access Pattern**: Used State<T> without Mutex for OpenCodeClient
   - Rationale: OpenCodeClient is Clone-able and immutable after creation
   - Alternative: Could use State<Arc<OpenCodeClient>>, but State<T> is simpler

3. **Response Type**: send_prompt returns serde_json::Value instead of typed response
   - Rationale: OpenCode response structure varies by version, frontend can parse as needed
   - Alternative: Could define typed response, but would be fragile to API changes

4. **Health Check in get_opencode_status**: Calls client.health() on every invocation
   - Rationale: Provides real-time status, not cached
   - Alternative: Could cache health status and poll in background, but adds complexity
   - Trade-off: Adds ~50ms latency per call, but ensures accurate status

### Potential Future Improvements
1. Add command for subscribe_events with SSE parsing (Phase 4)
2. Add command for graceful shutdown of OpenCode server (app exit handler)
3. Add command to get session history/logs from database (Phase 5)
4. Consider adding timeout configuration for commands (currently uses default reqwest timeout)

