export interface TerminalTaskPaneController {
  addTab(): void
  closeActiveTab(): Promise<void>
  focusActiveTab(): void
  switchToTab(tabIndex: number): void
}

const controllers = new Map<string, TerminalTaskPaneController>()

export function registerTerminalTaskPaneController(taskId: string, controller: TerminalTaskPaneController): void {
  controllers.set(taskId, controller)
}

export function unregisterTerminalTaskPaneController(taskId: string, controller: TerminalTaskPaneController): void {
  if (controllers.get(taskId) === controller) {
    controllers.delete(taskId)
  }
}

export function getTerminalTaskPaneController(taskId: string): TerminalTaskPaneController | undefined {
  return controllers.get(taskId)
}

export function clearTerminalTaskPaneControllers(): void {
  controllers.clear()
}
