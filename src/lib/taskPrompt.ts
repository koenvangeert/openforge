import type { Task } from './types'

export function getTaskPromptText(task: Pick<Task, 'initial_prompt' | 'prompt'>): string {
  return task.prompt || task.initial_prompt || ''
}
