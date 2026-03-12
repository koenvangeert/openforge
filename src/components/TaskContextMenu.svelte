<script lang="ts">
  import type { KanbanColumn } from '../lib/types'
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
  }

  let { visible, x, y, taskId, onClose, onStart, onDelete }: Props = $props()

  let taskStatus = $derived(($tasks.find(t => t.id === taskId)?.status ?? '') as KanbanColumn | '')

  function handleStart() {
    onClose()
    onStart?.(taskId)
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
  {#if taskStatus === 'doing'}
    <ContextMenuItem label="Move to Done" onclick={handleMoveToDone} />
  {/if}
  <ContextMenuItem label="Delete" variant="danger" onclick={handleDelete} />
</ContextMenu>
