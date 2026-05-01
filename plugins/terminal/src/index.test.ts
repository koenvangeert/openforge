import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { validatePluginManifest } from '@openforge/plugin-sdk'
import manifest from '../manifest.json'

const terminalSrcDir = dirname(fileURLToPath(import.meta.url))

const { mockTerminalTaskPane, mockTerminalProjectView, cleanupProjectTerminalTaskMock } = vi.hoisted(() => ({
  mockTerminalTaskPane: { name: 'TerminalTaskPaneComponent' },
  mockTerminalProjectView: { name: 'TerminalProjectViewComponent' },
  cleanupProjectTerminalTaskMock: vi.fn().mockResolvedValue({ killed: 0, released: 0, killFailures: [] }),
}))

vi.mock('./TerminalTaskPane.svelte', () => ({
  default: mockTerminalTaskPane,
}))

vi.mock('./TerminalProjectView.svelte', () => ({
  default: mockTerminalProjectView,
}))

vi.mock('./lib/projectTerminal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/projectTerminal')>()
  return {
    ...actual,
    cleanupProjectTerminalTask: cleanupProjectTerminalTaskMock,
  }
})

vi.mock('./lib/ipc', () => ({
  killPty: vi.fn(),
}))

vi.mock('./lib/terminalPool', () => ({
  clearTaskTerminalTabsSession: vi.fn(),
  getTaskTerminalTabsSession: vi.fn(() => ({ tabs: [] })),
  releaseAllForTask: vi.fn(() => 0),
}))

describe('terminal plugin', () => {
  afterEach(async () => {
    cleanupProjectTerminalTaskMock.mockClear()
    const { resetActiveProjectTerminalTask } = await import('./lib/projectTerminal')
    resetActiveProjectTerminalTask()
  })
  it('does not retain stale host PluginContext state in the terminal plugin entry', () => {
    const indexSource = readFileSync(join(terminalSrcDir, 'index.ts'), 'utf8')

    expect(indexSource).not.toContain('./pluginContext')
    expect(indexSource).not.toContain('setPluginContext')
    expect(existsSync(join(terminalSrcDir, 'pluginContext.ts'))).toBe(false)
  })

  it('has a valid manifest with a top-level terminal view', () => {
    const errors = validatePluginManifest(manifest)
    expect(errors).toEqual([])
    expect(manifest.contributes.views).toEqual([
      {
        id: 'terminal',
        title: 'Terminal',
        icon: 'terminal',
        showInRail: true,
        railOrder: 40,
        shortcut: 'Cmd+J',
      },
    ])
  })

  it('activates top-level view, task pane, and background service implementations', async () => {
    const { activate } = await import('./index')
    const result = await activate({
      pluginId: 'test-plugin',
      invokeHost: async () => null,
      invokeBackend: async () => null,
      onEvent: () => () => {},
      storage: { get: async () => null, set: async () => {} },
    })
    expect(result.contributions.views).toHaveLength(1)
    expect(result.contributions.views?.[0]).toMatchObject({
      id: 'terminal',
      component: mockTerminalProjectView,
    })
    expect(result.contributions.taskPaneTabs).toHaveLength(1)
    expect(result.contributions.taskPaneTabs?.[0]).toMatchObject({
      id: 'terminal',
      component: mockTerminalTaskPane,
    })
    expect(result.contributions.backgroundServices).toHaveLength(1)
    expect(result.contributions.backgroundServices?.[0]?.id).toBe('pty-manager')
  })

  it('cleans up the previous project terminal when project navigation changes while the view is unmounted', async () => {
    const navigationHandlers: Array<(payload: unknown) => void> = []
    const { activate } = await import('./index')
    const result = await activate({
      pluginId: 'test-plugin',
      invokeHost: async (command) => command === 'getNavigation' ? { activeProjectId: 'P-123', currentView: 'board' } : null,
      invokeBackend: async () => null,
      onEvent: (event, handler) => {
        if (event === 'navigation-changed') {
          navigationHandlers.push(handler)
        }
        return () => undefined
      },
      storage: { get: async () => null, set: async () => {} },
    })

    await result.contributions.backgroundServices?.[0]?.start()
    const { markActiveProjectTerminalTask } = await import('./lib/projectTerminal')
    markActiveProjectTerminalTask('project-P-123')
    expect(cleanupProjectTerminalTaskMock).not.toHaveBeenCalled()

    navigationHandlers[0]?.({ activeProjectId: 'P-456', currentView: 'board' })

    expect(cleanupProjectTerminalTaskMock).toHaveBeenCalledTimes(1)
    expect(cleanupProjectTerminalTaskMock).toHaveBeenCalledWith('project-P-123', expect.any(Object))
  })

  it('does not clean up a project terminal that was never opened', async () => {
    const navigationHandlers: Array<(payload: unknown) => void> = []
    const { activate } = await import('./index')
    const result = await activate({
      pluginId: 'test-plugin',
      invokeHost: async (command) => command === 'getNavigation' ? { activeProjectId: 'P-123', currentView: 'board' } : null,
      invokeBackend: async () => null,
      onEvent: (event, handler) => {
        if (event === 'navigation-changed') {
          navigationHandlers.push(handler)
        }
        return () => undefined
      },
      storage: { get: async () => null, set: async () => {} },
    })

    await result.contributions.backgroundServices?.[0]?.start()
    navigationHandlers[0]?.({ activeProjectId: 'P-456', currentView: 'board' })

    expect(cleanupProjectTerminalTaskMock).not.toHaveBeenCalled()
  })

  it('deactivates without error', async () => {
    const { deactivate } = await import('./index')
    await expect(deactivate()).resolves.toBeUndefined()
  })
})
