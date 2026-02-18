<script lang="ts">
  import type { ReviewPullRequest } from '../lib/types'

  interface Props {
    pr: ReviewPullRequest
    selected?: boolean
    onClick: () => void
  }

  let { pr, selected = false, onClick }: Props = $props()

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
</script>

<button class="pr-card" class:selected onclick={onClick}>
  <div class="header-row">
    <span class="repo-badge">{pr.repo_owner}/{pr.repo_name}</span>
    {#if pr.draft}
      <span class="draft-badge">Draft</span>
    {/if}
  </div>

  <div class="title-row">
    <h3 class="title">{pr.title}</h3>
  </div>

  <div class="meta-row">
    <span class="number">#{pr.number}</span>
    <span class="separator">•</span>
    <span class="author">{pr.user_login}</span>
    <span class="separator">•</span>
    <span class="time">{timeAgo(pr.created_at)}</span>
  </div>

  <div class="stats-row">
    <span class="stat">
      <span class="label">{pr.changed_files} {pr.changed_files === 1 ? 'file' : 'files'}</span>
    </span>
    <span class="separator">•</span>
    <span class="stat additions">+{pr.additions}</span>
    <span class="stat deletions">−{pr.deletions}</span>
  </div>
</button>

<style>
  .pr-card {
    all: unset;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .pr-card:hover {
    border-color: var(--accent);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  }

  .pr-card.selected {
    border-color: var(--accent);
    border-width: 2px;
    background: rgba(122, 162, 247, 0.1);
  }

  .header-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .repo-badge {
    padding: 4px 8px;
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--accent);
    background: rgba(122, 162, 247, 0.15);
    border-radius: 4px;
  }

  .draft-badge {
    padding: 4px 8px;
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--text-secondary);
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 4px;
  }

  .title-row {
    display: flex;
    align-items: flex-start;
  }

  .title {
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--text-primary);
    margin: 0;
    line-height: 1.4;
    text-align: left;
  }

  .meta-row {
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

  .stats-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.75rem;
  }

  .stat {
    font-weight: 500;
  }

  .label {
    color: var(--text-secondary);
  }

  .additions {
    color: var(--success);
  }

  .deletions {
    color: var(--error);
  }
</style>
