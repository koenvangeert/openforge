import { resetToBoard } from './router.svelte'
import { updateTaskStatus } from './ipc'
import { error } from './stores'

export interface MoveTaskToCompleteOptions {
  resetToBoard?: boolean
}

export async function moveTaskToComplete(
  taskId: string,
  options: MoveTaskToCompleteOptions = {},
): Promise<void> {
  if (options.resetToBoard ?? true) {
    resetToBoard()
  }

  void updateTaskStatus(taskId, 'done').catch((e) => {
    console.error('Failed to update task status:', e)
    error.set('Task completion may have succeeded, but background cleanup failed.')
  })
}
