<script lang="ts">
  import { onMount } from 'svelte'
  import type { Task, Action } from '../lib/types'
  import { selectedTaskId, activeSessions, activeProjectId } from '../lib/stores'
  import { getWorktreeForTask, updateTaskStatus, openUrl, getConfig } from '../lib/ipc'
  import { navigateBack } from '../lib/navigation'
  import { loadActions, getEnabledActions } from '../lib/actions'
  import AgentPanel from './AgentPanel.svelte'
  import TaskInfoPanel from './TaskInfoPanel.svelte'
  import SelfReviewView from './SelfReviewView.svelte'

  interface Props {
    task: Task
    onRunAction: (data: { taskId: string; actionPrompt: string; agent: string | null }) => void
  }

  let { task, onRunAction }: Props = $props()

  let reviewMode = $state(false)
  let worktreePath = $state<string | null>(null)
  let jiraBaseUrl = $state('')
  // Plain variable (not $state) so it's not tracked as a reactive dependency.
  // Used to detect actual task changes vs. same-task prop re-renders.
  let lastTaskId = ''
  let actions = $state<Action[]>([])

  let currentSession = $derived($activeSessions.get(task.id))
  let agentStatus = $derived(currentSession?.status ?? null)
  let isSessionBusy = $derived(currentSession?.status === 'running' || currentSession?.status === 'paused')
  let busyReason = $derived(currentSession?.status === 'running' ? 'Agent is busy' : currentSession?.status === 'paused' ? 'Answer pending question first' : '')

  $effect(() => {
    const taskId = task.id
    if (taskId !== lastTaskId) {
      lastTaskId = taskId
      reviewMode = false
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
      if (newStatus === 'done') {
        $selectedTaskId = null
      }
    } catch (e) {
      console.error('Failed to update status:', e)
    }
  }

  function handleActionClick(action: Action) {
    onRunAction({ taskId: task.id, actionPrompt: action.prompt, agent: action.agent ?? null })
  }

  function handleSendToAgent(prompt: string) {
    onRunAction({ taskId: task.id, actionPrompt: prompt, agent: null })
  }

</script>

<div class="flex flex-col flex-1 h-full bg-base-100 overflow-hidden">
  <header class="flex flex-col bg-base-200 border-b border-base-300 shrink-0">
    <div class="flex items-center gap-3 px-6 py-3.5">
      <button class="btn btn-soft btn-sm gap-1.5 shrink-0 shadow-sm hover:shadow-md transition-shadow" onclick={handleBack}>
        <span class="text-base leading-none">←</span>
        Back
      </button>
      <span class="text-base-content/20 select-none">|</span>
      <span class="text-[0.8125rem] font-semibold text-base-content/50 font-mono shrink-0">{task.jira_key || task.id}</span>
      {#if task.jira_key && jiraBaseUrl}
        <button
          class="btn btn-ghost btn-xs px-1.5 min-h-0 h-auto text-primary hover:underline"
          onclick={() => openUrl(`${jiraBaseUrl}/browse/${task.jira_key}`)}
          title="Open in Jira"
        >↗</button>
      {/if}
      <h1 class="text-lg font-bold text-base-content m-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap min-w-0" title={task.title.split('\n')[0]}>{task.title.split('\n')[0]}</h1>
      {#if task.status !== 'done'}
        <button
          class="btn btn-success btn-sm shrink-0 shadow-sm hover:shadow-md transition-shadow"
          onclick={() => handleStatusChange('done')}
        >
          Move to Done
        </button>
      {/if}
      {#if actions.length > 0}
        <div class="flex gap-1.5 shrink-0">
          {#each actions as action (action.id)}
            <button
              class="btn btn-soft btn-sm shadow-sm hover:shadow-md hover:btn-primary transition-all duration-200"
              disabled={isSessionBusy}
              title={isSessionBusy ? busyReason : action.name}
              onclick={() => handleActionClick(action)}
            >
              {action.name}
            </button>
          {/each}
        </div>
      {/if}
    </div>
    <div class="text-sm text-base-content/50 truncate px-6 pb-3 -mt-1" data-testid="subtitle-row">
      {#if task.jira_title && task.jira_key}
        <button
          class="hover:text-primary transition-colors cursor-pointer text-left w-full truncate"
          title={task.jira_title}
          onclick={() => jiraBaseUrl && openUrl(`${jiraBaseUrl}/browse/${task.jira_key}`)}
        >{task.jira_title}</button>
      {:else}
        <span class="invisible">&#8203;</span>
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
          class="btn btn-ghost btn-xs {!reviewMode ? 'text-primary border border-primary' : 'text-base-content/50 border border-base-300'}"
          onclick={() => reviewMode = false}
        >code_view</button>
        <button
          class="btn btn-ghost btn-xs {reviewMode ? 'text-primary border border-primary' : 'text-base-content/50 border border-base-300'}"
          onclick={() => reviewMode = true}
        >review_view</button>
      </div>
    {/if}
  </div>

  <div class="flex flex-1 overflow-hidden max-[800px]:flex-col">
    {#if reviewMode}
      <SelfReviewView {task} {agentStatus} onSendToAgent={handleSendToAgent} />
    {:else}
      <div class="basis-[70%] p-5 overflow-hidden max-[800px]:basis-auto max-[800px]:p-4">
        <AgentPanel taskId={task.id} />
      </div>
      <div class="w-px bg-base-300 shrink-0 max-[800px]:w-full max-[800px]:h-px"></div>
      <div class="basis-[30%] overflow-y-auto bg-base-200 max-[800px]:basis-auto">
        <TaskInfoPanel task={task} {worktreePath} />
      </div>
    {/if}
  </div>
</div>
