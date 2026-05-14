import { get } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineFrontendPlugin } from '@openforge/plugin-sdk/frontend'
import * as pluginLoader from './pluginLoader'
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
import type { PluginManifest } from './types'

function makeManifest(pluginId: string): PluginManifest {
  return {
    id: pluginId,
    name: `Plugin ${pluginId}`,
    version: '1.0.0',
    apiVersion: 1,
    description: 'Test plugin',
    permissions: [],
    frontend: 'index.js',
    backend: null,
  }
}

function seedPlugin(pluginId: string): void {
  installedPlugins.set(new Map([
    [pluginId, { manifest: makeManifest(pluginId), state: 'installed', error: null }],
  ]))
}

describe('pluginLoader', () => {
  it('exposes only module lifecycle helpers and no imperative component mounting API', () => {
    expect('mountPluginComponent' in pluginLoader).toBe(false)
    expect('unmountPluginComponent' in pluginLoader).toBe(false)
  })

  beforeEach(() => {
    installedPlugins.set(new Map())
    _resetPluginLoaderForTests()
  })

  it('loads default-exported defineFrontendPlugin modules successfully', async () => {
    seedPlugin('plugin.default')
    const module = defineFrontendPlugin({ activate: vi.fn((_api, _context) => undefined) })
    const loader = vi.fn(async () => ({ default: module }))
    _setModuleLoader(loader)

    const loaded = await loadPluginFrontend('plugin.default', 'plugin://plugin.default/dist/frontend.js')

    expect(loaded?.module).toBe(module)
    expect(loader).toHaveBeenCalledWith('plugin://plugin.default/dist/frontend.js')
  })

  it('loads legacy activate(context) ESM but does not activate it through compatibility paths', async () => {
    seedPlugin('plugin.legacy')
    const module = {
      activate: vi.fn(async () => ({ contributions: { commands: [{ id: 'legacy', title: 'Legacy' }] } })),
    }
    const loader = vi.fn(async () => module)
    _setModuleLoader(loader)

    const loaded = await loadPluginFrontend('plugin.legacy', '/plugins/plugin.legacy/index.js')

    expect(loaded).not.toBeNull()
    expect(loaded?.pluginId).toBe('plugin.legacy')
    expect(loaded?.module).toBe(module)
    expect(isPluginLoaded('plugin.legacy')).toBe(true)
    expect(loader).toHaveBeenCalledWith('/plugins/plugin.legacy/index.js')

    await expect(activatePlugin('plugin.legacy')).resolves.toBeNull()
    expect(module.activate).not.toHaveBeenCalled()
    expect(getLoadedPlugin('plugin.legacy')).not.toHaveProperty('activationResult')
    expect(get(installedPlugins).get('plugin.legacy')).toMatchObject({
      state: 'error',
      error: 'Plugin plugin.legacy uses the legacy activate(context) API, which is no longer supported; export defineFrontendPlugin(...) and register contributions at runtime',
    })
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

  it('refuses direct activation of defineFrontendPlugin modules because the runtime registry owns them', async () => {
    seedPlugin('plugin.frontend')
    const module = defineFrontendPlugin({ activate: vi.fn((_api, _context) => undefined) })
    _setModuleLoader(async () => module)
    await loadPluginFrontend('plugin.frontend', '/plugins/plugin.frontend/index.js')

    const result = await activatePlugin('plugin.frontend')

    expect(result).toBeNull()
    expect(get(installedPlugins).get('plugin.frontend')).toMatchObject({
      state: 'error',
      error: 'Plugin plugin.frontend uses defineFrontendPlugin and must be activated by the frontend runtime',
    })
  })

  it('deactivates plugin successfully', async () => {
    seedPlugin('plugin.deactivate')
    const module = {
      activate: vi.fn(async () => undefined),
      deactivate: vi.fn(async () => undefined),
    }
    _setModuleLoader(async () => module)
    await loadPluginFrontend('plugin.deactivate', '/plugins/plugin.deactivate/index.js')

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
      activate: vi.fn(async () => undefined),
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
    const result = await activatePlugin('plugin.unknown')

    expect(result).toBeNull()
  })

  it('returns cached instance for already loaded plugin', async () => {
    seedPlugin('plugin.cached')
    const module = defineFrontendPlugin({ activate: vi.fn((_api, _context) => undefined) })
    const loader = vi.fn(async () => module)
    _setModuleLoader(loader)

    const first = await loadPluginFrontend('plugin.cached', '/plugins/plugin.cached/index.js')
    const second = await loadPluginFrontend('plugin.cached', '/plugins/plugin.cached/index.js')

    expect(first).toBe(second)
    expect(loader).toHaveBeenCalledOnce()
  })
})
