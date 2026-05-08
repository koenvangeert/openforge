import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ORACLE_BLOCKING_SEVERITIES,
  buildManualVerificationSkip,
  buildOracleReviewPrompt,
  changeInventoryTask,
  angryOracleReviewTask,
  hasBlockingOracleFindings,
  implementationTask,
  manualAppVerificationTask,
  mergeChangedFiles,
  oracleFixTask,
  process as runProcess,
  projectContextTask,
  runVerificationCommandTask,
  shouldRequestManualAppVerification
} from './angry-oracle-code-change.js';

describe('angry oracle code-change process', () => {
  it('treats critical, high, explicit blockers, required fixes, and non-approve verdicts as blocking', () => {
    assert.deepEqual(ORACLE_BLOCKING_SEVERITIES, ['critical', 'high']);

    assert.equal(
      hasBlockingOracleFindings({ verdict: 'approve', findings: [{ severity: 'medium', message: 'nit' }] }),
      false
    );
    assert.equal(
      hasBlockingOracleFindings({ verdict: 'approve', findings: [{ severity: 'high', message: 'broken edge case' }] }),
      true
    );
    assert.equal(hasBlockingOracleFindings({ verdict: 'changes_requested', findings: [] }), true);
    assert.equal(hasBlockingOracleFindings({ verdict: 'approve', blockers: ['tests do not cover failure path'] }), true);
    assert.equal(hasBlockingOracleFindings({ verdict: 'approve', requiredFixes: ['split orchestration concerns'] }), true);
  });

  it('deduplicates changed files from implementation and fixer outputs while preserving order', () => {
    assert.deepEqual(
      mergeChangedFiles(['src/a.ts', 'src/b.ts'], {
        filesCreated: ['src/c.ts'],
        filesModified: ['src/b.ts', 'src/d.ts'],
        changedFiles: ['src/a.ts', 'src/e.ts']
      }),
      ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts']
    );
  });

  it('inventories tracked and untracked files for oracle review', async () => {
    const task = await changeInventoryTask.build({ iteration: 1 }, { effectId: 'effect-1' });

    assert.match(task.shell.command, /git diff --name-only HEAD/);
    assert.match(task.shell.command, /git ls-files --others --exclude-standard/);
  });

  it('directs fixes to address every reviewer-required change before re-review', async () => {
    const task = await oracleFixTask.build({ iteration: 1 }, { effectId: 'effect-1' });

    assert.ok(task.agent.prompt.instructions.some((instruction) => /required fixes/i.test(instruction)));
    assert.ok(task.agent.prompt.instructions.some((instruction) => /blocking review/i.test(instruction)));
  });

  it('applies TDD conditionally instead of mandating failing tests for every workflow change', async () => {
    const implementation = await implementationTask.build({}, { effectId: 'effect-1' });
    const fix = await oracleFixTask.build({ iteration: 1 }, { effectId: 'effect-2' });

    assert.match(implementation.title, /appropriate verification/i);
    assert.ok(
      implementation.agent.prompt.instructions.some((instruction) =>
        /TDD.*feature.*bugfix.*business-logic/i.test(instruction)
      )
    );
    assert.ok(
      implementation.agent.prompt.instructions.some((instruction) =>
        /documentation-only.*configuration-only.*process-only/i.test(instruction)
      )
    );
    assert.ok(
      fix.agent.prompt.instructions.some((instruction) =>
        /Do not invent failing product tests/i.test(instruction)
      )
    );
  });

  it('builds an adversarial post-change oracle prompt that requires architectural review and actionable fixes', () => {
    const prompt = buildOracleReviewPrompt({
      request: 'Add token rotation',
      changedFiles: ['src/auth.ts'],
      verificationResults: [{ command: 'pnpm test', status: 'ok' }],
      manualVerification: { status: 'passed', applicable: true, summary: 'Board smoke checked' },
      iteration: 1
    });

    assert.equal(prompt.role, 'angry principal engineer oracle');
    assert.match(prompt.task, /review the completed code changes/i);
    assert.match(prompt.task, /not rubber-stamp/i);
    assert.match(prompt.task, /architectural fit/i);
    assert.ok(prompt.instructions.some((instruction) => /actionable fix/i.test(instruction)));
    assert.ok(prompt.instructions.some((instruction) => /project conventions/i.test(instruction)));
    assert.ok(prompt.instructions.some((instruction) => /architecture/i.test(instruction)));
    assert.ok(prompt.instructions.some((instruction) => /manual app verification/i.test(instruction)));
    assert.deepEqual(prompt.context.changedFiles, ['src/auth.ts']);
    assert.deepEqual(prompt.context.manualVerification, { status: 'passed', applicable: true, summary: 'Board smoke checked' });
  });

  it('requests manual app verification for app-facing and runtime-sensitive changes', () => {
    assert.equal(shouldRequestManualAppVerification(['src/App.svelte']), true);
    assert.equal(shouldRequestManualAppVerification(['src/electron/main.ts']), true);
    assert.equal(shouldRequestManualAppVerification(['src-tauri/src/commands/tasks.rs']), true);
    assert.equal(shouldRequestManualAppVerification(['plugins/skills-viewer/src/SkillsView.svelte']), true);
    assert.equal(shouldRequestManualAppVerification(['packages/plugin-sdk/src/index.ts']), true);
  });

  it('skips manual app verification for process-only changes with an explicit rationale', () => {
    assert.equal(shouldRequestManualAppVerification(['.a5c/processes/angry-oracle-code-change.js']), false);

    assert.deepEqual(
      buildManualVerificationSkip(['.a5c/processes/angry-oracle-code-change.js'], 2),
      {
        status: 'skipped',
        applicable: false,
        iteration: 2,
        summary: 'Manual OpenForge app smoke verification was skipped because the changed files do not affect app UI, Electron shell, Rust sidecar/runtime, plugins, IPC, terminal, settings, navigation, or other running-app behavior.',
        changedFiles: ['.a5c/processes/angry-oracle-code-change.js']
      }
    );
  });

  it('uses the openforge-app-operator skill for applicable manual app verification', async () => {
    const task = await manualAppVerificationTask.build(
      {
        request: 'Fix task detail rendering',
        changedFiles: ['src/components/TaskDetails.svelte'],
        verificationResults: [{ command: 'pnpm test', status: 'ok' }],
        iteration: 1
      },
      { effectId: 'effect-1' }
    );

    assert.equal(task.kind, 'skill');
    assert.equal(task.skill.name, 'openforge-app-operator');
    assert.ok(task.skill.context.instructions.some((instruction) => /manual app smoke verification/i.test(instruction)));
    assert.ok(task.skill.context.instructions.some((instruction) => /read-only/i.test(instruction)));
    assert.deepEqual(task.skill.context.changedFiles, ['src/components/TaskDetails.svelte']);
    assert.equal(task.io.outputJsonPath, 'tasks/effect-1/output.json');
  });

  it('runs applicable manual app verification after automated verification and before oracle review', async () => {
    const taskOrder = [];
    const manualVerification = { status: 'passed', applicable: true, summary: 'Smoke checked task detail' };

    const result = await runProcess(
      {
        request: 'Fix task detail rendering',
        verificationCommands: ['pnpm test src/components/TaskDetails.test.ts'],
        targetOracleScore: 90,
        maxOracleIterations: 1
      },
      {
        runId: 'run-1',
        now: () => '2026-05-06T00:00:00.000Z',
        task: async (task, args) => {
          if (task === projectContextTask) {
            taskOrder.push('project-context');
            return { summary: 'context' };
          }
          if (task === implementationTask) {
            taskOrder.push('implementation');
            return { summary: 'implemented', changedFiles: ['src/components/TaskDetails.svelte'] };
          }
          if (task === changeInventoryTask) {
            taskOrder.push('change-inventory');
            return {};
          }
          if (task === runVerificationCommandTask) {
            taskOrder.push('automated-verification');
            assert.equal(args.command, 'pnpm test src/components/TaskDetails.test.ts');
            return { status: 'ok' };
          }
          if (task === manualAppVerificationTask) {
            taskOrder.push('manual-verification');
            assert.deepEqual(args.verificationResults, [
              { command: 'pnpm test src/components/TaskDetails.test.ts', status: 'ok' }
            ]);
            return manualVerification;
          }
          if (task === angryOracleReviewTask) {
            taskOrder.push('oracle-review');
            assert.deepEqual(args.manualVerification, manualVerification);
            return { verdict: 'approve', score: 95, summary: 'ready', findings: [] };
          }
          throw new Error(`Unexpected task: ${task?.id || task?.title || 'unknown'}`);
        },
        breakpoint: async () => {
          throw new Error('No breakpoint expected');
        }
      }
    );

    assert.deepEqual(taskOrder, [
      'project-context',
      'implementation',
      'change-inventory',
      'automated-verification',
      'manual-verification',
      'oracle-review'
    ]);
    assert.equal(result.oracleApproved, true);
    assert.deepEqual(result.manualVerification, manualVerification);
  });
});
