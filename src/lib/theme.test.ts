import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { get } from 'svelte/store'

vi.mock('./ipc', () => ({
  getConfig: vi.fn().mockResolvedValue(null),
  setConfig: vi.fn().mockResolvedValue(undefined),
}))

import { themeMode, applyTheme, initTheme, getTerminalTheme, getDiffTheme } from './theme'
import { getConfig, setConfig } from './ipc'

describe('theme', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.removeAttribute('data-theme')
  })

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme')
  })

  describe('themeMode store', () => {
    it('defaults to light', () => {
      expect(get(themeMode)).toBe('light')
    })
  })

  describe('applyTheme', () => {
    it('sets data-theme attribute on document element for light', () => {
      applyTheme('light')
      expect(document.documentElement.getAttribute('data-theme')).toBe('openforge')
    })

    it('sets data-theme attribute on document element for dark', () => {
      applyTheme('dark')
      expect(document.documentElement.getAttribute('data-theme')).toBe('openforge-dark')
    })

    it('updates the themeMode store', () => {
      applyTheme('dark')
      expect(get(themeMode)).toBe('dark')
      applyTheme('light')
      expect(get(themeMode)).toBe('light')
    })

    it('persists preference via setConfig', () => {
      applyTheme('dark')
      expect(setConfig).toHaveBeenCalledWith('theme', 'dark')
    })
  })

  describe('initTheme', () => {
    it('loads stored theme and applies it', async () => {
      vi.mocked(getConfig).mockResolvedValue('dark')
      await initTheme()
      expect(getConfig).toHaveBeenCalledWith('theme')
      expect(document.documentElement.getAttribute('data-theme')).toBe('openforge-dark')
      expect(get(themeMode)).toBe('dark')
    })

    it('defaults to light when no stored theme', async () => {
      vi.mocked(getConfig).mockResolvedValue(null)
      await initTheme()
      expect(document.documentElement.getAttribute('data-theme')).toBe('openforge')
      expect(get(themeMode)).toBe('light')
    })

    it('defaults to light on config error', async () => {
      vi.mocked(getConfig).mockRejectedValue(new Error('config error'))
      await initTheme()
      expect(document.documentElement.getAttribute('data-theme')).toBe('openforge')
      expect(get(themeMode)).toBe('light')
    })
  })

  describe('getTerminalTheme', () => {
    it('returns light terminal theme by default', () => {
      const theme = getTerminalTheme('light')
      expect(theme.background).toBe('#FAF8F5')
      expect(theme.foreground).toBe('#2D2D3F')
    })

    it('returns dark terminal theme', () => {
      const theme = getTerminalTheme('dark')
      expect(theme.background).toBe('#1C1A1F')
      expect(theme.foreground).toBe('#D8D4DE')
    })
  })

  describe('getDiffTheme', () => {
    it('returns light for light mode', () => {
      expect(getDiffTheme('light')).toBe('light')
    })

    it('returns dark for dark mode', () => {
      expect(getDiffTheme('dark')).toBe('dark')
    })
  })
})
