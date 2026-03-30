interface TaskDialogAgentSelectorOptions {
  isEditing: boolean
  aiProvider: string | null
  availableAgents: readonly string[]
}

export function shouldLoadTaskDialogAgents(aiProvider: string | null): boolean {
  return aiProvider !== null && aiProvider !== 'claude-code'
}

export function shouldShowTaskDialogAgentSelector({
  isEditing,
  aiProvider,
  availableAgents,
}: TaskDialogAgentSelectorOptions): boolean {
  return !isEditing && shouldLoadTaskDialogAgents(aiProvider) && availableAgents.length > 0
}
