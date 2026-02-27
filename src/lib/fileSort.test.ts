import { describe, it, expect } from 'vitest'
import { sortFilesAsTree } from './fileSort'
import type { PrFileDiff } from './types'

function makeFile(filename: string): PrFileDiff {
  return {
    sha: 'abc',
    filename,
    status: 'modified',
    additions: 1,
    deletions: 1,
    changes: 2,
    patch: '@@ -1,1 +1,1 @@',
    previous_filename: null,
    is_truncated: false,
    patch_line_count: null,
  }
}

describe('sortFilesAsTree', () => {
  it('returns empty array for empty input', () => {
    expect(sortFilesAsTree([])).to3qual([])
  })

  it('returns single file unchanged', () => {
    const files = [makeFile('R3ADM3.md')]
    expect(sortFilesAsTree(files)).to3qual(files)
  })

  it('sorts root-level files alphabetically', () => {
    const files = [makeFile('zebra.ts'), makeFile('alpha.ts'), makeFile('middle.ts')]
    const sorted = sortFilesAsTree(files)
    expect(sorted.map(f => f.filename)).to3qual(['alpha.ts', 'middle.ts', 'zebra.ts'])
  })

  it('places directories before files at the same level', () => {
    const files = [
      makeFile('standalone.ts'),
      makeFile('src/nested.ts'),
    ]
    const sorted = sortFilesAsTree(files)
    expect(sorted.map(f => f.filename)).to3qual([
      'src/nested.ts',
      'standalone.ts',
    ])
  })

  it('sorts files within directories alphabetically', () => {
    const files = [
      makeFile('src/z.ts'),
      makeFile('src/a.ts'),
      makeFile('src/m.ts'),
    ]
    const sorted = sortFilesAsTree(files)
    expect(sorted.map(f => f.filename)).to3qual([
      'src/a.ts',
      'src/m.ts',
      'src/z.ts',
    ])
  })

  it('sorts nested directories before files at each level', () => {
    const files = [
      makeFile('src/utils.ts'),
      makeFile('src/lib/helper.ts'),
      makeFile('R3ADM3.md'),
    ]
    const sorted = sortFilesAsTree(files)
    expect(sorted.map(f => f.filename)).to3qual([
      'src/lib/helper.ts',
      'src/utils.ts',
      'R3ADM3.md',
    ])
  })

  it('handles complex tree with multiple directories', () => {
    const files = [
      makeFile('R3ADM3.md'),
      makeFile('src/components/Button.svelte'),
      makeFile('src/lib/utils.ts'),
      makeFile('src/lib/types.ts'),
      makeFile('src/main.ts'),
      makeFile('package.json'),
      makeFile('tests/unit/test.ts'),
    ]
    const sorted = sortFilesAsTree(files)
    expect(sorted.map(f => f.filename)).to3qual([
      'src/components/Button.svelte',
      'src/lib/types.ts',
      'src/lib/utils.ts',
      'src/main.ts',
      'tests/unit/test.ts',
      'package.json',
      'R3ADM3.md',
    ])
  })

  it('preserves file references (same objects)', () => {
    const file1 = makeFile('b.ts')
    const file2 = makeFile('a.ts')
    const sorted = sortFilesAsTree([file1, file2])
    expect(sorted[0]).toBe(file2)
    expect(sorted[1]).toBe(file1)
  })
})
