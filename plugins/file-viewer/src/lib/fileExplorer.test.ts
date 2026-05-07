import { describe, expect, it } from 'vitest'
import type { FileEntry } from '@openforge/plugin-sdk/domain'
import {
  createEmptyFileBrowserProjectState,
  flattenFileBrowserEntries,
  getFileBrowserProjectState,
  updateFileBrowserProjectState,
} from './fileExplorer'

describe('file viewer browser state helpers', () => {
  const rootEntries: FileEntry[] = [
    { name: 'src', path: 'src', isDir: true, size: null, modifiedAt: null },
    { name: 'README.md', path: 'README.md', isDir: false, size: 128, modifiedAt: null },
  ]
  const srcEntries: FileEntry[] = [
    { name: 'main.ts', path: 'src/main.ts', isDir: false, size: 256, modifiedAt: null },
  ]

  it('creates isolated default state for each project', () => {
    const states = new Map<string, ReturnType<typeof createEmptyFileBrowserProjectState>>()

    const projectA = getFileBrowserProjectState(states, 'project-a')
    projectA.expandedPaths.add('src')

    const projectB = getFileBrowserProjectState(states, 'project-b')

    expect(projectB.expandedPaths.has('src')).toBe(false)
    expect(projectB.selectedPath).toBeNull()
  })

  it('updates one project while preserving another project state', () => {
    let states = new Map<string, ReturnType<typeof createEmptyFileBrowserProjectState>>()
    states = updateFileBrowserProjectState(states, 'project-a', (state) => ({
      ...state,
      rootEntries,
      expandedPaths: new Set(['src']),
      selectedPath: 'src/main.ts',
    }))
    states = updateFileBrowserProjectState(states, 'project-b', (state) => ({
      ...state,
      rootEntries: [{ name: 'docs', path: 'docs', isDir: true, size: null, modifiedAt: null }],
      expandedPaths: new Set(['docs']),
      selectedPath: null,
    }))

    const projectA = getFileBrowserProjectState(states, 'project-a')
    const projectB = getFileBrowserProjectState(states, 'project-b')

    expect(projectA.selectedPath).toBe('src/main.ts')
    expect(projectA.expandedPaths.has('src')).toBe(true)
    expect(projectB.expandedPaths.has('src')).toBe(false)
    expect(projectB.expandedPaths.has('docs')).toBe(true)
  })

  it('returns a new Map when updating state so Svelte stores react', () => {
    const states = new Map<string, ReturnType<typeof createEmptyFileBrowserProjectState>>()

    const next = updateFileBrowserProjectState(states, 'project-a', (state) => ({
      ...state,
      selectedPath: 'README.md',
    }))

    expect(next).not.toBe(states)
    expect(getFileBrowserProjectState(next, 'project-a').selectedPath).toBe('README.md')
    expect(states.has('project-a')).toBe(false)
  })

  it('flattens cached expanded directories in file tree order', () => {
    const state = createEmptyFileBrowserProjectState()
    state.rootEntries = rootEntries
    state.dirContents = new Map([['src', srcEntries]])
    state.expandedPaths = new Set(['src'])

    expect(flattenFileBrowserEntries(state)).toEqual([
      rootEntries[0],
      srcEntries[0],
      rootEntries[1],
    ])
  })
})
