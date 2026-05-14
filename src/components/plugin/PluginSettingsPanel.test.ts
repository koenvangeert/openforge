import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte'
import PluginSettingsPanel from './PluginSettingsPanel.svelte'
import { installedPlugins, enabledPluginIds, error as pluginLoadError } from '../../lib/plugin/pluginStore'
import {
  disablePluginForProject,
  enablePluginForProject,
  installFromLocal,
  installPluginFromGit,
  installPluginFromNpm,
  reloadPluginForProject,
} from '../../lib/plugin/pluginRegistry'
import type { PluginEntry } from '../../lib/plugin/types'

// Mock the dependencies
vi.mock('../../lib/plugin/pluginStore', () => {
  const { writable } = require('svelte/store')
  return {
    installedPlugins: writable(new Map()),
    enabledPluginIds: writable(new Set()),
    error: writable(null),
  }
})

vi.mock('../../lib/plugin/pluginRegistry', () => ({
  enablePluginForProject: vi.fn(),
  disablePluginForProject: vi.fn(),
  installFromLocal: vi.fn(),
  installPluginFromGit: vi.fn(),
  installPluginFromNpm: vi.fn(),
  reloadPluginForProject: vi.fn(),
}))

const mockPlugin: PluginEntry = {
  manifest: {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    apiVersion: 1,
    description: 'A test plugin',
    permissions: ['read:files'],
    frontend: 'index.js',
    backend: null,
  },
  state: 'installed',
  error: null,
  installPath: '/plugins/test-plugin',
  sourceKind: 'npm',
  sourceSpec: 'npm:@acme/test-plugin@1.0.0',
  installedAt: 1234,
}

describe('PluginSettingsPanel', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    
    // Reset stores
    installedPlugins.set(new Map())
    enabledPluginIds.set(new Set())
    pluginLoadError.set(null)
  })

  it('renders empty state when no plugins installed', () => {
    render(PluginSettingsPanel, { projectId: 'proj-1' })
    expect(screen.getByText('Plugins')).toBeTruthy()
    expect(screen.getByText('No plugins installed')).toBeTruthy()
  })

  it('renders app-wide install metadata for installed plugins', () => {
    installedPlugins.set(new Map([['test-plugin', mockPlugin]]))
    
    render(PluginSettingsPanel, { projectId: 'proj-1' })
    
    expect(screen.getByText('Test Plugin')).toBeTruthy()
    expect(screen.getByText('A test plugin')).toBeTruthy()
    expect(screen.getByText('v1.0.0')).toBeTruthy()
    expect(screen.getByText('Installed app-wide')).toBeTruthy()
    expect(screen.getByText('npm:@acme/test-plugin@1.0.0')).toBeTruthy()
    expect(screen.getByText('read:files')).toBeTruthy()
  })

  it('enables plugins through an explicit project CTA without using install as enablement', async () => {
    installedPlugins.set(new Map([['test-plugin', mockPlugin]]))
    
    render(PluginSettingsPanel, { projectId: 'proj-1' })
    
    await fireEvent.click(screen.getByRole('button', { name: /Enable for this project/i }))
    expect(enablePluginForProject).toHaveBeenCalledWith('proj-1', 'test-plugin')
    expect(installPluginFromNpm).not.toHaveBeenCalled()
    
    enabledPluginIds.set(new Set(['test-plugin']))
    await fireEvent.click(await screen.findByRole('button', { name: /Disable for this project/i }))
    expect(disablePluginForProject).toHaveBeenCalledWith('proj-1', 'test-plugin')
  })

  it('installs npm packages without silently enabling them', async () => {
    vi.mocked(installPluginFromNpm).mockResolvedValue(undefined)
    render(PluginSettingsPanel, { projectId: 'proj-1' })

    await fireEvent.input(screen.getByLabelText('Package source'), { target: { value: '@acme/openforge-github@1.2.0' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Install package' }))

    expect(installPluginFromNpm).toHaveBeenCalledWith('@acme/openforge-github@1.2.0')
    expect(enablePluginForProject).not.toHaveBeenCalled()
  })

  it('installs git and local package sources through the selected source flow', async () => {
    vi.mocked(installPluginFromGit).mockResolvedValue(undefined)
    vi.mocked(installFromLocal).mockResolvedValue(undefined)
    render(PluginSettingsPanel, { projectId: 'proj-1' })

    await fireEvent.change(screen.getByLabelText('Source type'), { target: { value: 'git' } })
    await fireEvent.input(screen.getByLabelText('Package source'), { target: { value: 'github.com/acme/openforge-tools@main' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Install package' }))
    expect(installPluginFromGit).toHaveBeenCalledWith('github.com/acme/openforge-tools@main')

    await fireEvent.change(screen.getByLabelText('Source type'), { target: { value: 'local' } })
    await fireEvent.input(screen.getByLabelText('Package source'), { target: { value: '/Users/me/plugins/local-plugin' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Install package' }))
    expect(installFromLocal).toHaveBeenCalledWith('/Users/me/plugins/local-plugin', 'proj-1')
  })

  it('shows install and load errors and can copy plugin diagnostics', async () => {
    vi.mocked(installPluginFromNpm).mockRejectedValue(new Error('npm install failed'))
    pluginLoadError.set('Failed to list plugins')
    installedPlugins.set(new Map([['test-plugin', { ...mockPlugin, state: 'error', error: 'activation failed' }]]))
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    render(PluginSettingsPanel, { projectId: 'proj-1' })

    expect(screen.getByText('Failed to list plugins')).toBeTruthy()
    expect(screen.getByText('activation failed')).toBeTruthy()

    await fireEvent.input(screen.getByLabelText('Package source'), { target: { value: '@acme/broken-plugin' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Install package' }))
    expect(screen.getByText('npm install failed')).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: /Copy diagnostics/i }))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('activation failed'))
  })

  it('reloads a plugin for the current project', async () => {
    vi.mocked(reloadPluginForProject).mockResolvedValue(true)
    installedPlugins.set(new Map([['test-plugin', mockPlugin]]))

    render(PluginSettingsPanel, { projectId: 'proj-1' })

    await fireEvent.click(screen.getByRole('button', { name: /Reload plugin/i }))
    expect(reloadPluginForProject).toHaveBeenCalledWith('proj-1', 'test-plugin')
  })
})
