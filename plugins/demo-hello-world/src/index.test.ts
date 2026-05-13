import { describe, it, expect } from 'vitest'
import manifest from '../manifest.json'
import { validatePluginManifest } from '../../../src/lib/plugin/manifest'

describe('demo-hello-world plugin', () => {
  it('has a valid manifest', () => {
    const errors = validatePluginManifest(manifest)
    expect(errors).toEqual([])
  })

  it('manifest has required fields', () => {
    expect(manifest.id).toBe('com.openforge.demo-hello')
    expect(manifest.apiVersion).toBe(1)
    expect(manifest.contributes.views).toHaveLength(1)
    expect(manifest.contributes.views[0].icon).toBe('plug')
  })

  it('contributes all expected types', () => {
    expect(manifest.contributes.views).toBeDefined()
    expect(manifest.contributes.taskPaneTabs).toBeDefined()
    expect(manifest.contributes.commands).toBeDefined()
    expect(manifest.contributes.settingsSections).toBeDefined()
  })
})
