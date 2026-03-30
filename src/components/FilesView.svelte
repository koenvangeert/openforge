<script lang="ts">
  import { onMount } from 'svelte'
  import { activeProjectId } from '../lib/stores'
  import { fsReadDir, fsReadFile } from '../lib/ipc'
  import type { FileEntry, FileContent } from '../lib/types'
  import ProjectFileTree from './ProjectFileTree.svelte'
  import FileContentViewer from './FileContentViewer.svelte'
  import ResizablePanel from './ResizablePanel.svelte'

  interface Props {
    projectName: string
  }

  let { projectName }: Props = $props()

  let rootEntries = $state<FileEntry[]>([])
  let dirContents = $state<Map<string, FileEntry[]>>(new Map())
  let expandedPaths = $state<Set<string>>(new Set())
  let selectedPath = $state<string | null>(null)
  let fileContent = $state<FileContent | null>(null)
  let loading = $state(true)
  let error = $state<string | null>(null)
  let hasLoaded = $state(false)

  const selectedFileName = $derived(
    selectedPath ? selectedPath.split('/').at(-1) ?? selectedPath : ''
  )

  async function loadRoot() {
    const projectId = $activeProjectId
    if (!projectId) {
      loading = false
      return
    }
    loading = true
    error = null
    try {
      rootEntries = await fsReadDir(projectId, null)
    } catch (e) {
      error = String(e)
    } finally {
      loading = false
      hasLoaded = true
    }
  }

  async function toggleDir(path: string) {
    const projectId = $activeProjectId
    if (!projectId) return

    const next = new Set(expandedPaths)
    if (next.has(path)) {
      next.delete(path)
    } else {
      next.add(path)
      if (!dirContents.has(path)) {
        try {
          const entries = await fsReadDir(projectId, path)
          dirContents = new Map(dirContents).set(path, entries)
        } catch (e) {
          error = String(e)
          return
        }
      }
    }
    expandedPaths = next
  }

  async function selectFile(path: string) {
    const projectId = $activeProjectId
    if (!projectId) return

    selectedPath = path
    fileContent = null
    error = null
    try {
      fileContent = await fsReadFile(projectId, path)
    } catch (e) {
      error = String(e)
    }
  }

  function flattenEntries(entries: FileEntry[]): FileEntry[] {
    const result: FileEntry[] = []
    for (const entry of entries) {
      result.push(entry)
      if (entry.isDir && expandedPaths.has(entry.path)) {
        const children = dirContents.get(entry.path) ?? []
        result.push(...flattenEntries(children))
      }
    }
    return result
  }

  const flatEntries = $derived(flattenEntries(rootEntries))

  onMount(() => {
    loadRoot()
  })
</script>

<div class="flex flex-col h-full overflow-hidden">
  <div class="flex items-center justify-between px-4 py-2 border-b border-base-300 shrink-0 bg-base-200">
    <h2 class="text-sm font-semibold text-base-content">{projectName} — Files</h2>
    {#if hasLoaded && !loading}
      <span class="badge badge-neutral badge-sm">{rootEntries.length} {rootEntries.length === 1 ? 'item' : 'items'}</span>
    {/if}
  </div>

  <div class="flex flex-1 overflow-hidden">
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
          />
        {/if}
      </ResizablePanel>

      <div class="flex-1 overflow-hidden flex flex-col">
        {#if selectedPath === null}
          <div class="flex-1 flex items-center justify-center text-base-content/40 text-sm p-6 text-center">
            Select a file to view its content
          </div>
        {:else}
          <FileContentViewer
            content={fileContent}
            fileName={selectedFileName}
            {error}
          />
        {/if}
      </div>
    {/if}
  </div>
</div>
