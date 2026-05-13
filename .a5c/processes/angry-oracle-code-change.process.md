# Angry Oracle Code-Change Process

Purpose: make `/call`-style implementation work converge through context-appropriate verification, an explicit architecture review gate, and then an adversarial post-change review before completion.

## High-level flow

1. Map project context and conventions from `AGENTS.md`, `.a5c/project-profile.md`, and `.a5c/quality-gates.json`.
2. Implement the requested code change with TDD when it applies, or with lighter targeted verification for documentation-only, configuration-only, planning, metadata, process-only, or similarly low-risk changes.
3. Inventory the actual git changes.
4. Run verification commands, defaulting to:
   - `pnpm exec tsc --noEmit`
   - `pnpm test`
5. Decide whether running-app smoke validation applies based on the changed files.
   - If the change affects OpenForge UI, Electron shell, Rust sidecar/runtime, plugins, IPC, terminal, settings, navigation, or other running-app behavior, run the `openforge-app-operator` skill for read-only manual app verification.
   - If not applicable, record an explicit skip rationale so the oracle can review why manual verification was not run.
6. Run the `improve-codebase-architecture` skill as an explicit architecture review gate against the completed changes, automated verification, and manual app verification result or skip rationale.
7. If the architecture gate reports any required fixes, critical/high findings, blockers, a non-approval verdict, or a score below the threshold, run an architecture fix task and repeat inventory + verification + manual verification decision + architecture review before the angry oracle can run.
8. After the architecture gate approves, send the completed changes, automated verification, manual app verification result or skip rationale, and architecture review result to an **angry principal engineer oracle** for code quality and final architectural-fit review.
9. If the oracle reports any required fixes, critical/high findings, blockers, a non-approval verdict, or a score below the threshold, run a fix task and repeat verification + manual verification decision + architecture review + oracle review.
10. Stop as successful only when the architecture gate and oracle both approve and the oracle reaches the configured score. If the loop exhausts its retries, pause at a manual breakpoint with the blocking feedback visible.

## Key decisions

- The architecture gate runs **after code changes, automated verification, and the manual verification decision** and **before** the angry oracle review.
- The oracle runs only after the explicit architecture gate has approved; it still performs an adversarial final architecture sanity check rather than replacing the dedicated gate.
- Manual app verification is conditional rather than unconditional; process-only or documentation-only changes carry an explicit skipped result.
- Applicable manual verification uses the `openforge-app-operator` skill and stays read-only by default.
- The architecture gate uses the architecture-focused `improve-codebase-architecture` skill, not a generic reviewer prompt.
- The oracle is intentionally adversarial and must validate that the code makes architectural sense for this codebase.
- Required fixes and critical/high findings are hard blockers.
- The process is generic: callers can override `verificationCommands`, `targetOracleScore`, and `maxOracleIterations` per task.
- The implementation and fix steps are still constrained by OpenForge project conventions: use TDD for feature, bugfix, business-logic, and product-behavior implementation, but do not invent failing product tests for docs/config/process-only work where targeted verification is more appropriate.

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

The process returns success state, architecture and oracle approval state, changed files, automated verification results, the manual verification result or skip rationale, final architecture review, final oracle review, and each architecture/oracle attempt for auditability.
