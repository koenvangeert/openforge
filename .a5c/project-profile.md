# Project Profile: Open Forge

A macOS-focused Electron desktop command center with a Rust sidecar for managing multiple projects and AI coding agents concurrently while keeping the user focused on one active thing at a time. The app coordinates tasks, agent worktrees, embedded terminals, PR/self-review, GitHub status, plugins, and contextual nudges so it interrupts the user only when attention is useful.

> Last updated: 2026-05-05T21:06:17.658Z | Version: 1

## Goals

- **product** [high]: Manage multiple software projects and multiple AI agents running at the same time from a single desktop app. (active)
- **focus** [high]: Help the user focus by presenting one actionable item at a time and reducing distracting context switching. (active)
- **attention-management** [high]: Poke or notify the user at the right moments, such as when an agent needs input, a review is ready, CI changes state, or a task is blocked, and otherwise stay out of the way. (active)
- **workflow** [high]: Run AI agents in isolated git worktrees with tracked task lifecycle, terminals, CI status, and review loops. (active)
- **platform** [medium]: Support extension through built-in and managed plugins while preserving predictable host/runtime behavior. (active)

## Tech Stack

### Languages

- TypeScript (frontend, Electron shell, plugin SDK, built-in plugins, tests)
- Svelte v5 (UI components using runes)
- Rust v1.77+ (Rust sidecar backend, database, command handlers, GitHub, PTY, providers)
- CSS (Tailwind CSS v4 CSS-first configuration and component scoped styles)
- Shell (installation scripts)

### Frameworks

- Electron v41 [desktop shell, main process, preload IPC, and macOS packaging]
- Svelte v5 [frontend UI]
- Vite v8 [dev/build tooling]
- Tailwind CSS v4 [styling]
- daisyUI v5 [semantic UI components/classes]
- Vitest [frontend tests]
- Tokio [Rust async runtime]
- Axum [local HTTP/MCP server and sidecar IPC]

### Databases

- SQLite (embedded)

### Infrastructure

- GitHub Actions [CI and release automation]
- macOS [primary desktop platform]

**Build tools:** pnpm, Vite, Electron, Cargo, TypeScript compiler, GitHub Actions

**Package managers:** pnpm 10.33.2, Cargo

## Architecture

**Pattern:** Desktop application monorepo with a Svelte 5/TypeScript renderer, Electron main/preload shell, Rust sidecar backend currently in `src-tauri`, SQLite persistence, managed plugin workspace, and AI-provider integrations.

**Data flow:** Svelte components call typed wrappers in `src/lib/ipc.ts`. Those wrappers use the Electron desktop IPC adapter and sandboxed Electron preload bridge to reach Electron main, which handles shell-owned commands such as `open_url` or forwards backend-owned commands to the authenticated loopback Rust sidecar. The Rust sidecar coordinates SQLite domain modules, Git/GitHub clients, PTY managers, agent providers, plugin host/RPC, Whisper, and local HTTP/MCP services. Sidecar app events stream back through Electron main/preload into frontend listeners. Agent tasks are launched in isolated git worktrees and reflected back through task lifecycle, terminal output, CI status, and review UI.

### Modules

| Module | Path | Description |
|--------|------|-------------|
| Frontend app | `src` | Svelte UI for board/task management, settings, PR/self-review diffs, terminals, skills, and typed IPC-facing business logic. |
| Electron shell | `src/electron` | Electron main/preload code for windowing, renderer security, shell-owned IPC, plugin protocol/CSP, app events, and Rust sidecar supervision. |
| Reusable components | `src/components` | Dialogs, file viewers, task detail surfaces, context menus, and view components. |
| Frontend library | `src/lib` | Business logic utilities, stores/composables, typed IPC wrappers, terminalPool lifecycle owner, diff/file helpers, and settings helpers. |
| Rust sidecar commands | `src-tauri/src/commands` | Rust sidecar command boundary for tasks, projects, config, providers, GitHub, review flows, plugins, PTY, and orchestration. |
| Rust sidecar HTTP/events | `src-tauri/src/http_server.rs` | Authenticated loopback HTTP IPC and app event streaming used by Electron main to reach the Rust sidecar. |
| Database layer | `src-tauri/src/db` | SQLite migrations and domain-specific Database impl blocks for app persistence. |
| Provider/runtime integration | `src-tauri/src/providers` | Claude Code, OpenCode, and Pi agent provider integration. |
| Plugin platform | `packages/plugin-sdk and plugins` | Workspace SDK plus built-in plugin implementations. |

**Entry points:** `src/main.ts`, `src/App.svelte`, `src/electron/main.ts`, `src/electron/preload.cts`, `src-tauri/src/main.rs`, `packages/plugin-sdk/src/index.ts`, `plugins/*/src`

## Team

- **Koen Van Geert / koenvg** (primary maintainer): product direction, frontend, Rust sidecar/backend, Electron shell, plugin platform, provider integrations, CI/release
- **Contributors** (occasional contributors): feature and bugfix contributions
- **AI coding agents** (implementation assistants): task implementation in isolated worktrees, tests, self-review support

## Workflows

### development

Run and iterate on the app locally.
**Triggers:** developer command

1. `pnpm install`
2. `pnpm electron:dev` for the full Electron app with Rust sidecar
3. `pnpm dev` for frontend-only Vite

### frontend-verification

Verify TypeScript/Svelte business logic.
**Triggers:** local quality gate, GitHub Actions pull_request/push

1. `pnpm exec tsc --noEmit`
2. `pnpm test`

### electron-shell-verification

Verify Electron shell, preload, sidecar bridge, and packaging contracts.
**Triggers:** local quality gate, GitHub Actions pull_request/push

1. `pnpm test -- src/electron`
2. `pnpm test -- scripts/electron-cutover.test.mjs scripts/electron-dev.test.mjs scripts/electron-package.test.mjs`

### rust-verification

Verify Rust sidecar/backend behavior.
**Triggers:** local quality gate, GitHub Actions pull_request/push

1. `cd src-tauri`
2. `cargo test`

### agent-task-flow

Create a task, launch an AI provider, let it work in an isolated worktree, then review changes and PR status.
**Triggers:** user starts task

1. create/prioritize task
2. start implementation from `TaskContextMenu`
3. monitor terminal/lifecycle
4. self-review diff
5. send feedback or complete
6. sync/review PR as needed

### release

Build and draft macOS releases.
**Triggers:** v* tag, manual workflow dispatch

1. push `v*` tag or `workflow_dispatch`
2. release workflow updates versions
3. `pnpm electron:package` builds macOS app bundles with the Rust sidecar
4. `pnpm electron:install` installs a local macOS app build when needed
5. draft release assets

## Processes

- **Project Install** (`cradle/project-install`, onboarding) - Project onboarding/profile generation process used to configure babysitter for this repository.
- **TDD Quality Convergence** (`tdd-quality-convergence`, methodology) - Recommended default methodology for feature and bugfix tasks: write/update tests first, implement, verify, refine.

## Tools

### Linting

- TypeScript compiler `pnpm exec tsc --noEmit`
- Cargo compiler/tests `cd src-tauri && cargo test`

### Testing

- Vitest `pnpm test`
- Testing Library Svelte
- Electron shell contract tests under `src/electron/*.test.ts` and `scripts/electron-*.test.mjs`
- Cargo test `cd src-tauri && cargo test`

## Services

- **GitHub** (source control / PR / CI) - https://github.com/koenvangeert/openforge
- **Claude Code** (AI coding agent CLI)
- **OpenCode** (AI coding agent service via HTTP/SSE)
- **Pi Coding Agent** (AI coding harness/provider)
- **Whisper** (on-device speech recognition)
- **macOS Keychain** (secure credential storage)

## CI/CD

**Provider:** GitHub Actions
**Config files:** `.github/workflows/ci.yml`, `.github/workflows/ci-comment.yml`, `.github/workflows/release.yml`

### Pipelines

- **CI** (trigger: pull_request and push to main)
  Stages: frontend typecheck/tests -> Rust tests
- **CI Comment** (trigger: CI workflow_run completed for PR)
  Stages: download artifacts -> post/clean failure comments
- **Release** (trigger: v* tags or manual dispatch)
  Stages: set version -> package Electron macOS app with Rust sidecar -> draft GitHub release

## Pain Points

- **medium** [testing]: Async frontend/component cleanup and listener registration have required stabilization work.
  - Remediation: Keep test cleanup explicit and add regression tests for listener lifecycle changes.
- **high** [runtime/terminal]: Terminal/PTY lifecycle, shell tabs, stale event filtering, and shortcut ownership are high-risk areas.
  - Remediation: Preserve terminalPool as single lifecycle owner and require focused tests for any PTY/session changes.
- **medium** [plugin platform/build]: Plugin runtime packaging and built-in plugin builds are sensitive to CI and host/runtime path assumptions.
  - Remediation: Verify plugin changes with build:plugins plus host/runtime tests.
- **high** [product/UX]: The product must balance visibility across many agents/projects with a calm one-thing-at-a-time focus model.
  - Remediation: Favor attention queues, contextual nudges, and explicit focus modes over broad dashboards that demand constant scanning.

## Bottlenecks

- Top-level app routing/state orchestration is high-churn at `src/App.svelte`, `src/App.test.ts`.
- Electron shell and sidecar bridge maintenance is security-sensitive at `src/electron/main.ts`, `src/electron/preload.cts`, `src/electron/backendBridge.ts`.
- Rust main/bootstrap command registration is high-churn at `src-tauri/src/main.rs`.
- Frontend shared types and IPC wrappers are tightly coupled to Rust sidecar command payloads at `src/lib/types.ts`, `src/lib/ipc.ts`, `src-tauri/src/commands`.
- GitHub polling/comment ingestion combines async external API data with local persistence at `src-tauri/src/github_poller.rs`.
- Terminal lifecycle is regression-prone and must remain single-owned by `src/lib/terminalPool.ts` and task-detail terminal components.

## Conventions

### Naming

- **frontend:** PascalCase Svelte components; camelCase/lowercase TS utilities; tests colocated as `*.test.ts` or `*.svelte.test.ts`.
- **rust:** snake_case modules/functions; domain DB modules under `src-tauri/src/db`.
- **branches:** KVG-<task-id>/<slug> for task branches.
- **tasks:** T-<number> references are app-local task IDs.

### Git

- **primaryBranch:** main
- **branchStrategy:** feature branches with PRs
- **mergeStrategy:** GitHub merge commits
- **commitStyle:** conventional-ish prefixes plus KVG task references in branches/PRs

**Import order:** framework imports > third-party packages > local modules/components > type-only imports where required

**Error handling:** Rust sidecar command boundaries map errors to `Result<T, String>`; frontend uses typed IPC wrappers and UI state; avoid direct desktop transport calls outside `src/lib/ipc.ts`.

**Testing:** Use TDD. Write/update tests first, verify failure where practical, then implement. Cover business logic and behavior; do not assert Tailwind/CSS visual classes. Run `pnpm test` and/or `cargo test` depending on touched area.

### Additional Rules

- All frontend backend calls go through `src/lib/ipc.ts` wrappers; do not call raw Electron, preload, HTTP sidecar endpoints, or other command/sidecar transport APIs directly from Svelte code.
- External links use `openUrl()` IPC wrapper so Electron main owns `open_url` handling.
- Rust sidecar IPC payloads from JS/TS use camelCase keys that match the frontend API shape, even when Rust params are snake_case.
- Map-based stores require `new Map()` assignment for reactivity.
- Task context menus use `TaskContextMenu`; non-task menus use `ContextMenu` primitives.
- Plain-key vim bindings must use `useVimNavigation` and check `isInputFocused()`.
- Multi-shell PTY sessions are keyed per shell tab end-to-end; terminal lifecycle ownership belongs in `src/lib/terminalPool.ts`.
- Do not use `$effect` return cleanup to release resources keyed by prop value; compare previous logical value and use `onDestroy` for teardown.

## Repositories

- **openforge** [`.`]

## CLAUDE.md Instructions

- Open Forge product goal: coordinate multiple projects and AI agents while preserving one-thing-at-a-time focus and low-noise timely nudges.
- Use `/babysitter:project-install` to refresh project profile artifacts after major architecture, workflow, or product-direction changes.
- Prefer TDD-driven iterative convergence for implementation tasks and run the relevant pnpm/electron/cargo verification gates.
- Map code before broad changes touching high-churn integration points: `App.svelte`, `src/electron/main.ts`, `main.rs`, ipc/types, github_poller, and terminalPool.
- CI/CD babysitter integration was intentionally skipped; do not add GitHub Actions babysitter automation without a future explicit task.

## Installed Extensions

- Skills: rust, ui-ux-pro-max, specializations/web-development/skills/svelte/SKILL.md, specializations/web-development/skills/typescript/SKILL.md, specializations/web-development/skills/vitest/SKILL.md, specializations/web-development/skills/tailwind-css/SKILL.md
- Agents: general-purpose, specializations/desktop-development/agents/desktop-ux-analyst/AGENT.md, specializations/desktop-development/agents/desktop-test-architect/AGENT.md
- Processes: cradle/project-install, methodologies/superpowers/test-driven-development.js, methodologies/gsd/iterative-convergence.js, methodologies/gsd/map-codebase.js, methodologies/gsd/verify-work.js, methodologies/spec-driven-development.js
