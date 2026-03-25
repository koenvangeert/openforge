<script lang="ts">
  import type { Task, AgentSession, PullRequestInfo } from '../lib/types'
  import type { TaskState } from '../lib/taskState'
  import { timeAgoFromSeconds } from '../lib/timeAgo'

  interface Props {
    task: Task
    state: TaskState
    session: AgentSession | null
    pullRequests: PullRequestInfo[]
    reasonText: string
    isSelected: boolean
    isFocused: boolean
    onSelect: () => void
    onContextMenu: (e: MouseEvent) => void
  }

  let { task, state, session, pullRequests, reasonText, isSelected, isFocused, onSelect, onContextMenu }: Props = $props()

  function truncate(text: string, max: number): string {
    return text.length > max ? text.slice(0, max) + '...' : text
  }

  function firstLine(text: string): string {
    return text.split('\n')[0]
  }

  function stateToBadgeClass(s: TaskState): string {
    switch (s) {
      case 'active': return 'badge-success'
      case 'needs-input': return 'badge-warning'
      case 'unaddressed-comments': return 'badge-warning'
      case 'ci-failed':
      case 'sad':
      case 'changes-requested': return 'badge-error'
      case 'celebrating': return 'badge-success'
      case 'ready-to-merge': return 'badge-info'
      case 'pr-queued': return 'badge-info'
      case 'egg': return 'badge-ghost'
      default: return ''
    }
  }

  function stateToLabel(s: TaskState): string {
    switch (s) {
      case 'active': return 'Active'
      case 'needs-input': return 'Needs Input'
      case 'unaddressed-comments': return 'Unaddressed Comments'
      case 'ci-failed': return 'CI Failed'
      case 'sad': return 'Failed'
      case 'changes-requested': return 'Changes Req.'
      case 'celebrating': return 'Done'
      case 'ready-to-merge': return 'Ready to Merge'
      case 'egg': return 'Backlog'
      case 'idle': return 'Idle'
      case 'resting': return 'Paused'
      case 'frozen': return 'Stopped'
      case 'pr-draft': return 'PR Draft'
      case 'pr-open': return 'PR Open'
      case 'ci-running': return 'CI Running'
      case 'review-pending': return 'Review Pending'
      case 'pr-queued': return 'Queued'
      case 'pr-merged': return 'Merged'
      default: return s
    }
  }

  let title = $derived(truncate(firstLine(task.jira_title ?? task.initial_prompt), 80))
  let badgeClass = $derived(stateToBadgeClass(state))
  let stateLabel = $derived(stateToLabel(state))
  let firstPr = $derived(pullRequests[0] ?? null)
</script>

<div
  role="button"
  tabindex="0"
  data-vim-item
  data-selected={isSelected ? 'true' : undefined}
  data-focused={isFocused ? 'true' : undefined}
  class:vim-focus={isFocused}
  class="{isSelected
    ? 'rounded-2xl bg-base-100 border border-base-300/70 shadow-sm p-4 gap-2.5'
    : 'rounded-2xl bg-base-100 border border-base-200 p-4 gap-2'} flex flex-col cursor-pointer w-full text-left"
  onclick={onSelect}
  oncontextmenu={onContextMenu}
  onkeydown={(e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect()
    }
  }}
>
  <div class="flex items-center gap-1.5">
    <span class="font-mono text-xs font-semibold text-primary">{task.id}</span>
    <span class="badge badge-xs {badgeClass}">{stateLabel}</span>
    <span class="font-mono text-xs text-base-content/50 ml-auto">{timeAgoFromSeconds(task.updated_at)}</span>
  </div>

  <div class="{isSelected ? 'text-lg font-semibold' : 'text-sm font-medium'} leading-snug text-base-content">
    {title}
  </div>

  {#if reasonText}
    <div class="text-xs text-base-content/60">{reasonText}</div>
  {/if}

  {#if firstPr}
    <div class="flex gap-1">
      <span class="font-mono text-[10px] font-medium px-1.5 py-px rounded text-primary bg-primary/10 border border-primary/20">
        PR #{firstPr.id}
      </span>
    </div>
  {/if}
</div>
