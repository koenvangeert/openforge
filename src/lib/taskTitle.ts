import type { Task } from './types'

export function getTaskTitle(task: Pick<Task, 'id' | 'initial_prompt' | 'prompt'>): string {
  for (const text of [task.initial_prompt, task.prompt]) {
    if (!text) continue
    const lines = text.split(/\r?\n/)
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed) {
        return trimmed
      }
    }
  }
  return task.id
}
