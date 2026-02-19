<script lang="ts">
  import type { Task } from '../lib/types'
  import { selectedTaskId, activeSessions } from '../lib/stores'
  import { getWorktreeForTask } from '../lib/ipc'
  import AgentPanel from './AgentPanel.svelte'
  import TaskInfoPanel from './TaskInfoPanel.svelte'
  import SelfReviewView from './SelfReviewView.svelte'

  interface Props {
    task: Task
    onRunAction: (data: { taskId: string; actionPrompt: string; agent: string | null }) => void
  }

  let { task, onRunAction }: Props = $props()

  let reviewMode = $state(false)
  let hasWorktree = $state(false)

  let currentSession = $derived($activeSessions.get(task.id))
  let agentStatus = $derived(currentSession?.status ?? null)

  $effect(() => {
    const taskId = task.id
    reviewMode = false
    getWorktreeForTask(taskId).then((worktree) => {
      hasWorktree = worktree !== null
    })
  })

  function handleBack() {
    $selectedTaskId = null
  }

  function handleEscape(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      $selectedTaskId = null
    }
  }

  function handleSendToAgent(prompt: string) {
    onRunAction({ taskId: task.id, actionPrompt: prompt, agent: null })
  }

  function getStatusLabel(status: string): string {
    return status.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
  }
</script>

<svelte:window onkeydown={handleEscape} />

<div class="flex flex-col flex-1 h-full bg-base-100 overflow-hidden">
  <header class="flex flex-col gap-4 px-6 py-5 bg-base-200 border-b border-base-300 shrink-0">
    <button class="btn btn-ghost btn-sm gap-2 w-fit border border-base-300" onclick={handleBack}>
      <span class="text-lg leading-none">←</span>
      Back to Board
    </button>
    <div class="flex items-center gap-3">
      <span class="text-[0.8125rem] font-semibold text-base-content/50 font-mono">{task.jira_key || task.id}</span>
      <h1 class="text-2xl font-bold text-base-content m-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap min-w-0 max-[800px]:text-xl">{task.title}</h1>
      <span class="badge {task.status === 'doing' ? 'badge-success' : task.status === 'done' ? 'badge-primary' : 'badge-ghost'} uppercase tracking-wider text-xs font-semibold">
        {getStatusLabel(task.status)}
      </span>
      {#if hasWorktree}
        <div class="inline-flex items-center bg-base-300 border border-base-300 rounded-full p-0.5 gap-0.5 shrink-0">
          <button class="btn btn-ghost btn-xs rounded-full px-4 {!reviewMode ? 'btn-active bg-primary text-primary-content font-semibold' : ''}" onclick={() => reviewMode = false}>Code</button>
          <button class="btn btn-ghost btn-xs rounded-full px-4 {reviewMode ? 'btn-active bg-primary text-primary-content font-semibold' : ''}" onclick={() => reviewMode = true}>Review</button>
        </div>
      {/if}
    </div>
  </header>

  <div class="flex flex-1 overflow-hidden max-[800px]:flex-col">
    {#if reviewMode}
      <SelfReviewView {task} {agentStatus} onSendToAgent={handleSendToAgent} />
    {:else}
      <div class="basis-[70%] p-6 overflow-hidden max-[800px]:basis-auto max-[800px]:p-4">
        <AgentPanel taskId={task.id} />
      </div>
      <div class="w-px bg-base-300 shrink-0 max-[800px]:w-full max-[800px]:h-px"></div>
      <div class="basis-[30%] p-6 overflow-y-auto bg-base-200 max-[800px]:basis-auto max-[800px]:p-4">
        <TaskInfoPanel task={task} />
      </div>
    {/if}
  </div>
</div>
