<script lang="ts">
  import { onMount } from 'svelte'
  import { reviewPrs, selectedReviewPr, prFileDiffs, reviewRequestCount, reviewComments, pendingManualComments } from '../lib/stores'
  import { fetchReviewPrs, getReviewPrs, getPrFileDiffs, openUrl, getReviewComments } from '../lib/ipc'
  import ReviewPrCard from './ReviewPrCard.svelte'
  import FileTree from './FileTree.svelte'
  import DiffViewer from './DiffViewer.svelte'
  import ReviewSubmitPanel from './ReviewSubmitPanel.svelte'
  import type { ReviewPullRequest } from '../lib/types'

  let isLoading = $state(false)
  let error = $state<string | null>(null)
  let diffViewer = $state<DiffViewer>()

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

  onMount(() => {
    loadPrs()
  })
</script>

<div class="pr-review-view">
  {#if $selectedReviewPr}
    <div class="detail-view">
      <div class="detail-header">
        <button class="back-btn" onclick={backToList}>
          ← Back to list
        </button>
        <div class="pr-info">
          <span class="repo-badge">{$selectedReviewPr.repo_owner}/{$selectedReviewPr.repo_name}</span>
          <h2 class="pr-title">{$selectedReviewPr.title}</h2>
          <div class="pr-meta">
            <span class="number">#{$selectedReviewPr.number}</span>
            <span class="separator">•</span>
            <span class="author">{$selectedReviewPr.user_login}</span>
            <span class="separator">•</span>
            <span class="time">{timeAgo($selectedReviewPr.created_at)}</span>
            <span class="separator">•</span>
            <span class="gh-link" role="link" tabindex="0" onclick={openPrOnGitHub} onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && openPrOnGitHub()}>View on GitHub ↗</span>
          </div>
        </div>
      </div>

      <div class="detail-content">
        {#if isLoading}
          <div class="loading">
            <div class="spinner"></div>
            <span>Loading diffs...</span>
          </div>
        {:else if error}
          <div class="error-state">
            <span class="error-icon">⚠</span>
            <span>{error}</span>
          </div>
        {:else}
          <FileTree files={$prFileDiffs} onSelectFile={handleFileSelect} />
          <DiffViewer 
            bind:this={diffViewer} 
            files={$prFileDiffs}
            existingComments={$reviewComments}
            repoOwner={$selectedReviewPr.repo_owner}
            repoName={$selectedReviewPr.repo_name}
          />
        {/if}
      </div>

      <ReviewSubmitPanel 
        repoOwner={$selectedReviewPr.repo_owner}
        repoName={$selectedReviewPr.repo_name}
        prNumber={$selectedReviewPr.number}
        commitId={$selectedReviewPr.head_sha}
      />
    </div>
  {:else}
    <div class="list-view">
      <div class="list-header">
        <div class="header-left">
          <h2 class="heading">PRs Requesting Your Review</h2>
          <span class="count">{$reviewPrs.length} {$reviewPrs.length === 1 ? 'PR' : 'PRs'}</span>
        </div>
        <button class="refresh-btn" onclick={refreshPrs} disabled={isLoading}>
          {isLoading ? '⟳' : '↻'} Refresh
        </button>
      </div>

      <div class="pr-list">
        {#if isLoading && $reviewPrs.length === 0}
          <div class="loading">
            <div class="spinner"></div>
            <span>Loading PRs...</span>
          </div>
        {:else if error}
          <div class="error-state">
            <span class="error-icon">⚠</span>
            <span>{error}</span>
          </div>
        {:else if $reviewPrs.length === 0}
          <div class="empty-state">
            <span class="empty-icon">✓</span>
            <h3>No PRs requesting your review</h3>
            <p>You're all caught up!</p>
          </div>
        {:else}
          {#each [...groupedPrs.entries()] as [repo, prs]}
            <div class="repo-group">
              <h3 class="repo-header">{repo}</h3>
              <div class="pr-cards">
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

<style>
  .pr-review-view {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .list-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .list-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 24px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .heading {
    font-size: 1.2rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  .count {
    padding: 4px 10px;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--accent);
    background: rgba(122, 162, 247, 0.15);
    border-radius: 12px;
  }

  .refresh-btn {
    all: unset;
    padding: 8px 16px;
    font-size: 0.8rem;
    color: var(--text-primary);
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .refresh-btn:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }

  .refresh-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .pr-list {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
  }

  .repo-group {
    margin-bottom: 32px;
  }

  .repo-header {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-secondary);
    margin: 0 0 12px 0;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .pr-cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
    gap: 16px;
  }

  .detail-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .detail-header {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 20px 24px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
  }

  .back-btn {
    all: unset;
    align-self: flex-start;
    padding: 6px 12px;
    font-size: 0.8rem;
    color: var(--text-secondary);
    cursor: pointer;
    transition: color 0.15s;
  }

  .back-btn:hover {
    color: var(--accent);
  }

  .pr-info {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .repo-badge {
    align-self: flex-start;
    padding: 4px 10px;
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--accent);
    background: rgba(122, 162, 247, 0.15);
    border-radius: 4px;
  }

  .pr-title {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
    line-height: 1.4;
  }

  .pr-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .number {
    font-weight: 600;
    color: var(--text-primary);
  }

  .separator {
    color: var(--border);
  }

  .author {
    font-weight: 500;
  }

  .gh-link {
    color: var(--accent);
    font-weight: 500;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .gh-link:hover {
    opacity: 0.8;
    text-decoration: underline;
  }

  .detail-content {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    gap: 12px;
    color: var(--text-secondary);
    font-size: 0.85rem;
  }

  .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 16px;
    color: var(--text-secondary);
    text-align: center;
  }

  .empty-icon {
    font-size: 4rem;
    color: var(--success);
  }

  .empty-state h3 {
    font-size: 1.2rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  .empty-state p {
    font-size: 0.9rem;
    margin: 0;
  }

  .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 12px;
    color: var(--error);
    font-size: 0.85rem;
    text-align: center;
    padding: 20px;
  }

  .error-icon {
    font-size: 3rem;
  }
</style>
