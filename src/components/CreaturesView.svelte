<script lang="ts">
  import type { AgentSession, PullRequestInfo } from '../lib/types'
  import { tasks, activeSessions, ticketPrs } from '../lib/stores'
  import { computeCreatureState, computeCreatureRoom } from '../lib/creatureState'
  import { parseCheckpointQuestion } from '../lib/parseCheckpoint'
  import Creature from './Creature.svelte'
  import CreatureHoverCard from './CreatureHoverCard.svelte'
  import TaskContextMenu from './TaskContextMenu.svelte'

  interface Props {
    onCreatureClick: (taskId: string) => void
    onRunAction?: (data: { taskId: string; actionPrompt: string; agent: string | null }) => void
  }

  let { onCreatureClick, onRunAction }: Props = $props()

  let hoveredTaskId = $state<string | null>(null)
  let hoverRect = $state<DOMRect | null>(null)
  let hideTimer: ReturnType<typeof setTimeout> | null = null

  function getSession(taskId: string): AgentSession | null {
    return $activeSessions.get(taskId) ?? null
  }

  function getPrs(taskId: string): PullRequestInfo[] {
    return $ticketPrs.get(taskId) ?? []
  }

  let visibleTasks = $derived($tasks.filter(t => t.status !== 'done'))

  let forgeTasks = $derived(visibleTasks.filter(t => {
    const session = getSession(t.id)
    return computeCreatureRoom(t, session, getPrs(t.id)) === 'forge'
  }))

  let warRoomTasks = $derived(visibleTasks.filter(t => {
    const session = getSession(t.id)
    return computeCreatureRoom(t, session, getPrs(t.id)) === 'warRoom'
  }))

  let nurseryTasks = $derived(visibleTasks.filter(t => {
    const session = getSession(t.id)
    return computeCreatureRoom(t, session, getPrs(t.id)) === 'nursery'
  }))

  let hasCreatures = $derived(forgeTasks.length > 0 || warRoomTasks.length > 0 || nurseryTasks.length > 0)

  let hoveredTask = $derived(hoveredTaskId ? $tasks.find(t => t.id === hoveredTaskId) ?? null : null)
  let hoveredSession = $derived(hoveredTaskId ? getSession(hoveredTaskId) : null)
  let hoveredPrs = $derived(hoveredTaskId ? getPrs(hoveredTaskId) : [])
  let hoveredState = $derived(hoveredTask ? computeCreatureState(hoveredTask, hoveredSession, hoveredPrs) : null)
  let hoveredRoom = $derived(hoveredTask ? computeCreatureRoom(hoveredTask, hoveredSession, hoveredPrs) : null)

  let hoverPosition = $derived.by(() => {
    if (!hoverRect) return { x: 0, y: 0 }
    
    const CARD_WIDTH = 320
    const CARD_HEIGHT = 240
    const GAP = 12
    
    let x = hoverRect.right + GAP
    let y = hoverRect.top
    
    if (hoverRect.right + GAP + CARD_WIDTH > window.innerWidth) {
      x = hoverRect.left - CARD_WIDTH - GAP
    }
    
    if (hoverRect.top + CARD_HEIGHT > window.innerHeight) {
      y = window.innerHeight - CARD_HEIGHT - GAP
    }
    
    return { x, y }
  })

  let runningCount = $derived(forgeTasks.filter(t => {
    const s = getSession(t.id)
    return s?.status === 'running'
  }).length)

  let doneCount = $derived(forgeTasks.filter(t => {
    const s = getSession(t.id)
    return s?.status === 'completed'
  }).length)

  let ciFailedCount = $derived(warRoomTasks.filter(t => {
    return computeCreatureState(t, getSession(t.id), getPrs(t.id)) === 'ci-failed'
  }).length)

  let changesReqCount = $derived(warRoomTasks.filter(t => {
    return computeCreatureState(t, getSession(t.id), getPrs(t.id)) === 'changes-requested'
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

  let contextMenu = $state({ visible: false, x: 0, y: 0, taskId: '' })

  function handleContextMenu(event: MouseEvent, taskId: string) {
    event.preventDefault()
    contextMenu = { visible: true, x: event.clientX, y: event.clientY, taskId }
  }

  function closeContextMenu() {
    contextMenu = { ...contextMenu, visible: false }
  }
</script>


<div class="flex flex-col h-full flex-1 bg-base-300">
  {#if !hasCreatures}
    <div class="flex flex-1 items-center justify-center">
      <span class="font-mono text-sm text-base-content/40">No creatures yet</span>
    </div>
  {:else}
    <div class="flex flex-1 overflow-hidden">
      <div data-testid="room-nursery" class="w-56 shrink-0 flex flex-col border-r border-base-content/10 bg-base-200/50">
        <div class="px-4 pt-3 pb-2">
          <h3 class="font-mono text-xs font-bold tracking-widest text-base-content/60">THE NURSERY</h3>
          <p class="font-mono text-[9px] text-base-content/30">{nurseryTasks.length} tasks in backlog</p>
          <div class="border-b border-base-content/10 mt-2"></div>
        </div>
        <div data-testid="creature-list" class="flex flex-col gap-1 p-2 flex-1 overflow-y-auto">
          {#each nurseryTasks as task (task.id)}
            {@const session = getSession(task.id)}
            {@const state = computeCreatureState(task, session, getPrs(task.id))}
            {@const room = computeCreatureRoom(task, session, getPrs(task.id))}
            {@const questionText = parseCheckpointQuestion(session?.checkpoint_data ?? null)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div oncontextmenu={(e: MouseEvent) => handleContextMenu(e, task.id)}>
              <Creature {task} {state} {room} {questionText} onClick={onCreatureClick} onHover={handleHover} onHoverEnd={handleHoverEnd} onStart={onRunAction ? (taskId: string) => onRunAction({ taskId, actionPrompt: '', agent: null }) : undefined} />
            </div>
          {/each}
        </div>
      </div>

      <div data-testid="room-forge" class="flex-1 flex flex-col border-r border-base-content/10 bg-success/5">
        <div class="px-4 pt-3 pb-2">
          <h3 class="font-mono text-xs font-bold tracking-widest text-success">THE FORGE</h3>
          <p class="font-mono text-[9px] text-success/40">{forgeTasks.length} agents running</p>
          <div class="border-b border-success/20 mt-2"></div>
        </div>
        <div data-testid="creature-list" class="flex flex-col gap-1 p-2 flex-1 overflow-y-auto">
           {#each forgeTasks as task (task.id)}
             {@const session = getSession(task.id)}
             {@const state = computeCreatureState(task, session, getPrs(task.id))}
             {@const room = computeCreatureRoom(task, session, getPrs(task.id))}
             {@const questionText = parseCheckpointQuestion(session?.checkpoint_data ?? null)}
             <!-- svelte-ignore a11y_no_static_element_interactions -->
             <div oncontextmenu={(e: MouseEvent) => handleContextMenu(e, task.id)}>
               <Creature {task} {state} {room} {questionText} onClick={onCreatureClick} onHover={handleHover} onHoverEnd={handleHoverEnd} />
             </div>
           {/each}
         </div>
      </div>

      <div data-testid="room-warRoom" class="flex-1 flex flex-col bg-warning/5">
        <div class="px-4 pt-3 pb-2">
          <h3 class="font-mono text-xs font-bold tracking-widest text-warning">WAR ROOM</h3>
          <p class="font-mono text-[9px] text-warning/40">{warRoomTasks.length} tasks blocked</p>
          <div class="border-b border-warning/20 mt-2"></div>
        </div>
        <div data-testid="creature-list" class="flex flex-col gap-1 p-2 flex-1 overflow-y-auto">
          {#each warRoomTasks as task (task.id)}
            {@const session = getSession(task.id)}
            {@const state = computeCreatureState(task, session, getPrs(task.id))}
            {@const room = computeCreatureRoom(task, session, getPrs(task.id))}
            {@const questionText = parseCheckpointQuestion(session?.checkpoint_data ?? null)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div oncontextmenu={(e: MouseEvent) => handleContextMenu(e, task.id)}>
              <Creature {task} {state} {room} {questionText} onClick={onCreatureClick} onHover={handleHover} onHoverEnd={handleHoverEnd} />
            </div>
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
        <span class="w-2 h-2 bg-info rounded-sm"></span>
        <span class="font-mono text-[9px] text-base-content/60 font-semibold">DONE</span>
        <span class="font-mono text-[9px] text-base-content/40">({doneCount})</span>
      </div>
      <div class="flex items-center gap-1.5">
        <span class="w-2 h-2 bg-error rounded-sm"></span>
        <span class="font-mono text-[9px] text-base-content/60 font-semibold">CI FAILED</span>
        <span class="font-mono text-[9px] text-base-content/40">({ciFailedCount})</span>
      </div>
      <div class="flex items-center gap-1.5">
        <span class="w-2 h-2 bg-error/60 rounded-sm"></span>
        <span class="font-mono text-[9px] text-base-content/60 font-semibold">CHANGES REQ</span>
        <span class="font-mono text-[9px] text-base-content/40">({changesReqCount})</span>
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
       position={hoverPosition}
       onClose={closeCard}
       onCardEnter={cancelHide}
     />
   {/if}

  <TaskContextMenu
    visible={contextMenu.visible}
    x={contextMenu.x}
    y={contextMenu.y}
    taskId={contextMenu.taskId}
    onClose={closeContextMenu}
    onStart={onRunAction ? (taskId) => onRunAction({ taskId, actionPrompt: '', agent: null }) : undefined}
  />
</div>
