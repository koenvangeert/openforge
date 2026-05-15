<script lang="ts">
  import type { Task, TaskLabel } from '../../lib/types'
  import { tasks as allTasks, ticketPrs } from '../../lib/stores'
  import { addTaskLabel, removeTaskLabel } from '../../lib/ipc'
  import { getTaskLabels, hasLabelNamed } from '../../lib/taskLabels'
  import { getTaskDependentSummaries, getTaskDependencySummaries, getWaitingDependencyCount } from '../../lib/taskDependencies'
  import CopyButton from '../shared/ui/CopyButton.svelte'
  import TaskPromptSummary from './TaskPromptSummary.svelte'
  import TaskPullRequestStatus from './TaskPullRequestStatus.svelte'
  import TaskMergeStatus from './TaskMergeStatus.svelte'
  import TaskLabelEditor from '../shared/tasks/TaskLabelEditor.svelte'
  import TaskRelationshipDetailSection from '../shared/tasks/TaskRelationshipDetailSection.svelte'

  interface Props {
    task: Task
    workspacePath: string | null
  }

  let { task, workspacePath }: Props = $props()

  let labels = $state<TaskLabel[]>([])
  let previousTaskId: string | null = null
  let previousTaskLabelSignature = ''

  let taskPrs = $derived($ticketPrs.get(task.id) || [])
  let dependencies = $derived(getTaskDependencySummaries(task, $allTasks))
  let waitingDependencyCount = $derived(getWaitingDependencyCount(task, $allTasks))
  let dependents = $derived(getTaskDependentSummaries(task, $allTasks))

  function labelSignature(nextLabels: TaskLabel[]): string {
    return JSON.stringify(nextLabels.map((label) => [label.id, label.name, label.color]))
  }

  $effect(() => {
    const taskLabels = getTaskLabels(task)
    const nextTaskLabelSignature = labelSignature(taskLabels)
    if (task.id !== previousTaskId || nextTaskLabelSignature !== previousTaskLabelSignature) {
      previousTaskId = task.id
      previousTaskLabelSignature = nextTaskLabelSignature
      labels = taskLabels
    }
  })

  function replaceTaskLabelsInStore(nextLabels: TaskLabel[]) {
    allTasks.update((current) => current.map((storedTask) => {
      if (storedTask.id !== task.id) return storedTask
      return { ...storedTask, labels: nextLabels } as Task & { labels: TaskLabel[] }
    }))
  }

  async function handleAddLabel(labelOrName: TaskLabel | string) {
    if (hasLabelNamed(labels, typeof labelOrName === 'string' ? labelOrName : labelOrName.name)) return
    const label = typeof labelOrName === 'string'
      ? await addTaskLabel(task.id, labelOrName)
      : await addTaskLabel(task.id, labelOrName.name)
    labels = [...labels, label]
    replaceTaskLabelsInStore(labels)
  }

  async function handleRemoveLabel(label: TaskLabel) {
    await removeTaskLabel(task.id, label.id)
    labels = labels.filter((selected) => selected.id !== label.id)
    replaceTaskLabelsInStore(labels)
  }

</script>

<div class="flex flex-col gap-5 p-5 overflow-y-auto bg-base-200 h-full">
  <TaskPromptSummary {task} />

  <TaskLabelEditor
    projectId={task.project_id}
    selectedLabels={labels}
    onAdd={handleAddLabel}
    onRemove={handleRemoveLabel}
  />

  <TaskRelationshipDetailSection
    kind="dependencies"
    items={dependencies}
    {waitingDependencyCount}
    density="full"
  />

  <TaskRelationshipDetailSection
    kind="dependents"
    items={dependents}
    density="full"
  />

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
