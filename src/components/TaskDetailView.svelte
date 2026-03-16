<script lang="ts">
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import type { Task, Action } from '../lib/types'
  import { selectedTaskId, activeSessions, activeProjectId, startingTasks, taskReviewModes } from '../lib/stores'
  import { getWorktreeForTask, updateTaskStatus, getConfig } from '../lib/ipc'
  import { navigateBack } from '../lib/navigation'
  import { isInputFocused } from '../lib/domUtils'
  import { loadActions, getEnabledActions } from '../lib/actions'
  import { commandHeld } from '../lib/stores'
  import { focusTerminal } from '../lib/terminalPool'
  import { Maximize2, Minimize2 } from 'lucide-svelte'
  import AgentPanel from './AgentPanel.svelte'
  import TaskInfoPanel from './TaskInfoPanel.svelte'
  import ResizablePanel from './ResizablePanel.svelte'
  import SelfReviewView from './SelfReviewView.svelte'
  import TaskTerminal from './TaskTerminal.svelte'

  interface Props {
    task: Task
    onRunAction: (data: { taskId: string; actionPrompt: string; agent: string | null }) => void
  }

  let { task, onRunAction }: Props = $props()

  let reviewMode = $state(false)
  let rightPanelMode = $state<'info' | 'terminal'>('info')
  let terminalFullscreen = $state(false)
  let worktreePath = $state<string | null>(null)
  let jiraBaseUrl = $state('')
  // Plain variable (not $state) so it's not tracked as a reactive dependency.
  // Used to detect actual task changes vs. same-task prop re-renders.
  let lastTaskId = ''
  let actions = $state<Action[]>([])

  let displayTitle = $derived(task.initial_prompt || (task.prompt ? task.prompt.split('\n')[0] : '') || task.id)

  function setReviewMode(value: boolean) {
    reviewMode = value
    const updated = new Map(get(taskReviewModes) as Map<string, boolean>)
    updated.set(task.id, value)
    taskReviewModes.set(updated)
  }

  let currentSession = $derived($activeSessions.get(task.id))
  let agentStatus = $derived(currentSession?.status ?? null)
  let isStarting = $derived($startingTasks.has(task.id))

  $effect(() => {
    const taskId = task.id
    if (taskId !== lastTaskId) {
      lastTaskId = taskId
      reviewMode = (get(taskReviewModes) as Map<string, boolean>).get(taskId) ?? false
      rightPanelMode = 'info'
      terminalFullscreen = false
      worktreePath = null
      getWorktreeForTask(taskId).then((worktree) => {
        worktreePath = worktree?.worktree_path ?? null
      })
    }
  })

  $effect(() => {
    if ($activeProjectId) {
      loadActions($activeProjectId).then(a => { actions = getEnabledActions(a) })
    }
  })

  onMount(async () => {
    jiraBaseUrl = (await getConfig('jira_base_url')) || ''
  })

  function handleBack() {
    if (!navigateBack()) {
      $selectedTaskId = null
    }
  }

  async function handleStatusChange(newStatus: string) {
    if (newStatus === task.status) return
    try {
      await updateTaskStatus(task.id, newStatus)
    } catch (e) {
      console.error('Failed to update status:', e)
    }
  }

  function handleActionClick(action: Action) {
    onRunAction({ taskId: task.id, actionPrompt: action.prompt, agent: null })
  }

  function handleSendToAgent(prompt: string) {
    onRunAction({ taskId: task.id, actionPrompt: prompt, agent: null })
  }

  function handleTaskDetailKeydown(e: KeyboardEvent) {
    // Cmd+f toggles terminal fullscreen (works even when xterm has focus)
    if ((e.metaKey || e.ctrlKey) && e.key === 'f' && rightPanelMode === 'terminal' && worktreePath !== null) {
      e.preventDefault()
      terminalFullscreen = !terminalFullscreen
      return
    }

    // Cmd+number shortcuts work regardless of focus (even when terminal has focus)
    if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && worktreePath !== null) {
      if (e.key === '1') {
        e.preventDefault()
        setReviewMode(false)
        return
      }
      if (e.key === '2') {
        e.preventDefault()
        setReviewMode(true)
        return
      }
      if (e.key === 'i') {
        e.preventDefault()
        setReviewMode(false)
        terminalFullscreen = false
        rightPanelMode = 'info'
        return
      }
      if (e.key === 'j') {
        e.preventDefault()
        setReviewMode(false)
        terminalFullscreen = false
        rightPanelMode = 'terminal'
        return
      }
    }

    if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.key === 'e') {
      e.preventDefault()
      setReviewMode(false)
      terminalFullscreen = false
      focusTerminal(task.id)
      return
    }

    // Escape in fullscreen exits fullscreen (does not navigate back)
    if (e.key === 'Escape' && terminalFullscreen) {
      e.preventDefault()
      terminalFullscreen = false
      return
    }

    if (isInputFocused()) return
    if (e.metaKey || e.ctrlKey || e.altKey) return

    if (e.key === 'Escape' || e.key === 'q') {
      e.preventDefault()
      handleBack()
      return
    }
    // ] / [ switches between Info and Terminal panels (vim-style prev/next)
    if (e.key === ']' && worktreePath !== null) {
      e.preventDefault()
      rightPanelMode = 'terminal'
      return
    }
    if (e.key === '[' && worktreePath !== null) {
      e.preventDefault()
      rightPanelMode = 'info'
      terminalFullscreen = false
      return
    }
    if (e.key === 'h' && worktreePath !== null) {
      e.preventDefault()
      setReviewMode(false)
      return
    }
    if (e.key === 'l' && worktreePath !== null) {
      e.preventDefault()
      setReviewMode(true)
      return
    }
  }

</script>

<svelte:window onkeydown={handleTaskDetailKeydown} />

<div class="flex flex-col flex-1 h-full bg-base-100 overflow-hidden">
  <header class="flex flex-col border-b border-base-300 shrink-0" style="background-color: var(--project-bg-alt, oklch(var(--b2)))">
    <div class="flex items-center gap-3 px-6 py-3.5">
      <button class="btn btn-ghost btn-sm font-mono text-sm text-secondary border border-base-300 shrink-0 px-2.5 h-7" onclick={handleBack}>
        <span aria-hidden="true">&lt; </span><span>back</span>
      </button>
       <span class="text-base-content/20 select-none">|</span>
       <span class="text-[0.8125rem] font-semibold text-primary font-mono shrink-0">{task.jira_key || task.id}</span>
       <h1 class="text-lg font-bold text-base-content m-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap min-w-0" title={displayTitle}>{displayTitle}</h1>
      {#if task.status === 'backlog'}
        <button
          class="btn btn-primary btn-sm shrink-0 shadow-sm hover:shadow-md transition-shadow"
          disabled={isStarting}
          onclick={() => onRunAction({ taskId: task.id, actionPrompt: '', agent: null })}
        >
          {#if isStarting}
            <span class="loading loading-spinner loading-xs"></span>
            Starting...
          {:else}
            Start Task
          {/if}
        </button>
      {:else if task.status === 'doing'}
        <button
          class="btn btn-success btn-sm shrink-0 shadow-sm hover:shadow-md transition-shadow"
          onclick={() => handleStatusChange('done')}
        >
          Move to Done
        </button>
        {#if actions.length > 0}
          <div class="flex gap-1.5 shrink-0">
            {#each actions as action (action.id)}
              <button
                class="btn btn-soft btn-sm shadow-sm hover:shadow-md hover:btn-primary transition-all duration-200"
                disabled={isStarting}
                title={isStarting ? 'Task is starting' : (action.prompt || action.name)}
                onclick={() => handleActionClick(action)}
              >
                {action.name}
              </button>
            {/each}
          </div>
        {/if}
      {/if}
     </div>
   </header>

  <div class="flex items-center justify-between h-10 px-6 border-b border-base-300 shrink-0">
    <div class="flex items-center gap-1 font-mono text-xs">
      <span class="text-base-content/50">$ cd board</span>
      <span class="text-base-content/20 mx-1">/</span>
      <span class="text-base-content/50">{task.status}</span>
      <span class="text-base-content/20 mx-1">/</span>
      <span class="text-primary font-semibold">{task.jira_key || task.id}</span>
      <span class="text-base-content/20 mx-1">/</span>
      <span class="text-primary font-semibold">{reviewMode ? 'self_review' : 'code'}</span>
    </div>
    {#if worktreePath !== null}
      <div class="flex items-center gap-1">
       <button
           class="btn btn-ghost btn-xs gap-1.5 {!reviewMode ? 'text-primary border border-primary' : 'text-base-content/50 border border-base-300'}"
           onclick={() => setReviewMode(false)}
          >code_view {#if $commandHeld}<kbd class="kbd kbd-xs opacity-50">⌘1</kbd>{/if}</button>
         <button
           class="btn btn-ghost btn-xs gap-1.5 {reviewMode ? 'text-primary border border-primary' : 'text-base-content/50 border border-base-300'}"
           onclick={() => setReviewMode(true)}
          >review_view {#if $commandHeld}<kbd class="kbd kbd-xs opacity-50">⌘2</kbd>{/if}</button>
      </div>
    {/if}
  </div>

  <div class="flex flex-1 overflow-hidden max-[800px]:flex-col">
    {#if reviewMode}
      <SelfReviewView {task} {agentStatus} onSendToAgent={handleSendToAgent} />
    {:else if terminalFullscreen && worktreePath !== null}
      <div class="flex flex-col flex-1 overflow-hidden">
        <div class="flex items-center h-10 bg-base-200 border-b border-base-300 shrink-0 px-3">
          <span class="text-xs font-mono text-base-content/50 flex-1">Terminal — {task.jira_key || task.id}</span>
          <button
            class="btn btn-ghost btn-xs"
            aria-label="Exit fullscreen"
            onclick={() => terminalFullscreen = false}
          >
            <Minimize2 size={14} />
          </button>
        </div>
        <div class="flex-1 overflow-hidden">
          <TaskTerminal taskId={task.id} {worktreePath} />
        </div>
      </div>
    {:else}
       <div class="relative flex-1 p-5 overflow-hidden max-[800px]:p-4">
         {#key task.id}
            <AgentPanel taskId={task.id} {isStarting} />
          {/key}
         {#if $commandHeld}
           <kbd class="kbd kbd-xs absolute top-2 right-2 bg-base-content/10 text-base-content/40 border-base-content/20 text-[0.55rem] min-w-4 h-4 flex items-center justify-center pointer-events-none z-10">E</kbd>
         {/if}
       </div>
       <ResizablePanel storageKey="task-detail-sidebar" defaultWidth={360} minWidth={200} maxWidth={600} side="right">
         <div class="overflow-hidden bg-base-200 border-l border-base-300 flex flex-col h-full">
           {#if worktreePath !== null}
             <div class="flex items-center h-10 bg-base-200 border-b border-base-300 shrink-0 px-1">
              <button
                  class="relative flex items-center gap-1.5 h-full px-3.5 text-xs font-mono transition-colors {rightPanelMode === 'info' ? 'text-base-content font-semibold border-b-2 border-primary' : 'text-base-content/50'}"
                  onclick={() => rightPanelMode = 'info'}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                  Info
                  {#if $commandHeld}
                    <kbd class="kbd kbd-xs absolute -top-2 -right-1 bg-base-content/10 text-base-content/40 border-base-content/20 text-[0.55rem] min-w-4 h-4 flex items-center justify-center pointer-events-none">I</kbd>
                  {/if}
                </button>
                <button
                  class="relative flex items-center gap-1.5 h-full px-3.5 text-xs font-mono transition-colors {rightPanelMode === 'terminal' ? 'text-base-content font-semibold border-b-2 border-primary' : 'text-base-content/50'}"
                  onclick={() => rightPanelMode = 'terminal'}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>
                  Terminal
                  {#if $commandHeld}
                    <kbd class="kbd kbd-xs absolute -top-2 -right-1 bg-base-content/10 text-base-content/40 border-base-content/20 text-[0.55rem] min-w-4 h-4 flex items-center justify-center pointer-events-none">J</kbd>
                  {/if}
                </button>
               {#if rightPanelMode === 'terminal'}
                 <button
                   class="btn btn-ghost btn-xs ml-auto gap-1"
                   aria-label="Fullscreen terminal"
                   onclick={() => terminalFullscreen = true}
                 >
                   <Maximize2 size={14} />
                    {#if $commandHeld}<kbd class="kbd kbd-xs text-base-content/40">⌘F</kbd>{/if}
                 </button>
               {/if}
             </div>
           {/if}
           <div class="flex-1 overflow-y-auto">
             {#if rightPanelMode === 'terminal' && worktreePath !== null}
               <TaskTerminal taskId={task.id} {worktreePath} />
             {:else}
               <TaskInfoPanel task={task} {worktreePath} {jiraBaseUrl} />
             {/if}
           </div>
         </div>
       </ResizablePanel>
    {/if}
  </div>
</div>
