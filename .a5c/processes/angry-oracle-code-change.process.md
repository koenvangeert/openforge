# Angry Oracle Code-Change Process

Purpose: make `/call`-style implementation work converge through normal TDD/verification and then force an adversarial post-change review before completion.

## High-level flow

1. Map project context and conventions from `AGENTS.md`, `.a5c/project-profile.md`, and `.a5c/quality-gates.json`.
2. Implement the requested code change using TDD.
3. Inventory the actual git changes.
4. Run verification commands, defaulting to:
   - `pnpm exec tsc --noEmit`
   - `pnpm test`
5. Decide whether running-app smoke validation applies based on the changed files.
   - If the change affects OpenForge UI, Electron shell, Rust sidecar/runtime, plugins, IPC, terminal, settings, navigation, or other running-app behavior, run the `openforge-app-operator` skill for read-only manual app verification.
   - If not applicable, record an explicit skip rationale so the oracle can review why manual verification was not run.
6. Send the completed changes, automated verification, and manual app verification result or skip rationale to an **angry principal engineer oracle** for code quality and architectural-fit review.
7. If the oracle reports any required fixes, critical/high findings, blockers, a non-approval verdict, or a score below the threshold, run a fix task and repeat verification + manual verification decision + oracle review.
8. Stop as successful only when the oracle approves and reaches the configured score. If the loop exhausts its retries, pause at a manual breakpoint with the oracle feedback visible.

## Key decisions

- The oracle runs **after code changes, automated verification, and the manual verification decision**, not before implementation.
- Manual app verification is conditional rather than unconditional; process-only or documentation-only changes carry an explicit skipped result.
- Applicable manual verification uses the `openforge-app-operator` skill and stays read-only by default.
- The oracle is intentionally adversarial and must validate that the code makes architectural sense for this codebase.
- Required fixes and critical/high findings are hard blockers.
- The process is generic: callers can override `verificationCommands`, `targetOracleScore`, and `maxOracleIterations` per task.
- The implementation and fix steps are still constrained by OpenForge project conventions and TDD.

## Inputs

```json
{
  "request": "Implement the requested code change",
  "verificationCommands": ["pnpm exec tsc --noEmit", "pnpm test"],
  "targetOracleScore": 90,
  "maxOracleIterations": 3
}
```

## Output

The process returns success state, oracle approval state, changed files, automated verification results, the manual verification result or skip rationale, final oracle review, and each oracle attempt for auditability.
