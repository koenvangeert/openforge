interface TaskDialogAgentSelectorOptions {
  isEditing: boolean
  aiProvider: string | null
  availableAgents: readonly string[]
}

export function shouldLoadTaskDialogAgents(_aiProvider: string | null): boolean {
  return false
}

export function shouldShowTaskDialogAgentSelector(_options: TaskDialogAgentSelectorOptions): boolean {
  return false
}
