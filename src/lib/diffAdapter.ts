import type { PrFileDiff } from './types'

export interface FileContents {
  oldContent: string
  newContent: string
}

const IMAGE_MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
}

export interface DiffViewData {
  oldFile: {
    fileName: string
    fileLang?: string
    content?: string | null
  }
  newFile: {
    fileName: string
    fileLang?: string
    content?: string | null
  }
  hunks: string[]
}

/**
 * Maps file extensions to language names for syntax highlighting
 * @param filename - The filename to extract language from
 * @returns Language name compatible with @git-diff-view
 */
export function getFileLanguage(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() || ''

  const languageMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    rs: 'rust',
    svelte: 'svelte',
    css: 'css',
    json: 'json',
    md: 'markdown',
    html: 'html',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    py: 'python',
    go: 'go',
  }

  return languageMap[ext] || 'text'
}

export function getImageMimeType(filename: string): string | null {
  const ext = filename.toLowerCase().split('.').pop() || ''
  return IMAGE_MIME_TYPES[ext] ?? null
}

export function isImageFileDiff(file: PrFileDiff): boolean {
  return getImageMimeType(file.filename) !== null || (file.previous_filename !== null && getImageMimeType(file.previous_filename) !== null)
}

export function getImagePreviewDataUrl(filename: string, base64Content: string): string | null {
  if (base64Content.length === 0) return null
  const mimeType = getImageMimeType(filename)
  if (mimeType === null) return null
  return `data:${mimeType};base64,${base64Content}`
}

export function toGitDiffViewData(file: PrFileDiff, contents?: FileContents): DiffViewData {
  const oldFileName = file.previous_filename || file.filename
  const newFileName = file.filename

  const oldFileLang = getFileLanguage(oldFileName)
  const newFileLang = getFileLanguage(newFileName)

  const hunks: string[] = file.patch
    ? [`--- a/${oldFileName}\n+++ b/${newFileName}\n${file.patch}`]
    : []

  return {
    oldFile: {
      fileName: oldFileName,
      fileLang: oldFileLang,
      content: contents?.oldContent ?? null,
    },
    newFile: {
      fileName: newFileName,
      fileLang: newFileLang,
      content: contents?.newContent ?? null,
    },
    hunks,
  }
}

/**
 * Check if a file's diff was truncated by the backend
 */
export function isTruncated(file: PrFileDiff): boolean {
  return file.is_truncated === true
}

/**
 * Get truncation statistics for a file
 * @returns Object with shown/total line counts, or null if not truncated
 */
export function getTruncationStats(file: PrFileDiff): { shown: number; total: number } | null {
  if (!file.is_truncated || file.patch_line_count == null) return null
  return { shown: 200, total: file.patch_line_count }
}
