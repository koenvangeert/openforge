<script lang="ts">
  import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge/plugin-sdk/frontend'
  import { activeProjectId, fileBrowserStates, pendingFileReveal } from './lib/stores'
  import { fsReadDir, fsReadFile } from './lib/ipc'
  import {
    createEmptyFileBrowserProjectState,
    flattenFileBrowserEntries,
    getFileBrowserProjectState,
    updateFileBrowserProjectState,
    type FileBrowserProjectState,
  } from './lib/fileExplorer'
  import ProjectFileTree from './ProjectFileTree.svelte'
  import FileContentViewer from './FileContentViewer.svelte'
  import ResizablePanel from '@openforge/plugin-sdk/ui/ResizablePanel.svelte'

  interface Props {
    api: FrontendOpenForgeAPI
    context: OpenForgeContextSnapshot
    projectName: string
    projectId: string | null
  }

  let { api, context: _context, projectName, projectId = null }: Props = $props()

  let loading = $state(true)
  let error = $state<string | null>(null)
  let loadedProjectId = $state<string | null>(null)
  let processingRevealPath = $state<string | null>(null)
  let failedRevealPath = $state<string | null>(null)
  let activeFileRequestId = 0

  const projectState = $derived.by((): FileBrowserProjectState => {
    const currentProjectId = $activeProjectId
    return currentProjectId ? getFileBrowserProjectState($fileBrowserStates, currentProjectId) : createEmptyFileBrowserProjectState()
  })
  const hasLoaded = $derived(projectState.rootLoaded)
  const rootEntries = $derived(projectState.rootEntries)
  const expandedPaths = $derived(projectState.expandedPaths)
  const selectedPath = $derived(projectState.selectedPath)
  const fileContent = $derived(projectState.fileContent)
  const flatEntries = $derived(flattenFileBrowserEntries(projectState))
  const selectedEntry = $derived(
    selectedPath ? flatEntries.find((entry) => entry.path === selectedPath) ?? null : null
  )
  const selectedFileName = $derived(
    selectedPath ? selectedPath.split('/').at(-1) ?? selectedPath : ''
  )

  function updateProjectState(
    projectId: string,
    updater: (state: FileBrowserProjectState) => FileBrowserProjectState,
  ) {
    fileBrowserStates.update((states) => updateFileBrowserProjectState(states, projectId, updater))
  }

  async function loadRoot(projectId: string) {
    loading = true
    error = null
    try {
      const entries = await fsReadDir(api, projectId, null)
      if ($activeProjectId !== projectId) return
      updateProjectState(projectId, (state) => ({
        ...state,
        rootEntries: entries,
        rootLoaded: true,
      }))
    } catch (e) {
      if ($activeProjectId === projectId) {
        error = String(e)
      }
    } finally {
      if ($activeProjectId === projectId) {
        loading = false
      }
    }
  }

  async function toggleDir(path: string): Promise<boolean> {
    const projectId = $activeProjectId
    if (!projectId) return false

    const state = getFileBrowserProjectState($fileBrowserStates, projectId)
    const nextExpanded = new Set(state.expandedPaths)

    if (nextExpanded.has(path)) {
      nextExpanded.delete(path)
      updateProjectState(projectId, (current) => ({
        ...current,
        expandedPaths: nextExpanded,
      }))
      return true
    }

    nextExpanded.add(path)
    if (state.dirContents.has(path)) {
      updateProjectState(projectId, (current) => ({
        ...current,
        expandedPaths: nextExpanded,
      }))
      return true
    }

    try {
      const entries = await fsReadDir(api, projectId, path)
      if ($activeProjectId !== projectId) return false
      updateProjectState(projectId, (current) => ({
        ...current,
        dirContents: new Map(current.dirContents).set(path, entries),
        expandedPaths: nextExpanded,
      }))
      return true
    } catch (e) {
      if ($activeProjectId === projectId) {
        error = String(e)
      }
      return false
    }
  }

  async function selectFile(path: string): Promise<boolean> {
    const projectId = $activeProjectId
    if (!projectId) return false

    const requestId = ++activeFileRequestId
    updateProjectState(projectId, (state) => ({
      ...state,
      selectedPath: path,
      fileContent: null,
      contentScrollTop: 0,
    }))
    error = null

    try {
      const nextContent = await fsReadFile(api, projectId, path)
      const currentState = getFileBrowserProjectState($fileBrowserStates, projectId)
      if (requestId !== activeFileRequestId || $activeProjectId !== projectId || currentState.selectedPath !== path) return false
      updateProjectState(projectId, (state) => ({
        ...state,
        fileContent: nextContent,
      }))
      return true
    } catch (e) {
      const currentState = getFileBrowserProjectState($fileBrowserStates, projectId)
      if (requestId !== activeFileRequestId || $activeProjectId !== projectId || currentState.selectedPath !== path) return false
      error = String(e)
      return true
    }
  }

  function updateTreeScrollTop(scrollTop: number) {
    const projectId = $activeProjectId
    if (!projectId) return
    updateProjectState(projectId, (state) => ({
      ...state,
      treeScrollTop: scrollTop,
    }))
  }

  function updateContentScrollTop(scrollTop: number) {
    const projectId = $activeProjectId
    if (!projectId) return
    updateProjectState(projectId, (state) => ({
      ...state,
      contentScrollTop: scrollTop,
    }))
  }

  async function revealPath(targetPath: string) {
    const revealProjectId = $activeProjectId
    if (!revealProjectId) return

    processingRevealPath = targetPath
    failedRevealPath = null
    try {
      const parts = targetPath.split('/')
      const parentPaths: string[] = []
      for (let i = 1; i < parts.length; i++) {
        parentPaths.push(parts.slice(0, i).join('/'))
      }
      for (const parent of parentPaths) {
        if ($activeProjectId !== revealProjectId) {
          failedRevealPath = targetPath
          return
        }

        const currentState = getFileBrowserProjectState($fileBrowserStates, revealProjectId)
        if (!currentState.expandedPaths.has(parent)) {
          const expanded = await toggleDir(parent)
          if (!expanded || $activeProjectId !== revealProjectId) {
            failedRevealPath = targetPath
            return
          }
        }
      }

      const selected = await selectFile(targetPath)
      if (selected && $activeProjectId === revealProjectId) {
        $pendingFileReveal = null
      } else {
        failedRevealPath = targetPath
      }
    } finally {
      processingRevealPath = null
    }
  }

  $effect(() => {
    $activeProjectId = projectId
  })

  $effect(() => {
    const currentProjectId = $activeProjectId
    if (currentProjectId === loadedProjectId) return

    loadedProjectId = currentProjectId
    activeFileRequestId++
    error = null

    if (!currentProjectId) {
      loading = false
      return
    }

    const state = getFileBrowserProjectState($fileBrowserStates, currentProjectId)
    if (state.rootLoaded) {
      loading = false
      if (state.selectedPath !== null && state.fileContent === null) {
        void selectFile(state.selectedPath)
      }
    } else {
      void loadRoot(currentProjectId)
    }
  })

  $effect(() => {
    const path = $pendingFileReveal
    if (path === null) {
      failedRevealPath = null
      return
    }

    if (failedRevealPath !== null && failedRevealPath !== path) {
      failedRevealPath = null
    }

    if (hasLoaded && processingRevealPath !== path && failedRevealPath !== path) {
      void revealPath(path)
    }
  })
</script>

<div class="flex flex-col h-full min-h-0 overflow-hidden">
  <div class="flex items-center justify-between px-4 py-2 border-b border-base-300 shrink-0 bg-base-200">
    <h2 class="text-sm font-semibold text-base-content">{projectName} — Files</h2>
    {#if hasLoaded && !loading}
      <span class="badge badge-neutral badge-sm">{rootEntries.length} {rootEntries.length === 1 ? 'item' : 'items'}</span>
    {/if}
  </div>

  <div class="flex flex-1 min-h-0 overflow-hidden">
    {#if !$activeProjectId}
      <div class="flex-1 flex items-center justify-center text-base-content/50 text-sm p-6 text-center">
        Select a project to browse files
      </div>
    {:else if loading}
      <div class="flex-1 flex items-center justify-center">
        <span class="loading loading-spinner loading-md text-primary"></span>
      </div>
    {:else if error !== null && rootEntries.length === 0}
      <div class="flex-1 flex items-center justify-center p-6">
        <div class="text-center space-y-2 max-w-sm">
          <div class="text-warning text-2xl" aria-hidden="true">!</div>
          <h3 class="text-base font-semibold">Failed to load files</h3>
          <p class="text-sm text-error">{error}</p>
        </div>
      </div>
    {:else}
      <ResizablePanel storageKey="files-tree" defaultWidth={240} side="left">
        {#if rootEntries.length === 0}
          <div class="flex items-center justify-center h-full text-base-content/50 text-xs p-4 text-center">
            This project folder is empty
          </div>
        {:else}
          <ProjectFileTree
            entries={flatEntries}
            expandedDirs={expandedPaths}
            {selectedPath}
            onToggleDir={toggleDir}
            onSelectFile={selectFile}
            initialScrollTop={projectState.treeScrollTop}
            onScrollTopChange={updateTreeScrollTop}
          />
        {/if}
      </ResizablePanel>

      <div class="flex-1 min-h-0 overflow-hidden flex flex-col">
        {#if selectedPath === null}
          <div class="flex-1 flex items-center justify-center text-base-content/40 text-sm p-6 text-center">
            Select a file to view its content
          </div>
        {:else}
          <FileContentViewer
            {api}
            content={fileContent}
            fileName={selectedFileName}
            {error}
            modifiedAt={selectedEntry?.modifiedAt ?? null}
            scrollTop={projectState.contentScrollTop}
            onScrollTopChange={updateContentScrollTop}
          />
        {/if}
      </div>
    {/if}
  </div>
</div>
