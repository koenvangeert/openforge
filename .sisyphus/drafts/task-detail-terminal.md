# Draft: Task Detail View — Terminal/Web UI Embedding

## Requirements (confirmed)
- Replace custom AgentPanel plain-text rendering with richer display
- Semi-orchestrated: app creates session + sends initial prompt, user can then interact with OpenCode directly
- App still needs to detect session completion for status/stage transitions
- This is for V1 — keep it simple

## Technical Decisions
- Current AgentPanel renders plain `<pre>` text via SSE event accumulation — 11+ files for a poor result
- **Approach: xterm.js + PTY + `opencode attach`**
  - Keep `opencode serve --port 0` for API/orchestration
  - Spawn `opencode attach http://127.0.0.1:{port} --session {id}` in a PTY
  - Pipe PTY ↔ xterm.js for full TUI display + interaction
- OpenCode web UI rejected — has unwanted features (session management, settings, etc.)
- OpenCode v1.2.6 installed

## Research Findings
- Current architecture: opencode serve → sse_bridge.rs → Tauri events → AgentPanel.svelte
- opencode serve is headless API only; opencode web serves web UI (same port flags)
- xterm.js + tauri-plugin-pty is viable for TUI embedding (Svelte wrapper exists)
- Embed web UI approach is lowest effort, highest value for V1

## Resolved Questions
- Completion detection: Keep SSE bridge, simplified to only completion/error events
- Status bar: Keep thin status bar (dot, stage, abort) above the terminal
- Session history: `opencode attach --session {id}` works for both active and past sessions
- PTY library: TBD (recommend portable-pty for battle-tested reliability, reference: marc2332/tauri-terminal)
- Terminal sizing: responsive via xterm.js FitAddon

## Open Questions
- Test strategy: TDD vs tests-after vs none?

## Scope Boundaries
- INCLUDE: Replace AgentPanel output display, keep orchestration (session creation, initial prompt, completion detection)
- EXCLUDE: Removing programmatic orchestration entirely, building full OpenCode feature parity
