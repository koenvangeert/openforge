<script lang="ts">
  import type { BoardStatus, Task } from '../../lib/types'
  import { tasks as allTasks, ticketPrs } from '../../lib/stores'
  import CopyButton from '../shared/ui/CopyButton.svelte'
  import TaskPromptSummary from './TaskPromptSummary.svelte'
  import TaskPullRequestStatus from './TaskPullRequestStatus.svelte'
  import TaskMergeStatus from './TaskMergeStatus.svelte'

  interface Props {
    task: Task
    workspacePath: string | null
  }

  let { task, workspacePath }: Props = $props()

  let taskPrs = $derived($ticketPrs.get(task.id) || [])
  let tasksById = $derived(new Map($allTasks.map((knownTask) => [knownTask.id, knownTask])))
  let dependencies = $derived(task.depends_on.map((dependencyId) => {
    const dependencyTask = tasksById.get(dependencyId)
    return {
      id: dependencyId,
      status: dependencyTask?.status ?? null,
      title: dependencyTask?.initial_prompt || dependencyTask?.summary || dependencyId,
    }
  }))
  let waitingDependencyCount = $derived(dependencies.filter((dependency) => dependency.status !== 'done').length)

  function dependencyStatusLabel(status: BoardStatus | null): string {
    return status ?? 'unknown'
  }

  function dependencyStatusClass(status: BoardStatus | null): string {
    if (status === 'done') return 'badge-success'
    if (status === 'doing') return 'badge-warning'
    if (status === 'backlog') return 'badge-ghost'
    return 'badge-neutral'
  }
</script>

<div class="flex flex-col gap-5 p-5 overflow-y-auto bg-base-200 h-full">
  <TaskPromptSummary {task} />

  {#if dependencies.length > 0}
    <section class="flex flex-col gap-2.5" aria-label="Dependencies" aria-live="polite">
      <h3 class="text-[10px] font-bold text-primary font-mono tracking-[1.2px] m-0">// DEPENDS_ON</h3>
      <div class="flex flex-wrap gap-2">
        {#each dependencies as dependency (dependency.id)}
          <span class="badge badge-sm gap-1.5 border border-base-300 {dependencyStatusClass(dependency.status)}" title={dependency.title}>
            <span class="font-mono">{dependency.id}</span>
            <span class="opacity-80">{dependencyStatusLabel(dependency.status)}</span>
          </span>
        {/each}
      </div>
      <div class="text-[11px] text-base-content/50">
        {#if waitingDependencyCount === 0}
          All dependencies done
        {:else}
          Waiting on {waitingDependencyCount} {waitingDependencyCount === 1 ? 'dependency' : 'dependencies'}
        {/if}
      </div>
    </section>
  {/if}

  {#if workspacePath}
    <section class="flex flex-col gap-2.5">
      <h3 class="text-[10px] font-bold text-primary font-mono tracking-[1.2px] m-0" aria-label="Workspace">// WORKSPACE</h3>
      <div class="flex items-center gap-2 bg-base-100 border border-base-300 rounded-md px-3 py-2">
        <span class="text-xs font-mono text-base-content/70 truncate flex-1" title={workspacePath}>{workspacePath}</span>
        <CopyButton text={workspacePath} label="Copy workspace path" />
      </div>
    </section>
  {/if}

  <TaskMergeStatus {task} {taskPrs} />

  <TaskPullRequestStatus {taskPrs} />

 </div>
