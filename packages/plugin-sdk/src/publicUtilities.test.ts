import { describe, expect, it } from 'vitest'

import { parseStrictFiniteNumber } from '@openforge/plugin-sdk/numberParsing'
import { sanitizeHtml } from '@openforge/plugin-sdk/sanitize'
import {
  getSkillIdentity,
  hasMergeConflicts,
  isQueuedForMerge,
  isReadyToMerge,
  isSameSkillIdentity,
  parseCheckRuns,
  preservePullRequestState,
  splitCheckRuns,
  type FileContent,
  type FileEntry,
  type PullRequestInfo,
  type SkillInfo,
} from '@openforge/plugin-sdk/domain'

describe('public plugin utilities', () => {
  it('parses only strict finite decimal values', () => {
    expect(parseStrictFiniteNumber('42')).toBe(42)
    expect(parseStrictFiniteNumber('-.5')).toBe(-0.5)
    expect(parseStrictFiniteNumber('1e3')).toBeNull()
    expect(parseStrictFiniteNumber('Infinity')).toBeNull()
    expect(parseStrictFiniteNumber('12px')).toBeNull()
  })

  it('sanitizes unsafe HTML while preserving safe structure', () => {
    const result = sanitizeHtml('<p style="color:red">Hello</p><script>alert(1)</script><a href="javascript:alert(1)">bad</a>')

    expect(result).toContain('<p>Hello</p>')
    expect(result).not.toContain('style')
    expect(result).not.toContain('script')
    expect(result).not.toContain('javascript:')
  })

  it('exposes file domain types for plugin file views', () => {
    const entry: FileEntry = { name: 'README.md', path: 'README.md', isDir: false, size: 12, modifiedAt: null }
    const content: FileContent = { type: 'text', content: '# Hi', size: 4, mimeType: 'text/markdown' }

    expect(entry.path).toBe('README.md')
    expect(content.type).toBe('text')
  })

  it('exposes PR domain helpers for GitHub plugins', () => {
    expect(hasMergeConflicts({ state: 'open', mergeable: false, mergeable_state: 'dirty' })).toBe(true)
    expect(isReadyToMerge({ state: 'open', mergeable: true, mergeable_state: 'clean' })).toBe(true)
    expect(isQueuedForMerge({ state: 'open', is_queued: true })).toBe(true)
  })

  it('preserves optimistic and definitive pull request state across transient syncs', () => {
    const oldPr = makePullRequest({ state: 'merged', mergeable: true, mergeable_state: 'clean', merged_at: 123 })
    const nextPr = makePullRequest({ state: 'open', mergeable: null, mergeable_state: 'unknown', merged_at: null })

    expect(preservePullRequestState(oldPr, nextPr)).toMatchObject({
      state: 'merged',
      mergeable: true,
      mergeable_state: 'clean',
      merged_at: 123,
    })
  })

  it('exposes skill identity helpers for skills plugins', () => {
    const skill: SkillInfo = {
      name: 'review',
      description: null,
      agent: null,
      template: null,
      level: 'project',
      source_dir: '.agents',
      file_name: null,
    }

    const identity = getSkillIdentity(skill)

    expect(identity).toEqual({ name: 'review', level: 'project', source_dir: '.agents', file_name: null })
    expect(isSameSkillIdentity(skill, identity)).toBe(true)
  })

  it('parses and splits CI check runs for PR views', () => {
    const checks = parseCheckRuns(JSON.stringify([
      { id: 1, name: 'unit', status: 'completed', conclusion: 'success', html_url: 'https://example.com/1' },
      { id: 2, name: 'lint', status: 'completed', conclusion: 'failure', html_url: 'https://example.com/2' },
    ]))

    expect(splitCheckRuns(checks)).toEqual({
      visible: [{ id: 2, name: 'lint', status: 'completed', conclusion: 'failure', html_url: 'https://example.com/2' }],
      passingCount: 1,
    })
  })
})

function makePullRequest(overrides: Partial<PullRequestInfo>): PullRequestInfo {
  return {
    id: 1,
    ticket_id: 'T-1',
    repo_owner: 'openforge',
    repo_name: 'app',
    title: 'Test PR',
    url: 'https://example.com/pr/1',
    state: 'open',
    head_sha: 'abc123',
    ci_status: null,
    ci_check_runs: null,
    review_status: null,
    mergeable: null,
    mergeable_state: null,
    merged_at: null,
    created_at: 1,
    updated_at: 1,
    draft: false,
    is_queued: false,
    unaddressed_comment_count: 0,
    ...overrides,
  }
}
