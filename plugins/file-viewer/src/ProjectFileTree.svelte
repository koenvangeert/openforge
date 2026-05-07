<script lang="ts">
  import { FileText, Folder, FolderOpen } from 'lucide-svelte'
  import type { FileEntry } from '@openforge/plugin-sdk/domain'

  interface Props {
    entries: FileEntry[]
    expandedDirs: Set<string>
    selectedPath: string | null
    onToggleDir: (path: string) => void
    onSelectFile: (path: string) => void
    initialScrollTop?: number
    onScrollTopChange?: (scrollTop: number) => void
  }

  const {
    entries,
    expandedDirs,
    selectedPath,
    onToggleDir,
    onSelectFile,
    initialScrollTop = 0,
    onScrollTopChange,
  }: Props = $props()

  let scrollContainer = $state<HTMLDivElement | null>(null)
  let appliedInitialScrollTop = $state<number | null>(null)

  function getDepth(path: string): number {
    return path.split('/').length - 1
  }

  function formatSize(size: number | null): string {
    if (size === null) return ''
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
    return `${(size / (1024 * 1024)).toFixed(1)} MB`
  }

  function handleScroll() {
    if (scrollContainer) {
      onScrollTopChange?.(scrollContainer.scrollTop)
    }
  }

  $effect(() => {
    if (scrollContainer && appliedInitialScrollTop !== initialScrollTop) {
      scrollContainer.scrollTop = initialScrollTop
      appliedInitialScrollTop = initialScrollTop
    }
  })
</script>

<div class="flex flex-col h-full bg-base-200 border-r border-base-300">
  <div
    class="flex-1 overflow-y-auto py-2"
    bind:this={scrollContainer}
    onscroll={handleScroll}
  >
    {#each entries as entry (entry.path)}
      {#if entry.isDir}
        {@const isExpanded = expandedDirs.has(entry.path)}
        <button
          class="w-full flex items-center gap-2 text-xs text-base-content cursor-pointer hover:bg-base-content/5 transition-colors py-1.5 pr-3"
          style="padding-left: {12 + getDepth(entry.path) * 16}px"
          onclick={() => onToggleDir(entry.path)}
          data-testid="tree-entry"
        >
          <span class="text-[0.6rem] text-base-content/50 shrink-0" data-testid={`dir-indicator-${entry.path}`}>{isExpanded ? '▼' : '▶'}</span>
          {#if isExpanded}
            <FolderOpen class="w-3.5 h-3.5 text-base-content/60 shrink-0" data-testid={`folder-icon-${entry.path}`} />
          {:else}
            <Folder class="w-3.5 h-3.5 text-base-content/60 shrink-0" data-testid={`folder-icon-${entry.path}`} />
          {/if}
          <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left" data-testid="entry-label">{entry.name}/</span>
        </button>
      {:else}
        <button
          class="w-full flex items-center gap-2 text-xs text-base-content cursor-pointer transition-colors py-1.5 pr-3 {selectedPath === entry.path ? 'bg-primary/10 border-l-2 border-l-primary' : 'hover:bg-base-content/5'}"
          style="padding-left: {selectedPath === entry.path ? 10 + getDepth(entry.path) * 16 : 12 + getDepth(entry.path) * 16}px"
          onclick={() => onSelectFile(entry.path)}
          data-testid="tree-entry"
        >
          <FileText class="w-3.5 h-3.5 text-base-content/60 shrink-0" data-testid={`file-icon-${entry.path}`} />
          <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left" data-testid="entry-label">{entry.name}</span>
          <span class="text-base-content/50 text-[0.7rem] ml-auto">{formatSize(entry.size)}</span>
        </button>
      {/if}
    {/each}
  </div>
</div>
