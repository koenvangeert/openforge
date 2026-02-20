import { highlighter } from '@git-diff-view/lowlight'

/**
 * Configure syntax highlighting for diff view with performance optimizations
 * - Skip highlighting for files > 3000 lines (performance)
 * - Skip lock files and minified files (not useful to highlight)
 */
highlighter.setMaxLineToIgnoreSyntax(3000)
highlighter.setIgnoreSyntaxHighlightList([
  /\.lock$/,
  /lock\.json$/,
  /lock\.yaml$/,
  /\.min\.js$/,
  /\.min\.css$/,
])

export const diffHighlighter = highlighter
