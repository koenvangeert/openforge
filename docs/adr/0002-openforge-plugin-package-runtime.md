# ADR 0002: Rework plugins as trusted OpenForge packages with runtime registrations

Status: Proposed
Date: 2026-05-13
Task: KVG-1171

## Context

OpenForge already has a plugin platform spanning a TypeScript/Svelte renderer, Electron shell, Rust sidecar plugin install/storage code, and a shared Node plugin-host sidecar. The current abstraction surface is not the desired long-term shape:

- `packages/plugin-sdk/src/types.ts` exposes manifest contribution arrays, activation results, host/backend invocation, events, and string storage through one public surface.
- `src/lib/plugin/pluginRegistry.ts` currently mixes activation/deactivation, contribution registration, host command routing, desktop event subscriptions, install/uninstall state updates, background services, and store reconciliation.
- External backend plugins cross Rust install/platform code and the Node JSON-RPC plugin host.
- Existing plugin manifests duplicate contribution declarations that activation code can also return, creating split-brain risk.

We investigated Pi's package/extension model for inspiration. Pi packages use `package.json` metadata to declare resources, load TypeScript/JavaScript extension modules, and let extensions register commands/tools/events through a small injected API. The Babysitter Pi package is intentionally thin: `package.json` declares Pi resources, and its extension only forwards slash commands into skills while orchestration remains in Babysitter's SDK and skills. The important lesson is the separation between package discovery, trusted extension code, and explicit host capabilities.

OpenForge should adopt that package/runtime-registration shape, while remaining agent-agnostic and tailored to a desktop app with project/task/terminal state.

## Decision

Replace the current manifest-contribution plugin model with a hard-cutover OpenForge package model:

- Plugin packages are trusted app extensions, not sandboxed third-party widgets.
- Package discovery and install metadata live in `package.json#openforge`.
- Contributions are registered imperatively at runtime through a stable injected `OpenForgeAPI`.
- Plugins must not import OpenForge renderer stores, IPC wrappers, Electron internals, Rust DB helpers, or other host internals directly.
- Built-in plugins use the same package metadata, build contract, and activation path as external plugins.
- The cutover intentionally removes old `manifest.json` contribution loading instead of providing a compatibility adapter.

## Goals

- Provide a small, stable author-facing SDK with explicit host capability namespaces.
- Make package install/update/remove flows consistent across npm, git, and local path sources.
- Keep OpenForge plugins agent-agnostic: plugins extend app capabilities, not skills or prompts for a specific agent.
- Preserve first-class Svelte UI integration without iframe/webview isolation.
- Keep backend plugin code natural for Node package authors.
- Make built-ins prove the external plugin contract.
- Keep plugin lifecycle, cleanup, registration errors, and diagnostics explicit.

## Non-goals

- No stronger sandboxing or runtime permission wall in v1.
- No compatibility adapter for old manifest-based plugins.
- No agent-specific plugin resources such as skills or prompts.
- No plugin-to-plugin dependency ordering or plugin-defined host capabilities in v1.
- No GitHub, review, or PR-specific core plugin APIs.
- No global enablement mode in v1.
- No local path auto-reload watcher in v1.
- No command palette implementation unless already needed by another effort.

## Package metadata

Use `package.json` as the package/discovery manifest. OpenForge-specific fields live under `openforge`:

```json
{
  "name": "@acme/openforge-github",
  "version": "1.0.0",
  "peerDependencies": {
    "@openforge/plugin-sdk": "^1.0.0"
  },
  "openforge": {
    "id": "github",
    "apiVersion": 1,
    "displayName": "GitHub",
    "description": "GitHub PR review and sync",
    "icon": "github",
    "frontend": "./dist/frontend.js",
    "backend": "./dist/backend.js",
    "requires": ["projects", "tasks", "commands", "storage"]
  }
}
```

Rules:

- `openforge.id` is explicit and unique app-wide.
- `openforge.apiVersion` is the hard host compatibility gate.
- Peer dependencies on `@openforge/plugin-sdk` are advisory diagnostics, not the runtime compatibility source of truth.
- Each built artifact targets one API version.
- Installed packages must ship built JavaScript artifacts.
- Local path development installs also point to already-built artifacts; OpenForge should validate entries and show a helpful build-required error.
- Package-level display metadata is for plugin management UI; runtime contributions have their own titles/icons.
- Icons can be semantic OpenForge icon keys or package asset references.
- Assets should be served through a plugin asset protocol aligned with package identity, for example `plugin://github/assets/icon.svg`.

A shared JSON Schema should define `package.json#openforge` metadata and be used by TypeScript tooling/tests and Rust install validation to avoid drift.

## SDK shape

The public author-facing SDK stays small and stable:

- `@openforge/plugin-sdk` exports shared types, API version constants, metadata helpers, schema helpers, and test utilities.
- `@openforge/plugin-sdk/frontend` exports frontend-specific plugin helpers/types.
- `@openforge/plugin-sdk/backend` exports backend-specific plugin helpers/types.
- Host runtime internals are private and not importable by plugins.

Frontend example:

```ts
import { defineFrontendPlugin } from '@openforge/plugin-sdk/frontend'

export default defineFrontendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(
      openforge.views.register({
        id: 'prs',
        title: 'Pull Requests',
        icon: 'git-pull-request',
        placement: 'rail',
        order: 50,
        component: () => import('./PullRequests.svelte')
      })
    )
  }
})
```

Backend example:

```ts
import { Type } from '@sinclair/typebox'
import { defineBackendPlugin } from '@openforge/plugin-sdk/backend'

export default defineBackendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(
      openforge.backend.registerMethod('syncProject', {
        input: Type.Object({ projectId: Type.String() }),
        output: Type.Object({ synced: Type.Number() }),
        handler: async ({ projectId }) => {
          // trusted plugin code may use Node/npm dependencies here
          return { synced: 1 }
        }
      })
    )
  }
})
```

Cleanup is only through `context.subscriptions`. `activate()` does not return a cleanup function.

## Runtime model

- A plugin package can include optional `frontend` and `backend` entries.
- Frontend and backend are separate runtime boundaries but should feel like one plugin package to authors and users.
- Frontend activation does not globally wait for backend readiness.
- Backend methods cannot be invoked before backend activation/registration is ready.
- Frontend gets readiness helpers such as `openforge.backend.whenReady()`, `onReady`, and `state`.
- Backend plugin code runs in the shared Node plugin-host sidecar process.
- v1 can restart the entire shared backend host and reactivate enabled plugin backends; per-plugin host restart is deferred.
- Use a simple crash-loop guard to stop retrying when plugin activation/service startup repeatedly crashes the backend host.
- Backend host logs/errors should be tagged with plugin id.

Contribution ownership:

- Views, settings sections, and task-pane tabs are frontend-only.
- Backend methods and background services are backend-only.
- Commands can be registered from frontend or backend, but local command IDs must be unique across both runtimes for the plugin.
- Registration failures fail plugin activation.
- Background service start failures fail plugin activation in v1.
- Command handler failures report command errors but do not automatically mark the plugin as errored.
- Renderer contribution render crashes are isolated to the contribution boundary and recorded in plugin diagnostics.

## Contribution registration

All extension points are runtime contribution registries. No public SDK `PluginManifest.contributes` arrays remain.

Core frontend registries include:

- `openforge.views.register(...)`
- `openforge.taskPane.registerTab(...)`
- `openforge.settings.registerSection(...)`
- `openforge.commands.register(...)`
- `openforge.events.on(...)` / `emit(...)`

Core backend registries include:

- `openforge.backend.registerMethod(...)`
- `openforge.background.register(...)`
- `openforge.commands.register(...)`
- `openforge.events.on(...)` / `emit(...)`

Registrations must be disposable and idempotent. Basic runtime validation is required for critical fields such as ids, scopes, titles, handlers/components, duplicate IDs, and reserved namespaces. Full JSON Schema validation for every registration can come later.

## Namespacing

Plugin authors use local IDs. The host auto-qualifies them with the plugin id.

```ts
openforge.commands.register({ id: 'sync', title: 'Sync', handler })
```

Host-exposed qualified id:

```txt
github.sync
```

Rules:

- Dot notation is used for qualified commands, events, views, and other contribution IDs.
- `openforge.*` is reserved for host/core namespaces.
- Plugin-local command invocation uses local IDs: `openforge.commands.invoke('sync')`.
- External/core command invocation uses explicit global APIs: `openforge.commands.invokeGlobal('github.sync')`.
- Local events are auto-prefixed by the host.
- Host/core and cross-plugin event listening uses explicit global APIs such as `openforge.events.onGlobal('openforge.task.selected', handler)` or `openforge.events.onGlobal('github.sync.finished', handler)`.
- Plugin-defined host capability namespaces are not supported in v1; commands/events are the loose integration layer.

## Commands and schemas

Commands are first-class app commands, not just plugin view buttons. Views, shortcuts, menus, background services, automation, and other plugins can integrate via commands.

Command and backend method registrations should support JSON Schema / TypeBox-style input and output schemas. Schemas can be optional initially for ergonomics, but the API should be designed around them because they enable validation, docs, future command forms, and safer frontend/backend RPC.

Commands can declare default shortcut metadata in v1. Plugin command shortcuts are active when the plugin is enabled for the active project, with simple scope/context gating if needed. A full `when` expression language is deferred.

Command metadata should support a future command palette, but building a command palette is not part of this ADR unless another task already requires it.

## Frontend UI model

Frontend plugin UI uses native Svelte components, not iframes, webviews, or web-component isolation.

- Components receive standard stable props with API and context snapshots.
- Components should receive API/context through props, not module globals.
- Plugin components must not import app stores directly.
- Reactive context should be snapshots plus events, not Svelte store access.
- Lazy component factories are the primary registration model; direct component registration can be allowed for built-ins/dev ergonomics.
- Task-pane tabs are task-context-only and render only when a task is selected and the plugin is enabled for that task's project.
- Durable task-pane state belongs in task-scoped plugin storage, not component instance lifetime guarantees.

Example prop direction:

```ts
type PluginViewProps = {
  api: FrontendOpenForgeAPI
  context: OpenForgeContextSnapshot
}

type PluginTaskPaneProps = {
  api: FrontendOpenForgeAPI
  context: OpenForgeContextSnapshot
  taskId: string
  projectId: string | null
}
```

View registration supports rail placement metadata in v1:

```ts
openforge.views.register({
  id: 'prs',
  title: 'PRs',
  icon: 'git-pull-request',
  placement: 'rail',
  order: 50,
  component: () => import('./PullRequests.svelte')
})
```

Views have one focused placement in v1.

Settings sections are first-class runtime contributions. Component-based settings come first; schema-generated forms can come later.

## Backend services and RPC

Backend plugin methods are plugin-internal RPC, not a global API namespace.

- A plugin frontend calls its own backend with `openforge.backend.invoke('syncProject', payload)`.
- Backend registers plugin-local methods with `openforge.backend.registerMethod(...)`.
- Cross-plugin/app integration goes through commands.
- Backend methods are callable only after backend activation/registration is ready.

Background services are first-class backend contributions:

```ts
openforge.background.register({
  id: 'sync',
  scope: 'project',
  start: async () => {},
  stop: async () => {}
})
```

Enabled plugin backend services auto-start. Registration should support scopes/conditions over time; v1 can keep conditions simple or let services inspect context during `start`.

Backend plugin code may use Node/npm dependencies directly. Frontend plugin dependencies must be bundled into the built frontend artifact.

## Storage

Plugin storage is automatically namespaced by plugin id and stores JSON-serializable values.

Scopes in v1:

- global
- project
- task

Example:

```ts
await openforge.storage.project(projectId).set('repo', { owner: 'acme', name: 'app' })
await openforge.storage.task(taskId).set('reviewState', { viewedFiles: [] })
```

Storage APIs are available from both frontend and backend runtimes. Renderer implementations can route through IPC/host as needed.

## Core capability namespaces

The versioned `OpenForgeAPI` should be organized as capability namespaces. Commands can remain the generic primitive internally, but normal plugin code should prefer typed core APIs.

V1 capabilities should include:

- `commands`
- `events`
- `views`
- `taskPane`
- `settings`
- `background`
- `backend`
- `storage`
- `context`
- `tasks`
- `projects`
- `fs`
- `shell`
- `notifications`
- `attention`
- `system.openUrl`
- `config`
- `projectConfig`

Filesystem capability should be project-scoped as the primary interface, for example `openforge.fs.readFile({ projectId, path })`. Backend plugins may still use Node `fs` for trusted advanced operations or plugin-private files.

Shell/terminal capability is included in v1, with explicit shell/session/index semantics. Avoid task-scoped ambiguity.

External URL opening must go through `openforge.system.openUrl` so Electron main owns URL handling consistently.

App config/project config APIs are exposed separately from plugin storage. Trusted plugins may mutate exposed config APIs, but should not get arbitrary DB writes.

Generic notification and attention APIs are included, including backend access, to support focus-aware nudges from sync/review/watch services.

## Install, update, remove, and enablement

Install state is app-wide. Enablement is project-level only in v1.

- A plugin is installed once into the app.
- A plugin is enabled/disabled per project using `projectId + pluginId`.
- Contributions appear when their scope/context matches an enabled active project.
- Global-looking contributions also require project enablement in v1.
- Installing does not silently auto-enable. Show an "Enable for this project?" CTA.

Supported source specs:

```txt
npm:@acme/openforge-github@1.2.0
git:github.com/acme/openforge-tools@main
/path/to/local/plugin
```

Persist source spec, resolved install path, package metadata, install state, diagnostics, and project enablement.

Rust sidecar owns install metadata/storage. Package-source mechanics should live in a focused package-manager module owned/called by Rust. For v1 it should invoke external CLIs rather than reimplement protocols:

- `npm` for npm package acquisition.
- `git` for git clone/pull/checkout.
- Direct path reference for local path installs.

For npm/git installs, use managed app-data install directories. For local path installs, reference the local path directly.

Plugin reload should be a first-class host/app action for development and recovery, though not necessarily plugin-callable in v1.

## Diagnostics and errors

Minimal diagnostics are part of v1:

- Install/build/load errors visible in plugin management UI.
- Activation/backend/service errors visible in plugin management UI.
- Contribution slot render crashes show a friendly fallback in that slot.
- Backend host stderr/log lines should be captured/tagged with plugin id where possible.
- Provide a "copy diagnostics" path if practical.
- Record/log command errors; richer plugin health scoring can come later.

## Built-ins and hard cutover

Built-in plugins must migrate first and become the reference implementation.

The cutover should:

- Remove old `manifest.json` contribution loading.
- Move built-ins to `package.json#openforge` metadata.
- Convert built-ins to `defineFrontendPlugin` / `defineBackendPlugin` runtime registration.
- Use the same build contract/tooling as external plugins where practical.
- Delete `PluginManifest.contributes` from the public SDK.
- Let breakage be loud if anything still depends on old manifests.

## Testing, docs, and templates

The SDK should include testing utilities/mocks for `OpenForgeAPI`, such as registry fakes and `createMockOpenForgeApi()`-style helpers.

The rework should include minimal author documentation/templates:

- frontend-only plugin
- backend method + frontend view
- command + background service
- global/project/task storage examples
- package metadata examples

Verification should cover business logic and contracts, including package metadata validation, registration validation, namespacing, lifecycle cleanup, backend readiness/RPC, project enablement, storage scoping, built-in plugin migration, and hard cutover removal of old manifest contribution paths.

## Consequences

Positive consequences:

- The plugin author surface becomes clearer and closer to Pi's proven package-extension model.
- The public SDK becomes smaller and more stable.
- Runtime registrations avoid manifest/activation split-brain.
- Built-ins become meaningful reference implementations.
- Project/task-focused enablement aligns with OpenForge's product model.
- Agent-specific assumptions stay out of the plugin contract.

Negative consequences / costs:

- Existing manifest-based plugins break and must migrate.
- The hard cutover touches SDK, renderer runtime, Rust install/platform code, backend host, built-in plugin builds, tests, and docs.
- No sandboxing means install trust remains an explicit user/product concern.
- Shared backend host crash attribution/recovery needs careful diagnostics.
- Project-only enablement may need future global enablement if global-only plugins become real.

## Staged implementation plan

1. Define the SDK/package contract and shared metadata schema.
2. Implement Rust package manager/install metadata for npm/git/local source specs.
3. Implement runtime registries, namespace rules, disposables, and registration validation.
4. Implement frontend package loading, Svelte component contribution rendering, stable props, and render error boundaries.
5. Implement backend package activation in the shared Node plugin host, plugin-local RPC, background services, readiness, and log attribution.
6. Implement command/event integration, local/global APIs, and typed core capability wrappers.
7. Implement scoped JSON plugin storage for global/project/task from frontend and backend.
8. Update plugin management UI for source installs, project enablement, reload, errors, and diagnostics.
9. Migrate built-in plugins to the new package model and build contract.
10. Hard cutover: remove legacy manifest contribution APIs/loaders and update all tests.
11. Add author docs/templates and SDK testing utilities.

## Deferred questions

- Whether to add truly global plugin enablement later.
- Whether to add per-contribution enable/disable toggles.
- Whether to add local path auto-reload watchers.
- Whether to add a command palette or generated command forms from schemas.
- Whether to add plugin-to-plugin dependency ordering or formal provided capabilities.
- Whether to add richer plugin health scoring beyond logged diagnostics.
