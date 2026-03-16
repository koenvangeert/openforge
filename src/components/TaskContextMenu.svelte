<script lang="ts">
  import type { KanbanColumn, Action } from '../lib/types'
  import { tasks, error } from '../lib/stores'
  import { updateTaskStatus, deleteTask } from '../lib/ipc'
  import ContextMenu from './ContextMenu.svelte'
  import ContextMenuItem from './ContextMenuItem.svelte'

  interface Props {
    visible: boolean
    x: number
    y: number
    taskId: string
    onClose: () => void
    onStart?: (taskId: string) => void
    onDelete?: (taskId: string) => void
    actions?: Action[]
    onRunAction?: (data: { taskId: string; actionPrompt: string; agent: string | null }) => void
  }

  let { visible, x, y, taskId, onClose, onStart, onDelete, actions = [], onRunAction }: Props = $props()

  let taskStatus = $derived(($tasks.find(t => t.id === taskId)?.status ?? '') as KanbanColumn | '')

  function handleStart() {
    onClose()
    onStart?.(taskId)
  }

  function handleRunAction(action: Action) {
    const id = taskId
    onClose()
    onRunAction?.({ taskId: id, actionPrompt: action.prompt, agent: null })
  }

  async function handleMoveToDone() {
    const id = taskId
    onClose()
    try {
      await updateTaskStatus(id, 'done')
    } catch (err: unknown) {
      console.error('Failed to move task:', err)
      $error = String(err)
    }
  }

  async function handleDelete() {
    const id = taskId
    onClose()
    try {
      await deleteTask(id)
      onDelete?.(id)
    } catch (err: unknown) {
      console.error('Failed to delete task:', err)
      $error = String(err)
    }
  }
</script>

<ContextMenu {visible} {x} {y} {onClose}>
  {#if taskStatus === 'backlog' && onStart}
    <ContextMenuItem label="Start Task" variant="primary" onclick={handleStart} />
  {/if}
  {#if taskStatus === 'backlog' && actions.length > 0 && onRunAction}
    <div class="border-t border-base-content/10 my-1"></div>
    {#each actions as action (action.id)}
      <ContextMenuItem label={action.name} description={action.prompt} onclick={() => handleRunAction(action)} />
    {/each}
  {/if}
  {#if taskStatus === 'doing'}
    <ContextMenuItem label="Move to Done" onclick={handleMoveToDone} />
  {/if}
  <div class="border-t border-base-content/10 my-1"></div>
  <ContextMenuItem label="Delete" variant="danger" onclick={handleDelete} />
</ContextMenu>
