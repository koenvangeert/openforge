import { describe, expect, it } from 'vitest'
import { getLanguageForFile, highlightCode } from './fileHighlighter'

describe('fileHighlighter', () => {
  describe('getLanguageForFile', () => {
    it('returns known languages from file extensions', () => {
      expect(getLanguageForFile('component.ts')).toBe('typescript')
      expect(getLanguageForFile('query.graphql')).toBe('graphql')
      expect(getLanguageForFile('README.md')).toBe('markdown')
    })

    it('returns null for unknown extensions', () => {
      expect(getLanguageForFile('archive.unknown')).toBeNull()
      expect(getLanguageForFile('LICENSE')).toBeNull()
    })
  })

  describe('highlightCode', () => {
    it('returns highlighted html for supported languages', () => {
      const result = highlightCode('const total = 1', 'example.ts')

      expect(result).toContain('hljs-keyword')
      expect(result).toContain('hljs-number')
    })

    it('escapes html for unsupported languages', () => {
      const result = highlightCode('<custom>&value</custom>', 'example.unknown')

      expect(result).toBe('&lt;custom&gt;&amp;value&lt;/custom&gt;')
    })

    it('preserves escaped content inside highlighted output', () => {
      const result = highlightCode('const label = "<div>"', 'example.ts')

      expect(result).toContain('&lt;div&gt;')
      expect(result).not.toContain('<div>')
    })
  })
})
