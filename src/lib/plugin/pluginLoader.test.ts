import { get } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetPluginLoaderForTests,
  _setModuleLoader,
  activatePlugin,
  deactivatePlugin,
  getLoadedPlugin,
  isPluginLoaded,
  loadPluginFrontend,
} from './pluginLoader'
import { installedPlugins } from './pluginStore'
import type { PluginActivationResult, PluginContext, PluginManifest } from './types'

function makeManifest(pluginId: string): PluginManifest {
  return {
    id: pluginId,
    name: `Plugin ${pluginId}`,
    version: '1.0.0',
    apiVersion: 1,
    description: 'Test plugin',
    permissions: [],
    contributes: {},
    frontend: 'index.js',
    backend: null,
  }
}

function seedPlugin(pluginId: string): void {
  installedPlugins.set(new Map([
    [pluginId, { manifest: makeManifest(pluginId), state: 'installed', error: null }],
  ]))
}

function makeContext(): PluginContext {
  return {
    pluginId: 'test-plugin',
    invokeHost: vi.fn(async () => null),
    invokeBackend: vi.fn(async () => null),
    onEvent: vi.fn(() => () => {}),
    storage: {
      get: vi.fn(async () => null),
      set: vi.fn(async () => undefined),
    },
  }
}

function makeActivationResult(id: string): PluginActivationResult {
  return {
    contributions: {
      commands: [{ id, title: `Command ${id}` }],
    },
  }
}

describe('pluginLoader', () => {
  beforeEach(() => {
    installedPlugins.set(new Map())
    _resetPluginLoaderForTests()
  })

  it('loads plugin ESM successfully', async () => {
    seedPlugin('plugin.success')
    const module = {
      activate: vi.fn(async () => makeActivationResult('success')),
    }
    const loader = vi.fn(async () => module)
    _setModuleLoader(loader)

    const loaded = await loadPluginFrontend('plugin.success', '/plugins/plugin.success/index.js')

    expect(loaded).not.toBeNull()
    expect(loaded?.pluginId).toBe('plugin.success')
    expect(loaded?.module).toBe(module)
    expect(isPluginLoaded('plugin.success')).toBe(true)
    expect(loader).toHaveBeenCalledWith('/plugins/plugin.success/index.js')
  })

  it('catches syntax error on load', async () => {
    seedPlugin('plugin.load-error')
    _setModuleLoader(async () => {
      throw new Error('Unexpected token export')
    })

    const loaded = await loadPluginFrontend('plugin.load-error', '/plugins/plugin.load-error/index.js')

    expect(loaded).toBeNull()
    expect(isPluginLoaded('plugin.load-error')).toBe(false)
    expect(get(installedPlugins).get('plugin.load-error')).toMatchObject({
      state: 'error',
      error: 'Unexpected token export',
    })
  })

  it('activates plugin and returns result', async () => {
    seedPlugin('plugin.activate')
    const activationResult = makeActivationResult('activate')
    const module = {
      activate: vi.fn(async (_context: PluginContext) => activationResult),
    }
    _setModuleLoader(async () => module)
    await loadPluginFrontend('plugin.activate', '/plugins/plugin.activate/index.js')

    const result = await activatePlugin('plugin.activate', makeContext())

    expect(result).toEqual(activationResult)
    expect(module.activate).toHaveBeenCalledOnce()
    expect(getLoadedPlugin('plugin.activate')?.activationResult).toEqual(activationResult)
    expect(get(installedPlugins).get('plugin.activate')).toMatchObject({
      state: 'active',
      error: null,
    })
  })

  it('catches activate error', async () => {
    seedPlugin('plugin.activate-error')
    const module = {
      activate: vi.fn(async () => {
        throw new Error('activate failed')
      }),
    }
    _setModuleLoader(async () => module)
    await loadPluginFrontend('plugin.activate-error', '/plugins/plugin.activate-error/index.js')

    const result = await activatePlugin('plugin.activate-error', makeContext())

    expect(result).toBeNull()
    expect(getLoadedPlugin('plugin.activate-error')?.activationResult).toBeNull()
    expect(get(installedPlugins).get('plugin.activate-error')).toMatchObject({
      state: 'error',
      error: 'activate failed',
    })
  })

  it('deactivates plugin successfully', async () => {
    seedPlugin('plugin.deactivate')
    const module = {
      activate: vi.fn(async () => makeActivationResult('deactivate')),
      deactivate: vi.fn(async () => undefined),
    }
    _setModuleLoader(async () => module)
    await loadPluginFrontend('plugin.deactivate', '/plugins/plugin.deactivate/index.js')
    await activatePlugin('plugin.deactivate', makeContext())

    await deactivatePlugin('plugin.deactivate')

    expect(module.deactivate).toHaveBeenCalledOnce()
    expect(isPluginLoaded('plugin.deactivate')).toBe(false)
    expect(get(installedPlugins).get('plugin.deactivate')).toMatchObject({
      state: 'installed',
      error: null,
    })
  })

  it('catches deactivate error and still cleans up', async () => {
    seedPlugin('plugin.deactivate-error')
    const module = {
      activate: vi.fn(async () => makeActivationResult('deactivate-error')),
      deactivate: vi.fn(async () => {
        throw new Error('deactivate failed')
      }),
    }
    _setModuleLoader(async () => module)
    await loadPluginFrontend('plugin.deactivate-error', '/plugins/plugin.deactivate-error/index.js')

    await deactivatePlugin('plugin.deactivate-error')

    expect(module.deactivate).toHaveBeenCalledOnce()
    expect(isPluginLoaded('plugin.deactivate-error')).toBe(false)
    expect(get(installedPlugins).get('plugin.deactivate-error')).toMatchObject({
      state: 'installed',
      error: null,
    })
  })

  it('returns null when activating unloaded plugin', async () => {
    const result = await activatePlugin('plugin.unknown', makeContext())

    expect(result).toBeNull()
  })

  it('returns cached instance for already loaded plugin', async () => {
    seedPlugin('plugin.cached')
    const module = {
      activate: vi.fn(async () => makeActivationResult('cached')),
    }
    const loader = vi.fn(async () => module)
    _setModuleLoader(loader)

    const first = await loadPluginFrontend('plugin.cached', '/plugins/plugin.cached/index.js')
    const second = await loadPluginFrontend('plugin.cached', '/plugins/plugin.cached/index.js')

    expect(first).toBe(second)
    expect(loader).toHaveBeenCalledOnce()
  })
})
