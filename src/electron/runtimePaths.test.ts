import { describe, expect, it, vi } from 'vitest'
import { configureElectronUserDataPath, electronUserDataDirFromEnv } from './runtimePaths'

describe('Electron runtime path isolation', () => {
  it('reads a non-empty Electron userData override from env', () => {
    expect(electronUserDataDirFromEnv({ OPENFORGE_ELECTRON_USER_DATA_DIR: '/tmp/openforge-user' })).toBe('/tmp/openforge-user')
    expect(electronUserDataDirFromEnv({ OPENFORGE_ELECTRON_USER_DATA_DIR: '   ' })).toBeNull()
    expect(electronUserDataDirFromEnv({})).toBeNull()
  })

  it('applies the userData override before Electron app readiness', () => {
    const app = { setPath: vi.fn() }

    expect(configureElectronUserDataPath(app, { OPENFORGE_ELECTRON_USER_DATA_DIR: '/tmp/openforge-user' })).toBe('/tmp/openforge-user')
    expect(app.setPath).toHaveBeenCalledWith('userData', '/tmp/openforge-user')
  })
})
