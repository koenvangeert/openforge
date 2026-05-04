import { describe, expect, it, vi } from 'vitest'
import { resolveElectronSidecarPath } from './sidecarPath'

describe('Electron packaged sidecar path resolution', () => {
  it('uses OPENFORGE_SIDECAR_PATH when explicitly provided', () => {
    const exists = vi.fn(() => false)

    expect(resolveElectronSidecarPath({ OPENFORGE_SIDECAR_PATH: '/tmp/custom-sidecar' }, '/app/dist-electron', 'darwin', exists)).toBe('/tmp/custom-sidecar')
    expect(exists).not.toHaveBeenCalled()
  })

  it('resolves the bundled macOS sidecar next to the packaged app executable', () => {
    const exists = vi.fn((path: string) => path === '/Applications/Open Forge.app/Contents/MacOS/openforge-sidecar')

    expect(resolveElectronSidecarPath({}, '/Applications/Open Forge.app/Contents/Resources/app/dist-electron', 'darwin', exists)).toBe('/Applications/Open Forge.app/Contents/MacOS/openforge-sidecar')
  })

  it('returns null in development when no bundled sidecar exists', () => {
    expect(resolveElectronSidecarPath({}, '/repo/dist-electron', 'darwin', () => false)).toBeNull()
  })
})
