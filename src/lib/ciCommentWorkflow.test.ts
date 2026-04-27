import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('CI comment workflow', () => {
  const readWorkflow = () => readFileSync(resolve(process.cwd(), '.github/workflows/ci-comment.yml'), 'utf8');

  function getStep(workflow: string, stepName: string): string {
    const match = workflow.match(new RegExp(`\\n      - name: ${stepName}[\\s\\S]*?(?=\\n      - name: |$)`));
    expect(match, `Expected to find step named ${stepName}`).not.toBeNull();
    return match?.[0] ?? '';
  }

  it('does not hide GitHub Script failures with empty catch blocks', () => {
    const workflow = readWorkflow();

    expect(workflow).not.toMatch(/catch\s*(?:\([^)]*\)\s*)?\{\s*\}/);
  });

  it('does not list workflow artifacts while resolving the PR number', () => {
    const workflow = readWorkflow();
    const getPrNumberStep = getStep(workflow, 'Get PR number');

    expect(getPrNumberStep).not.toContain('listWorkflowRunArtifacts');
  });
});
