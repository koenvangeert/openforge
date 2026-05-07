import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import ProjectFileTree from './ProjectFileTree.svelte'
import type { FileEntry } from '../lib/types'

function makeEntry(overrides: Partial<FileEntry>): FileEntry {
  return {
    name: 'entry',
    path: 'entry',
    isDir: false,
    size: 128,
    modifiedAt: null,
    ...overrides,
  }
}

function renderTree(props: Partial<{
  entries: FileEntry[]
  expandedDirs: Set<string>
  selectedPath: string | null
  onToggleDir: (path: string) => void
  onSelectFile: (path: string) => void
  initialScrollTop: number
  onScrollTopChange: (scrollTop: number) => void
}> = {}) {
  return render(ProjectFileTree, {
    props: {
      entries: [],
      expandedDirs: new Set<string>(),
      selectedPath: null,
      onToggleDir: () => {},
      onSelectFile: () => {},
      ...props,
    },
  })
}

describe('ProjectFileTree', () => {
  it('renders directory and file entries', () => {
    renderTree({
      entries: [
        makeEntry({ name: 'src', path: 'src', isDir: true, size: null }),
        makeEntry({ name: 'README.md', path: 'README.md', isDir: false, size: 256 }),
      ],
    })

    expect(screen.getByText('src/')).toBeTruthy()
    expect(screen.getByText('README.md')).toBeTruthy()
  })

  it('shows folder icons for directories', () => {
    renderTree({
      entries: [makeEntry({ name: 'src', path: 'src', isDir: true, size: null })],
    })

    expect(screen.getByTestId('folder-icon-src')).toBeTruthy()
  })

  it('shows file icons for files', () => {
    renderTree({
      entries: [makeEntry({ name: 'README.md', path: 'README.md', isDir: false })],
    })

    expect(screen.getByTestId('file-icon-README.md')).toBeTruthy()
  })

  it('clicking a directory calls onToggleDir', async () => {
    const onToggleDir = vi.fn()
    renderTree({
      entries: [makeEntry({ name: 'src', path: 'src', isDir: true, size: null })],
      onToggleDir,
    })

    await fireEvent.click(screen.getByRole('button', { name: /src\// }))

    expect(onToggleDir).toHaveBeenCalledWith('src')
    expect(onToggleDir).toHaveBeenCalledOnce()
  })

  it('clicking a file calls onSelectFile', async () => {
    const onSelectFile = vi.fn()
    renderTree({
      entries: [makeEntry({ name: 'README.md', path: 'README.md', isDir: false })],
      onSelectFile,
    })

    await fireEvent.click(screen.getByRole('button', { name: /README.md/ }))

    expect(onSelectFile).toHaveBeenCalledWith('README.md')
    expect(onSelectFile).toHaveBeenCalledOnce()
  })

  it('selected file has highlight style', () => {
    renderTree({
      entries: [makeEntry({ name: 'README.md', path: 'README.md', isDir: false })],
      selectedPath: 'README.md',
    })

    const selected = screen.getByRole('button', { name: /README.md/ })
    expect(selected.className).toContain('bg-primary/10')
    expect(selected.className).toContain('border-l-primary')
  })

  it('preserves the incoming entry order', () => {
    renderTree({
      entries: [
        makeEntry({ name: 'z-file.ts', path: 'z-file.ts', isDir: false }),
        makeEntry({ name: 'a-dir', path: 'a-dir', isDir: true, size: null }),
      ],
    })

    const labels = screen.getAllByTestId('entry-label').map((node) => node.textContent)
    expect(labels).toEqual(['z-file.ts', 'a-dir/'])
  })

  it('keeps nested folders and files grouped beneath their parent order', () => {
    renderTree({
      entries: [
        makeEntry({ name: 'src', path: 'src', isDir: true, size: null }),
        makeEntry({ name: 'lib', path: 'src/lib', isDir: true, size: null }),
        makeEntry({ name: 'utils.ts', path: 'src/lib/utils.ts', isDir: false }),
        makeEntry({ name: 'main.ts', path: 'src/main.ts', isDir: false }),
        makeEntry({ name: 'README.md', path: 'README.md', isDir: false }),
      ],
    })

    const labels = screen.getAllByTestId('entry-label').map((node) => node.textContent)
    expect(labels).toEqual(['src/', 'lib/', 'utils.ts', 'main.ts', 'README.md'])
  })

  it('shows no entry rows for empty entries', () => {
    renderTree({ entries: [] })
    expect(screen.queryAllByTestId('tree-entry')).toHaveLength(0)
  })

  it('shows expanded and collapsed indicators for directories', () => {
    const { rerender } = renderTree({
      entries: [makeEntry({ name: 'src', path: 'src', isDir: true, size: null })],
      expandedDirs: new Set<string>(),
    })

    expect(screen.getByTestId('dir-indicator-src').textContent).toBe('▶')

    rerender({
      entries: [makeEntry({ name: 'src', path: 'src', isDir: true, size: null })],
      expandedDirs: new Set<string>(['src']),
      selectedPath: null,
      onToggleDir: () => {},
      onSelectFile: () => {},
    })

    expect(screen.getByTestId('dir-indicator-src').textContent).toBe('▼')
  })

  it('renders entries with depth-based indentation', () => {
    renderTree({
      entries: [
        makeEntry({ name: 'src', path: 'src', isDir: true, size: null }),
        makeEntry({ name: 'index.ts', path: 'src/index.ts', isDir: false }),
        makeEntry({ name: 'lib', path: 'src/lib', isDir: true, size: null }),
        makeEntry({ name: 'utils.ts', path: 'src/lib/utils.ts', isDir: false }),
      ],
    })
    const rows = screen.getAllByTestId('tree-entry')
    const styles = rows.map(r => r.getAttribute('style') ?? '')
    expect(styles[0]).toContain('padding-left: 12px')
    expect(styles[1]).toContain('padding-left: 28px')
    expect(styles[2]).toContain('padding-left: 28px')
    expect(styles[3]).toContain('padding-left: 44px')
  })

  it('restores initial scroll position and reports scroll changes', async () => {
    const onScrollTopChange = vi.fn()
    renderTree({
      entries: [
        makeEntry({ name: 'one.ts', path: 'one.ts', isDir: false }),
        makeEntry({ name: 'two.ts', path: 'two.ts', isDir: false }),
      ],
      initialScrollTop: 42,
      onScrollTopChange,
    })

    const scrollRegion = screen.getAllByTestId('tree-entry')[0]?.parentElement as HTMLDivElement
    expect(scrollRegion.scrollTop).toBe(42)

    scrollRegion.scrollTop = 84
    await fireEvent.scroll(scrollRegion)

    expect(onScrollTopChange).toHaveBeenCalledWith(84)
  })

  it('renders selected file with adjusted indentation', () => {
    renderTree({
      entries: [
        makeEntry({ name: 'index.ts', path: 'src/index.ts', isDir: false }),
      ],
      selectedPath: 'src/index.ts',
    })
    const rows = screen.getAllByTestId('tree-entry')
    // Selected file at depth 1: 10 + 1*16 = 26px
    expect(rows[0].getAttribute('style') ?? '').toContain('padding-left: 26px')
  })
})
