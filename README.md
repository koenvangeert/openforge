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
pnpm electron:install
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
- **Desktop shell** — Electron/Chromium main + sandboxed preload
- **Backend** — Rust sidecar, SQLite
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

# Run the full Electron desktop app in dev mode
pnpm electron:dev

# Or run just the frontend dev server (no desktop shell)
pnpm dev
```

`pnpm electron:dev` starts Vite, builds the Rust sidecar, builds the Electron main/preload bundle, then launches Electron. Rust sidecar layout facts live in `openforge-backend-layout.json` and are resolved by `scripts/rust-sidecar-layout.mjs`. It shares Rust build artifacts through the checkout's Git common directory by setting `CARGO_TARGET_DIR` to `.cargo-target` beside the primary `.git` directory. Set `CARGO_TARGET_DIR` yourself to override it.

## Testing

```bash
# Frontend tests
pnpm test

# Rust tests
cd "$(node scripts/rust-sidecar-layout.mjs backend-crate-root)" && cargo test

# Rust-only backend validation (from the backend crate root)
cargo check
cargo build
cargo clippy
```

Rust validation builds the backend sidecar and does not require a prebuilt `dist/` frontend bundle. Release packaging is Electron-owned; use `pnpm electron:install` for a full local app build/install.

## Building

```bash
# Build renderer, Electron main/preload, plugins, and Rust sidecar into a macOS app bundle
pnpm electron:package

# Build and install the Electron app into /Applications
pnpm electron:install
```

`pnpm electron:install` builds the Svelte renderer, Electron main/preload files, and the Rust sidecar, packages them into the Electron app path resolved from `openforge-backend-layout.json` (currently `src-tauri/target/release/bundle/electron/macos/Open Forge.app`), then copies the app to `/Applications`.

## First-run setup

1. Launch the app — the project setup dialog appears automatically
2. Go to **Settings > Global** to configure your AI provider and GitHub token
3. Go to **Settings > Project** to set the GitHub repo
4. Create a task (`Cmd+T`), right-click it, and choose **Start Implementation**
