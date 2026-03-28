import { highlighter } from '@git-diff-view/lowlight'
import { configureDiffHighlighter } from './diffHighlightConfig'

/**
 * Configure syntax highlighting for diff view with performance optimizations
 * - Skip highlighting for files > 3000 lines (performance)
 * - Skip lock files and minified files (not useful to highlight)
 */
configureDiffHighlighter(highlighter)

export const diffHighlighter = highlighter
