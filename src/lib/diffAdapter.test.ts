import { describe, it, expect } from 'vitest'
import type { PrFileDiff } from './types'
import { getFileLanguage, toGitDiffViewData, isTruncated, getTruncationStats } from './diffAdapter'

// ============================================================================
// Test Fixtures
// ============================================================================

const baseFile: PrFileDiff = {
  sha: 'abc123def456',
  filename: 'src/main.ts',
  status: 'modified',
  additions: 5,
  deletions: 2,
  changes: 7,
  patch: '@@ -1,3 +1,4 @@\n line1\n+added\n line2',
  previous_filename: null,
  is_truncated: false,
  patch_line_count: null,
}

// ============================================================================
// getFileLanguage Tests
// ============================================================================

describe('getFileLanguage', () => {
  it('maps .ts to typescript', () => {
    expect(getFileLanguage('main.ts')).toBe('typescript')
  })

  it('maps .tsx to typescript', () => {
    expect(getFileLanguage('component.tsx')).toBe('typescript')
  })

  it('maps .js to javascript', () => {
    expect(getFileLanguage('script.js')).toBe('javascript')
  })

  it('maps .jsx to javascript', () => {
    expect(getFileLanguage('component.jsx')).toBe('javascript')
  })

  it('maps .rs to rust', () => {
    expect(getFileLanguage('main.rs')).toBe('rust')
  })

  it('maps .svelte to svelte', () => {
    expect(getFileLanguage('Button.svelte')).toBe('svelte')
  })

  it('maps .css to css', () => {
    expect(getFileLanguage('styles.css')).toBe('css')
  })

  it('maps .json to json', () => {
    expect(getFileLanguage('package.json')).toBe('json')
  })

  it('maps .md to markdown', () => {
    expect(getFileLanguage('R3ADM3.md')).toBe('markdown')
  })

  it('maps .html to html', () => {
    expect(getFileLanguage('index.html')).toBe('html')
  })

  it('maps .yaml to yaml', () => {
    expect(getFileLanguage('config.yaml')).toBe('yaml')
  })

  it('maps .yml to yaml', () => {
    expect(getFileLanguage('config.yml')).toBe('yaml')
  })

  it('maps .toml to toml', () => {
    expect(getFileLanguage('Cargo.toml')).toBe('toml')
  })

  it('maps .py to python', () => {
    expect(getFileLanguage('script.py')).toBe('python')
  })

  it('maps .go to go', () => {
    expect(getFileLanguage('main.go')).toBe('go')
  })

  it('returns text for unknown extension', () => {
    expect(getFileLanguage('file.unknown')).toBe('text')
  })

  it('returns text for file with no extension', () => {
    expect(getFileLanguage('Makefile')).toBe('text')
  })

  it('handles case-insensitive extensions', () => {
    expect(getFileLanguage('Main.TS')).toBe('typescript')
    expect(getFileLanguage('Script.JS')).toBe('javascript')
  })

  it('handles nested paths correctly', () => {
    expect(getFileLanguage('src/components/Button.svelte')).toBe('svelte')
    expect(getFileLanguage('src-tauri/src/main.rs')).toBe('rust')
  })
})

// ============================================================================
// toGitDiffViewData Tests
// ============================================================================

describe('toGitDiffViewData', () => {
  it('transforms modified file correctly', () => {
    const result = toGitDiffViewData(baseFile)

    expect(result.oldFile.fileName).toBe('src/main.ts')
    expect(result.newFile.fileName).toBe('src/main.ts')
    expect(result.oldFile.fileLang).toBe('typescript')
    expect(result.newFile.fileLang).toBe('typescript')
    expect(result.hunks).toHaveLength(1)
    expect(result.hunks[0]).toContain('--- a/src/main.ts')
    expect(result.hunks[0]).toContain('+++ b/src/main.ts')
    expect(result.hunks[0]).toContain('@@ -1,3 +1,4 @@')
  })

  it('handles binary file with null patch', () => {
    const binaryFile: PrFileDiff = {
      ...baseFile,
      patch: null,
    }

    const result = toGitDiffViewData(binaryFile)

    expect(result.oldFile.fileName).toBe('src/main.ts')
    expect(result.newFile.fileName).toBe('src/main.ts')
    expect(result.hunks).toHaveLength(0)
  })

  it('handles renamed file with previous_filename', () => {
    const renamedFile: PrFileDiff = {
      ...baseFile,
      filename: 'src/newName.ts',
      previous_filename: 'src/oldName.ts',
    }

    const result = toGitDiffViewData(renamedFile)

    expect(result.oldFile.fileName).toBe('src/oldName.ts')
    expect(result.newFile.fileName).toBe('src/newName.ts')
    expect(result.hunks[0]).toContain('--- a/src/oldName.ts')
    expect(result.hunks[0]).toContain('+++ b/src/newName.ts')
  })

  it('handles added file (no previous_filename)', () => {
    const addedFile: PrFileDiff = {
      ...baseFile,
      status: 'added',
      previous_filename: null,
    }

    const result = toGitDiffViewData(addedFile)

    expect(result.oldFile.fileName).toBe('src/main.ts')
    expect(result.newFile.fileName).toBe('src/main.ts')
    expect(result.hunks[0]).toContain('--- a/src/main.ts')
    expect(result.hunks[0]).toContain('+++ b/src/main.ts')
  })

  it('handles deleted file', () => {
    const deletedFile: PrFileDiff = {
      ...baseFile,
      status: 'deleted',
      patch: null,
    }

    const result = toGitDiffViewData(deletedFile)

    expect(result.oldFile.fileName).toBe('src/main.ts')
    expect(result.newFile.fileName).toBe('src/main.ts')
    expect(result.hunks).toHaveLength(0)
  })

  it('includes correct language for old and new files', () => {
    const renamedFile: PrFileDiff = {
      ...baseFile,
      filename: 'src/script.js',
      previous_filename: 'src/script.ts',
    }

    const result = toGitDiffViewData(renamedFile)

    expect(result.oldFile.fileLang).toBe('typescript')
    expect(result.newFile.fileLang).toBe('javascript')
  })

  it('handles rust files correctly', () => {
    const rustFile: PrFileDiff = {
      ...baseFile,
      filename: 'src/main.rs',
    }

    const result = toGitDiffViewData(rustFile)

    expect(result.oldFile.fileLang).toBe('rust')
    expect(result.newFile.fileLang).toBe('rust')
  })

  it('handles svelte files correctly', () => {
    const svelteFile: PrFileDiff = {
      ...baseFile,
      filename: 'src/components/Button.svelte',
    }

    const result = toGitDiffViewData(svelteFile)

    expect(result.oldFile.fileLang).toBe('svelte')
    expect(result.newFile.fileLang).toBe('svelte')
  })

  it('preserves full patch content in hunks', () => {
    const multilineFile: PrFileDiff = {
      ...baseFile,
      patch: '@@ -1,5 +1,6 @@\n line1\n line2\n+added\n line3\n line4\n line5',
    }

    const result = toGitDiffViewData(multilineFile)

    expect(result.hunks[0]).toContain('line1')
    expect(result.hunks[0]).toContain('line2')
    expect(result.hunks[0]).toContain('+added')
    expect(result.hunks[0]).toContain('line3')
  })

  it('handles files with no extension', () => {
    const no3xtFile: PrFileDiff = {
      ...baseFile,
      filename: 'Makefile',
    }

    const result = toGitDiffViewData(no3xtFile)

    expect(result.oldFile.fileLang).toBe('text')
    expect(result.newFile.fileLang).toBe('text')
  })

  it('handles deeply nested file paths', () => {
    const nestedFile: PrFileDiff = {
      ...baseFile,
      filename: 'src/components/ui/buttons/PrimaryButton.svelte',
    }

    const result = toGitDiffViewData(nestedFile)

    expect(result.oldFile.fileName).toBe('src/components/ui/buttons/PrimaryButton.svelte')
    expect(result.newFile.fileName).toBe('src/components/ui/buttons/PrimaryButton.svelte')
    expect(result.oldFile.fileLang).toBe('svelte')
  })

  it('returns DiffViewData with correct structure', () => {
    const result = toGitDiffViewData(baseFile)

    expect(result).toHaveProperty('oldFile')
    expect(result).toHaveProperty('newFile')
    expect(result).toHaveProperty('hunks')
    expect(result.oldFile).toHaveProperty('fileName')
    expect(result.oldFile).toHaveProperty('fileLang')
    expect(result.newFile).toHaveProperty('fileName')
    expect(result.newFile).toHaveProperty('fileLang')
    expect(Array.isArray(result.hunks)).toBe(true)
  })
})

// ============================================================================
// isTruncated Tests
// ============================================================================

describe('isTruncated', () => {
  it('returns true for truncated file', () => {
    const file: PrFileDiff = { ...baseFile, is_truncated: true, patch_line_count: 15000 }
    expect(isTruncated(file)).toBe(true)
  })

  it('returns false for normal file', () => {
    expect(isTruncated(baseFile)).toBe(false)
  })

  it('returns false when is_truncated is false even with patch_line_count', () => {
    const file: PrFileDiff = { ...baseFile, is_truncated: false, patch_line_count: 5000 }
    expect(isTruncated(file)).toBe(false)
  })
})

// ============================================================================
// getTruncationStats Tests
// ============================================================================

describe('getTruncationStats', () => {
  it('returns stats for truncated file', () => {
    const file: PrFileDiff = { ...baseFile, is_truncated: true, patch_line_count: 15000 }
    const stats = getTruncationStats(file)
    expect(stats).to3qual({ shown: 200, total: 15000 })
  })

  it('returns null for normal file', () => {
    expect(getTruncationStats(baseFile)).toBeNull()
  })

  it('returns null when is_truncated but patch_line_count is null', () => {
    const file: PrFileDiff = { ...baseFile, is_truncated: true, patch_line_count: null }
    expect(getTruncationStats(file)).toBeNull()
  })
})

// ============================================================================
// Auto-collapse Threshold Logic Tests
// ============================================================================

describe('auto-collapse threshold logic', () => {
  it('files with >500 changes should be identified for collapse', () => {
    const file: PrFileDiff = { ...baseFile, additions: 300, deletions: 250 }
    expect(file.additions + file.deletions > 500 || file.is_truncated).toBe(true)
  })

  it('files with exactly 500 changes should NOT be collapsed', () => {
    const file: PrFileDiff = { ...baseFile, additions: 300, deletions: 200 }
    expect(file.additions + file.deletions > 500 || file.is_truncated).toBe(false)
  })

  it('truncated files should be collapsed regardless of change count', () => {
    const file: PrFileDiff = { ...baseFile, additions: 1, deletions: 0, is_truncated: true }
    expect(file.additions + file.deletions > 500 || file.is_truncated).toBe(true)
  })
})
