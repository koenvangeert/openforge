<script lang="ts">
  import type { Task } from '../../lib/types'
  import { ticketPrs } from '../../lib/stores'
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
</script>

<div class="flex flex-col gap-5 p-5 overflow-y-auto bg-base-200 h-full">
  <TaskPromptSummary {task} />

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
