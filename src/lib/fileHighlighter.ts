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

type HastNode = {
  type: string
  value?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

function serializeProperty(name: string, value: unknown): string {
  if (value === null || value === undefined || value === false) return ''

  const attributeName = name === 'className' ? 'class' : name
  const attributeValue = Array.isArray(value) ? value.join(' ') : String(value)

  if (attributeValue.length === 0) return ''

  return ` ${attributeName}="${escapeHtml(attributeValue)}"`
}

function serializeNode(node: HastNode): string {
  if (node.type === 'text') {
    return escapeHtml(node.value ?? '')
  }

  if (node.type === 'root') {
    return (node.children ?? []).map(serializeNode).join('')
  }

  if (node.type === 'element' && node.tagName) {
    const attributes = Object.entries(node.properties ?? {})
      .map(([name, value]) => serializeProperty(name, value))
      .join('')
    const children = (node.children ?? []).map(serializeNode).join('')

    return `<${node.tagName}${attributes}>${children}</${node.tagName}>`
  }

  return ''
}

export function getLanguageForFile(fileName: string): string | null {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  return EXT_TO_LANG[ext] ?? null
}

export function highlightCode(code: string, fileName: string): string {
  const language = getLanguageForFile(fileName)
  if (!language) return escapeHtml(code)

  try {
    const engine = highlighter.getHighlighterEngine()
    const highlightedAst = engine.highlight(language, code) as HastNode
    const highlighted = serializeNode(highlightedAst)

    if (highlighted.length > 0) {
      return highlighted
    }
  } catch {
    return escapeHtml(code)
  }

  return escapeHtml(code)
}
