import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('CI comment workflow', () => {
  it('does not hide GitHub Script failures with empty catch blocks', () => {
    const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/ci-comment.yml'), 'utf8');

    expect(workflow).not.toMatch(/catch\s*(?:\([^)]*\)\s*)?\{\s*\}/);
  });
});
