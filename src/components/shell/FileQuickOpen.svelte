<script lang="ts">
  import { onDestroy } from 'svelte'
  import { activeProjectId, pendingFileReveal } from '../../lib/stores'
  import { fsSearchFiles } from '../../lib/ipc'
  import { FILE_VIEWER_VIEW_KEY } from '../../lib/fileViewerPlugin'
  import { useListNavigation } from '../../lib/useListNavigation.svelte'
  import { useAppRouter } from '../../lib/router.svelte'
  import PaletteModal from './PaletteModal.svelte'

  interface Props {
    onClose: () => void
  }

  let { onClose }: Props = $props()

  const router = useAppRouter()

  let searchQuery = $state('')
  let results = $state<string[]>([])
  let loading = $state(false)
  let selectedIndex = $state(0)
  let listContainer: HTMLDivElement | null = $state(null)
  let searchTimer: ReturnType<typeof setTimeout> | null = null

  let filteredResults = $derived(results.filter((p) => !p.endsWith('/')))

  function closeModal() {
    if (searchTimer) {
      clearTimeout(searchTimer)
      searchTimer = null
    }
    onClose()
  }

  const listNav = useListNavigation({
    get itemCount() { return filteredResults.length },
    get selectedIndex() { return selectedIndex },
    set selectedIndex(index: number) { selectedIndex = index },
    wrap: true,
    onSelect() {
      if (selectedIndex >= 0 && selectedIndex < filteredResults.length) {
        handleSelectFile(filteredResults[selectedIndex])
      }
    },
    onCancel() { closeModal() }
  })

  function handleKeyDown(e: KeyboardEvent): boolean {
    return listNav.handleKeydown(e)
  }

  async function searchFiles(query: string) {
    const projectId = $activeProjectId
    if (!projectId || !query.trim()) {
      results = []
      loading = false
      return
    }

    loading = true
    try {
      results = await fsSearchFiles(projectId, query, 50)
    } catch (e) {
      console.error('[FileQuickOpen] search failed:', e)
      results = []
    } finally {
      loading = false
    }
  }

  function handleInput() {
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      searchTimer = null
      void searchFiles(searchQuery)
    }, 150)
  }

  function handleSelectFile(path: string) {
    $pendingFileReveal = path
    router.navigate(FILE_VIEWER_VIEW_KEY)
    closeModal()
  }

  function getFileName(path: string): string {
    return path.split('/').at(-1) ?? path
  }

  function getDirectory(path: string): string {
    const parts = path.split('/')
    if (parts.length <= 1) return ''
    return parts.slice(0, -1).join('/')
  }

  $effect(() => {
    filteredResults.length
    selectedIndex = 0
  })

  $effect(() => {
    if (listContainer && selectedIndex >= 0) {
      const items = listContainer.querySelectorAll('[data-palette-item]')
      items[selectedIndex]?.scrollIntoView({ block: 'nearest' })
    }
  })

  onDestroy(() => {
    if (searchTimer) {
      clearTimeout(searchTimer)
      searchTimer = null
    }
  })
</script>

<PaletteModal
  ariaLabel="Search files"
  testId="file-quick-open-backdrop"
  onClose={closeModal}
  onKeydown={handleKeyDown}
>
    <div class="p-3 border-b border-base-300">
      <input
        data-palette-initial-focus
        type="text"
        class="input input-sm w-full bg-base-100 border-base-300 focus:outline-none text-base-content placeholder:text-base-content/40"
        placeholder="Search files..."
        bind:value={searchQuery}
        oninput={handleInput}
      />
    </div>

    <div class="max-h-[400px] overflow-y-auto" bind:this={listContainer}>
      {#if !$activeProjectId}
        <div class="px-4 py-6 text-center text-base-content/50 text-sm">
          Select a project first
        </div>
      {:else if loading}
        <div class="px-4 py-6 text-center text-base-content/50 text-sm">
          Searching...
        </div>
      {:else if searchQuery.trim() && filteredResults.length === 0}
        <div class="px-4 py-6 text-center text-base-content/50 text-sm">
          No files match your search
        </div>
      {:else if filteredResults.length > 0}
        {#each filteredResults as filePath, i (filePath)}
          <button
            type="button"
            data-palette-item
            class="flex items-center gap-3 w-full px-4 py-2 text-left text-sm text-base-content transition-colors
              {i === selectedIndex ? 'bg-base-300' : 'hover:bg-base-300/60'}"
            onclick={() => handleSelectFile(filePath)}
          >
            <div class="flex-1 min-w-0">
              <div class="font-medium truncate">{getFileName(filePath)}</div>
              <div class="text-xs text-base-content/50 truncate">{getDirectory(filePath)}</div>
            </div>
          </button>
        {/each}
      {:else}
        <div class="px-4 py-6 text-center text-base-content/50 text-sm">
          Type to search files...
        </div>
      {/if}
    </div>

    {#if filteredResults.length === 50}
      <div class="px-4 py-1.5 border-t border-base-300 text-xs text-base-content/40 text-center">
        Showing top 50 results
      </div>
    {/if}

    <div class="flex items-center gap-4 px-3 py-1.5 border-t border-base-300 bg-base-300/30">
      <span class="text-[10px] text-base-content/40"><kbd class="kbd kbd-xs">↑↓</kbd> navigate</span>
      <span class="text-[10px] text-base-content/40"><kbd class="kbd kbd-xs">Enter</kbd> open file</span>
      <span class="text-[10px] text-base-content/40"><kbd class="kbd kbd-xs">Esc</kbd> close</span>
    </div>
</PaletteModal>
