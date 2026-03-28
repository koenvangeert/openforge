export const DIFF_HIGHLIGHT_MAX_LINES = 3000

export const DIFF_HIGHLIGHT_IGNORE_PATTERNS: (string | RegExp)[] = [
  /\.lock$/,
  /lock\.json$/,
  /lock\.yaml$/,
  /\.min\.js$/,
  /\.min\.css$/,
]

export function configureDiffHighlighter(highlighter: {
  setMaxLineToIgnoreSyntax: (value: number) => void
  setIgnoreSyntaxHighlightList: (value: (string | RegExp)[]) => void
}) {
  highlighter.setMaxLineToIgnoreSyntax(DIFF_HIGHLIGHT_MAX_LINES)
  highlighter.setIgnoreSyntaxHighlightList(DIFF_HIGHLIGHT_IGNORE_PATTERNS)
}
