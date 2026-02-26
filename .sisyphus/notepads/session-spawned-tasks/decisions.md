
## Plugin Installer Implementation (T-76)

### Decision: Auto-install spawn_task OpenCode plugin on app startup

**Context**: The AI Command Center needs to provide the spawn_task tool as a global OpenCode plugin so agents can spawn new tasks during execution.

**Choice**: Create a dedicated `plugin_installer.rs` module that:
- Embeds the spawn_task tool source code as a raw string constant
- Checks if the plugin is already installed at `~/.opencode/plugins/spawn-task/index.ts`
- Creates directory structure and writes the plugin file only if not present
- Integrates into the app startup lifecycle via `.setup()` closure

**Rationale**:
- Embedding source code avoids file I/O complexity during initialization
- Checking for existing plugin prevents unnecessary rewrites
- Non-blocking error handling keeps app startup resilient
- Using `dirs::home_dir()` provides cross-platform home directory resolution (macOS/Linux/Windows)
- `.setup()` closure is the ideal location (runs once after DB init, before window display)

**Startup Order** (in `main.rs`):
1. Database initialization
2. **Plugin installer** (this task)
3. HTTP server startup
4. JIRA sync task
5. GitHub poller task
6. OpenCode server resume

**Test Strategy**:
- Unit test: Verify `get_opencode_plugins_dir()` returns correct path
- Unit test: Verify SPAWN_TASK_TOOL constant is not empty and contains key content
- Manual integration: Tool will be installed to real `~/.opencode/plugins/` on app start

