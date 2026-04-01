import { describe, expect, it } from 'vitest'

import { requireDefined, requireElement } from './dom'

describe('dom test utils', () => {
  describe('requireDefined', () => {
    it('returns a defined value', () => {
      expect(requireDefined('value')).toBe('value')
    })

    it('throws for nullish values', () => {
      expect(() => requireDefined(null)).toThrow('Expected value to be defined')
      expect(() => requireDefined(undefined)).toThrow('Expected value to be defined')
    })
  })

  describe('requireElement', () => {
    it('returns the element when it matches the requested constructor', () => {
      const input = document.createElement('input')

      expect(requireElement(input, HTMLInputElement)).toBe(input)
    })

    it('throws when the element is missing', () => {
      expect(() => requireElement(null, HTMLInputElement)).toThrow('Expected HTMLInputElement')
    })

    it('throws when the element has the wrong type', () => {
      const div = document.createElement('div')

      expect(() => requireElement(div, HTMLButtonElement)).toThrow('Expected HTMLButtonElement')
    })
  })
})
