import { render, screen, waitFor, cleanup } from '@testing-library/svelte'
import { beforeEach, describe, expect, it } from 'vitest'
import { defineFrontendPlugin } from '@openforge/plugin-sdk/frontend'

import PluginSlot from './PluginSlot.svelte'
import PluginSlotRuntimePropsView from './PluginSlotRuntimePropsView.svelte'
import { installedPlugins, enabledPluginIds, runtimeContributionSources } from '../../lib/plugin/pluginStore'
import { activatePlugin } from '../../lib/plugin/pluginRegistry'
import { clearComponentRegistry } from '../../lib/plugin/componentRegistry'
import { _resetPluginLoaderForTests, _setModuleLoader } from '../../lib/plugin/pluginLoader'
import type { PluginManifest } from '../../lib/plugin/types'

function makePackageManifest(): PluginManifest {
  return {
    id: 'runtime-slot-plugin',
    name: 'Runtime Slot Plugin',
    version: '1.0.0',
    apiVersion: 1,
    description: 'Runtime slot integration plugin',
    permissions: [],
    frontend: './dist/frontend.js',
    backend: null,
  }
}

describe('PluginSlot runtime integration', () => {
  beforeEach(() => {
    cleanup()
    installedPlugins.set(new Map())
    enabledPluginIds.set(new Set())
    runtimeContributionSources.set(new Map())
    clearComponentRegistry()
    _resetPluginLoaderForTests()
  })

  it('renders runtime-registered views with real stable API and render context props', async () => {
    const frontendPlugin = defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.views.register({
          id: 'main',
          title: 'Main',
          icon: 'sparkles',
          placement: 'rail',
          component: () => Promise.resolve({ default: PluginSlotRuntimePropsView }),
        }))
      },
    })

    installedPlugins.set(new Map([['runtime-slot-plugin', {
      manifest: makePackageManifest(),
      state: 'installed',
      error: null,
      packageMetadata: {
        id: 'runtime-slot-plugin',
        apiVersion: 1,
        displayName: 'Runtime Slot Plugin',
        description: 'Runtime slot integration plugin',
        frontend: './dist/frontend.js',
      },
    }]]))
    enabledPluginIds.set(new Set(['runtime-slot-plugin']))
    _setModuleLoader(async () => ({ default: frontendPlugin }))

    await expect(activatePlugin('runtime-slot-plugin')).resolves.toBe(true)

    render(PluginSlot, {
      props: {
        slotType: 'views',
        slotId: 'plugin:runtime-slot-plugin:main',
        projectId: 'P-1',
        taskId: 'T-1',
      },
    })

    await waitFor(() => {
      expect(screen.getByTestId('plugin-runtime-props').textContent).toContain('runtime-slot-plugin:P-1:T-1:T-1:P-1:api')
    })
  })
})
