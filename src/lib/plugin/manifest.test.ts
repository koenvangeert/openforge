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
    frontend: 'dist/index.js',
    backend: null,
    ...overrides,
  }
}

describe('validatePluginManifest', () => {
  it('accepts a valid manifest without contribution arrays', () => {
    const errors = validatePluginManifest(createValidManifest())
    expect(errors).toEqual([])
  })

  it('rejects legacy contribution arrays loudly', () => {
    const errors = validatePluginManifest(createValidManifest({
      contributes: {
        views: [{ id: 'main', title: 'Demo', icon: 'plug' }],
      },
    }))

    expect(errors).toContainEqual({
      path: 'contributes',
      message: 'Manifest contribution arrays are not supported; register contributions at runtime',
    })
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
