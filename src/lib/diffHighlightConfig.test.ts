import { DiffFile } from '@git-diff-view/core'
import { highlighter } from '@git-diff-view/lowlight'
import { describe, expect, it, vi } from 'vitest'
import {
  configureDiffHighlighter,
  DIFF_HIGHLIGHT_IGNORE_PATTERNS,
  DIFF_HIGHLIGHT_MAX_LINES,
} from './diffHighlightConfig'

describe('diffHighlightConfig', () => {
  it('applies the shared performance guardrails to a highlighter instance', () => {
    const stubHighlighter = {
      setMaxLineToIgnoreSyntax: vi.fn(),
      setIgnoreSyntaxHighlightList: vi.fn(),
    }

    configureDiffHighlighter(stubHighlighter)

    expect(stubHighlighter.setMaxLineToIgnoreSyntax).toHaveBeenCalledWith(DIFF_HIGHLIGHT_MAX_LINES)
    expect(stubHighlighter.setIgnoreSyntaxHighlightList).toHaveBeenCalledWith(DIFF_HIGHLIGHT_IGNORE_PATTERNS)
  })

  it('preserves syntax metadata when a worker-style full bundle is reconstructed', () => {
    configureDiffHighlighter(highlighter)

    const diffFile = new DiffFile(
      'example.ts',
      'const value = 1\n',
      'example.ts',
      'const value = 2\n',
      ['@@ -1 +1 @@', '-const value = 1', '+const value = 2'],
      'typescript',
      'typescript'
    )

    diffFile.initTheme('light')
    diffFile.initRaw()
    diffFile.initSyntax({ registerHighlighter: highlighter })
    diffFile.buildSplitDiffLines()
    diffFile.buildUnifiedDiffLines()

    const bundle = diffFile._getFullBundle()
    const reconstructed = DiffFile.createInstance({}, bundle)

    expect(bundle.hasInitSyntax).toBe(true)
    expect(bundle.highlighterName).toBe(highlighter.name)
    expect(bundle.highlighterType).toBe(highlighter.type)
    expect(bundle.newFileSyntaxLines[1]?.nodeList.length).toBeGreaterThan(0)
    expect(reconstructed._getHighlighterName()).toBe(highlighter.name)
    expect(reconstructed._getHighlighterType()).toBe(highlighter.type)
    expect(reconstructed.getNewSyntaxLine(1)?.nodeList.length).toBeGreaterThan(0)

    diffFile.clear()
    reconstructed.clear()
  })
})
