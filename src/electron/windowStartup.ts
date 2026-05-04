export interface MainWindowLike {
  once(event: 'ready-to-show', listener: () => void): this
  loadURL(url: string): Promise<void>
  loadFile(path: string): Promise<void>
  show(): void
  focus(): void
  isDestroyed(): boolean
}

export type MainWindowLoadTarget =
  | { rendererUrl: string; filePath?: never }
  | { rendererUrl?: null; filePath: string }

export async function loadAndRevealMainWindow(window: MainWindowLike, target: MainWindowLoadTarget): Promise<void> {
  let didShow = false
  const reveal = (): void => {
    if (didShow || window.isDestroyed()) return
    didShow = true
    window.show()
    window.focus()
  }

  window.once('ready-to-show', reveal)

  if (target.rendererUrl) {
    await window.loadURL(target.rendererUrl)
  } else if (target.filePath) {
    await window.loadFile(target.filePath)
  } else {
    throw new Error('Main window load target must include a renderer URL or file path')
  }

  reveal()
}
