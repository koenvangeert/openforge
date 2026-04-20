import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte'
import PluginSettingsPanel from './PluginSettingsPanel.svelte'
import { installedPlugins, enabledPluginIds, enablePlugin, disablePlugin } from '../../lib/plugin/pluginStore'
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

  it('does not render install and uninstall controls', () => {
    installedPlugins.set(new Map([['test-plugin', mockPlugin]]))
    render(PluginSettingsPanel, { projectId: 'proj-1' })
    
    // Assert install controls are absent
    expect(screen.queryByPlaceholderText(/Enter absolute path/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Install/i })).toBeNull()
    
    // Assert uninstall controls are absent
    expect(screen.queryByTitle(/Uninstall Plugin/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /Uninstall/i })).toBeNull()
  })
})
