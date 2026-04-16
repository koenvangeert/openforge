import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte'
import PluginSettingsPanel from './PluginSettingsPanel.svelte'
import { installedPlugins, enabledPluginIds, enablePlugin, disablePlugin } from '../../lib/plugin/pluginStore'
import { installFromLocal, uninstallPlugin } from '../../lib/plugin/pluginRegistry'
import type { PluginEntry } from '../../lib/plugin/types'

// Mock the dependencies
vi.mock('../../lib/plugin/pluginStore', () => {
  const { writable } = require('svelte/store')
  return {
    installedPlugins: writable(new Map()),
    enabledPluginIds: writable(new Set()),
    enablePlugin: vi.fn(),
    disablePlugin: vi.fn(),
  }
})

vi.mock('../../lib/plugin/pluginRegistry', () => ({
  installFromLocal: vi.fn(),
  uninstallPlugin: vi.fn(),
}))

const mockPlugin: PluginEntry = {
  manifest: {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    apiVersion: 1,
    description: 'A test plugin',
    permissions: ['read:files'],
    contributes: {},
    frontend: 'index.js',
    backend: null,
  },
  state: 'installed',
  error: null,
}

describe('PluginSettingsPanel', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    
    // Reset stores
    installedPlugins.set(new Map())
    enabledPluginIds.set(new Set())
    
    // Mock confirm dialog
    global.confirm = vi.fn(() => true)
  })

  it('renders empty state when no plugins installed', () => {
    render(PluginSettingsPanel, { projectId: 'proj-1' })
    expect(screen.getByText('Plugins')).toBeTruthy()
    expect(screen.getByText('No plugins installed')).toBeTruthy()
  })

  it('renders list of installed plugins', () => {
    installedPlugins.set(new Map([['test-plugin', mockPlugin]]))
    
    render(PluginSettingsPanel, { projectId: 'proj-1' })
    
    expect(screen.getByText('Test Plugin')).toBeTruthy()
    expect(screen.getByText('A test plugin')).toBeTruthy()
    expect(screen.getByText('v1.0.0')).toBeTruthy()
    expect(screen.getByText('read:files')).toBeTruthy()
  })

  it('toggles plugin enable state', async () => {
    installedPlugins.set(new Map([['test-plugin', mockPlugin]]))
    
    render(PluginSettingsPanel, { projectId: 'proj-1' })
    
    const toggle = screen.getByRole('checkbox') as HTMLInputElement
    expect(toggle.checked).toBe(false)
    
    await fireEvent.click(toggle)
    expect(enablePlugin).toHaveBeenCalledWith('proj-1', 'test-plugin')
    
    // Set enabled
    enabledPluginIds.set(new Set(['test-plugin']))
    await fireEvent.click(toggle)
    expect(disablePlugin).toHaveBeenCalledWith('proj-1', 'test-plugin')
  })

  it('installs plugin from local path', async () => {
    render(PluginSettingsPanel, { projectId: 'proj-1' })
    
    const input = screen.getByPlaceholderText('Enter absolute path to plugin directory...')
    const button = screen.getByRole('button', { name: 'Install' })
    
    await fireEvent.input(input, { target: { value: '/path/to/plugin' } })
    await fireEvent.click(button)
    
    expect(installFromLocal).toHaveBeenCalledWith('/path/to/plugin', 'proj-1')
  })

  it('uninstalls plugin with confirmation', async () => {
    installedPlugins.set(new Map([['test-plugin', mockPlugin]]))
    
    render(PluginSettingsPanel, { projectId: 'proj-1' })
    
    const uninstallButton = screen.getByTitle('Uninstall Plugin')
    await fireEvent.click(uninstallButton)
    
    expect(global.confirm).toHaveBeenCalled()
    expect(uninstallPlugin).toHaveBeenCalledWith('test-plugin')
  })
})
