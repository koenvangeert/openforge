import { describe, expect, it, vi } from 'vitest'

const { mockFilesView } = vi.hoisted(() => ({
  mockFilesView: { name: 'FilesViewComponent' },
}))

vi.mock('../../../src/components/FilesView.svelte', () => ({
  default: mockFilesView,
}))

import manifest from '../manifest.json'
import { validatePluginManifest } from '../../../src/lib/plugin/manifest'

describe('file-viewer plugin', () => {
  it('has a valid manifest', () => {
    const errors = validatePluginManifest(manifest)
    expect(errors).toEqual([])
  })

  it('activates the Files view contribution', async () => {
    const { activate, FilesViewComponent } = await import('./index')

    const result = await activate({
      invokeHost: async () => null,
      invokeBackend: async () => null,
      onEvent: () => () => {},
      storage: {
        get: async () => null,
        set: async () => {},
      },
    })

    expect(result.contributions.views).toHaveLength(1)
    expect(result.contributions.views?.[0]?.id).toBe('files')
    expect(result.contributions.views?.[0]?.component).toBe(FilesViewComponent)
    expect(FilesViewComponent).toBe(mockFilesView)
  })

  it('deactivates without throwing', async () => {
    const { deactivate } = await import('./index')

    await expect(deactivate()).resolves.toBeUndefined()
  })
})
