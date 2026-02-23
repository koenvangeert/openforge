import { describe, it, expect } from 'vitest'
import { compileReviewPrompt } from './reviewPrompt'

describe('compileReviewPrompt', () => {
  it('returns empty string for no comments', () => {
    const result = compileReviewPrompt('My Task', [], [])
    expect(result).toBe('')
  })

  it('compiles prompt with inline and general comments', () => {
    const inline = [
      { path: 'src/auth.ts', line: 42, body: 'Missing null check' },
      { path: 'src/db.ts', line: 10, body: 'Use parameterized query' },
    ]
    const general = [
      { body: 'Add error handling throughout' },
      { body: 'Consider splitting into smaller modules' },
    ]

    const result = compileReviewPrompt('Auth Middleware', inline, general)

    expect(result).toContain('Auth Middleware')
    expect(result).toContain('## Code Comments')
    expect(result).toContain('## General Feedback')
    expect(result).toContain('`src/auth.ts:42`')
    expect(result).toContain('Missing null check')
    expect(result).toContain('`src/db.ts:10`')
    expect(result).toContain('Use parameterized query')
    expect(result).toContain('Add error handling throughout')
    expect(result).toContain('Consider splitting into smaller modules')
    expect(result).toContain('Please address ALL items above')
    expect(result).toContain('After making all fixes, commit the changes and push to the branch.')
  })

  it('handles inline-only — omits General Feedback section', () => {
    const inline = [{ path: 'src/foo.ts', line: 5, body: 'Fix this' }]

    const result = compileReviewPrompt('Inline Task', inline, [])

    expect(result).toContain('## Code Comments')
    expect(result).not.toContain('## General Feedback')
    expect(result).toContain('`src/foo.ts:5`')
    expect(result).toContain('Fix this')
    expect(result).toContain('Please address ALL items above')
    expect(result).toContain('After making all fixes, commit the changes and push to the branch.')
  })

  it('handles general-only — omits Code Comments section', () => {
    const general = [{ body: 'Improve test coverage' }]

    const result = compileReviewPrompt('General Task', [], general)

    expect(result).not.toContain('## Code Comments')
    expect(result).toContain('## General Feedback')
    expect(result).toContain('Improve test coverage')
    expect(result).toContain('Please address ALL items above')
    expect(result).toContain('After making all fixes, commit the changes and push to the branch.')
  })

  it('handles special characters in comment body — backticks, quotes, newlines preserved', () => {
    const inline = [
      { path: 'src/util.ts', line: 1, body: 'Use `Array.from()` instead of `[...set]`' },
    ]
    const general = [
      { body: 'The "error" message says: it\'s broken\nPlease fix it' },
    ]

    const result = compileReviewPrompt('Special Chars', inline, general)

    expect(result).toContain('Use `Array.from()` instead of `[...set]`')
    expect(result).toContain('The "error" message says: it\'s broken\nPlease fix it')
  })

  it('numbers list items starting from 1', () => {
    const inline = [
      { path: 'a.ts', line: 1, body: 'First' },
      { path: 'b.ts', line: 2, body: 'Second' },
      { path: 'c.ts', line: 3, body: 'Third' },
    ]

    const result = compileReviewPrompt('Numbered', inline, [])

    expect(result).toContain('1. `a.ts:1`')
    expect(result).toContain('2. `b.ts:2`')
    expect(result).toContain('3. `c.ts:3`')
  })

  it('includes task title in opening instruction', () => {
    const result = compileReviewPrompt('My Special Feature', [{ path: 'x.ts', line: 1, body: 'Fix' }], [])
    expect(result).toContain('"My Special Feature"')
  })

  it('includes PR review comments section when prReviewComments provided', () => {
    const prComments = [
      { body: 'Consider using a constant here', author: 'reviewer1', file_path: 'src/config.ts', line_number: 15 }
    ]
    const result = compileReviewPrompt('PR Task', [], [], prComments)
    expect(result).toContain('## PR Review Comments')
    expect(result).toContain('[reviewer1]')
    expect(result).toContain('`src/config.ts:15`')
    expect(result).toContain('Consider using a constant here')
  })

  it('includes file path and author in PR review comments', () => {
    const prComments = [
      { body: 'Fix naming', author: 'alice', file_path: 'src/utils.ts', line_number: 42 },
      { body: 'Add docs', author: 'bob', file_path: 'src/api.ts', line_number: null }
    ]
    const result = compileReviewPrompt('Review', [], [], prComments)
    expect(result).toContain('1. [alice] `src/utils.ts:42` — Fix naming')
    expect(result).toContain('2. [bob] `src/api.ts` — Add docs')
  })

  it('handles PR comments without file path (general comments)', () => {
    const prComments = [
      { body: 'Overall looks good but needs more tests', author: 'reviewer', file_path: null, line_number: null }
    ]
    const result = compileReviewPrompt('General PR', [], [], prComments)
    expect(result).toContain('1. [reviewer] (general) — Overall looks good but needs more tests')
  })

  it('includes all three sections when all comment types present', () => {
    const inline = [{ path: 'a.ts', line: 1, body: 'Inline comment' }]
    const general = [{ body: 'General comment' }]
    const prComments = [{ body: 'PR comment', author: 'dev', file_path: 'b.ts', line_number: 5 }]
    const result = compileReviewPrompt('All Types', inline, general, prComments)
    expect(result).toContain('## Code Comments')
    expect(result).toContain('## PR Review Comments')
    expect(result).toContain('## General Feedback')
    // Verify order: Code Comments before PR Review Comments before General Feedback
    const codeIdx = result.indexOf('## Code Comments')
    const prIdx = result.indexOf('## PR Review Comments')
    const generalIdx = result.indexOf('## General Feedback')
    expect(codeIdx).toBeLessThan(prIdx)
    expect(prIdx).toBeLessThan(generalIdx)
  })

  it('returns empty string when only empty arrays provided (including prReviewComments)', () => {
    const result = compileReviewPrompt('Empty', [], [], [])
    expect(result).toBe('')
  })
})
