import type { FileContent, FileEntry } from '@openforge/plugin-sdk/domain'

export interface FileBrowserProjectState {
  rootEntries: FileEntry[]
  dirContents: Map<string, FileEntry[]>
  expandedPaths: Set<string>
  selectedPath: string | null
  fileContent: FileContent | null
  rootLoaded: boolean
  treeScrollTop: number
  contentScrollTop: number
}

export function createEmptyFileBrowserProjectState(): FileBrowserProjectState {
  return {
    rootEntries: [],
    dirContents: new Map(),
    expandedPaths: new Set(),
    selectedPath: null,
    fileContent: null,
    rootLoaded: false,
    treeScrollTop: 0,
    contentScrollTop: 0,
  }
}

export function getFileBrowserProjectState(
  states: Map<string, FileBrowserProjectState>,
  projectId: string,
): FileBrowserProjectState {
  return states.get(projectId) ?? createEmptyFileBrowserProjectState()
}

export function updateFileBrowserProjectState(
  states: Map<string, FileBrowserProjectState>,
  projectId: string,
  updater: (state: FileBrowserProjectState) => FileBrowserProjectState,
): Map<string, FileBrowserProjectState> {
  const current = getFileBrowserProjectState(states, projectId)
  const nextState = updater(current)
  return new Map(states).set(projectId, nextState)
}

export function flattenFileBrowserEntries(state: FileBrowserProjectState): FileEntry[] {
  const result: FileEntry[] = []

  function flatten(entries: FileEntry[]) {
    for (const entry of entries) {
      result.push(entry)
      if (entry.isDir && state.expandedPaths.has(entry.path)) {
        flatten(state.dirContents.get(entry.path) ?? [])
      }
    }
  }

  flatten(state.rootEntries)
  return result
}
