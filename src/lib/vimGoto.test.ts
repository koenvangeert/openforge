import { describe, it, expect } from 'vitest'
import { resolveGotoKey } from './vimGoto'

describe('resolveGotoKey', () => {
  it('maps "b" to board', () => {
    expect(resolveGotoKey('b')).toBe('board')
  })

  it('maps "p" to pr_review', () => {
    expect(resolveGotoKey('p')).toBe('pr_review')
  })

  it('maps "s" to skills', () => {
    expect(resolveGotoKey('s')).toBe('skills')
  })

  it('maps "c" to creatures', () => {
    expect(resolveGotoKey('c')).toBe('creatures')
  })

  it('maps "w" to workqueue', () => {
    expect(resolveGotoKey('w')).toBe('workqueue')
  })

  it('maps "," to settings', () => {
    expect(resolveGotoKey(',')).toBe('settings')
  })

  it('returns null for unknown keys', () => {
    expect(resolveGotoKey('m')).toBeNull()
    expect(resolveGotoKey('z')).toBeNull()
    expect(resolveGotoKey('x')).toBeNull()
    expect(resolveGotoKey('1')).toBeNull()
  })

  it('returns null for "g" (gg is handled elsewhere)', () => {
    expect(resolveGotoKey('g')).toBeNull()
  })
})
