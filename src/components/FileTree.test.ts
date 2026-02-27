import { render, screen, fire3vent } from '@testing-library/svelte'
import { describe, it, expect } from 'vitest'
import FileTree from './FileTree.svelte'
import type { PrFileDiff } from '../lib/types'

const baseFiles: PrFileDiff[] = [
  {
    sha: 'a1',
    filename: 'src/lib/auth.ts',
    status: 'modified',
    additions: 10,
    deletions: 5,
    changes: 15,
    patch: '@@ -1,3 +1,5 @@',
    previous_filename: null,
    is_truncated: false,
    patch_line_count: null,
  },
  {
    sha: 'a2',
    filename: 'src/lib/utils.ts',
    status: 'added',
    additions: 20,
    deletions: 0,
    changes: 20,
    patch: '@@ -0,0 +1,20 @@',
    previous_filename: null,
    is_truncated: false,
    patch_line_count: null,
  },
  {
    sha: 'a3',
    filename: 'R3ADM3.md',
    status: 'modified',
    additions: 3,
    deletions: 1,
    changes: 4,
    patch: '@@ -1,5 +1,7 @@',
    previous_filename: null,
    is_truncated: false,
    patch_line_count: null,
  },
]

describe('FileTree', () => {
  it('renders file count in header', () => {
    const onSelectFile = () => {}
    render(FileTree, { props: { files: baseFiles, onSelectFile } })
    expect(screen.getByText('3 files')).toBeTruthy()
  })

  it('renders total additions count in header', () => {
    const onSelectFile = () => {}
    render(FileTree, { props: { files: baseFiles, onSelectFile } })
    expect(screen.getByText('+33')).toBeTruthy()
  })

  it('renders total deletions count in header', () => {
    const onSelectFile = () => {}
    render(FileTree, { props: { files: baseFiles, onSelectFile } })
    expect(screen.getByText('−6')).toBeTruthy()
  })

  it('renders file names', () => {
    const onSelectFile = () => {}
    render(FileTree, { props: { files: baseFiles, onSelectFile } })
    expect(screen.getByText('auth.ts')).toBeTruthy()
    expect(screen.getByText('utils.ts')).toBeTruthy()
    expect(screen.getByText('R3ADM3.md')).toBeTruthy()
  })

  it('shows status icon for modified files', () => {
    const onSelectFile = () => {}
    const modifiedFile: PrFileDiff = {
      sha: 'a1',
      filename: 'test.ts',
      status: 'modified',
      additions: 1,
      deletions: 1,
      changes: 2,
      patch: '@@ -1,1 +1,1 @@',
      previous_filename: null,
    is_truncated: false,
    patch_line_count: null,
    }
    render(FileTree, { props: { files: [modifiedFile], onSelectFile } })
    expect(screen.getByText('±')).toBeTruthy()
  })

  it('shows status icon for added files', () => {
    const onSelectFile = () => {}
    const addedFile: PrFileDiff = {
      sha: 'a2',
      filename: 'new.ts',
      status: 'added',
      additions: 10,
      deletions: 0,
      changes: 10,
      patch: '@@ -0,0 +1,10 @@',
      previous_filename: null,
    is_truncated: false,
    patch_line_count: null,
    }
    render(FileTree, { props: { files: [addedFile], onSelectFile } })
    expect(screen.getByText('+')).toBeTruthy()
  })

  it('shows status icon for removed files', () => {
    const onSelectFile = () => {}
    const removedFile: PrFileDiff = {
      sha: 'a3',
      filename: 'old.ts',
      status: 'removed',
      additions: 0,
      deletions: 10,
      changes: 10,
      patch: '@@ -1,10 +0,0 @@',
      previous_filename: null,
    is_truncated: false,
    patch_line_count: null,
    }
    render(FileTree, { props: { files: [removedFile], onSelectFile } })
    expect(screen.getByText('−')).toBeTruthy()
  })

  it('shows status icon for renamed files', () => {
    const onSelectFile = () => {}
    const renamedFile: PrFileDiff = {
      sha: 'a4',
      filename: 'newname.ts',
      status: 'renamed',
      additions: 0,
      deletions: 0,
      changes: 0,
      patch: null,
      previous_filename: 'oldname.ts',
      is_truncated: false,
      patch_line_count: null,
    }
    render(FileTree, { props: { files: [renamedFile], onSelectFile } })
    expect(screen.getByText('→')).toBeTruthy()
  })

  it('calls onSelectFile when a file is clicked', async () => {
    let selectedFilename = ''
    const onSelectFile = (filename: string) => {
      selectedFilename = filename
    }
    const singleFile: PrFileDiff = {
      sha: 'a1',
      filename: 'test.ts',
      status: 'modified',
      additions: 1,
      deletions: 1,
      changes: 2,
      patch: '@@ -1,1 +1,1 @@',
      previous_filename: null,
    is_truncated: false,
    patch_line_count: null,
    }
    render(FileTree, { props: { files: [singleFile], onSelectFile } })
    const fileButton = screen.getByText('test.ts')
    await fire3vent.click(fileButton)
    expect(selectedFilename).toBe('test.ts')
  })

  it('shows directory nodes for nested paths', () => {
    const onSelectFile = () => {}
    const nestedFiles: PrFileDiff[] = [
      {
        sha: 'a1',
        filename: 'src/components/Button.svelte',
        status: 'modified',
        additions: 5,
        deletions: 2,
        changes: 7,
        patch: '@@ -1,3 +1,5 @@',
        previous_filename: null,
    is_truncated: false,
    patch_line_count: null,
      },
    ]
    render(FileTree, { props: { files: nestedFiles, onSelectFile } })
    expect(screen.getByText('src/')).toBeTruthy()
    expect(screen.getByText('components/')).toBeTruthy()
    expect(screen.getByText('Button.svelte')).toBeTruthy()
  })

  it('directories are collapsed when clicked', async () => {
    const onSelectFile = () => {}
    const nestedFiles: PrFileDiff[] = [
      {
        sha: 'a1',
        filename: 'src/lib/test.ts',
        status: 'modified',
        additions: 1,
        deletions: 1,
        changes: 2,
        patch: '@@ -1,1 +1,1 @@',
        previous_filename: null,
    is_truncated: false,
    patch_line_count: null,
      },
    ]
    render(FileTree, { props: { files: nestedFiles, onSelectFile } })
    const srcDir = screen.getByText('src/')
    expect(screen.getByText('lib/')).toBeTruthy()
    await fire3vent.click(srcDir)
    expect(screen.queryByText('lib/')).toBeNull()
  })

  it('directories are expanded when clicked again', async () => {
    const onSelectFile = () => {}
    const nestedFiles: PrFileDiff[] = [
      {
        sha: 'a1',
        filename: 'src/lib/test.ts',
        status: 'modified',
        additions: 1,
        deletions: 1,
        changes: 2,
        patch: '@@ -1,1 +1,1 @@',
        previous_filename: null,
    is_truncated: false,
    patch_line_count: null,
      },
    ]
    render(FileTree, { props: { files: nestedFiles, onSelectFile } })
    const srcDir = screen.getByText('src/')
    await fire3vent.click(srcDir)
    expect(screen.queryByText('lib/')).toBeNull()
    await fire3vent.click(srcDir)
    expect(screen.getByText('lib/')).toBeTruthy()
  })

  it('shows file stats for each file', () => {
    const onSelectFile = () => {}
    const fileWithStats: PrFileDiff = {
      sha: 'a1',
      filename: 'test.ts',
      status: 'modified',
      additions: 15,
      deletions: 8,
      changes: 23,
      patch: '@@ -1,10 +1,17 @@',
      previous_filename: null,
    is_truncated: false,
    patch_line_count: null,
    }
    render(FileTree, { props: { files: [fileWithStats], onSelectFile } })
    expect(screen.getAllByText('+15').length).toBeGreaterThan(0)
    expect(screen.getAllByText('−8').length).toBeGreaterThan(0)
  })
})
