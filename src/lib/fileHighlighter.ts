import { highlighter } from '@git-diff-view/lowlight'

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  rs: 'rust',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  css: 'css',
  html: 'html',
  svelte: 'html',
  sh: 'bash',
  sql: 'sql',
  graphql: 'graphql',
  xml: 'xml',
}

function escapeHtml(value: string): string {
  return value
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
    .split("'").join('&#39;')
}

export function getLanguageForFile(fileName: string): string | null {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  return EXT_TO_LANG[ext] ?? null
}

export function highlightCode(code: string, fileName: string): string {
  const language = getLanguageForFile(fileName)
  if (!language) return escapeHtml(code)

  const instance = highlighter as unknown as {
    codeToHtml?: (value: string, lang: string) => string | null | undefined
  }

  try {
    const highlighted = instance.codeToHtml?.(code, language)
    if (typeof highlighted === 'string' && highlighted.length > 0) {
      return highlighted
    }
  } catch {
  }

  return escapeHtml(code)
}
