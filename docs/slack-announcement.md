## Open Forge — one window to rule your dev workflow

You know the drill. You're working on a task, terminal running, agent doing its thing. Slack pings — someone needs a PR review. You open GitHub, review the code, switch back... wait, which terminal was that? Which branch? Was the agent even done?

Meanwhile you've got Jira open in 5 tabs, a terminal multiplexer that looks like a war zone, and zero idea whether T-347 was the auth refactor or the dashboard fix.

I got tired of this, so I built **Open Forge** — a desktop app that puts everything in one place:

- **Kanban board** with Jira sync — your tasks, one view
- **AI agents** (Claude Code / OpenCode) running in isolated git worktrees — one per task, no branch confusion
- **Inline code review** — read the agent's diff, leave comments, send feedback back
- **PR reviews** across all your repos — pending reviews, CI status, approve or request changes without leaving the app
- **Notifications** when CI fails or an agent needs your input

No more "which terminal was that?" No more alt-tabbing between 6 apps. Tasks go from idea to agent implementation to review to merged — all in one window.

Open source, macOS-first. Still early but it's been my daily driver for weeks.

Interested? Check it out: https://github.com/koenvangeert/openforge
