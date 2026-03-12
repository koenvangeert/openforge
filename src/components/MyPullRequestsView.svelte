<script lang="ts">
  import { onMount } from 'svelte'
  import { authoredPrs, authoredPrCount } from '../lib/stores'
  import { fetchAuthoredPrs, getAuthoredPrs, openUrl } from '../lib/ipc'
  import { isInputFocused } from '../lib/domUtils'
  import { useVimNavigation } from '../lib/useVimNavigation.svelte'
  import AuthoredPrCard from './AuthoredPrCard.svelte'
  import type { AuthoredPullRequest } from '../lib/types'

  let isLoading = $state(false)
  let error = $state<string | null>(null)

  let flatPrList = $derived($authoredPrs)

  const vim = useVimNavigation({
    getItemCount: () => flatPrList.length,
    onSelect: (index) => {
      const pr = flatPrList[index]
      if (pr) openUrl(pr.html_url)
    },
    onBack: () => {},
  })

  function handleKeydown(e: KeyboardEvent) {
    if (isInputFocused()) return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    vim.handleKeydown(e)
  }

  $effect(() => {
    const idx = vim.focusedIndex
    const items = document.querySelectorAll('[data-vim-authored-pr-item]')
    const el = items[idx] as HTMLElement | undefined
    el?.scrollIntoView?.({ block: 'nearest' })
  })

  let groupedPrs = $derived(groupByRepo($authoredPrs))

  function groupByRepo(prs: AuthoredPullRequest[]): Map<string, AuthoredPullRequest[]> {
    const grouped = new Map<string, AuthoredPullRequest[]>()
    for (const pr of prs) {
      const key = `${pr.repo_owner}/${pr.repo_name}`
      const existing = grouped.get(key) || []
      existing.push(pr)
      grouped.set(key, existing)
    }
    return grouped
  }

  function updateCount(prs: AuthoredPullRequest[]) {
    $authoredPrCount = prs.filter(p => p.ci_status === 'failure' || p.review_status === 'changes_requested').length
  }

  async function loadPrs() {
    isLoading = true
    error = null
    try {
      const prs = await getAuthoredPrs()
      $authoredPrs = prs
      updateCount(prs)
    } catch (e) {
      console.error('Failed to load authored PRs:', e)
      error = 'Failed to load pull requests. Please try again.'
    } finally {
      isLoading = false
    }
  }

  async function refreshPrs() {
    isLoading = true
    error = null
    try {
      const prs = await fetchAuthoredPrs()
      $authoredPrs = prs
      updateCount(prs)
    } catch (e) {
      console.error('Failed to refresh authored PRs:', e)
      error = 'Failed to refresh pull requests. Please try again.'
    } finally {
      isLoading = false
    }
  }

  onMount(() => {
    loadPrs()
  })
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex flex-col h-full overflow-hidden">
  <div class="flex items-center justify-between px-6 py-5 bg-base-200 border-b border-base-300 shrink-0">
    <div class="flex items-center gap-3">
      <h2 class="text-xl font-semibold text-base-content m-0">My Pull Requests</h2>
      <span class="badge badge-primary badge-sm">{$authoredPrs.length} {$authoredPrs.length === 1 ? 'PR' : 'PRs'}</span>
    </div>
    <button class="btn btn-sm border border-base-300" onclick={refreshPrs} disabled={isLoading}>
      {isLoading ? '⟳' : '↻'} Refresh
    </button>
  </div>

  <div class="flex-1 overflow-y-auto p-6 pb-8">
    {#if isLoading && $authoredPrs.length === 0}
      <div class="flex flex-col items-center justify-center h-full gap-3 text-base-content/50 text-sm">
        <span class="loading loading-spinner loading-md text-primary"></span>
        <span>Loading PRs...</span>
      </div>
    {:else if error}
      <div class="flex flex-col items-center justify-center h-full gap-3 text-error text-sm text-center p-5">
        <span class="text-5xl">⚠</span>
        <span>{error}</span>
      </div>
    {:else if $authoredPrs.length === 0}
      <div class="flex flex-col items-center justify-center h-full gap-4 text-base-content/50 text-center">
        <span class="text-6xl">🚀</span>
        <h3 class="text-xl font-semibold text-base-content m-0">No open pull requests</h3>
        <p class="text-sm m-0">You don't have any open PRs right now.</p>
      </div>
    {:else}
      {#each [...groupedPrs.entries()] as [repo, prs]}
        <div class="mb-8">
          <h3 class="text-xs font-semibold text-base-content/50 m-0 mb-3 uppercase tracking-wider">{repo}</h3>
          <div class="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-5">
            {#each prs as pr}
              {@const flatIdx = flatPrList.indexOf(pr)}
              <div data-vim-authored-pr-item class={flatIdx === vim.focusedIndex ? 'vim-focus' : ''}>
                <AuthoredPrCard
                  {pr}
                  selected={false}
                  onClick={() => openUrl(pr.html_url)}
                />
              </div>
            {/each}
          </div>
        </div>
      {/each}
    {/if}
  </div>
</div>
