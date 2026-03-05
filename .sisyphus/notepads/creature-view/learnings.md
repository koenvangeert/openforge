# Learnings — Creature View

## Pre-existing LSP errors (NOT caused by us)
- `SkillsView.test.ts:83` — `plan_text` does not exist on Task type (pre-existing)
- `doingStatus.test.ts:19` — AgentSession fixtures missing `provider` and `claude_session_id` fields (pre-existing)
- `App.svelte:5` — `selectedSkillName` declared but unused (pre-existing)

These are NOT regressions from our work. Do NOT attempt to fix them unless explicitly asked.

## CSS Animation Patterns (T-507 creature animations)

### Keyframe Structure
- All creature animations defined in `src/app.css` (lines 162-206)
- Pattern: Define `@keyframes` first, then utility classes that reference them
- Each utility class includes `will-change: transform` for GPU acceleration
- Animations use `ease-in-out` timing for smooth, natural motion

### Animation Specifications
1. **creature-bounce** (2s): Gentle up-down bobbing (translateY -6px)
2. **creature-sleep** (3s): Slow breathing scale (1.0 → 1.05)
3. **creature-exclaim** (1s): Pulsing effect for exclamation mark (scale + opacity)
4. **creature-celebrate** (1.5s): Jump + squish with multi-step keyframes (0%, 25%, 50%, 75%, 100%)
5. **creature-wobble** (1s): Dizzy side-to-side rotation (-5deg to 5deg)

### Key Decisions
- Animations are color-agnostic (no color references) — colors applied via component classes
- No hardcoded hex colors — follows daisyUI v5 + Tailwind v4 conventions
- Placed between existing animation block (line 160) and `.markdown-body` section (line 208)
- Section header comment `/* Creature animations */` follows existing pattern (cf. line 151)

### Build Verification
- `pnpm build` passes with no CSS errors
- Commit: `43651ad` — "style(creatures): add creature keyframe animations"
