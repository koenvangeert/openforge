<script lang="ts">
  import { onMount } from 'svelte'
  import { reviewPrs, selectedReviewPr, prFileDiffs, reviewRequestCount, reviewComments, pendingManualComments, prOverviewComments } from '../lib/stores'
  import { fetchReviewPrs, getReviewPrs, getPrFileDiffs, openUrl, getReviewComments, getFileContent, getFileAtRef } from '../lib/ipc'
  import ReviewPrCard from './ReviewPrCard.svelte'
  import FileTree from './FileTree.svelte'
  import DiffViewer from './DiffViewer.svelte'
  import ReviewSubmitPanel from './ReviewSubmitPanel.svelte'
  import PrOverviewTab from './PrOverviewTab.svelte'
  import type { ReviewPullRequest, PrFileDiff } from '../lib/types'
  import type { FileContents } from '../lib/diffAdapter'

  type PrDetailTab = 'overview' | 'files'

  let isLoading = $state(false)
  let error = $state<string | null>(null)
  let diffViewer = $state<DiffViewer>()
  let fileTreeVisible = $state(true)
  let activeTab = $state<PrDetailTab>('overview')

  let groupedPrs = $derived(groupByRepo($reviewPrs))

  function groupByRepo(prs: ReviewPullRequest[]): Map<string, ReviewPullRequest[]> {
    const grouped = new Map<string, ReviewPullRequest[]>()
    for (const pr of prs) {
      const key = `${pr.repo_owner}/${pr.repo_name}`
      const existing = grouped.get(key) || []
      existing.push(pr)
      grouped.set(key, existing)
    }
    return grouped
  }

  async function loadPrs() {
    isLoading = true
    error = null
    try {
      const prs = await getReviewPrs()
      $reviewPrs = prs
      $reviewRequestCount = prs.length
    } catch (e) {
      console.error('Failed to load PRs:', e)
      error = String(e)
    } finally {
      isLoading = false
    }
  }

  async function refreshPrs() {
    isLoading = true
    error = null
    try {
      const prs = await fetchReviewPrs()
      $reviewPrs = prs
      $reviewRequestCount = prs.length
    } catch (e) {
      console.error('Failed to refresh PRs:', e)
      error = String(e)
    } finally {
      isLoading = false
    }
  }

  async function selectPr(pr: ReviewPullRequest) {
    $selectedReviewPr = pr
    isLoading = true
    try {
      const diffs = await getPrFileDiffs(pr.repo_owner, pr.repo_name, pr.number)
      $prFileDiffs = diffs
      const comments = await getReviewComments(pr.repo_owner, pr.repo_name, pr.number)
      $reviewComments = comments
    } catch (e) {
      console.error('Failed to load PR diffs:', e)
      error = String(e)
    } finally {
      isLoading = false
    }
  }

  function backToList() {
    $selectedReviewPr = null
    $prFileDiffs = []
    $reviewComments = []
    $pendingManualComments = []
    $prOverviewComments = []
    activeTab = 'overview'
  }

  function handleFileSelect(filename: string) {
    if (diffViewer) {
      diffViewer.scrollToFile(filename)
    }
  }

  function openPrOnGitHub() {
    if ($selectedReviewPr) {
      openUrl($selectedReviewPr.html_url)
    }
  }

  function timeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000)
    if (seconds < 60) return 'just now'
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }

  async function fetchPrFileContents(file: PrFileDiff): Promise<FileContents> {
    const pr = $selectedReviewPr!
    let oldContent = ''
    let newContent = ''

    if (file.status !== 'removed' && file.sha) {
      try {
        newContent = await getFileContent(pr.repo_owner, pr.repo_name, file.sha)
      } catch { /* file may not exist */ }
    }

    if (file.status !== 'added') {
      const oldPath = file.previous_filename || file.filename
      try {
        oldContent = await getFileAtRef(pr.repo_owner, pr.repo_name, oldPath, pr.base_ref)
      } catch { /* file may not exist on base */ }
    }

    return { oldContent, newContent }
  }

  onMount(() => {
    loadPrs()
  })
</script>

<div class="flex flex-col w-full h-full overflow-hidden">
  {#if $selectedReviewPr}
    <div class="flex flex-col h-full overflow-hidden">
      <div class="flex flex-col gap-3 px-6 py-5 bg-base-200 border-b border-base-300 shrink-0">
        <button class="btn btn-ghost btn-sm gap-2 self-start text-base-content/50" onclick={backToList}>
          ← Back to list
        </button>
        <div class="flex flex-col gap-2">
          <span class="badge badge-primary badge-sm self-start">{$selectedReviewPr.repo_owner}/{$selectedReviewPr.repo_name}</span>
          <h2 class="text-lg font-semibold text-base-content m-0 leading-snug">{$selectedReviewPr.title}</h2>
          <div class="flex items-center gap-2 text-xs text-base-content/50">
            <span class="font-semibold text-base-content">#{$selectedReviewPr.number}</span>
            <span class="text-base-300">•</span>
            <span class="font-medium">{$selectedReviewPr.user_login}</span>
            <span class="text-base-300">•</span>
            <span>{timeAgo($selectedReviewPr.created_at)}</span>
            <span class="text-base-300">•</span>
            <span
              class="text-primary font-medium cursor-pointer hover:opacity-80 hover:underline"
              role="link"
              tabindex="0"
              onclick={openPrOnGitHub}
              onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && openPrOnGitHub()}
            >View on GitHub ↗</span>
          </div>
        </div>
        <div class="flex gap-1 mt-1">
          <button
            class="btn btn-ghost btn-sm {activeTab === 'overview' ? 'text-primary bg-primary/10 border border-primary' : 'text-base-content/50'}"
            onclick={() => { activeTab = 'overview' }}
          >Overview</button>
          <button
            class="btn btn-ghost btn-sm {activeTab === 'files' ? 'text-primary bg-primary/10 border border-primary' : 'text-base-content/50'}"
            onclick={() => { activeTab = 'files' }}
          >Files changed <span class="badge badge-sm ml-1">{$prFileDiffs.length}</span></button>
        </div>
      </div>

      {#if activeTab === 'overview'}
        <PrOverviewTab pr={$selectedReviewPr} />
      {:else}
        <div class="flex flex-1 overflow-hidden">
          {#if isLoading}
            <div class="flex flex-col items-center justify-center flex-1 gap-3 text-base-content/50 text-sm">
              <span class="loading loading-spinner loading-md text-primary"></span>
              <span>Loading diffs...</span>
            </div>
          {:else if error}
            <div class="flex flex-col items-center justify-center h-full gap-3 text-error text-sm text-center p-5">
              <span class="text-5xl">⚠</span>
              <span>{error}</span>
            </div>
          {:else}
            {#if fileTreeVisible}
              <FileTree files={$prFileDiffs} onSelectFile={handleFileSelect} />
            {/if}
            <DiffViewer
              bind:this={diffViewer}
              files={$prFileDiffs}
              existingComments={$reviewComments}
              repoOwner={$selectedReviewPr.repo_owner}
              repoName={$selectedReviewPr.repo_name}
              {fileTreeVisible}
              onToggleFileTree={() => { fileTreeVisible = !fileTreeVisible }}
              fetchFileContents={fetchPrFileContents}
            />
          {/if}
        </div>

        <ReviewSubmitPanel
          repoOwner={$selectedReviewPr.repo_owner}
          repoName={$selectedReviewPr.repo_name}
          prNumber={$selectedReviewPr.number}
          commitId={$selectedReviewPr.head_sha}
        />
      {/if}
    </div>
  {:else}
    <div class="flex flex-col h-full overflow-hidden">
      <div class="flex items-center justify-between px-6 py-5 bg-base-200 border-b border-base-300 shrink-0">
        <div class="flex items-center gap-3">
          <h2 class="text-xl font-semibold text-base-content m-0">PRs Requesting Your Review</h2>
          <span class="badge badge-primary badge-sm">{$reviewPrs.length} {$reviewPrs.length === 1 ? 'PR' : 'PRs'}</span>
        </div>
        <button class="btn btn-sm border border-base-300" onclick={refreshPrs} disabled={isLoading}>
          {isLoading ? '⟳' : '↻'} Refresh
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-6 pb-8">
        {#if isLoading && $reviewPrs.length === 0}
          <div class="flex flex-col items-center justify-center h-full gap-3 text-base-content/50 text-sm">
            <span class="loading loading-spinner loading-md text-primary"></span>
            <span>Loading PRs...</span>
          </div>
        {:else if error}
          <div class="flex flex-col items-center justify-center h-full gap-3 text-error text-sm text-center p-5">
            <span class="text-5xl">⚠</span>
            <span>{error}</span>
          </div>
        {:else if $reviewPrs.length === 0}
          <div class="flex flex-col items-center justify-center h-full gap-4 text-base-content/50 text-center">
            <span class="text-6xl text-success">✓</span>
            <h3 class="text-xl font-semibold text-base-content m-0">No PRs requesting your review</h3>
            <p class="text-sm m-0">You're all caught up!</p>
          </div>
        {:else}
          {#each [...groupedPrs.entries()] as [repo, prs]}
            <div class="mb-8">
              <h3 class="text-xs font-semibold text-base-content/50 m-0 mb-3 uppercase tracking-wider">{repo}</h3>
              <div class="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-5 max-w-6xl">
                {#each prs as pr}
                  <ReviewPrCard
                    {pr}
                    selected={false}
                    onClick={() => selectPr(pr)}
                  />
                {/each}
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  {/if}
</div>
