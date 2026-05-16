import { describe, expect, it, vi } from 'vitest'
import { RecordingFailureReporterAdapter } from './failureReporting'
import { loadAndRevealMainWindow } from './windowStartup'

class FakeMainWindow {
  listeners = new Map<string, () => void>()
  show = vi.fn()
  focus = vi.fn()
  loadURL = vi.fn(async () => undefined)
  loadFile = vi.fn(async () => undefined)
  destroyed = false

  once(event: 'ready-to-show', listener: () => void): this {
    this.listeners.set(event, listener)
    return this
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  emitReadyToShow(): void {
    this.listeners.get('ready-to-show')?.()
  }
}

describe('Electron main window startup visibility', () => {
  it('registers the reveal handler before loading the dev renderer URL', async () => {
    const window = new FakeMainWindow()
    window.loadURL.mockImplementation(async () => {
      expect(window.listeners.has('ready-to-show')).toBe(true)
    })

    await loadAndRevealMainWindow(window, { rendererUrl: 'http://127.0.0.1:1420' })

    expect(window.loadURL).toHaveBeenCalledWith('http://127.0.0.1:1420')
  })

  it('reveals the window after load when ready-to-show does not fire', async () => {
    const window = new FakeMainWindow()

    await loadAndRevealMainWindow(window, { rendererUrl: 'http://127.0.0.1:1420' })

    expect(window.show).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
  })

  it('does not reveal the window twice when ready-to-show fires during load', async () => {
    const window = new FakeMainWindow()
    window.loadFile.mockImplementation(async () => {
      window.emitReadyToShow()
    })

    await loadAndRevealMainWindow(window, { filePath: '/tmp/openforge/index.html' })

    expect(window.show).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
  })

  it('reports renderer load failure with a quit decision before rethrowing', async () => {
    const window = new FakeMainWindow()
    const failureReporter = new RecordingFailureReporterAdapter()
    window.loadURL.mockRejectedValue(new Error('renderer refused connection'))

    await expect(loadAndRevealMainWindow(
      window,
      { rendererUrl: 'http://127.0.0.1:1420' },
      { failureReporter },
    )).rejects.toThrow('renderer refused connection')

    expect(failureReporter.reports).toContainEqual(expect.objectContaining({
      phase: 'boot:renderer-load',
      severity: 'fatal',
      decision: 'quit',
    }))
    expect(window.show).not.toHaveBeenCalled()
  })
})
