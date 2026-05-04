import { describe, expect, it } from 'vitest'
import { PRELOAD_BUNDLE_FILENAME, createPreloadPath } from './preloadPath'

describe('Electron preload runtime path', () => {
  it('uses a CommonJS preload bundle because sandboxed Electron preload scripts cannot load ESM import syntax', () => {
    expect(PRELOAD_BUNDLE_FILENAME).toBe('preload.cjs')
    expect(createPreloadPath('/tmp/dist-electron')).toBe('/tmp/dist-electron/preload.cjs')
  })
})
