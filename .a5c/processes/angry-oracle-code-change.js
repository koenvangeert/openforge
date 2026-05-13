/**
 * @process openforge/angry-oracle-code-change
 * @description Code-change workflow with context-appropriate verification, an explicit architecture review gate, and an adversarial post-change oracle review/fix loop
 * @skill rust .agents/skills/rust/SKILL.md
 * @skill ui-ux-pro-max .agents/skills/ui-ux-pro-max/SKILL.md
 * @skill improve-codebase-architecture /Users/koen/.agents/skills/improve-codebase-architecture/SKILL.md
 * @skill openforge /Users/koen/.pi/agent/skills/openforge/SKILL.md
 * @skill openforge-app-operator .agents/skills/openforge-app-operator/SKILL.md
 * @inputs { request: string, maxOracleIterations: number, targetOracleScore: number, verificationCommands: string[] }
 * @outputs { success: boolean, architectureApproved: boolean, oracleApproved: boolean, iterations: number, changedFiles: string[], finalArchitectureReview: object, finalOracleReview: object, manualVerification: object }
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';

export const ORACLE_BLOCKING_SEVERITIES = ['critical', 'high'];
export const DEFAULT_VERIFICATION_COMMANDS = ['pnpm exec tsc --noEmit', 'pnpm test'];

export const TDD_APPLICABILITY_GUIDANCE = 'Use TDD for feature work, bugfixes, and business-logic or product-behavior implementation: write or update focused tests first, verify the right failure where practical, implement, then refactor.';
export const LIGHTWEIGHT_VERIFICATION_GUIDANCE = 'For documentation-only, configuration-only, planning, metadata, process-only, or similarly low-risk changes, do not invent failing product tests; instead choose the lightest verification that proves the requested artifact is correct, such as process unit tests, schema checks, targeted CLI checks, or careful review.';

export const MANUAL_APP_VERIFICATION_PATH_PREFIXES = [
  'src/',
  'src-tauri/',
  'plugins/',
  'packages/plugin-sdk/',
  'packages/terminal-shared/'
];

export const MANUAL_APP_VERIFICATION_EXACT_FILES = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'vite.config.ts',
  'svelte.config.js',
  'tsconfig.json',
  'tsconfig.electron.json',
  'vitest.config.ts'
];

export function hasBlockingOracleFindings(review = {}) {
  const verdict = String(review.verdict || '').toLowerCase();
  if (verdict && !['approve', 'approved', 'pass', 'passed'].includes(verdict)) {
    return true;
  }

  if (Array.isArray(review.blockers) && review.blockers.length > 0) {
    return true;
  }

  if (Array.isArray(review.requiredFixes) && review.requiredFixes.length > 0) {
    return true;
  }

  const findings = Array.isArray(review.findings) ? review.findings : [];
  return findings.some((finding) =>
    ORACLE_BLOCKING_SEVERITIES.includes(String(finding?.severity || '').toLowerCase())
  );
}

export function normalizeFiniteReviewScore(score) {
  if (typeof score === 'number') {
    return Number.isFinite(score) ? score : null;
  }

  if (typeof score === 'string' && score.trim() !== '') {
    const numericScore = Number(score);
    return Number.isFinite(numericScore) ? numericScore : null;
  }

  return null;
}

export function isFiniteNumericReviewScore(score) {
  return normalizeFiniteReviewScore(score) !== null;
}

export function isReviewScoreInDocumentedRange(score) {
  const normalizedScore = normalizeFiniteReviewScore(score);
  return normalizedScore !== null && normalizedScore >= 0 && normalizedScore <= 100;
}

export function hasBlockingArchitectureFindings(review = {}) {
  const verdict = String(review.verdict || '').toLowerCase();
  if (!['approve', 'approved', 'pass', 'passed'].includes(verdict)) {
    return true;
  }

  if (!isReviewScoreInDocumentedRange(review.score)) {
    return true;
  }

  return hasBlockingOracleFindings(review);
}

export function mergeChangedFiles(existing = [], update = {}) {
  const ordered = [];
  const add = (path) => {
    if (typeof path !== 'string') return;
    const trimmed = path.trim();
    if (trimmed && !ordered.includes(trimmed)) ordered.push(trimmed);
  };

  existing.forEach(add);
  update.filesCreated?.forEach(add);
  update.filesModified?.forEach(add);
  update.changedFiles?.forEach(add);
  update.files?.forEach(add);

  return ordered;
}

function normalizeChangedPath(path) {
  return typeof path === 'string' ? path.trim().replace(/^\.\//, '') : '';
}

export function shouldRequestManualAppVerification(changedFiles = []) {
  return changedFiles.some((path) => {
    const normalized = normalizeChangedPath(path);
    return MANUAL_APP_VERIFICATION_EXACT_FILES.includes(normalized) ||
      MANUAL_APP_VERIFICATION_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix));
  });
}

export function buildManualVerificationSkip(changedFiles = [], iteration = 1) {
  return {
    status: 'skipped',
    applicable: false,
    iteration,
    summary: 'Manual OpenForge app smoke verification was skipped because the changed files do not affect app UI, Electron shell, Rust sidecar/runtime, plugins, IPC, terminal, settings, navigation, or other running-app behavior.',
    changedFiles
  };
}

export function buildOracleReviewPrompt({ request, changedFiles = [], verificationResults = [], manualVerification = null, architectureReview = null, iteration = 1 }) {
  return {
    role: 'angry principal engineer oracle',
    task: 'Review the completed code changes after implementation, including whether the solution has sound architectural fit for this codebase. Be adversarial: do not rubber-stamp the work, and assume subtle bugs, convention violations, missing tests, over-engineering, and misplaced responsibilities are present until proven otherwise.',
    context: {
      request,
      changedFiles,
      verificationResults,
      manualVerification,
      architectureReview,
      iteration,
      architectureReviewCriteria: [
        'The change belongs in the right module/layer and preserves established ownership boundaries',
        'The solution is not over-engineered for the requested scope',
        'Responsibilities are cohesive and not duplicated across unrelated modules',
        'The implementation remains maintainable for future OpenForge task/workflow changes'
      ],
      projectConventions: [
        'Svelte 5 runes only; no legacy event dispatchers',
        'All Tauri invoke calls go through src/lib/ipc.ts typed wrappers',
        'External links use openUrl() IPC wrapper',
        'TypeScript uses import type with verbatimModuleSyntax',
        'Rust commands return Result<T, String> with formatted errors',
        'Tests cover business logic, not visual styling',
        'TDD is expected for feature, bugfix, business-logic, and product-behavior implementation; documentation-only, configuration-only, planning, metadata, and process-only changes may use lighter targeted verification without inventing failing product tests',
        'Map-based stores must replace with new Map() for reactivity',
        'Terminal lifecycle ownership belongs in src/lib/terminalPool.ts'
      ]
    },
    instructions: [
      'Inspect the diff, tests, verification output, manual app verification result or skip rationale, and explicit architecture review gate result against the original request.',
      'Check project conventions from AGENTS.md and the project profile before judging readiness.',
      'Validate that the explicit architecture review gate was run and that its findings were addressed before this oracle review.',
      'Validate architecture and architectural fit: module boundaries, ownership, separation of concerns, cohesion, coupling, and whether the design makes sense for the requested scope.',
      'Flag any missing test coverage, business logic regressions, race conditions, stale lifecycle state, direct invoke usage, Svelte/Rust convention violations, misplaced responsibilities, or over-engineering.',
      'Every finding must include severity, file/path when applicable, evidence, and an actionable fix.',
      'Treat critical/high severity findings, blockers, required fixes, and requiredFixes entries as blockers that must be fixed before completion.',
      'Return changes_requested unless the implementation is genuinely ready with no blocking issues and no required fixes.'
    ],
    outputFormat: 'JSON with verdict (approve|changes_requested), score (0-100), summary, blockers, findings, requiredFixes, and praiseIfAny'
  };
}

export async function process(inputs, ctx) {
  const request = inputs.request || inputs.prompt || 'Implement the requested code change';
  const maxOracleIterations = Number(inputs.maxOracleIterations ?? 3);
  const targetOracleScore = Number(inputs.targetOracleScore ?? 90);
  const verificationCommands = Array.isArray(inputs.verificationCommands) && inputs.verificationCommands.length > 0
    ? inputs.verificationCommands
    : DEFAULT_VERIFICATION_COMMANDS;

  const projectContext = await ctx.task(projectContextTask, { request });

  let implementation = await ctx.task(implementationTask, {
    request,
    projectContext,
    previousOracleReview: null
  });

  let changedFiles = mergeChangedFiles([], implementation);
  const oracleAttempts = [];
  const architectureAttempts = [];
  let verificationResults = [];
  let finalOracleReview = null;
  let finalArchitectureReview = null;
  let manualVerification = null;
  let oracleApproved = false;
  let architectureApproved = false;

  for (let iteration = 1; iteration <= maxOracleIterations; iteration++) {
    const inventory = await ctx.task(changeInventoryTask, { request, changedFiles, iteration });
    changedFiles = mergeChangedFiles(changedFiles, inventory);

    verificationResults = [];
    for (const command of verificationCommands) {
      const result = await ctx.task(runVerificationCommandTask, { command, iteration });
      verificationResults.push({ command, ...result });
    }

    manualVerification = shouldRequestManualAppVerification(changedFiles)
      ? await ctx.task(manualAppVerificationTask, { request, changedFiles, verificationResults, iteration })
      : buildManualVerificationSkip(changedFiles, iteration);

    finalArchitectureReview = await ctx.task(architectureReviewTask, {
      request,
      changedFiles,
      implementation,
      verificationResults,
      manualVerification,
      iteration,
      targetOracleScore
    });

    const architectureBlocking = hasBlockingArchitectureFindings(finalArchitectureReview);
    const architectureScore = normalizeFiniteReviewScore(finalArchitectureReview?.score);
    architectureAttempts.push({
      iteration,
      review: finalArchitectureReview,
      blocking: architectureBlocking,
      score: architectureScore,
      manualVerification
    });

    if (architectureBlocking || architectureScore < targetOracleScore) {
      architectureApproved = false;

      if (iteration === maxOracleIterations) {
        await ctx.breakpoint({
          title: 'Architecture review still has blocking feedback',
          question: `The architecture review gate still requests changes after ${iteration} iteration(s). Stop here or manually approve continuing despite the feedback?`,
          context: {
            runId: ctx.runId,
            architectureReview: finalArchitectureReview,
            changedFiles,
            verificationResults,
            manualVerification
          },
          tags: ['architecture', 'quality-gate', 'manual-decision']
        });
        break;
      }

      const fixResult = await ctx.task(architectureFixTask, {
        request,
        changedFiles,
        verificationResults,
        manualVerification,
        architectureReview: finalArchitectureReview,
        iteration
      });
      implementation = { ...implementation, ...fixResult };
      changedFiles = mergeChangedFiles(changedFiles, fixResult);
      continue;
    }

    architectureApproved = true;

    finalOracleReview = await ctx.task(angryOracleReviewTask, {
      request,
      changedFiles,
      implementation,
      verificationResults,
      manualVerification,
      architectureReview: finalArchitectureReview,
      iteration,
      targetOracleScore
    });

    const blocking = hasBlockingOracleFindings(finalOracleReview);
    const score = Number(finalOracleReview?.score ?? 0);
    oracleAttempts.push({ iteration, review: finalOracleReview, blocking, score, manualVerification, architectureReview: finalArchitectureReview });

    if (!blocking && score >= targetOracleScore) {
      oracleApproved = true;
      break;
    }

    if (iteration === maxOracleIterations) {
      await ctx.breakpoint({
        title: 'Angry oracle still has blocking feedback',
        question: `The angry oracle still requests changes after ${iteration} iteration(s). Stop here or manually approve continuing despite the feedback?`,
        context: {
          runId: ctx.runId,
          oracleReview: finalOracleReview,
          architectureReview: finalArchitectureReview,
          changedFiles,
          verificationResults,
          manualVerification
        },
        tags: ['oracle', 'quality-gate', 'manual-decision']
      });
      break;
    }

    const fixResult = await ctx.task(oracleFixTask, {
      request,
      changedFiles,
      verificationResults,
      manualVerification,
      architectureReview: finalArchitectureReview,
      oracleReview: finalOracleReview,
      iteration
    });
    implementation = { ...implementation, ...fixResult };
    changedFiles = mergeChangedFiles(changedFiles, fixResult);
  }

  return {
    success: oracleApproved,
    request,
    oracleApproved,
    architectureApproved,
    iterations: Math.max(oracleAttempts.length, architectureAttempts.length),
    changedFiles,
    verificationResults,
    manualVerification,
    finalArchitectureReview,
    finalOracleReview,
    architectureAttempts,
    oracleAttempts,
    metadata: {
      processId: 'openforge/angry-oracle-code-change',
      timestamp: ctx.now()
    }
  };
}

export const projectContextTask = defineTask('project-context', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Map project context and constraints',
  description: 'Read project guidance and identify verification expectations before editing',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'senior engineer preparing a code change',
      task: 'Summarize the project-specific rules, relevant files, and verification gates for the requested change',
      context: args,
      instructions: [
        'Read AGENTS.md, .a5c/project-profile.md, and .a5c/quality-gates.json if available.',
        'Identify which frontend, Rust, plugin, or process files are likely touched.',
        'Call out any project-specific hazards that the implementation and oracle must enforce.'
      ],
      outputFormat: 'JSON with summary, relevantFiles, verificationCommands, hazards, and constraints'
    },
    outputSchema: {
      type: 'object',
      required: ['summary'],
      properties: {
        summary: { type: 'string' },
        relevantFiles: { type: 'array', items: { type: 'string' } },
        verificationCommands: { type: 'array', items: { type: 'string' } },
        hazards: { type: 'array', items: { type: 'string' } },
        constraints: { type: 'array', items: { type: 'string' } }
      }
    }
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`
  },
  labels: ['agent', 'planning', 'project-context']
}));

export const implementationTask = defineTask('implementation-with-appropriate-verification', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Implement requested code change with appropriate verification',
  description: 'Make the requested changes with TDD when it applies and lighter targeted verification for docs/config/process-only work',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'senior OpenForge engineer',
      task: 'Implement the requested code change completely',
      context: args,
      instructions: [
        TDD_APPLICABILITY_GUIDANCE,
        LIGHTWEIGHT_VERIFICATION_GUIDANCE,
        'Implement only the requested scope; do not opportunistically refactor unrelated code.',
        'Follow AGENTS.md conventions exactly for Svelte, TypeScript, Rust, IPC, terminal lifecycle, task context menus, and styling.',
        'Run targeted verification as you work when practical.',
        'Return a precise list of files created, modified, and verification performed.'
      ],
      outputFormat: 'JSON with summary, filesCreated, filesModified, changedFiles, testsAddedOrUpdated, verification'
    },
    outputSchema: {
      type: 'object',
      required: ['summary', 'changedFiles'],
      properties: {
        summary: { type: 'string' },
        filesCreated: { type: 'array', items: { type: 'string' } },
        filesModified: { type: 'array', items: { type: 'string' } },
        changedFiles: { type: 'array', items: { type: 'string' } },
        testsAddedOrUpdated: { type: 'array', items: { type: 'string' } },
        verification: { type: 'array' }
      }
    }
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`
  },
  labels: ['agent', 'implementation', 'verification']
}));

export const changeInventoryTask = defineTask('change-inventory', (args) => ({
  kind: 'shell',
  title: `Inventory changed files (oracle iter ${args.iteration})`,
  description: 'Capture git status, changed file names, and diff stat after code changes',
  shell: {
    command: 'printf "## git status --short\\n" && git status --short && printf "\\n## changed tracked files\\n" && git diff --name-only HEAD && printf "\\n## untracked files\\n" && git ls-files --others --exclude-standard && printf "\\n## diff stat\\n" && git diff --stat HEAD',
    cwd: '.'
  },
  labels: ['shell', 'git', 'inventory', `oracle-iteration-${args.iteration}`]
}));

export const runVerificationCommandTask = defineTask('verification-command', (args) => ({
  kind: 'shell',
  title: `Verify: ${args.command}`,
  description: 'Run a project verification command before the oracle review',
  shell: {
    command: args.command,
    cwd: '.'
  },
  labels: ['shell', 'verification', `oracle-iteration-${args.iteration}`]
}));

export const manualAppVerificationTask = defineTask('manual-app-verification', (args, taskCtx) => ({
  kind: 'skill',
  title: `Manual OpenForge app verification (iteration ${args.iteration})`,
  description: 'Use the OpenForge app operator skill for read-only manual smoke checks when app behavior changed',
  skill: {
    name: 'openforge-app-operator',
    context: {
      request: args.request,
      changedFiles: args.changedFiles,
      verificationResults: args.verificationResults,
      iteration: args.iteration,
      instructions: [
        'Perform manual app smoke verification only for the changed OpenForge UI, Electron shell, Rust sidecar/runtime, plugin, IPC, terminal, settings, navigation, or other running-app behavior.',
        'Follow the openforge-app-operator skill instructions and keep checks read-only by default.',
        'Use the CLI bridge check and targeted click-through guidance from the skill where applicable.',
        'Do not create, update, delete, move, start, or stop tasks/agents unless the original request explicitly requires it or the user approved it.',
        'Return status, applicability, commands run, app sections checked, observations, screenshot paths if any, cleanup performed, skipped gates, and open risks.'
      ],
      expectedOutput: 'JSON with status (passed|failed|skipped), applicable, summary, commandsRun, appSectionsChecked, observations, screenshots, cleanup, skippedGates, and openRisks'
    }
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`
  },
  labels: ['skill', 'manual-verification', 'openforge-app-operator', `oracle-iteration-${args.iteration}`]
}));

export const architectureReviewTask = defineTask('architecture-review', (args, taskCtx) => ({
  kind: 'skill',
  title: `Architecture review gate (iteration ${args.iteration})`,
  description: 'Run an explicit architecture-focused review before the angry oracle review',
  skill: {
    name: 'improve-codebase-architecture',
    context: {
      request: args.request,
      changedFiles: args.changedFiles,
      implementation: args.implementation,
      verificationResults: args.verificationResults,
      manualVerification: args.manualVerification,
      iteration: args.iteration,
      targetScore: args.targetOracleScore,
      instructions: [
        'Act as an explicit architecture review gate before the angry oracle review runs.',
        'Inspect the completed diff, changed files, automated verification, and manual verification result or skip rationale.',
        'Evaluate module boundaries, layer ownership, separation of concerns, cohesion, coupling, data flow, and whether the design is appropriately scoped for the request.',
        'Check OpenForge-specific ownership rules such as IPC wrappers, Electron shell boundaries, Rust sidecar command boundaries, terminal lifecycle ownership, task context menu ownership, and Svelte component responsibilities when relevant.',
        'Flag misplaced responsibilities, duplicate lifecycle truth, unnecessary abstraction, over-engineering, cross-layer leakage, and architecture-sensitive missing tests.',
        'Return approve only if the architecture is sound enough to proceed to the angry oracle review; otherwise return changes_requested with actionable fixes.'
      ],
      expectedOutput: 'JSON with verdict (approve|changes_requested), score (0-100), summary, blockers, findings with severity/file/evidence/actionableFix, requiredFixes, and architectureNotes'
    }
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`
  },
  labels: ['skill', 'architecture', 'architecture-review', 'improve-codebase-architecture', `iteration-${args.iteration}`]
}));

export const architectureFixTask = defineTask('architecture-fix', (args, taskCtx) => ({
  kind: 'agent',
  title: `Fix architecture review feedback (iteration ${args.iteration})`,
  description: 'Apply required fixes from the explicit architecture review gate',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'senior engineer fixing architecture review blockers',
      task: 'Apply the architecture review feedback and remove all required fixes plus critical/high blockers before the angry oracle review runs',
      context: args,
      instructions: [
        'Fix every architecture review required fixes item, every requiredFixes entry, and every blocking architecture finding unless it is demonstrably false; explain any false positive with evidence.',
        'Fix every critical and high severity architecture finding unless it is demonstrably false; explain any false positive with evidence.',
        'Preserve module boundaries, layer ownership, separation of concerns, cohesion, coupling, and appropriate scope for the original request.',
        'Add or update focused business-logic tests only when the architecture fix changes feature, bugfix, business-logic, or product behavior.',
        'Do not invent failing product tests for documentation-only, configuration-only, planning, metadata, process-only, or similarly low-risk fixes; use targeted verification that fits the changed artifact.',
        'Keep the scope tight to the architecture review feedback and original request.',
        'Return exactly what changed and which architecture findings were addressed.'
      ],
      outputFormat: 'JSON with summary, filesCreated, filesModified, changedFiles, addressedFindings, testsAddedOrUpdated, remainingConcerns'
    },
    outputSchema: {
      type: 'object',
      required: ['summary', 'changedFiles'],
      properties: {
        summary: { type: 'string' },
        filesCreated: { type: 'array', items: { type: 'string' } },
        filesModified: { type: 'array', items: { type: 'string' } },
        changedFiles: { type: 'array', items: { type: 'string' } },
        addressedFindings: { type: 'array', items: { type: 'string' } },
        testsAddedOrUpdated: { type: 'array', items: { type: 'string' } },
        remainingConcerns: { type: 'array', items: { type: 'string' } }
      }
    }
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`
  },
  labels: ['agent', 'fix', 'architecture-review', `iteration-${args.iteration}`]
}));

export const angryOracleReviewTask = defineTask('angry-oracle-review', (args, taskCtx) => ({
  kind: 'agent',
  title: `Angry oracle review (iteration ${args.iteration})`,
  description: 'Adversarial post-change review that must find actionable blocking feedback before completion',
  agent: {
    name: 'general-purpose',
    prompt: buildOracleReviewPrompt(args),
    outputSchema: {
      type: 'object',
      required: ['verdict', 'score', 'summary', 'findings'],
      properties: {
        verdict: { type: 'string', enum: ['approve', 'changes_requested'] },
        score: { type: 'number', minimum: 0, maximum: 100 },
        summary: { type: 'string' },
        blockers: { type: 'array', items: { type: 'string' } },
        findings: {
          type: 'array',
          items: {
            type: 'object',
            required: ['severity', 'message', 'actionableFix'],
            properties: {
              severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
              file: { type: 'string' },
              message: { type: 'string' },
              evidence: { type: 'string' },
              actionableFix: { type: 'string' }
            }
          }
        },
        requiredFixes: { type: 'array', items: { type: 'string' } },
        praiseIfAny: { type: 'array', items: { type: 'string' } }
      }
    }
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`
  },
  labels: ['agent', 'oracle', 'adversarial-review', `iteration-${args.iteration}`]
}));

export const oracleFixTask = defineTask('oracle-fix', (args, taskCtx) => ({
  kind: 'agent',
  title: `Fix angry oracle feedback (iteration ${args.iteration})`,
  description: 'Apply required fixes from the adversarial oracle review',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'senior engineer fixing code review blockers',
      task: 'Apply the angry oracle feedback and remove all required fixes plus critical/high blockers',
      context: args,
      instructions: [
        'Fix every required fixes item, every requiredFixes entry, and every blocking review finding unless it is demonstrably false; explain any false positive with evidence.',
        'Fix every critical and high severity finding unless it is demonstrably false; explain any false positive with evidence.',
        'Address architectural fit feedback by preserving module boundaries, ownership, cohesion, and appropriate scope.',
        'Add or update focused business-logic tests for fixed feature, bugfix, business-logic, or product-behavior changes.',
        'Do not invent failing product tests for documentation-only, configuration-only, planning, metadata, process-only, or similarly low-risk fixes; use targeted verification that fits the changed artifact.',
        'Keep the scope tight to the oracle feedback and original request.',
        'Return exactly what changed and which findings were addressed.'
      ],
      outputFormat: 'JSON with summary, filesCreated, filesModified, changedFiles, addressedFindings, testsAddedOrUpdated, remainingConcerns'
    },
    outputSchema: {
      type: 'object',
      required: ['summary', 'changedFiles'],
      properties: {
        summary: { type: 'string' },
        filesCreated: { type: 'array', items: { type: 'string' } },
        filesModified: { type: 'array', items: { type: 'string' } },
        changedFiles: { type: 'array', items: { type: 'string' } },
        addressedFindings: { type: 'array', items: { type: 'string' } },
        testsAddedOrUpdated: { type: 'array', items: { type: 'string' } },
        remainingConcerns: { type: 'array', items: { type: 'string' } }
      }
    }
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`
  },
  labels: ['agent', 'fix', 'oracle-feedback', `iteration-${args.iteration}`]
}));
