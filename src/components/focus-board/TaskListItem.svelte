<script lang="ts">
  import type { Task, AgentSession, PullRequestInfo } from '../../lib/types'
  import type { TaskState } from '../../lib/taskState'
  import { getStateDrivingPr } from '../../lib/taskState'
  import { TASK_STATE_COMPACT_LABELS, getTaskStateBadgeClass } from '../../lib/taskStatePresentation'
  import { timeAgoFromSeconds } from '../../lib/timeAgo'
  import { getTaskTitle } from '../../lib/taskTitle'

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
  let title = $derived(truncate(getTaskTitle(task), 80))
  let badgeClass = $derived(getTaskStateBadgeClass(state))
  let stateLabel = $derived(TASK_STATE_COMPACT_LABELS[state] ?? state)
  let firstPr = $derived(getStateDrivingPr(pullRequests))
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
    <div class="text-xs text-base-content/60 truncate">{reasonText}</div>
  {/if}

  {#if firstPr}
    <div class="flex gap-1">
      <span class="font-mono text-[10px] font-medium px-1.5 py-px rounded text-primary bg-primary/10 border border-primary/20">
        PR #{firstPr.id}
      </span>
    </div>
  {/if}
</div>
