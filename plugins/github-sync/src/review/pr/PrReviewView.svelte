<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge/plugin-sdk/frontend'
  type UnlistenFn = () => void
  import { reviewPrs, selectedReviewPr, prFileDiffs, reviewRequestCount, reviewComments, pendingManualComments, prOverviewComments, agentReviewComments, authoredPrs, authoredPrCount, activeProjectId } from '../../lib/stores'
  import { getHTMLElementAt, isInputFocused } from '../../lib/domUtils'
  import { useVimNavigation } from '../../lib/useVimNavigation.svelte'
  import { timeAgoFromSeconds } from '../../lib/timeAgo'
  import ReviewPrCard from './ReviewPrCard.svelte'
  import AuthoredPrCard from './AuthoredPrCard.svelte'
  import FileTree from '../shared/FileTree.svelte'
  import ResizablePanel from '@openforge/plugin-sdk/ui/ResizablePanel.svelte'
  import DiffViewer from '../shared/diff-viewer/DiffViewer.svelte'
  import ProjectPageHeader from '../../project/ProjectPageHeader.svelte'
  import ReviewSubmitPanel from './ReviewSubmitPanel.svelte'
  import PrOverviewTab from './PrOverviewTab.svelte'
  import { hasMergeConflicts } from '@openforge/plugin-sdk/domain'
  import type { AgentReviewComment, ReviewComment, ReviewPullRequest, AuthoredPullRequest, PrFileDiff } from '@openforge/plugin-sdk/domain'
  import type { FileContents } from '../../lib/diffAdapter'

  type PrDetailTab = 'overview' | 'files'

  interface Props {
    api: FrontendOpenForgeAPI
    context: OpenForgeContextSnapshot
    projectName: string
    projectId?: string | null
  }

  let { api, context: _context, projectName, projectId = null }: Props = $props()

  $effect(() => {
    $activeProjectId = projectId
  })

  let isLoading = $state(false)
  let isLoadingAuthored = $state(false)
  let error = $state<string | null>(null)
  let authoredError = $state<string | null>(null)
  let diffViewer = $state<DiffViewer>()
  let fileTreeVisible = $state(true)
  let activeTab = $state<PrDetailTab>('overview')
  let unlisteners: UnlistenFn[] = []

  function listenGlobal<TPayload>(event: string, handler: (payload: TPayload) => void): UnlistenFn {
    const subscription = api.events.onGlobal(event, handler)
    return () => { void subscription.dispose() }
  }

  // Repo filtering
  let excludedRepos = $state<Set<string>>(new Set())
  let showFilterDropdown = $state(false)

  // Load excluded repos when project changes
  $effect(() => {
    const pid = $activeProjectId
    if (pid) {
      api.projectConfig.get<string>('pr_excluded_repos', pid).then((val) => {
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
      await api.projectConfig.set('pr_excluded_repos', JSON.stringify(arr), $activeProjectId)
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
      const prs = await api.commands.invokeGlobal<ReviewPullRequest[]>('openforge.getReviewPrs')
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
      const prs = await api.commands.invokeGlobal<ReviewPullRequest[]>('openforge.fetchReviewPrs')
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
      const prs = await api.commands.invokeGlobal<ReviewPullRequest[]>('openforge.getReviewPrs')
      $reviewPrs = prs
    } catch (e) {
      console.error('Failed to silently refresh PRs:', e)
    }
  }

  async function loadAuthoredPrs() {
    isLoadingAuthored = true
    authoredError = null
    try {
      const prs = await api.commands.invokeGlobal<AuthoredPullRequest[]>('openforge.getAuthoredPrs')
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
      const prs = await api.commands.invokeGlobal<AuthoredPullRequest[]>('openforge.fetchAuthoredPrs')
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
      const prs = await api.commands.invokeGlobal<AuthoredPullRequest[]>('openforge.getAuthoredPrs')
      $authoredPrs = prs
    } catch (e) {
      console.error('Failed to silently refresh authored PRs:', e)
    }
  }

  async function selectPr(pr: ReviewPullRequest) {
    void api.commands.invokeGlobal('openforge.navigate', { currentView: 'plugin:com.openforge.github-sync:pr_review' })
    const now = Math.floor(Date.now() / 1000)
    const updatedPr = { ...pr, viewed_at: now, viewed_head_sha: pr.head_sha }
    $selectedReviewPr = updatedPr
    $reviewPrs = $reviewPrs.map(p => p.id === pr.id ? updatedPr : p)
    api.commands.invokeGlobal('openforge.markReviewPrViewed', { prId: pr.id, headSha: pr.head_sha }).catch(e => console.error('Failed to mark viewed:', e))
    isLoading = true
    try {
      const diffs = await api.commands.invokeGlobal<PrFileDiff[]>('openforge.getPrFileDiffs', {
        owner: pr.repo_owner,
        repo: pr.repo_name,
        prNumber: pr.number,
      })
      $prFileDiffs = diffs
      const comments = await api.commands.invokeGlobal<ReviewComment[]>('openforge.getReviewComments', {
        owner: pr.repo_owner,
        repo: pr.repo_name,
        prNumber: pr.number,
      })
      $reviewComments = comments
      const agentComments = await api.commands.invokeGlobal<AgentReviewComment[]>('openforge.getAgentReviewComments', { reviewPrId: pr.id })
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
    activeTab = 'overview'
  }

  function handleFileSelect(filename: string) {
    if (diffViewer) {
      diffViewer.scrollToFile(filename)
    }
  }

  function openPrOnGitHub() {
    if ($selectedReviewPr) {
      api.system.openUrl($selectedReviewPr.html_url)
    }
  }


  async function fetchPrFileContents(file: PrFileDiff): Promise<FileContents> {
    const pr = $selectedReviewPr!
    let oldContent = ''
    let newContent = ''

    if (file.status !== 'removed' && file.sha) {
      try {
        newContent = await api.commands.invokeGlobal<string>('openforge.getFileContent', {
          owner: pr.repo_owner,
          repo: pr.repo_name,
          sha: file.sha,
        })
      } catch { /* file may not exist */ }
    }

    if (file.status !== 'added') {
      const oldPath = file.previous_filename || file.filename
      try {
        oldContent = await api.commands.invokeGlobal<string>('openforge.getFileAtRef', {
          owner: pr.repo_owner,
          repo: pr.repo_name,
          path: oldPath,
          refSha: pr.base_ref,
        })
      } catch { /* file may not exist on base */ }
    }

    return { oldContent, newContent }
  }

  onMount(async () => {
    loadPrs()
    loadAuthoredPrs()
    unlisteners.push(
      listenGlobal('openforge.authored-prs-updated', () => {
        silentRefreshAuthoredPrs()
      })
    )
    unlisteners.push(
      listenGlobal('openforge.review-pr-count-changed', () => {
        silentRefreshPrs()
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

<div class="flex flex-col w-full h-full min-h-0 overflow-hidden">
  {#if $selectedReviewPr}
    <div class="flex flex-col h-full min-h-0 overflow-hidden">
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
        <PrOverviewTab {api} context={_context} pr={$selectedReviewPr} />
      {:else}
        <div class="flex flex-1 min-h-0 overflow-hidden">
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
              {api}
              files={$prFileDiffs}
              existingComments={$reviewComments}
              repoOwner={$selectedReviewPr.repo_owner}
              repoName={$selectedReviewPr.repo_name}
              {fileTreeVisible}
              onToggleFileTree={() => { fileTreeVisible = !fileTreeVisible }}
              fetchFileContents={fetchPrFileContents}
              agentComments={$agentReviewComments}
            />
          {/if}
        </div>

        <ReviewSubmitPanel
          {api}
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
                        onClick={() => api.system.openUrl(pr.html_url)}
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
