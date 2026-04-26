<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" alt="Open Forge" width="128" height="128">
</p>

<h1 align="center">Open Forge</h1>

<p align="center">
  A desktop app that orchestrates AI coding agents. Manage tasks on a focused board, launch agents in isolated git worktrees, and review their work — all from one place.
</p>

---

![Open Forge — Board](docs/images/board.png)

## Quick install

Install the latest prebuilt release (macOS, no build tools required):

```bash
curl -fsSL https://raw.githubusercontent.com/koenvangeert/openforge/main/scripts/install.sh | sh
```

To install a specific version:

```bash
OPENFORGE_VERSION=0.0.5 curl -fsSL https://raw.githubusercontent.com/koenvangeert/openforge/main/scripts/install.sh | sh
```

> **Note:** The app is unsigned. The install script automatically removes the macOS quarantine flag. If you downloaded the DMG manually, run:
> ```
> xattr -rd com.apple.quarantine /Applications/Open\ Forge.app
> ```

## Manual install (build from source)

If you prefer to build from source or want to run the latest unreleased changes:

**Prerequisites:** [Rust](https://rustup.rs/) (1.77+), [Node.js](https://nodejs.org/) (20+), [pnpm](https://pnpm.io/) (10+), and macOS with Xcode Command Line Tools.

```bash
git clone https://github.com/koenvangeert/openforge.git
cd openforge
pnpm install
pnpm tauri:install
```

This builds a production release, copies `Open Forge.app` to `/Applications`, and removes the macOS quarantine flag. If an existing instance is running it will be closed automatically before the install.

## CLI

The installer creates an `openforge` CLI launcher at `~/.openforge/bin/openforge` and adds `~/.openforge/bin` to `~/.zshrc` if it is not already present. Open Forge also refreshes the launcher on app startup. Restart your shell or run `source ~/.zshrc`, then use:

```bash
openforge --help
openforge list-projects
openforge get-task --task-id T-123
openforge update-task --task-id T-123 --summary "Done"
```

The CLI talks to the local Open Forge HTTP bridge and is used by the auto-installed provider skills.

## What it does

Open Forge is a command center for AI-assisted development. You define coding tasks, an AI agent (Claude Code or OpenCode) implements them in isolated git worktrees on dedicated branches, and the app tracks the full lifecycle: agent progress, CI status, and PR reviews.

| | |
|---|---|
| **Flow board** | Prioritize work from a focused list with an always-visible detail pane. Search, create, and manage tasks with keyboard shortcuts. |
| **AI agents** | Launch Claude Code or OpenCode agents per task. Each runs in its own git worktree and branch with a live embedded terminal. |
| **Self-review** | Review agent changes with a syntax-highlighted diff viewer. Leave inline comments and send feedback back to the agent. |
| **PR review** | Review pull requests assigned to you. Browse diffs, leave comments, and submit reviews directly from the app. |
| **GitHub** | Background polling keeps PR status and CI checks in sync. |
| **Voice input** | Dictate instructions to the agent using on-device speech recognition (Whisper). |

![Open Forge — Task View](docs/images/task-view.png)

![Open Forge — Self-Review](docs/images/self-review.png)

## Tech stack

- **Frontend** — Svelte 5, TypeScript, Tailwind CSS v4, daisyUI v5
- **Backend** — Rust, Tauri v2, SQLite
- **AI agents** — Claude Code CLI (via PTY), OpenCode (via HTTP/SSE)

## Prerequisites

- [Rust](https://rustup.rs/) (1.77+)
- [Node.js](https://nodejs.org/) (20+) and [pnpm](https://pnpm.io/) (10+)
- macOS with Xcode Command Line Tools (for Metal/Whisper support)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) or [OpenCode](https://github.com/opencode-ai/opencode) installed

## Local development

```bash
# Install frontend dependencies
pnpm install

# Run the full desktop app in dev mode
pnpm tauri:dev

# Or run just the frontend dev server (no Tauri shell)
pnpm dev
```

## Testing

```bash
# Frontend tests
pnpm test

# Rust tests (from src-tauri/)
cd src-tauri && cargo test
```

Rust tests use Tauri's mock runtime and do not require a prebuilt `dist/` frontend bundle.

## Building

```bash
# Production build
pnpm tauri:build

# Install the built macOS app
pnpm tauri:install
```

## First-run setup

1. Launch the app — the project setup dialog appears automatically
2. Go to **Settings > Global** to configure your AI provider and GitHub token
3. Go to **Settings > Project** to set the GitHub repo
4. Create a task (`Cmd+T`), right-click it, and choose **Start Implementation**
