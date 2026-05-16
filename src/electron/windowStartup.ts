import { createFailureReport, reportFailure } from './failureReporting.js'
import type { ElectronFailureReporter } from './failureReporting.js'

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

export interface MainWindowStartupOptions {
  failureReporter?: ElectronFailureReporter | null
}

export async function loadAndRevealMainWindow(
  window: MainWindowLike,
  target: MainWindowLoadTarget,
  options: MainWindowStartupOptions = {},
): Promise<void> {
  let didShow = false
  const reveal = (): void => {
    if (didShow || window.isDestroyed()) return
    didShow = true
    window.show()
    window.focus()
  }

  window.once('ready-to-show', reveal)

  try {
    if (target.rendererUrl) {
      await window.loadURL(target.rendererUrl)
    } else if (target.filePath) {
      await window.loadFile(target.filePath)
    } else {
      throw new Error('Main window load target must include a renderer URL or file path')
    }
  } catch (error) {
    await reportFailure(options.failureReporter, createFailureReport({
      phase: 'boot:renderer-load',
      severity: 'fatal',
      cause: error,
      userMessage: 'OpenForge window could not load.',
      remediation: 'Verify the renderer URL or packaged index.html exists, then launch again.',
      decision: 'quit',
    }))
    throw error
  }

  reveal()
}
