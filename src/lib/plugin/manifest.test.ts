import { describe, expect, it } from 'vitest'
import { ALLOWED_ICON_KEYS, isPluginManifest, isValidShortcutFormat, normalizeShortcut, validatePluginManifest } from './manifest'

function createValidManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'com.openforge.demo',
    name: 'Demo Plugin',
    version: '1.0.0',
    apiVersion: 1,
    description: 'A demo plugin',
    permissions: ['db:read'],
    contributes: {
      views: [{ id: 'main', title: 'Demo', icon: 'plug' }],
    },
    frontend: 'dist/index.js',
    backend: null,
    ...overrides,
  }
}

describe('validatePluginManifest', () => {
  it('accepts a valid manifest', () => {
    const errors = validatePluginManifest(createValidManifest())
    expect(errors).toEqual([])
  })

  it('accepts task pane tab and background service contributions', () => {
    const errors = validatePluginManifest(createValidManifest({
      contributes: {
        taskPaneTabs: [{ id: 'terminal', title: 'Terminal', icon: 'terminal', order: 10 }],
        backgroundServices: [{ id: 'pty-manager', name: 'PTY Process Manager' }],
      },
    }))

    expect(errors).toEqual([])
  })

  it('accepts sidebar panel, command, and settings section contributions', () => {
    const errors = validatePluginManifest(createValidManifest({
      contributes: {
        sidebarPanels: [{ id: 'inspector', title: 'Inspector', side: 'right', order: 20 }],
        commands: [{ id: 'open-demo', title: 'Open Demo', shortcut: 'Cmd+Shift+O' }],
        settingsSections: [{ id: 'demo-settings', title: 'Demo Settings' }],
      },
    }))

    expect(errors).toEqual([])
  })

  it('rejects invalid task pane tab icon key', () => {
    const errors = validatePluginManifest(createValidManifest({
      contributes: {
        taskPaneTabs: [{ id: 'terminal', title: 'Terminal', icon: 'bad-icon' }],
      },
    }))

    expect(errors).toContainEqual(expect.objectContaining({ path: 'contributes.taskPaneTabs[0].icon' }))
  })

  it('rejects background services without a name', () => {
    const errors = validatePluginManifest(createValidManifest({
      contributes: {
        backgroundServices: [{ id: 'pty-manager' }],
      },
    }))

    expect(errors).toContainEqual(expect.objectContaining({ path: 'contributes.backgroundServices[0].name' }))
  })

  it('rejects sidebar panels with invalid side values', () => {
    const errors = validatePluginManifest(createValidManifest({
      contributes: {
        sidebarPanels: [{ id: 'inspector', title: 'Inspector', side: 'center' }],
      },
    }))

    expect(errors).toContainEqual(expect.objectContaining({ path: 'contributes.sidebarPanels[0].side' }))
  })

  it('rejects commands with invalid shortcut format', () => {
    const errors = validatePluginManifest(createValidManifest({
      contributes: {
        commands: [{ id: 'open-demo', title: 'Open Demo', shortcut: 'BAD+FORMAT+!!!' }],
      },
    }))

    expect(errors).toContainEqual(expect.objectContaining({ path: 'contributes.commands[0].shortcut' }))
  })

  it('rejects settings sections without a title', () => {
    const errors = validatePluginManifest(createValidManifest({
      contributes: {
        settingsSections: [{ id: 'demo-settings' }],
      },
    }))

    expect(errors).toContainEqual(expect.objectContaining({ path: 'contributes.settingsSections[0].title' }))
  })

  it('rejects manifest without id', () => {
    const { id, ...noId } = createValidManifest()
    const errors = validatePluginManifest(noId)
    expect(errors).toContainEqual(expect.objectContaining({ path: 'id', message: expect.stringContaining('Required') }))
  })

  it('rejects manifest without apiVersion', () => {
    const { apiVersion, ...noVersion } = createValidManifest()
    const errors = validatePluginManifest(noVersion)
    expect(errors).toContainEqual(expect.objectContaining({ path: 'apiVersion' }))
  })

  it('rejects manifest with apiVersion higher than host supports', () => {
    const errors = validatePluginManifest(createValidManifest({ apiVersion: 999 }))
    expect(errors).toContainEqual(expect.objectContaining({ path: 'apiVersion', message: expect.stringContaining('supported') }))
  })

  it('rejects manifest with invalid icon key', () => {
    const errors = validatePluginManifest(createValidManifest({
      contributes: { views: [{ id: 'main', title: 'Demo', icon: 'nonexistent-icon' }] },
    }))
    expect(errors).toContainEqual(expect.objectContaining({ path: 'contributes.views[0].icon', message: expect.stringContaining('icon') }))
  })

  it('rejects manifest with invalid shortcut format', () => {
    const errors = validatePluginManifest(createValidManifest({
      contributes: { views: [{ id: 'main', title: 'Demo', icon: 'plug', shortcut: 'BAD+FORMAT+!!!' }] },
    }))
    expect(errors).toContainEqual(expect.objectContaining({ path: 'contributes.views[0].shortcut' }))
  })

  it('accepts a null frontend entry for host-bundled built-in plugins', () => {
    const errors = validatePluginManifest(createValidManifest({ frontend: null }))
    expect(errors).toEqual([])
  })

  it('rejects manifest without frontend entry', () => {
    const { frontend, ...noFrontend } = createValidManifest()
    const errors = validatePluginManifest(noFrontend)
    expect(errors).toContainEqual(expect.objectContaining({ path: 'frontend' }))
  })

  it('returns multiple errors at once', () => {
    const errors = validatePluginManifest({})
    expect(errors.length).toBeGreaterThanOrEqual(4)
  })
})

describe('isPluginManifest', () => {
  it('returns true for valid manifest', () => {
    expect(isPluginManifest(createValidManifest())).toBe(true)
  })

  it('returns false for invalid manifest', () => {
    expect(isPluginManifest({})).toBe(false)
  })
})

describe('isValidShortcutFormat', () => {
  it('accepts Cmd+O', () => expect(isValidShortcutFormat('Cmd+O')).toBe(true))
  it('accepts Ctrl+Shift+R', () => expect(isValidShortcutFormat('Ctrl+Shift+R')).toBe(true))
  it('accepts Alt+Enter', () => expect(isValidShortcutFormat('Alt+Enter')).toBe(true))
  it('accepts plain letter', () => expect(isValidShortcutFormat('x')).toBe(true))
  it('rejects empty string', () => expect(isValidShortcutFormat('')).toBe(false))
  it('rejects random symbols', () => expect(isValidShortcutFormat('!!!')).toBe(false))
})

describe('normalizeShortcut', () => {
  it('normalizes Cmd+O to ⌘o', () => expect(normalizeShortcut('Cmd+O')).toBe('⌘o'))
  it('normalizes Ctrl+Shift+R to ⌃⇧r', () => expect(normalizeShortcut('Ctrl+Shift+R')).toBe('⌃⇧r'))
  it('normalizes Alt+Enter to ⌥enter', () => expect(normalizeShortcut('Alt+Enter')).toBe('⌥enter'))
  it('normalizes plain letter to lowercase', () => expect(normalizeShortcut('x')).toBe('x'))
})

describe('ALLOWED_ICON_KEYS', () => {
  it('contains expected core icons', () => {
    expect(ALLOWED_ICON_KEYS.has('layout-dashboard')).toBe(true)
    expect(ALLOWED_ICON_KEYS.has('folder-open')).toBe(true)
    expect(ALLOWED_ICON_KEYS.has('terminal')).toBe(true)
    expect(ALLOWED_ICON_KEYS.has('plug')).toBe(true)
  })
})
