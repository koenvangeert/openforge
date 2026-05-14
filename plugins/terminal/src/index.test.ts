import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OPENFORGE_FRONTEND_PLUGIN_MARKER } from '@openforge/plugin-sdk/frontend'
import { isOpenForgePackageMetadata } from '@openforge/plugin-sdk'
import type { FrontendOpenForgeAPI, FrontendPluginContext } from '@openforge/plugin-sdk/frontend'
import packageJson from '../package.json'

const terminalSrcDir = dirname(fileURLToPath(import.meta.url))

const { mockTerminalTaskPane, mockTerminalProjectView, cleanupSideEffects } = vi.hoisted(() => ({
  mockTerminalTaskPane: { name: 'TerminalTaskPaneComponent' },
  mockTerminalProjectView: { name: 'TerminalProjectViewComponent' },
  cleanupSideEffects: {
    killPty: vi.fn(),
    releaseAllForTask: vi.fn(),
    clearTaskTerminalTabsSession: vi.fn(),
  },
}))

vi.mock('./TerminalTaskPane.svelte', () => ({
  default: mockTerminalTaskPane,
}))

vi.mock('./TerminalProjectView.svelte', () => ({
  default: mockTerminalProjectView,
}))

vi.mock('./lib/ipc', () => ({
  killPty: cleanupSideEffects.killPty,
}))

vi.mock('./lib/terminalPool', () => ({
  clearTaskTerminalTabsSession: cleanupSideEffects.clearTaskTerminalTabsSession,
  getTaskTerminalTabsSession: vi.fn(() => ({ tabs: [] })),
  releaseAllForTask: cleanupSideEffects.releaseAllForTask,
}))

function makeRuntimeHarness() {
  const subscriptions = { add: vi.fn() }
  const api = {
    views: { register: vi.fn(() => ({ dispose: vi.fn() })) },
    taskPane: { registerTab: vi.fn(() => ({ dispose: vi.fn() })) },
  } as unknown as FrontendOpenForgeAPI
  const context = { pluginId: packageJson.openforge.id, apiVersion: 1, packageMetadata: packageJson.openforge, subscriptions } as FrontendPluginContext
  return { api, context, subscriptions }
}

function expectNoProjectTerminalCleanup() {
  expect(cleanupSideEffects.killPty).not.toHaveBeenCalled()
  expect(cleanupSideEffects.releaseAllForTask).not.toHaveBeenCalled()
  expect(cleanupSideEffects.clearTaskTerminalTabsSession).not.toHaveBeenCalled()
}

describe('terminal plugin', () => {
  afterEach(() => {
    cleanupSideEffects.killPty.mockClear()
    cleanupSideEffects.releaseAllForTask.mockClear()
    cleanupSideEffects.clearTaskTerminalTabsSession.mockClear()
  })

  it('does not retain stale host PluginContext state in the terminal plugin entry', () => {
    const indexSource = readFileSync(join(terminalSrcDir, 'index.ts'), 'utf8')

    expect(indexSource).not.toContain('./pluginContext')
    expect(indexSource).not.toContain('setPluginContext')
    expect(existsSync(join(terminalSrcDir, 'pluginContext.ts'))).toBe(false)
  })

  it('has valid package.json#openforge metadata without manifest contributions', () => {
    expect(isOpenForgePackageMetadata(packageJson.openforge)).toBe(true)
    expect(packageJson.openforge).not.toHaveProperty('contributes')
    expect(packageJson.openforge.frontend).toBe('./dist/frontend.js')
  })

  it('registers top-level view and task pane at runtime through defineFrontendPlugin', async () => {
    const { default: plugin } = await import('./index')
    const { api, context, subscriptions } = makeRuntimeHarness()

    await plugin.activate(api, context)

    expect(plugin[OPENFORGE_FRONTEND_PLUGIN_MARKER]).toBe(true)
    expect(api.views.register).toHaveBeenCalledWith(expect.objectContaining({
      id: 'terminal',
      title: 'Terminal',
      icon: 'terminal',
      placement: 'rail',
      order: 40,
      component: mockTerminalProjectView,
    }))
    expect(api.taskPane.registerTab).toHaveBeenCalledWith(expect.objectContaining({
      id: 'terminal',
      title: 'Terminal',
      icon: 'terminal',
      order: 10,
      component: mockTerminalTaskPane,
    }))
    expect(subscriptions.add).toHaveBeenCalledTimes(2)
  })

  it('keeps previous project terminals alive when project navigation changes while the view is unmounted', async () => {
    const { default: plugin } = await import('./index')
    const { api, context } = makeRuntimeHarness()

    await plugin.activate(api, context)

    expectNoProjectTerminalCleanup()
  })

  it('does not clean up a project terminal that was never opened', async () => {
    const { default: plugin } = await import('./index')
    const { api, context } = makeRuntimeHarness()

    await plugin.activate(api, context)

    expectNoProjectTerminalCleanup()
  })
})
