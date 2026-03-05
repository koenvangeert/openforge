# Gamified Creature View — Task Avatars in a Garden Habitat

## TL;DR

> **Quick Summary**: Add a new "Creatures" tab showing active and backlog tasks as animated CSS/SVG blob creatures in a garden habitat scene. Running tasks bounce, paused tasks with questions show ❗ exclamation marks, backlog tasks are sleeping eggs. Click any creature to navigate to its task detail.
> 
> **Deliverables**:
> - `src/lib/creatureState.ts` — Pure function mapping `(Task, AgentSession | null) → CreatureState`
> - `src/components/Creature.svelte` — Animated CSS/SVG blob creature component
> - `src/components/CreaturesView.svelte` — Garden habitat scene with creature layout
> - Updated `src/lib/types.ts` — `AppView` union includes `"creatures"`
> - Updated `src/components/IconRail.svelte` — New creatures tab button
> - Updated `src/App.svelte` — Render branch + navigation effect
> - Updated `src/app.css` — Creature `@keyframes` animations
> - Full TDD test coverage for all new files + updated existing tests
> 
> **Estimated Effort**: Medium
> **Parallel Execution**: YES — 4 waves
> **Critical Path**: Task 1 → Task 3 → Task 4 → Task 5

---

## Context

### Original Request
"I want to have another tab other than the dashboard where you have a view like Pokémon or with avatars where you have the different tasks that are ongoing as little avatars or little Pokémons and whenever you have a question, there's an exclamation mark above it. Let's gamify this shit!"

### Interview Summary
**Key Discussions**:
- **Art style**: CSS/SVG blob creatures with eyes/expressions — no external image assets, themeable with daisyUI colors
- **Which tasks**: Doing + Backlog (not Done). Active creatures for doing, eggs/sleeping for backlog
- **Layout**: Habitat/garden scene with themed background, creatures semi-randomly positioned
- **Click behavior**: Navigate directly to TaskDetailView (same pattern as Kanban board task click)
- **Scope**: Visuals + status animations only (v1). No XP, evolution, creature variety, or naming

**Research Findings**:
- Navigation is 100% store-based. `AppView` union at `types.ts:313`, `currentView` writable at `stores.ts:21`, `IconRail.svelte` has hardcoded navItems array at line 13
- Task status via `AgentSession` stored in `activeSessions` Map keyed by task.id. Session status values: `running`, `paused`, `completed`, `failed`, `interrupted`
- "Needs input" detection: `session.status === 'paused' && session.checkpoint_data !== null`. Use `parseCheckpointQuestion()` for question text extraction
- daisyUI v5 + Tailwind v4 with CSS-first config. Two themes: "openforge" (light) and "openforge-dark" (dark) with identical CSS variable names
- Existing `@keyframes` animations in `app.css`: `border-pulse-success`, `border-pulse-warning`, `badge-pulse`, `ci-pulse`
- Testing: vitest + @testing-library/svelte, test files alongside components

### Metis Review
**Identified Gaps** (addressed):
- **Missing creature state**: "doing + paused WITHOUT checkpoint_data" was not mapped → Added as "drowsy/resting" blob (distinct from idle and needs-input)
- **Navigation click-through trap**: Setting `$selectedTaskId` while on creatures view would NOT show TaskDetailView because the `{:else if $currentView === 'creatures'}` branch takes priority → Click handler must set BOTH `$currentView = 'board'` AND `$selectedTaskId = taskId`
- **IconRail test regression**: `IconRail.test.ts` asserts exactly 4 buttons and uses positional indices → Must update test expectations BEFORE component changes (TDD)
- **Dark mode**: Both themes use same CSS variable names so colors auto-adapt, but habitat background gradient needs explicit verification in both themes
- **Empty state**: Zero tasks scenario not addressed → Render empty habitat with message
- **Icon choice**: Not discussed → Default to `Bug` from lucide-svelte (creature-themed)
- **AgentSession test fixtures**: `provider` and `claude_session_id` fields are required but missing from older test helpers → All new test fixtures MUST include these

---

## Work Objectives

### Core Objective
Add a gamified "Creatures" tab that visually represents active and backlog tasks as animated CSS/SVG blob creatures in a garden/habitat scene, with exclamation marks indicating tasks that need user input.

### Concrete Deliverables
- New `creatureState.ts` pure function with 8 creature state mappings
- New `Creature.svelte` component rendering animated SVG blobs
- New `CreaturesView.svelte` habitat scene with creature layout
- Updated navigation (types, IconRail, App.svelte) for new tab
- Creature CSS animations in `app.css`
- Full TDD test coverage (all new + updated existing)

### Definition of Done
- [ ] `pnpm test -- --run` passes with zero failures and zero regressions
- [ ] `pnpm exec tsc --noEmit` exits with code 0
- [ ] New "Creatures" tab appears in IconRail sidebar
- [ ] Clicking creatures tab shows garden habitat with task creatures
- [ ] Backlog tasks render as sleeping egg creatures
- [ ] Doing tasks render as active blob creatures with state-appropriate animations
- [ ] Tasks needing input show pulsing ❗ exclamation mark
- [ ] Clicking any creature navigates to its TaskDetailView
- [ ] Back navigation returns to creatures view

### Must Have
- Pure function `computeCreatureState()` covering all 8 task/session state combinations
- CSS/SVG blob creatures with daisyUI semantic colors (no hardcoded hex)
- Garden/habitat background scene
- Animated creatures: bouncing (running), pulsing ❗ (needs input), sleeping zzz (backlog)
- Click-to-navigate to TaskDetailView
- Empty state message when no backlog/doing tasks
- All `@keyframes` animations in `app.css` (NO `<style>` blocks)
- TDD: tests written before implementation

### Must NOT Have (Guardrails)
- XP, leveling, evolution, or any progression system
- Creature variety (different species, body shapes, accessories)
- Persistent creature positioning (random each render is fine)
- Drag-and-drop for creatures
- Right-click context menus
- Sound effects or audio feedback
- Elaborate habitat decorations (trees, clouds, weather effects)
- New keyboard shortcuts for creatures view
- Search or filter within creatures view
- Creature size variations based on task age/complexity
- New IPC calls or Rust backend changes (pure frontend feature)
- New Svelte stores (derive everything from existing `$tasks` and `$activeSessions`)
- Any `<style>` blocks in components (AGENTS.md rule)
- Hardcoded hex colors (use daisyUI semantic classes/variables)

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (vitest + @testing-library/svelte)
- **Automated tests**: TDD (per AGENTS.md: "Always use TDD")
- **Framework**: vitest with jsdom environment
- **Pattern**: Write failing tests → implement to pass → refactor

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Frontend/UI**: Use Playwright (playwright skill) for visual verification
- **Unit tests**: Use `pnpm test -- --run {file}` for TDD verification
- **Type checking**: Use `pnpm exec tsc --noEmit` for type safety

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — foundation, 3 parallel):
├── Task 1: Creature state pure function + TDD [quick]
├── Task 2: AppView type + IconRail + IconRail test update [quick]
└── Task 3: Creature CSS keyframe animations [quick]

Wave 2 (After Wave 1 — creature component):
└── Task 4: Creature.svelte component + TDD [visual-engineering]
    (depends: Task 1 for CreatureState type, Task 3 for CSS animations)

Wave 3 (After Wave 2 — view + integration):
├── Task 5: CreaturesView.svelte habitat scene + TDD [visual-engineering]
│   (depends: Task 4 for Creature component)
└── Task 6: App.svelte integration + navigation wiring [quick]
    (depends: Task 2 for AppView type, Task 5 for CreaturesView)

Wave FINAL (After ALL tasks — independent review, 4 parallel):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high + playwright)
└── Task F4: Scope fidelity check (deep)

Critical Path: Task 1 → Task 4 → Task 5 → Task 6 → F1-F4
Parallel Speedup: ~50% faster than sequential
Max Concurrent: 3 (Wave 1)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | — | 4 | 1 |
| 2 | — | 6 | 1 |
| 3 | — | 4 | 1 |
| 4 | 1, 3 | 5 | 2 |
| 5 | 4 | 6 | 3 |
| 6 | 2, 5 | F1-F4 | 3 |

### Agent Dispatch Summary

- **Wave 1**: 3 tasks — T1 → `quick`, T2 → `quick`, T3 → `quick`
- **Wave 2**: 1 task — T4 → `visual-engineering`
- **Wave 3**: 2 tasks — T5 → `visual-engineering`, T6 → `quick`
- **FINAL**: 4 tasks — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [ ] 1. Creature State Pure Function + TDD

  **What to do**:
  - Create `src/lib/creatureState.ts` exporting:
    - `CreatureState` type: `'egg' | 'idle' | 'active' | 'needs-input' | 'resting' | 'celebrating' | 'sad' | 'frozen'`
    - `computeCreatureState(task: Task, session: AgentSession | null): CreatureState` pure function
  - State mapping logic:
    - `task.status === 'backlog'` → `'egg'` (regardless of session)
    - `task.status === 'doing'` + `session === null` → `'idle'`
    - `task.status === 'doing'` + `session.status === 'running'` → `'active'`
    - `task.status === 'doing'` + `session.status === 'paused'` + `session.checkpoint_data !== null` → `'needs-input'`
    - `task.status === 'doing'` + `session.status === 'paused'` + `session.checkpoint_data === null` → `'resting'`
    - `task.status === 'doing'` + `session.status === 'completed'` → `'celebrating'`
    - `task.status === 'doing'` + `session.status === 'failed'` → `'sad'`
    - `task.status === 'doing'` + `session.status === 'interrupted'` → `'frozen'`
    - Any other combination → `'idle'` (safe fallback)
  - Write `src/lib/creatureState.test.ts` FIRST (TDD):
    - Test all 8 primary states with minimal Task + AgentSession fixtures
    - Test fallback case (unknown session status → `'idle'`)
    - **CRITICAL**: All AgentSession fixtures MUST include `provider: string` and `claude_session_id: string | null` fields (these are required by the type but older test helpers omit them, see `doingStatus.test.ts` LSP errors)
    - Follow `doingStatus.test.ts` test structure pattern

  **Must NOT do**:
  - Do NOT create a Svelte component in this task
  - Do NOT import from Svelte stores — this is a pure function module
  - Do NOT add any dependencies

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single pure function + test file, no UI complexity, straightforward mapping logic
  - **Skills**: `[]`
    - No special skills needed for pure TypeScript logic
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: No UI work in this task

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: Task 4 (Creature component needs CreatureState type)
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References** (existing code to follow):
  - `src/lib/doingStatus.ts:10-29` — Follow this exact pattern: pure function taking `(tasks, sessions)` and returning computed state. Your function is simpler (single task, not array) but same structure
  - `src/lib/types.ts:1-27` — Task and AgentSession type definitions. Use these exact interfaces for function parameters

  **Test References** (testing patterns to follow):
  - `src/lib/doingStatus.test.ts` — Test structure pattern for pure state functions. **WARNING**: This file has a bug — AgentSession fixtures are missing `provider` and `claude_session_id` fields. Your fixtures MUST include them: `provider: 'opencode'` and `claude_session_id: null`
  - `src/components/TaskCard.test.ts` — Shows how AgentSession fixtures are constructed in component tests

  **API/Type References**:
  - `src/lib/types.ts:15-27` — Full AgentSession interface (note the `provider` and `claude_session_id` fields at lines 25-26)
  - `src/lib/types.ts:339` — KanbanColumn type shows the valid task.status values: `"backlog" | "doing" | "done"`
  - `src/components/TaskCard.svelte:29-31` — Shows how needsInput is derived: `session?.status === 'paused' && session?.checkpoint_data !== null`

  **WHY Each Reference Matters**:
  - `doingStatus.ts` is the canonical pattern for extracting task+session state into a testable pure function — follow its structure exactly
  - `types.ts` defines the contracts — your function signatures must match these interfaces
  - `TaskCard.svelte` shows the existing needsInput detection logic — your `'needs-input'` state must use identical logic

  **Acceptance Criteria**:

  - [ ] `src/lib/creatureState.ts` exports `CreatureState` type and `computeCreatureState` function
  - [ ] `src/lib/creatureState.test.ts` covers all 8 primary states + fallback case (9 tests minimum)
  - [ ] `pnpm test -- --run src/lib/creatureState.test.ts` → PASS (all tests, 0 failures)
  - [ ] `pnpm exec tsc --noEmit` → no new type errors from this file

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: All creature states compute correctly (happy path)
    Tool: Bash (pnpm test)
    Preconditions: creatureState.test.ts written with 9+ test cases
    Steps:
      1. Run `pnpm test -- --run src/lib/creatureState.test.ts`
      2. Verify output contains "9 passed" (or more) and "0 failed"
    Expected Result: All 9+ tests pass with exit code 0
    Failure Indicators: Any test failure, type error, or import error
    Evidence: .sisyphus/evidence/task-1-creature-state-tests.txt

  Scenario: Type safety — function signatures match interfaces
    Tool: Bash (tsc)
    Preconditions: creatureState.ts imports Task and AgentSession from types.ts
    Steps:
      1. Run `pnpm exec tsc --noEmit`
      2. Grep output for creatureState-related errors
    Expected Result: No type errors referencing creatureState.ts
    Failure Indicators: Type mismatch, missing property, wrong return type
    Evidence: .sisyphus/evidence/task-1-type-check.txt
  ```

  **Commit**: YES
  - Message: `feat(creatures): add creature state computation with TDD`
  - Files: `src/lib/creatureState.ts`, `src/lib/creatureState.test.ts`
  - Pre-commit: `pnpm test -- --run src/lib/creatureState.test.ts`

- [ ] 2. AppView Type + IconRail Navigation + Test Update

  **What to do**:
  - **TDD FIRST** — Update `src/components/IconRail.test.ts`:
    - Change "renders 4 navigation buttons" assertion → 5 buttons
    - Add test: "renders creatures navigation button" that verifies creatures button exists and calls `onNavigate('creatures')` on click
    - Fix positional index assertions for settings button (now index 4 instead of 3)
    - Run tests — verify they FAIL (creatures button doesn't exist yet)
  - Update `src/lib/types.ts:313`:
    - Change `AppView = "board" | "pr_review" | "settings" | "skills"` → add `| "creatures"`
  - Update `src/components/IconRail.svelte`:
    - Import `Bug` from `lucide-svelte` (creature-themed icon)
    - Add `{ view: 'creatures', Icon: Bug }` to navItems array BEFORE settings (so settings stays last)
  - Run tests again — verify they PASS

  **Must NOT do**:
  - Do NOT modify App.svelte yet (that's Task 6)
  - Do NOT create CreaturesView component yet
  - Do NOT add badge/notification counts to the creatures button (not in scope for v1)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small edits to 3 existing files (type, component, test). Pattern is obvious — just extend arrays/unions
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: No visual design work, just adding a nav item to existing pattern

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3)
  - **Blocks**: Task 6 (App.svelte integration needs `"creatures"` in AppView)
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src/components/IconRail.svelte:1-18` — Full IconRail component. navItems array at line 13-18. Add new item BEFORE settings
  - `src/lib/types.ts:313` — `AppView = "board" | "pr_review" | "settings" | "skills"` — extend this union type

  **Test References**:
  - `src/components/IconRail.test.ts` — Existing test file. Line 12 asserts 4 buttons (change to 5). Lines 22-48 test button clicks by positional index — settings moves from index 3 to index 4

  **External References**:
  - lucide-svelte `Bug` icon: https://lucide.dev/icons/bug — creature-themed icon for the nav

  **WHY Each Reference Matters**:
  - `IconRail.svelte` is the exact file to modify — follow its existing navItems pattern (view + Icon pairs)
  - `IconRail.test.ts` has positional assertions that WILL break if we add a button without updating indices — TDD catches this
  - `types.ts:313` is the source of truth for valid views — must be updated first for TypeScript to accept `'creatures'`

  **Acceptance Criteria**:

  - [ ] `AppView` type at `types.ts:313` includes `"creatures"`
  - [ ] IconRail renders 5 navigation buttons (creatures before settings)
  - [ ] Creatures button uses `Bug` icon from lucide-svelte
  - [ ] Clicking creatures button calls `onNavigate('creatures')`
  - [ ] `pnpm test -- --run src/components/IconRail.test.ts` → PASS (all tests, 0 failures)
  - [ ] `pnpm exec tsc --noEmit` → no new type errors

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: IconRail renders 5 buttons including creatures (happy path)
    Tool: Bash (pnpm test)
    Preconditions: IconRail.test.ts updated with 5-button assertions
    Steps:
      1. Run `pnpm test -- --run src/components/IconRail.test.ts`
      2. Verify all tests pass
    Expected Result: All tests pass, including new "creatures" button test
    Failure Indicators: Button count mismatch, wrong icon, navigation callback not fired
    Evidence: .sisyphus/evidence/task-2-iconrail-tests.txt

  Scenario: TypeScript accepts 'creatures' as valid AppView
    Tool: Bash (tsc)
    Preconditions: types.ts updated with 'creatures' in AppView union
    Steps:
      1. Run `pnpm exec tsc --noEmit`
      2. Grep for AppView-related errors
    Expected Result: No type errors, 'creatures' accepted as valid AppView value
    Failure Indicators: Type error mentioning 'creatures' not assignable to AppView
    Evidence: .sisyphus/evidence/task-2-type-check.txt
  ```

  **Commit**: YES
  - Message: `feat(nav): add creatures tab to navigation`
  - Files: `src/lib/types.ts`, `src/components/IconRail.svelte`, `src/components/IconRail.test.ts`
  - Pre-commit: `pnpm test -- --run src/components/IconRail.test.ts`

- [ ] 3. Creature CSS Keyframe Animations

  **What to do**:
  - Add creature-specific `@keyframes` animations to `src/app.css` (after existing animation block around line 92+):
    - `creature-bounce`: gentle up-down bobbing for `active` state (transform translateY, 2s ease-in-out infinite)
    - `creature-sleep`: slow scale breathing for `egg` state (scale 0.95-1.05, 3s ease-in-out infinite)
    - `creature-exclaim`: pulsing exclamation mark for `needs-input` state (scale + opacity, 1s ease-in-out infinite)
    - `creature-celebrate`: small jump + squish for `celebrating` state (translateY + scaleX, 1.5s ease-in-out infinite)
    - `creature-wobble`: dizzy side-to-side wobble for `sad` state (rotate -5deg to 5deg, 1s ease-in-out infinite)
  - Add corresponding utility classes that reference these keyframes:
    - `.creature-bounce { animation: creature-bounce 2s ease-in-out infinite; }`
    - `.creature-sleep { animation: creature-sleep 3s ease-in-out infinite; }`
    - `.creature-exclaim { animation: creature-exclaim 1s ease-in-out infinite; }`
    - `.creature-celebrate { animation: creature-celebrate 1.5s ease-in-out infinite; }`
    - `.creature-wobble { animation: creature-wobble 1s ease-in-out infinite; }`
  - All animations should use `will-change: transform` for performance optimization

  **Must NOT do**:
  - Do NOT add animations in component `<style>` blocks (AGENTS.md rule)
  - Do NOT use hardcoded colors in animations — colors come from the component via daisyUI classes
  - Do NOT create elaborate particle effects or complex multi-step animations
  - Do NOT add transition animations between states (each state is a standalone animation loop)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single file edit (app.css), just CSS keyframes. No logic, no testing complexity
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: Pure CSS keyframes, no design decisions needed — animations are specified

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2)
  - **Blocks**: Task 4 (Creature component uses these animation classes)
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src/app.css:84-120` — Existing `@keyframes` block with `border-pulse-success`, `border-pulse-warning`, `badge-pulse`, `ci-pulse`. Follow this exact convention: keyframes defined, then utility classes that reference them. Use same formatting style

  **WHY Each Reference Matters**:
  - `app.css` is the ONLY place animations are defined in this project. The existing animation block shows the exact pattern to follow (keyframe definition + utility class). Adding creature animations here ensures consistency and avoids the forbidden `<style>` blocks

  **Acceptance Criteria**:

  - [ ] 5 new `@keyframes` animations added to `src/app.css`
  - [ ] 5 corresponding utility classes added
  - [ ] All animations use `will-change: transform`
  - [ ] No hardcoded colors in animations
  - [ ] `pnpm dev` starts without CSS errors

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: CSS file is valid and dev server starts (happy path)
    Tool: Bash
    Preconditions: app.css updated with creature animations
    Steps:
      1. Run `pnpm dev &` (background)
      2. Wait 3 seconds for Vite to start
      3. Verify "ready" appears in output (no CSS parse errors)
      4. Kill the dev server
    Expected Result: Vite starts successfully with no CSS errors
    Failure Indicators: CSS parse error, Vite crash, missing animation reference
    Evidence: .sisyphus/evidence/task-3-css-valid.txt

  Scenario: No duplicate keyframe names (error case)
    Tool: Bash (grep)
    Preconditions: app.css updated
    Steps:
      1. Search app.css for duplicate @keyframes names
      2. Verify each creature-* keyframe name appears exactly once as a @keyframes definition
    Expected Result: No duplicate keyframe names found
    Failure Indicators: Same keyframe name defined more than once
    Evidence: .sisyphus/evidence/task-3-no-duplicates.txt
  ```

  **Commit**: YES
  - Message: `style(creatures): add creature keyframe animations`
  - Files: `src/app.css`
  - Pre-commit: `pnpm dev` (verify no CSS errors)

- [ ] 4. Creature SVG Blob Component + TDD

  **What to do**:
  - **TDD FIRST** — Create `src/components/Creature.test.ts`:
    - Test: renders SVG blob for each CreatureState (8 states)
    - Test: shows exclamation mark element when state is `'needs-input'`
    - Test: does NOT show exclamation mark for other states
    - Test: shows "zzz" text/indicator when state is `'egg'`
    - Test: calls onClick with task.id when creature is clicked
    - Test: displays task.id label near creature
    - Test: applies correct animation class per state (e.g., `creature-bounce` for `'active'`)
    - Use `@testing-library/svelte` render + screen queries
    - Run tests — verify they FAIL
  - Create `src/components/Creature.svelte`:
    - Props interface: `{ task: Task, state: CreatureState, questionText: string | null, onClick: (taskId: string) => void }`
    - Render an inline SVG blob shape (rounded blob/circle with two eye dots)
    - Apply CSS class per state:
      - `'egg'` → `creature-sleep` class, muted color (`text-base-content/30`), smaller blob
      - `'idle'` → no animation, neutral color (`text-base-content/50`)
      - `'active'` → `creature-bounce` class, success color (`text-success`)
      - `'needs-input'` → `creature-exclaim` class on exclamation mark, warning color (`text-warning`). Show ❗ element positioned above blob
      - `'resting'` → `creature-sleep` class (slower), info color (`text-info/50`)
      - `'celebrating'` → `creature-celebrate` class, info color (`text-info`)
      - `'sad'` → `creature-wobble` class, error color (`text-error`)
      - `'frozen'` → no animation, grey color (`text-base-content/20`), reduced opacity
    - Show task.id label below creature (small monospace text)
    - Show question text as `title` attribute (native tooltip) when state is `'needs-input'`
    - Entire creature is clickable (cursor-pointer)
  - Run tests — verify they PASS

  **Must NOT do**:
  - Do NOT add `<style>` blocks — all animations are in `app.css` (Task 3)
  - Do NOT create different SVG shapes per creature type (all creatures are the same blob shape)
  - Do NOT add hover animations or click ripple effects
  - Do NOT use external image assets or icon libraries for creature shapes
  - Do NOT subscribe to any Svelte stores — component receives all data via props

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: SVG blob design + CSS animation integration requires visual/frontend expertise. The creature shape and color mapping is the core visual work of this feature
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: Needed for designing the SVG blob creature shape — needs to look appealing with expressions (eyes, mouth shapes per state)
  - **Skills Evaluated but Omitted**:
    - `playwright`: Not needed — unit tests only for this component, visual QA happens in final wave

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (solo)
  - **Blocks**: Task 5 (CreaturesView renders Creature components)
  - **Blocked By**: Task 1 (needs `CreatureState` type), Task 3 (needs CSS animation classes)

  **References**:

  **Pattern References**:
  - `src/components/TaskCard.svelte:1-38` — Props interface pattern with `$props()`, `$derived` for computed state. The creature component follows this same pattern but with SVG instead of Card layout
  - `src/components/Card.svelte` — Wrapper component pattern. Creature doesn't use Card but follows its "single responsibility" approach

  **Test References**:
  - `src/components/TaskCard.test.ts` — Shows how to test a component that receives Task + session data as props. Follow this pattern for Creature.test.ts: render with props, query for expected elements
  - `src/components/CheckpointToast.test.ts` — Shows testing of components with click handlers and dynamic content

  **API/Type References**:
  - `src/lib/creatureState.ts` (from Task 1) — `CreatureState` type to import for the `state` prop
  - `src/lib/types.ts:1-13` — `Task` interface for the `task` prop
  - `src/lib/parseCheckpoint.ts:1-33` — `parseCheckpointQuestion()` returns the question text string that gets passed as `questionText` prop

  **External References**:
  - daisyUI color classes reference: `text-success`, `text-warning`, `text-error`, `text-info`, `text-base-content` — these auto-adapt to light/dark theme

  **WHY Each Reference Matters**:
  - `TaskCard.svelte` is the closest existing analog — a component that renders a Task with status-dependent styling. Follow its Props pattern and `$derived` usage
  - `TaskCard.test.ts` shows how task/session fixtures are constructed for component tests
  - `creatureState.ts` provides the type this component consumes — ensures interface compatibility
  - daisyUI color classes ensure the creatures look correct in both light and dark themes without custom CSS

  **Acceptance Criteria**:

  - [ ] `src/components/Creature.svelte` renders SVG blob creature with eyes
  - [ ] Creature color matches state (success for active, warning for needs-input, etc.)
  - [ ] Exclamation mark visible above creature when state is `'needs-input'`
  - [ ] "zzz" indicator visible when state is `'egg'`
  - [ ] Task ID label visible below creature
  - [ ] Correct CSS animation class applied per state
  - [ ] Click calls onClick callback with task.id
  - [ ] `pnpm test -- --run src/components/Creature.test.ts` → PASS (all tests, 0 failures)
  - [ ] `pnpm exec tsc --noEmit` → no new type errors

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: All creature states render with correct visual indicators (happy path)
    Tool: Bash (pnpm test)
    Preconditions: Creature.test.ts written with tests for all 8 states
    Steps:
      1. Run `pnpm test -- --run src/components/Creature.test.ts`
      2. Verify output shows all tests passing
    Expected Result: 8+ tests pass covering all creature states, click handling, and visual indicators
    Failure Indicators: Missing SVG elements, wrong CSS classes, click handler not called
    Evidence: .sisyphus/evidence/task-4-creature-tests.txt

  Scenario: Needs-input state shows exclamation and hides it for other states (edge case)
    Tool: Bash (pnpm test)
    Preconditions: Tests include assertions for exclamation presence/absence
    Steps:
      1. Verify test for 'needs-input' state asserts exclamation element exists
      2. Verify tests for non-needs-input states assert exclamation element does NOT exist
    Expected Result: Exclamation mark is exclusive to needs-input state
    Failure Indicators: Exclamation visible in wrong states or missing in needs-input
    Evidence: .sisyphus/evidence/task-4-exclamation-exclusivity.txt

  Scenario: Type safety for Creature props
    Tool: Bash (tsc)
    Preconditions: Creature.svelte imports CreatureState from creatureState.ts
    Steps:
      1. Run `pnpm exec tsc --noEmit`
      2. Check for type errors in Creature.svelte
    Expected Result: No type errors
    Failure Indicators: Type mismatch on state prop, missing required props
    Evidence: .sisyphus/evidence/task-4-type-check.txt
  ```

  **Commit**: YES
  - Message: `feat(creatures): add animated SVG blob creature component`
  - Files: `src/components/Creature.svelte`, `src/components/Creature.test.ts`
  - Pre-commit: `pnpm test -- --run src/components/Creature.test.ts`

- [ ] 5. Creatures View — Garden Habitat Scene + TDD

  **What to do**:
  - **TDD FIRST** — Create `src/components/CreaturesView.test.ts`:
    - Test: renders empty state message when no backlog/doing tasks exist
    - Test: renders Creature components for doing tasks
    - Test: renders Creature components for backlog tasks (as eggs)
    - Test: does NOT render Creature components for done tasks
    - Test: passes correct CreatureState to each creature based on session data
    - Test: click on creature calls navigation handler with task.id
    - Test: shows question text for needs-input creatures (via `parseCheckpointQuestion`)
    - Mock stores: `vi.mock('../lib/stores')` with writable stores for tasks and activeSessions
    - Run tests — verify they FAIL
  - Create `src/components/CreaturesView.svelte`:
    - Props interface: `{ onCreatureClick: (taskId: string) => void }`
    - Subscribe to `$tasks` and `$activeSessions` stores via Svelte 5 store syntax
    - Filter tasks: `task.status === 'backlog' || task.status === 'doing'`
    - For each filtered task, compute `CreatureState` using `computeCreatureState(task, sessions.get(task.id) ?? null)`
    - Extract question text using `parseCheckpointQuestion(session?.checkpoint_data ?? null)` for needs-input creatures
    - Layout:
      - Full-height container with garden/habitat background: gradient from `base-200` (ground) to `base-100` (sky) using daisyUI semantic colors
      - Simple ground line at bottom (~20% height) with slightly darker shade
      - Creatures positioned in a flex-wrap grid with some padding/gap (NOT truly random — use CSS grid or flex-wrap for consistent layout that doesn't cause overlap issues)
      - Backlog "eggs" grouped at bottom/ground level
      - Doing "active" creatures above the eggs
    - Empty state: When no tasks match filter, show centered message like "No creatures yet — move tasks to Doing or Backlog to see them hatch!" in monospace, muted text
  - Run tests — verify they PASS

  **Must NOT do**:
  - Do NOT use truly random positioning (causes overlap and unpredictable layout)
  - Do NOT add elaborate background decorations (trees, clouds, sun, flowers)
  - Do NOT add drag-and-drop to creatures
  - Do NOT create new Svelte stores — derive everything from existing `$tasks` and `$activeSessions`
  - Do NOT add new IPC calls — data is already loaded in existing stores by App.svelte
  - Do NOT add search, filter, or sort controls

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Garden habitat layout with creature positioning is visual design work. The gradient background, creature grouping, and empty state all require frontend expertise
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: Needed for the habitat scene composition — background gradient, creature layout spacing, visual hierarchy between doing creatures and backlog eggs
  - **Skills Evaluated but Omitted**:
    - `playwright`: Visual QA deferred to final wave

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 6 (App.svelte needs to import and render CreaturesView)
  - **Blocked By**: Task 4 (needs Creature component)

  **References**:

  **Pattern References**:
  - `src/components/KanbanBoard.svelte:1-50` — Main view component pattern: subscribes to `$tasks` store, filters by status, renders child components. CreaturesView follows this same pattern but with different filtering (backlog+doing) and different child components (Creature instead of TaskCard)
  - `src/components/SkillsView.svelte` — Alternative view component pattern: `interface Props`, `$props()`, view-level layout. Follow for the outer structure
  - `src/components/TaskCard.svelte:29-31` — Session lookup and needsInput detection: `$derived(session?.status === 'paused' && session?.checkpoint_data !== null)`

  **Test References**:
  - `src/components/KanbanBoard.test.ts` — Shows how to mock stores (`vi.mock('../lib/stores')`) and test view components that render multiple child components. Follow this pattern for CreaturesView tests
  - `src/components/SkillsView.test.ts` — Alternative view test pattern

  **API/Type References**:
  - `src/lib/creatureState.ts` (from Task 1) — `computeCreatureState()` function to import
  - `src/lib/parseCheckpoint.ts:1-33` — `parseCheckpointQuestion()` to extract question text for tooltips
  - `src/lib/stores.ts:4,9` — `tasks` and `activeSessions` stores to subscribe to

  **WHY Each Reference Matters**:
  - `KanbanBoard.svelte` is the primary analog — it's the other main "view all tasks" component. Its store subscription, task filtering, and child component rendering pattern should be followed closely
  - `KanbanBoard.test.ts` shows the exact store mocking strategy needed — `vi.mock` with writable stores, then set store values before rendering
  - `parseCheckpoint.ts` provides the question text extraction function — must be used (not reimplemented) for consistency

  **Acceptance Criteria**:

  - [ ] `src/components/CreaturesView.svelte` renders garden habitat with creature layout
  - [ ] Doing tasks rendered as active creatures with correct states
  - [ ] Backlog tasks rendered as egg creatures
  - [ ] Done tasks NOT rendered
  - [ ] Empty state shows "No creatures" message when no matching tasks
  - [ ] Habitat background uses daisyUI semantic colors (adapts to dark mode)
  - [ ] `pnpm test -- --run src/components/CreaturesView.test.ts` → PASS (all tests, 0 failures)
  - [ ] `pnpm exec tsc --noEmit` → no new type errors

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: View renders creatures for doing+backlog tasks only (happy path)
    Tool: Bash (pnpm test)
    Preconditions: CreaturesView.test.ts with store mocks for backlog, doing, and done tasks
    Steps:
      1. Run `pnpm test -- --run src/components/CreaturesView.test.ts`
      2. Verify all tests pass
    Expected Result: All tests pass. Doing and backlog tasks render as creatures. Done tasks are excluded.
    Failure Indicators: Done tasks appearing, missing backlog eggs, wrong creature states
    Evidence: .sisyphus/evidence/task-5-creatures-view-tests.txt

  Scenario: Empty state when no tasks match (edge case)
    Tool: Bash (pnpm test)
    Preconditions: Test sets tasks store to only done tasks (or empty)
    Steps:
      1. Verify test asserts "No creatures" message is displayed
      2. Verify no Creature components are rendered
    Expected Result: Empty state message visible, zero creatures
    Failure Indicators: Error thrown with empty data, message not displayed
    Evidence: .sisyphus/evidence/task-5-empty-state.txt
  ```

  **Commit**: YES
  - Message: `feat(creatures): add garden habitat creatures view`
  - Files: `src/components/CreaturesView.svelte`, `src/components/CreaturesView.test.ts`
  - Pre-commit: `pnpm test -- --run src/components/CreaturesView.test.ts`

- [ ] 6. App.svelte Integration + Navigation Wiring

  **What to do**:
  - Import `CreaturesView` at top of `src/App.svelte`:
    - `import CreaturesView from './components/CreaturesView.svelte'`
  - Add `$effect` to clear `selectedTaskId` when navigating to creatures view (follow existing pattern at lines 38-53 in App.svelte):
    ```typescript
    $effect(() => {
      if ($currentView === 'creatures') {
        $selectedTaskId = null
      }
    })
    ```
  - Add render branch in the conditional chain. **CRITICAL PLACEMENT**: Add `{:else if $currentView === 'creatures'}` BEFORE the `{:else if selectedTask}` check (between the skills check and the selectedTask check, around line 642-644):
    ```svelte
    {:else if $currentView === 'creatures'}
      <CreaturesView
        onCreatureClick={(taskId) => {
          pushNavState()
          $currentView = 'board'
          $selectedTaskId = taskId
        }}
      />
    ```
  - **CRITICAL**: The `onCreatureClick` handler MUST set BOTH `$currentView = 'board'` AND `$selectedTaskId = taskId`. Just setting `$selectedTaskId` alone will NOT work because the `{:else if $currentView === 'creatures'}` branch takes rendering priority over `{:else if selectedTask}`. This is the #1 implementation trap identified by Metis.
  - Update `NavState` in `src/lib/navigation.ts` if needed to support `'creatures'` in the view state (it should already work since NavState stores `AppView` which now includes `'creatures'`)
  - Verify full app flow: creatures tab → click creature → task detail → back → returns to creatures

  **Must NOT do**:
  - Do NOT modify `KanbanBoard.svelte` or any other view component
  - Do NOT add new Tauri event listeners
  - Do NOT add loading states or spinners (data is already loaded by existing App.svelte mechanisms)
  - Do NOT add keyboard shortcuts

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small integration edit in existing files. Pattern is clearly established by other view branches in App.svelte. The key complexity (navigation trap) is documented explicitly
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: No visual design, just wiring existing components

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Tasks 2 and 5)
  - **Parallel Group**: Wave 3 (after Task 5 completes)
  - **Blocks**: Final verification wave
  - **Blocked By**: Task 2 (AppView type must include 'creatures'), Task 5 (CreaturesView component must exist)

  **References**:

  **Pattern References**:
  - `src/App.svelte:638-657` — Conditional rendering chain for views. The `{:else if $currentView === 'settings'}`, `{:else if $currentView === 'pr_review'}`, `{:else if $currentView === 'skills'}` blocks show the exact pattern to follow. Add creatures branch BEFORE `{:else if selectedTask}`
  - `src/App.svelte:38-53` — `$effect` blocks that clear state when switching views. Follow this pattern for clearing `selectedTaskId` on creatures view
  - `src/lib/navigation.ts:5-10` — `NavState` interface: `{ currentView: AppView, selectedTaskId: string | null, selectedReviewPr, selectedSkillName }`. Already stores `AppView` so `'creatures'` is automatically supported

  **API/Type References**:
  - `src/lib/navigation.ts:12-25` — `pushNavState()` function to import for the click handler. Captures current state before navigation so back button restores creatures view
  - `src/lib/stores.ts:8,21` — `selectedTaskId` and `currentView` stores used in the click handler

  **WHY Each Reference Matters**:
  - `App.svelte:638-657` is the EXACT location to add the new render branch. The ORDER matters — creatures must come before selectedTask in the if/else chain (Metis critical finding)
  - `App.svelte:38-53` shows the established pattern for clearing state on view switch — must be followed exactly
  - `navigation.ts` provides `pushNavState()` which is essential for the back-button flow: creatures → click → task detail → back → creatures

  **Acceptance Criteria**:

  - [ ] `CreaturesView` imported and rendered in App.svelte when `$currentView === 'creatures'`
  - [ ] Render branch placed BEFORE `{:else if selectedTask}` in conditional chain
  - [ ] `$effect` clears `$selectedTaskId` when navigating to creatures
  - [ ] Creature click handler sets BOTH `$currentView = 'board'` AND `$selectedTaskId = taskId`
  - [ ] `pushNavState()` called before navigation so back button works
  - [ ] `pnpm exec tsc --noEmit` → no new type errors
  - [ ] `pnpm test -- --run` → full test suite passes (0 regressions)

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Full navigation flow — creatures tab → creature click → task detail → back (happy path)
    Tool: Playwright (playwright skill)
    Preconditions: App running with `pnpm tauri:dev` or `pnpm dev`, at least 1 task in "doing" status
    Steps:
      1. Navigate to app, verify Kanban board is default view
      2. Click the Bug icon (5th button) in the left sidebar
      3. Assert creatures view renders (habitat background visible)
      4. Assert at least one creature is visible
      5. Click on a creature
      6. Assert TaskDetailView renders with that task's ID visible
      7. Press Cmd+[ (back navigation)
      8. Assert creatures view renders again
    Expected Result: Full round-trip navigation works: board → creatures → task detail → creatures
    Failure Indicators: Creatures view not rendering, task detail not showing, back navigation going to wrong view
    Evidence: .sisyphus/evidence/task-6-navigation-flow.png

  Scenario: No regressions in existing views (error prevention)
    Tool: Bash (pnpm test)
    Preconditions: All changes from Tasks 1-6 committed
    Steps:
      1. Run `pnpm test -- --run` (full test suite)
      2. Verify zero failures
      3. Run `pnpm exec tsc --noEmit`
      4. Verify exit code 0
    Expected Result: Full test suite passes, TypeScript compiles cleanly
    Failure Indicators: Any test failure, type error, or regression in existing view tests
    Evidence: .sisyphus/evidence/task-6-full-regression.txt
  ```

  **Commit**: YES
  - Message: `feat(creatures): integrate creatures view in app shell`
  - Files: `src/App.svelte`
  - Pre-commit: `pnpm test -- --run`

---

## Final Verification Wave

> 4 review agents run in PARALLEL. ALL must APPROVE. Rejection → fix → re-run.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run test command). For each "Must NOT Have": search codebase for forbidden patterns (new stores, style blocks, hex colors, new IPC calls) — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `pnpm exec tsc --noEmit` + `pnpm test -- --run`. Review all changed/new files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports, hardcoded hex colors, `<style>` blocks. Check AI slop: excessive comments, over-abstraction, generic variable names. Verify Svelte 5 runes used correctly ($state, $derived, $effect, $props).
  Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill)
  Start from clean state (`pnpm dev`). Execute EVERY QA scenario from EVERY task. Test: creatures tab appears in sidebar, creatures render for doing+backlog tasks, exclamation marks appear on needs-input tasks, clicking creature navigates to TaskDetailView, back navigation returns to creatures view, empty state renders correctly, dark mode works (toggle theme). Save screenshots to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance: no XP/evolution, no creature variety, no new stores, no new IPC, no style blocks. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Scope Creep [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **After Task 1**: `feat(creatures): add creature state computation with TDD` — `src/lib/creatureState.ts`, `src/lib/creatureState.test.ts`
- **After Task 2**: `feat(nav): add creatures tab to navigation` — `src/lib/types.ts`, `src/components/IconRail.svelte`, `src/components/IconRail.test.ts`
- **After Task 3**: `style(creatures): add creature keyframe animations` — `src/app.css`
- **After Task 4**: `feat(creatures): add animated SVG blob creature component` — `src/components/Creature.svelte`, `src/components/Creature.test.ts`
- **After Task 5**: `feat(creatures): add garden habitat creatures view` — `src/components/CreaturesView.svelte`, `src/components/CreaturesView.test.ts`
- **After Task 6**: `feat(creatures): integrate creatures view in app shell` — `src/App.svelte`

---

## Success Criteria

### Verification Commands
```bash
pnpm exec tsc --noEmit          # Expected: exit 0, no type errors
pnpm test -- --run               # Expected: all tests pass, 0 failures
pnpm dev                         # Expected: dev server starts, creatures tab visible
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass (including updated IconRail tests)
- [ ] TypeScript compiles cleanly
- [ ] Both light and dark themes render correctly
- [ ] Creatures tab navigable via sidebar
- [ ] Back navigation works correctly
