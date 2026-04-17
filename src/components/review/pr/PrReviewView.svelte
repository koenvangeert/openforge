<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { listen } from '@tauri-apps/api/event'
  import type { UnlistenFn } from '@tauri-apps/api/event'
  import { reviewPrs, selectedReviewPr, prFileDiffs, reviewRequestCount, reviewComments, pendingManualComments, prOverviewComments, agentReviewComments, agentReviewLoading, agentReviewError, authoredPrs, authoredPrCount, activeProjectId } from '../../../lib/stores'
  import { fetchReviewPrs, getReviewPrs, fetchAuthoredPrs, getAuthoredPrs, getPrFileDiffs, openUrl, getReviewComments, getFileContent, getFileAtRef, markReviewPrViewed, startAgentReview, getAgentReviewComments, abortAgentReview, getProjectConfig, setProjectConfig } from '../../../lib/ipc'
  import { useAppRouter } from '../../../lib/router.svelte'
  import { getHTMLElementAt, isInputFocused } from '../../../lib/domUtils'
  import { useVimNavigation } from '../../../lib/useVimNavigation.svelte'
  import { timeAgoFromSeconds } from '../../../lib/timeAgo'
  import ReviewPrCard from './ReviewPrCard.svelte'
  import AuthoredPrCard from './AuthoredPrCard.svelte'
  import FileTree from '../shared/FileTree.svelte'
  import ResizablePanel from '../../shared/ui/ResizablePanel.svelte'
  import DiffViewer from '../shared/diff-viewer/DiffViewer.svelte'
  import ProjectPageHeader from '../../project/ProjectPageHeader.svelte'
  import ReviewSubmitPanel from './ReviewSubmitPanel.svelte'
  import PrOverviewTab from './PrOverviewTab.svelte'
  import AgentReviewOutputModal from './AgentReviewOutputModal.svelte'
  import { hasMergeConflicts } from '../../../lib/types'
  import type { ReviewPullRequest, AuthoredPullRequest, PrFileDiff } from '../../../lib/types'
  import type { FileContents } from '../../../lib/diffAdapter'

  type PrDetailTab = 'overview' | 'files'

  interface Props {
    projectName: string
  }

  let { projectName }: Props = $props()

  const router = useAppRouter()

  let isLoading = $state(false)
  let isLoadingAuthored = $state(false)
  let error = $state<string | null>(null)
  let authoredError = $state<string | null>(null)
  let diffViewer = $state<DiffViewer>()
  let fileTreeVisible = $state(true)
  let activeTab = $state<PrDetailTab>('overview')
  let reviewSessionKey = $state<string | null>(null)
  let showOutputModal = $state(false)
  let unlisteners: UnlistenFn[] = []

  // Repo filtering
  let excludedRepos = $state<Set<string>>(new Set())
  let showFilterDropdown = $state(false)

  // Load excluded repos when project changes
  $effect(() => {
    const pid = $activeProjectId
    if (pid) {
      getProjectConfig(pid, 'pr_excluded_repos').then((val) => {
        if (val) {
          try {
            const parsed = JSON.parse(val)
            excludedRepos = new Set(Array.isArray(parsed) ? parsed : [])
          } catch {
            excludedRepos = new Set()
          }
        } else {
          excludedRepos = new Set()
        }
      }).catch(() => {
        excludedRepos = new Set()
      })
    } else {
      excludedRepos = new Set()
    }
  })

  function isRepoExcluded(repoOwner: string, repoName: string): boolean {
    return excludedRepos.has(`${repoOwner}/${repoName}`)
  }

  let filteredReviewPrs = $derived($reviewPrs.filter(pr => !isRepoExcluded(pr.repo_owner, pr.repo_name)))
  let filteredAuthoredPrs = $derived($authoredPrs.filter(pr => !isRepoExcluded(pr.repo_owner, pr.repo_name)))

  // Text input for manually adding repos
  let newRepoInput = $state('')

  // Suggested repos from current PRs that aren't already excluded
  let suggestedRepos = $derived(() => {
    const repos = new Set<string>()
    for (const pr of $reviewPrs) repos.add(`${pr.repo_owner}/${pr.repo_name}`)
    for (const pr of $authoredPrs) repos.add(`${pr.repo_owner}/${pr.repo_name}`)
    return [...repos].filter(r => !excludedRepos.has(r)).sort()
  })

  async function persistExcludedRepos(newExcluded: Set<string>) {
    excludedRepos = newExcluded
    if ($activeProjectId) {
      const arr = [...newExcluded].sort()
      await setProjectConfig($activeProjectId, 'pr_excluded_repos', JSON.stringify(arr))
    }
  }

  async function addExcludedRepo(repo: string) {
    const trimmed = repo.trim()
    if (!trimmed || excludedRepos.has(trimmed)) return
    const newExcluded = new Set(excludedRepos)
    newExcluded.add(trimmed)
    await persistExcludedRepos(newExcluded)
    newRepoInput = ''
  }

  async function removeExcludedRepo(repo: string) {
    const newExcluded = new Set(excludedRepos)
    newExcluded.delete(repo)
    await persistExcludedRepos(newExcluded)
  }

  // Flat PR list for vim navigation
  let flatPrList = $derived(filteredReviewPrs)

  const vimList = useVimNavigation({
    getItemCount: () => $selectedReviewPr ? 0 : flatPrList.length,
    onSelect: (index) => {
      const pr = flatPrList[index]
      if (pr) selectPr(pr)
    },
    onBack: () => {
      if ($selectedReviewPr) backToList()
    },
  })

  function handlePrReviewKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && showFilterDropdown) {
      e.preventDefault()
      showFilterDropdown = false
      return
    }
    if (isInputFocused()) return
    if (e.metaKey || e.ctrlKey || e.altKey) return

    // Detail mode
    if ($selectedReviewPr) {
      if (e.key === 'Escape' || e.key === 'q') {
        e.preventDefault()
        backToList()
        return
      }
      if (e.key === '1') {
        e.preventDefault()
        activeTab = 'overview'
        return
      }
      if (e.key === '2') {
        e.preventDefault()
        activeTab = 'files'
        return
      }
      return
    }

    // List mode — delegate to vim navigation
    vimList.handleKeydown(e)
  }

  // Scroll focused PR into view
  $effect(() => {
    if ($selectedReviewPr) return
    const idx = vimList.focusedIndex
    const items = document.querySelectorAll('[data-vim-pr-item]')
    const el = getHTMLElementAt(items, idx)
    el?.scrollIntoView?.({ block: 'nearest' })
  })

  let groupedPrs = $derived(groupByRepo(filteredReviewPrs))
  let groupedAuthoredPrs = $derived(groupAuthoredByRepo(filteredAuthoredPrs))

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

  function groupAuthoredByRepo(prs: AuthoredPullRequest[]): Map<string, AuthoredPullRequest[]> {
    const grouped = new Map<string, AuthoredPullRequest[]>()
    for (const pr of prs) {
      const key = `${pr.repo_owner}/${pr.repo_name}`
      const existing = grouped.get(key) || []
      existing.push(pr)
      grouped.set(key, existing)
    }
    return grouped
  }

  function updateAuthoredCount() {
    $authoredPrCount = filteredAuthoredPrs.filter(
      (p) => p.ci_status === 'failure' || p.review_status === 'changes_requested' || hasMergeConflicts(p),
    ).length
  }

  // Update authored PR count whenever filtered authored PRs change
  $effect(() => {
    updateAuthoredCount()
  })

  // Update review request count whenever filtered PRs change
  $effect(() => {
    $reviewRequestCount = filteredReviewPrs.filter(p => p.viewed_at === null).length
  })

  async function loadPrs() {
    isLoading = true
    error = null
    try {
      const prs = await getReviewPrs()
      $reviewPrs = prs
    } catch (e) {
      console.error('Failed to load PRs:', e)
      error = 'Failed to load pull requests. Please try again.'
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
    } catch (e) {
      console.error('Failed to refresh PRs:', e)
      error = 'Failed to refresh pull requests. Please try again.'
    } finally {
      isLoading = false
    }
  }

  /** Silently update PR store from DB without showing loading state. Used by background sync events. */
  async function silentRefreshPrs() {
    try {
      const prs = await getReviewPrs()
      $reviewPrs = prs
    } catch (e) {
      console.error('Failed to silently refresh PRs:', e)
    }
  }

  async function loadAuthoredPrs() {
    isLoadingAuthored = true
    authoredError = null
    try {
      const prs = await getAuthoredPrs()
      $authoredPrs = prs
      // count is updated reactively via $effect
    } catch (e) {
      console.error('Failed to load authored PRs:', e)
      authoredError = 'Failed to load pull requests. Please try again.'
    } finally {
      isLoadingAuthored = false
    }
  }

  async function refreshAuthoredPrs() {
    isLoadingAuthored = true
    authoredError = null
    try {
      const prs = await fetchAuthoredPrs()
      $authoredPrs = prs
      // count is updated reactively via $effect
    } catch (e) {
      console.error('Failed to refresh authored PRs:', e)
      authoredError = 'Failed to refresh pull requests. Please try again.'
    } finally {
      isLoadingAuthored = false
    }
  }

  /** Silently update authored PR store from DB without showing loading state. Used by background sync events. */
  async function silentRefreshAuthoredPrs() {
    try {
      const prs = await getAuthoredPrs()
      $authoredPrs = prs
    } catch (e) {
      console.error('Failed to silently refresh authored PRs:', e)
    }
  }

  async function selectPr(pr: ReviewPullRequest) {
    router.navigate('plugin:com.openforge.github-sync:pr_review')
    const now = Math.floor(Date.now() / 1000)
    const updatedPr = { ...pr, viewed_at: now, viewed_head_sha: pr.head_sha }
    $selectedReviewPr = updatedPr
    $reviewPrs = $reviewPrs.map(p => p.id === pr.id ? updatedPr : p)
    // Fire-and-forget IPC
    markReviewPrViewed(pr.id, pr.head_sha).catch(e => console.error('Failed to mark viewed:', e))
    isLoading = true
    try {
      const diffs = await getPrFileDiffs(pr.repo_owner, pr.repo_name, pr.number)
      $prFileDiffs = diffs
      const comments = await getReviewComments(pr.repo_owner, pr.repo_name, pr.number)
      $reviewComments = comments
      const agentComments = await getAgentReviewComments(pr.id)
      $agentReviewComments = agentComments
    } catch (e) {
      console.error('Failed to load PR diffs:', e)
      error = 'Failed to load pull request details.'
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
    $agentReviewComments = []
    $agentReviewLoading = false
    $agentReviewError = null
    reviewSessionKey = null
    showOutputModal = false
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

  async function handleStartAgentReview() {
    if (!$selectedReviewPr) return
    $agentReviewLoading = true
    $agentReviewError = null
    try {
      const result = await startAgentReview(
        $selectedReviewPr.repo_owner,
        $selectedReviewPr.repo_name,
        $selectedReviewPr.number,
        $selectedReviewPr.head_ref,
        $selectedReviewPr.base_ref,
        $selectedReviewPr.title,
        $selectedReviewPr.body,
        $selectedReviewPr.id
      )
      reviewSessionKey = result.review_session_key
    } catch (e) {
      console.error('[PrReviewView] Failed to start agent review:', e)
      $agentReviewError = 'Failed to start AI review. Please try again.'
      $agentReviewLoading = false
    }
  }

  async function handleCancelReview() {
    if (!reviewSessionKey) return
    try {
      await abortAgentReview(reviewSessionKey)
    } catch (e) {
      console.error('[PrReviewView] Failed to cancel agent review:', e)
    } finally {
      $agentReviewLoading = false
      reviewSessionKey = null
      showOutputModal = false
    }
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

  onMount(async () => {
    loadPrs()
    loadAuthoredPrs()
    unlisteners.push(
      await listen('authored-prs-updated', () => {
        silentRefreshAuthoredPrs()
      })
    )
    unlisteners.push(
      await listen('review-pr-count-changed', () => {
        silentRefreshPrs()
      })
    )
    unlisteners.push(
      await listen<{ task_id: string; event_type: string; data: string }>('agent-event', async (event) => {
        const { task_id, event_type, data } = event.payload
        const pr = $selectedReviewPr
        if (!pr) return
        if (task_id !== `pr-review-${pr.id}`) return

        console.log('[PrReviewView] Agent event:', event_type, 'for task:', task_id, 'data:', data)

        if (event_type === 'session.idle' || event_type === 'session.status') {
          try {
            const parsed = JSON.parse(data)
            const statusType = parsed.properties?.status?.type
            console.log('[PrReviewView] Status event:', event_type, 'statusType:', statusType)
            if (event_type === 'session.idle' || statusType === 'idle') {
              console.log('[PrReviewView] Session completed, fetching agent comments for PR:', pr.id)
              const comments = await getAgentReviewComments(pr.id)
              console.log('[PrReviewView] Fetched', comments.length, 'agent comments')
              $agentReviewComments = comments
              $agentReviewLoading = false
            }
          } catch (e) {
            console.error('[PrReviewView] Failed to parse status event:', e, 'raw:', data)
            if (event_type === 'session.idle') {
              const comments = await getAgentReviewComments(pr.id)
              console.log('[PrReviewView] Fetched', comments.length, 'agent comments (fallback)')
              $agentReviewComments = comments
              $agentReviewLoading = false
            }
          }
        } else if (event_type === 'session.error') {
          console.error('[PrReviewView] Agent review error:', data)
          $agentReviewError = 'Agent review failed. Please try again.'
          $agentReviewLoading = false
        }
      })
    )
  })

  onDestroy(() => {
    unlisteners.forEach((fn) => {
      fn()
    })
  })
</script>

<svelte:window onkeydown={handlePrReviewKeydown} />

<div class="flex flex-col w-full h-full overflow-hidden">
  {#if $selectedReviewPr}
    <div class="flex flex-col h-full overflow-hidden">
      <div class="flex flex-col gap-1.5 px-4 py-2.5 border-b border-base-300 shrink-0" style="background-color: var(--project-bg-alt, oklch(var(--b2)))">
        <div class="flex items-center gap-2 min-w-0">
          <button class="btn btn-ghost btn-xs text-base-content/50 shrink-0" onclick={backToList}>← Back</button>
          <span class="badge badge-primary badge-sm shrink-0">{$selectedReviewPr.repo_owner}/{$selectedReviewPr.repo_name}</span>
          <h2 class="text-sm font-semibold text-base-content m-0 truncate flex-1">{$selectedReviewPr.title}</h2>
          <span
            class="text-xs text-primary font-medium cursor-pointer hover:opacity-80 hover:underline shrink-0"
            role="link"
            tabindex="0"
            onclick={openPrOnGitHub}
            onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && openPrOnGitHub()}
          >GitHub ↗</span>
        </div>
        <div class="flex items-center">
          <div class="flex items-center gap-2 text-xs text-base-content/50">
            <span class="font-semibold text-base-content">#{$selectedReviewPr.number}</span>
            <span class="text-base-300">•</span>
            <span class="font-medium">{$selectedReviewPr.user_login}</span>
            <span class="text-base-300">•</span>
            <span>{timeAgoFromSeconds($selectedReviewPr.created_at)}</span>
          </div>
          <span class="flex-1"></span>
          <div class="flex gap-1">
            <button
              class="btn btn-ghost btn-xs {activeTab === 'overview' ? 'text-primary bg-primary/10 border border-primary' : 'text-base-content/50'}"
              onclick={() => { activeTab = 'overview' }}
            >Overview</button>
            <button
              class="btn btn-ghost btn-xs {activeTab === 'files' ? 'text-primary bg-primary/10 border border-primary' : 'text-base-content/50'}"
              onclick={() => { activeTab = 'files' }}
            >Files changed <span class="badge badge-xs ml-1">{$prFileDiffs.length}</span></button>
          </div>
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
              <ResizablePanel storageKey="pr-review-file-tree" defaultWidth={260} minWidth={160} maxWidth={500} side="left">
                <FileTree files={$prFileDiffs} onSelectFile={handleFileSelect} />
              </ResizablePanel>
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
              agentComments={$agentReviewComments}
            >
              {#snippet toolbarExtra()}
                <div class="w-px h-5 bg-base-300 mx-1 self-center"></div>
                {#if $agentReviewLoading}
                  <button class="btn btn-ghost btn-xs gap-1 text-base-content/50" disabled>
                    <span class="loading loading-spinner loading-xs"></span>
                    Reviewing...
                  </button>
                  <button
                    class="btn btn-ghost btn-xs text-base-content/50"
                    onclick={() => { showOutputModal = true }}
                    title="View agent output"
                  >View Output</button>
                  <button
                    class="btn btn-ghost btn-xs text-error"
                    onclick={handleCancelReview}
                    title="Cancel AI review"
                  >Cancel</button>
                {:else}
                  <button
                    class="btn btn-ghost btn-xs gap-1 text-base-content/50"
                    onclick={handleStartAgentReview}
                    title="Start AI review"
                  >
                    AI Review
                    {#if $agentReviewComments.length > 0}
                      <span class="badge badge-primary badge-xs">{$agentReviewComments.length}</span>
                    {/if}
                  </button>
                  {#if reviewSessionKey}
                    <button
                      class="btn btn-ghost btn-xs text-base-content/50"
                      onclick={() => { showOutputModal = true }}
                      title="View last agent review output"
                    >View Output</button>
                  {/if}
                {/if}
                {#if $agentReviewError}
                  <span class="text-xs text-error">{$agentReviewError}</span>
                {/if}
              {/snippet}
            </DiffViewer>
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
      <ProjectPageHeader
        title={`${projectName} — Pull Requests`}
        subtitle="Review open pull requests for this project"
      >
        {#snippet actions()}
          <div class="relative">
            <button
              class="btn btn-ghost btn-sm gap-1 {excludedRepos.size > 0 ? 'text-warning' : 'text-base-content/50'}"
              title="Filter repositories"
              onclick={() => { showFilterDropdown = !showFilterDropdown }}
            >
              {#if excludedRepos.size > 0}
                <span class="badge badge-warning badge-xs">{excludedRepos.size}</span>
              {/if}
              Filter
            </button>
              {#if showFilterDropdown}
                <!-- Invisible backdrop to close dropdown on outside click -->
               <!-- svelte-ignore a11y_click_events_have_key_events -->
               <div role="presentation" class="fixed inset-0 z-40" onclick={() => { showFilterDropdown = false }}></div>
               <div class="absolute right-0 top-full mt-1 z-50 bg-base-100 border border-base-300 rounded-lg shadow-lg w-[320px] p-3">
                <div class="text-xs font-semibold text-base-content/50 mb-2">Excluded Repositories</div>

                <!-- Manual input to add a repo -->
                <form class="flex gap-1.5 mb-3" onsubmit={(e) => { e.preventDefault(); addExcludedRepo(newRepoInput) }}>
                  <input
                    type="text"
                    class="input input-bordered input-xs flex-1"
                    placeholder="owner/repo"
                    bind:value={newRepoInput}
                  />
                  <button type="submit" class="btn btn-primary btn-xs" disabled={!newRepoInput.trim()}>Add</button>
                </form>

                <!-- Current exclusion list -->
                {#if excludedRepos.size > 0}
                  <div class="flex flex-col gap-1 mb-3 max-h-[160px] overflow-y-auto">
                    {#each [...excludedRepos].sort() as repo}
                      <div class="flex items-center justify-between px-2 py-1 rounded bg-base-200 text-sm">
                        <span class="text-base-content truncate">{repo}</span>
                        <button
                          class="btn btn-ghost btn-xs text-base-content/40 hover:text-error"
                          onclick={() => removeExcludedRepo(repo)}
                          title="Remove from exclusion list"
                        >✕</button>
                      </div>
                    {/each}
                  </div>
                {:else}
                  <div class="text-xs text-base-content/40 px-1 mb-3">No repositories excluded</div>
                {/if}

                <!-- Quick-add suggestions from current PRs -->
                {#if suggestedRepos().length > 0}
                  <div class="border-t border-base-300 pt-2">
                    <div class="text-xs text-base-content/40 mb-1.5">Quick add from open PRs</div>
                    <div class="flex flex-wrap gap-1">
                      {#each suggestedRepos() as repo}
                        <button
                          class="btn btn-ghost btn-xs text-base-content/60"
                          onclick={() => addExcludedRepo(repo)}
                        >+ {repo}</button>
                      {/each}
                    </div>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/snippet}
      </ProjectPageHeader>

      <div class="flex flex-1 overflow-hidden">
        <!-- Left column: Review Requests -->
        <div class="flex-1 flex flex-col overflow-hidden border-r border-base-300">
          <div class="flex items-center justify-between px-5 py-3 bg-base-200/50 border-b border-base-300 shrink-0">
            <div class="flex items-center gap-2">
              <h3 class="text-sm font-semibold text-base-content m-0">Review Requests</h3>
              <span class="badge badge-primary badge-xs">{filteredReviewPrs.length}</span>
            </div>
            <button class="btn btn-xs btn-ghost text-base-content/50" onclick={refreshPrs} disabled={isLoading}>
              {isLoading ? '⟳' : '↻'}
            </button>
          </div>

          <div class="flex-1 overflow-y-auto p-5 pb-8">
            {#if isLoading && filteredReviewPrs.length === 0}
              <div class="flex flex-col items-center justify-center h-full gap-3 text-base-content/50 text-sm">
                <span class="loading loading-spinner loading-md text-primary"></span>
                <span>Loading PRs...</span>
              </div>
            {:else if error}
              <div class="flex flex-col items-center justify-center h-full gap-3 text-error text-sm text-center p-5">
                <span class="text-5xl">⚠</span>
                <span>{error}</span>
              </div>
            {:else if filteredReviewPrs.length === 0}
              <div class="flex flex-col items-center justify-center h-full gap-4 text-base-content/50 text-center">
                <span class="text-6xl text-success">✓</span>
                <h3 class="text-xl font-semibold text-base-content m-0">No PRs requesting your review</h3>
                <p class="text-sm m-0">You're all caught up!</p>
              </div>
            {:else}
              {#each [...groupedPrs.entries()] as [repo, prs]}
                <div class="mb-6">
                  <h3 class="text-xs font-semibold text-base-content/50 m-0 mb-3 uppercase tracking-wider">{repo}</h3>
                  <div class="flex flex-col gap-3">
                    {#each prs as pr}
                      {@const flatIdx = flatPrList.indexOf(pr)}
                      <div data-vim-pr-item class={flatIdx === vimList.focusedIndex ? 'vim-focus' : ''}>
                        <ReviewPrCard
                          {pr}
                          selected={false}
                          onClick={() => selectPr(pr)}
                        />
                      </div>
                    {/each}
                  </div>
                </div>
              {/each}
            {/if}
          </div>
        </div>

        <!-- Right column: My Pull Requests -->
        <div class="flex-1 flex flex-col overflow-hidden">
          <div class="flex items-center justify-between px-5 py-3 bg-base-200/50 border-b border-base-300 shrink-0">
            <div class="flex items-center gap-2">
              <h3 class="text-sm font-semibold text-base-content m-0">My Pull Requests</h3>
              <span class="badge badge-primary badge-xs">{filteredAuthoredPrs.length}</span>
            </div>
            <button class="btn btn-xs btn-ghost text-base-content/50" onclick={refreshAuthoredPrs} disabled={isLoadingAuthored}>
              {isLoadingAuthored ? '⟳' : '↻'}
            </button>
          </div>

          <div class="flex-1 overflow-y-auto p-5 pb-8">
            {#if isLoadingAuthored && filteredAuthoredPrs.length === 0}
              <div class="flex flex-col items-center justify-center h-full gap-3 text-base-content/50 text-sm">
                <span class="loading loading-spinner loading-md text-primary"></span>
                <span>Loading PRs...</span>
              </div>
            {:else if authoredError}
              <div class="flex flex-col items-center justify-center h-full gap-3 text-error text-sm text-center p-5">
                <span class="text-5xl">⚠</span>
                <span>{authoredError}</span>
              </div>
            {:else if filteredAuthoredPrs.length === 0}
              <div class="flex flex-col items-center justify-center h-full gap-4 text-base-content/50 text-center">
                <span class="text-6xl">🚀</span>
                <h3 class="text-xl font-semibold text-base-content m-0">No open pull requests</h3>
                <p class="text-sm m-0">You don't have any open PRs right now.</p>
              </div>
            {:else}
              {#each [...groupedAuthoredPrs.entries()] as [repo, prs]}
                <div class="mb-6">
                  <h3 class="text-xs font-semibold text-base-content/50 m-0 mb-3 uppercase tracking-wider">{repo}</h3>
                  <div class="flex flex-col gap-3">
                    {#each prs as pr}
                      <AuthoredPrCard
                        {pr}
                        selected={false}
                        onClick={() => openUrl(pr.html_url)}
                      />
                    {/each}
                  </div>
                </div>
              {/each}
            {/if}
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

{#if showOutputModal && reviewSessionKey}
  <AgentReviewOutputModal
    sessionKey={reviewSessionKey}
    onClose={() => { showOutputModal = false }}
  />
{/if}
