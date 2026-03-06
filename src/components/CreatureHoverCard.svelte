<script lang="ts">
  import type { Task, AgentSession } from '../lib/types'
  import type { CreatureState, CreatureRoom } from '../lib/creatureState'
  import { ticketPrs } from '../lib/stores'
  import { User, GitPullRequest, Timer, Bot, MousePointerClick } from 'lucide-svelte'

  interface Props {
    task: Task
    session: AgentSession | null
    state: CreatureState
    room: CreatureRoom
    position: { x: number; y: number }
    onClose: () => void
    onCardEnter: () => void
  }

  let { task, session, state, room, position, onClose, onCardEnter }: Props = $props()

  function formatDuration(startMs: number): string {
    const diffMs = Date.now() - startMs
    const hours = Math.floor(diffMs / 3600000)
    const minutes = Math.floor((diffMs % 3600000) / 60000)
    if (hours > 0) return `${hours}h ${minutes}m`
    return `${minutes}m`
  }

  let statusLabel = $derived(
    state === 'active' ? 'RUNNING' :
    state === 'needs-input' ? 'BLOCKED' :
    state === 'resting' ? 'PAUSED' :
    state === 'sad' ? 'FAILED' :
    state === 'frozen' ? 'INTERRUPTED' :
    state === 'celebrating' ? 'DONE' :
    'IDLE'
  )

  let badgeColor = $derived(
    room === 'forge' ? 'bg-success/20 text-success' :
    room === 'warRoom' ? 'bg-warning/20 text-warning' :
    'bg-base-content/10 text-base-content/40'
  )

  let borderColor = $derived(
    room === 'forge' ? 'border-success' :
    room === 'warRoom' ? 'border-warning' :
    'border-base-content/30'
  )

  let agentStatusText = $derived(
    !session ? 'no agent' :
    session.status === 'running' ? 'agent implementing...' :
    session.status === 'paused' ? 'agent paused' :
    session.status === 'failed' ? 'agent failed' :
    session.status === 'completed' ? 'agent done' :
    'agent idle'
  )

  let prs = $derived($ticketPrs.get(task.id) ?? [])

  let prDisplay = $derived(
    prs.length === 0 ? 'no PR' :
    `#${prs[0].id} ${prs[0].state}` + (prs[0].ci_status ? ` · CI: ${prs[0].ci_status}` : '')
  )

  let runningTime = $derived(
    session?.created_at ? formatDuration(session.created_at) : 'idle'
  )

  let cardStyle = $derived(`position: fixed; left: ${position.x}px; top: ${position.y}px; z-index: 50;`)

  let taskIdColor = $derived(
    room === 'forge' ? 'text-success' :
    room === 'warRoom' ? 'text-warning' :
    'text-base-content/60'
  )
</script>

<div
  style={cardStyle}
  class="w-[320px] bg-base-200 border-2 {borderColor} rounded shadow-xl"
  onmouseenter={onCardEnter}
  onmouseleave={onClose}
  role="tooltip"
>
  <div class="p-4 flex flex-col gap-2.5">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="font-mono text-sm font-bold {taskIdColor}">{task.id}</span>
        <div class="flex items-center gap-1 px-2 py-0.5 rounded-sm {badgeColor} border border-current/20">
          <span class="w-1.5 h-1.5 rounded-full bg-current"></span>
          <span class="font-mono text-[8px] font-bold uppercase tracking-wider">{statusLabel}</span>
        </div>
      </div>
    </div>

    <div class="font-mono text-xs font-semibold text-base-content leading-snug">
      {task.title}
    </div>

    <div class="border-t border-base-content/20"></div>

    <div class="flex flex-col gap-1.5">
      <div class="flex items-center gap-1.5">
        <Bot size={12} class="text-base-content/60 shrink-0" />
        <span class="font-mono text-[10px] text-base-content/70">{agentStatusText}</span>
      </div>
      <div class="flex items-center gap-1.5">
        <GitPullRequest size={12} class="text-base-content/60 shrink-0" />
        <span class="font-mono text-[10px] {prs.length > 0 ? 'text-success' : 'text-base-content/70'}">{prDisplay}</span>
      </div>
      <div class="flex items-center gap-1.5">
        <User size={12} class="text-base-content/60 shrink-0" />
        <span class="font-mono text-[10px] text-base-content/70">{task.jira_assignee ? `@${task.jira_assignee}` : 'unassigned'}</span>
      </div>
      <div class="flex items-center gap-1.5">
        <Timer size={12} class="text-base-content/60 shrink-0" />
        <span class="font-mono text-[10px] text-base-content/70">{runningTime}</span>
      </div>
    </div>

    <div class="border-t border-base-content/20"></div>

    <div class="flex items-center justify-center gap-1.5">
      <MousePointerClick size={12} class="text-base-content/50" />
      <span class="font-mono text-[9px] text-base-content/50">click to view task details</span>
    </div>
  </div>
</div>
