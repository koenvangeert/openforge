<script lang="ts">
  import type { AgentSession } from '../lib/types'
  import { tasks, activeSessions } from '../lib/stores'
  import { computeCreatureState, computeCreatureRoom } from '../lib/creatureState'
  import { parseCheckpointQuestion } from '../lib/parseCheckpoint'
  import Creature from './Creature.svelte'
  import CreatureHoverCard from './CreatureHoverCard.svelte'

  interface Props {
    onCreatureClick: (taskId: string) => void
  }

  let { onCreatureClick }: Props = $props()

  let hoveredTaskId = $state<string | null>(null)
  let hoverRect = $state<DOMRect | null>(null)
  let hideTimer: ReturnType<typeof setTimeout> | null = null

  function getSession(taskId: string): AgentSession | null {
    return $activeSessions.get(taskId) ?? null
  }

  let visibleTasks = $derived($tasks.filter(t => t.status !== 'done'))

  let forgeTasks = $derived(visibleTasks.filter(t => {
    const session = getSession(t.id)
    return computeCreatureRoom(t, session) === 'forge'
  }))

  let warRoomTasks = $derived(visibleTasks.filter(t => {
    const session = getSession(t.id)
    return computeCreatureRoom(t, session) === 'warRoom'
  }))

  let nurseryTasks = $derived(visibleTasks.filter(t => {
    const session = getSession(t.id)
    return computeCreatureRoom(t, session) === 'nursery'
  }))

  let hasCreatures = $derived(forgeTasks.length > 0 || warRoomTasks.length > 0 || nurseryTasks.length > 0)

  let hoveredTask = $derived(hoveredTaskId ? $tasks.find(t => t.id === hoveredTaskId) ?? null : null)
  let hoveredSession = $derived(hoveredTaskId ? getSession(hoveredTaskId) : null)
  let hoveredState = $derived(hoveredTask ? computeCreatureState(hoveredTask, hoveredSession) : null)
  let hoveredRoom = $derived(hoveredTask ? computeCreatureRoom(hoveredTask, hoveredSession) : null)

  let runningCount = $derived(forgeTasks.filter(t => {
    const s = getSession(t.id)
    return s?.status === 'running'
  }).length)

  let blockedCount = $derived(warRoomTasks.length)
  let backlogCount = $derived(nurseryTasks.length)

  function handleHover(taskId: string, rect: DOMRect) {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
    hoveredTaskId = taskId
    hoverRect = rect
  }

  function handleHoverEnd() {
    hideTimer = setTimeout(() => {
      hoveredTaskId = null
      hoverRect = null
    }, 150)
  }

  function cancelHide() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
  }

  function closeCard() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
    hoveredTaskId = null
    hoverRect = null
  }
</script>

<div class="flex flex-col h-full flex-1 bg-base-300">
  {#if !hasCreatures}
    <div class="flex flex-1 items-center justify-center">
      <span class="font-mono text-sm text-base-content/40">No creatures yet</span>
    </div>
  {:else}
    <div class="flex flex-1 overflow-hidden">
      <div data-testid="room-forge" class="flex-1 flex flex-col border-r border-base-content/10 bg-success/5">
        <div class="px-4 pt-3 pb-2">
          <h3 class="font-mono text-xs font-bold tracking-widest text-success">THE FORGE</h3>
          <p class="font-mono text-[9px] text-success/40">{forgeTasks.length} agents running</p>
          <div class="border-b border-success/20 mt-2"></div>
        </div>
        <div class="flex flex-wrap gap-4 p-4 items-start content-start flex-1 overflow-y-auto">
          {#each forgeTasks as task (task.id)}
            {@const session = getSession(task.id)}
            {@const state = computeCreatureState(task, session)}
            {@const room = computeCreatureRoom(task, session)}
            {@const questionText = parseCheckpointQuestion(session?.checkpoint_data ?? null)}
            <Creature {task} {state} {room} {questionText} onClick={onCreatureClick} onHover={handleHover} onHoverEnd={handleHoverEnd} />
          {/each}
        </div>
      </div>

      <div data-testid="room-warRoom" class="flex-1 flex flex-col border-r border-base-content/10 bg-warning/5">
        <div class="px-4 pt-3 pb-2">
          <h3 class="font-mono text-xs font-bold tracking-widest text-warning">WAR ROOM</h3>
          <p class="font-mono text-[9px] text-warning/40">{warRoomTasks.length} tasks blocked</p>
          <div class="border-b border-warning/20 mt-2"></div>
        </div>
        <div class="flex flex-wrap gap-4 p-4 items-start content-start flex-1 overflow-y-auto">
          {#each warRoomTasks as task (task.id)}
            {@const session = getSession(task.id)}
            {@const state = computeCreatureState(task, session)}
            {@const room = computeCreatureRoom(task, session)}
            {@const questionText = parseCheckpointQuestion(session?.checkpoint_data ?? null)}
            <Creature {task} {state} {room} {questionText} onClick={onCreatureClick} onHover={handleHover} onHoverEnd={handleHoverEnd} />
          {/each}
        </div>
      </div>

      <div data-testid="room-nursery" class="flex-1 flex flex-col bg-base-200/50">
        <div class="px-4 pt-3 pb-2">
          <h3 class="font-mono text-xs font-bold tracking-widest text-base-content/60">THE NURSERY</h3>
          <p class="font-mono text-[9px] text-base-content/30">{nurseryTasks.length} tasks in backlog</p>
          <div class="border-b border-base-content/10 mt-2"></div>
        </div>
        <div class="flex flex-wrap gap-4 p-4 items-start content-start flex-1 overflow-y-auto">
          {#each nurseryTasks as task (task.id)}
            {@const session = getSession(task.id)}
            {@const state = computeCreatureState(task, session)}
            {@const room = computeCreatureRoom(task, session)}
            {@const questionText = parseCheckpointQuestion(session?.checkpoint_data ?? null)}
            <Creature {task} {state} {room} {questionText} onClick={onCreatureClick} onHover={handleHover} onHoverEnd={handleHoverEnd} />
          {/each}
        </div>
      </div>
    </div>

    <div data-testid="legend-bar" class="flex items-center gap-8 px-4 h-7 border-t border-base-content/10 bg-base-300 shrink-0">
      <div class="flex items-center gap-1.5">
        <span class="w-2 h-2 bg-success rounded-sm"></span>
        <span class="font-mono text-[9px] text-base-content/60 font-semibold">RUNNING</span>
        <span class="font-mono text-[9px] text-base-content/40">({runningCount})</span>
      </div>
      <div class="flex items-center gap-1.5">
        <span class="w-2 h-2 bg-warning rounded-sm"></span>
        <span class="font-mono text-[9px] text-base-content/60 font-semibold">BLOCKED</span>
        <span class="font-mono text-[9px] text-base-content/40">({blockedCount})</span>
      </div>
      <div class="flex items-center gap-1.5">
        <span class="w-2 h-2 bg-base-content/30 rounded-sm"></span>
        <span class="font-mono text-[9px] text-base-content/60 font-semibold">BACKLOG</span>
        <span class="font-mono text-[9px] text-base-content/40">({backlogCount})</span>
      </div>
      <span class="font-mono text-[8px] text-base-content/30 italic ml-auto">click any creature to view task details</span>
    </div>
  {/if}

  {#if hoveredTaskId && hoveredTask && hoveredState && hoveredRoom && hoverRect}
    <CreatureHoverCard
      task={hoveredTask}
      session={hoveredSession}
      state={hoveredState}
      room={hoveredRoom}
      position={{ x: hoverRect.right + 12, y: hoverRect.top }}
      onClose={closeCard}
      onCardEnter={cancelHide}
    />
  {/if}
</div>
