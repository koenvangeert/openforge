import { describe, expect, it } from 'vitest'
import { DESKTOP_ASSET_BASE } from './viteDesktopBuild'

describe('Vite desktop build configuration', () => {
  it('emits relative asset URLs so packaged Electron can load renderer files from file://', () => {
    expect(DESKTOP_ASSET_BASE).toBe('./')
  })
})
