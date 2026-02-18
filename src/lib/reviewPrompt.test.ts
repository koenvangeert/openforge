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
  })

  it('handles inline-only — omits General Feedback section', () => {
    const inline = [{ path: 'src/foo.ts', line: 5, body: 'Fix this' }]

    const result = compileReviewPrompt('Inline Task', inline, [])

    expect(result).toContain('## Code Comments')
    expect(result).not.toContain('## General Feedback')
    expect(result).toContain('`src/foo.ts:5`')
    expect(result).toContain('Fix this')
    expect(result).toContain('Please address ALL items above')
  })

  it('handles general-only — omits Code Comments section', () => {
    const general = [{ body: 'Improve test coverage' }]

    const result = compileReviewPrompt('General Task', [], general)

    expect(result).not.toContain('## Code Comments')
    expect(result).toContain('## General Feedback')
    expect(result).toContain('Improve test coverage')
    expect(result).toContain('Please address ALL items above')
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
})
