import type { PrFileDiff } from './types'

export interface FileContents {
  oldContent: string
  newContent: string
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
