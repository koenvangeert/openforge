import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import { getConfig, setConfig } from './ipc'
import { applyTheme, getDiffTheme, getTerminalTheme, initTheme, themeMode } from './theme'

vi.mock('./ipc', () => ({
  getConfig: vi.fn().mockResolvedValue(null),
  setConfig: vi.fn().mockResolvedValue(undefined),
}))

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
    let getComputedStyleSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      const originalGetComputedStyle = window.getComputedStyle.bind(window)

      getComputedStyleSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation((elt) => {
        const style = originalGetComputedStyle(elt)
        const theme = elt.getAttribute('data-theme')

        return new Proxy(style, {
          get(target, property, receiver) {
            if (property === 'getPropertyValue') {
              return (prop: string) => {
                if (theme === 'openforge' && prop === '--term-background') return '#111111'
                if (theme === 'openforge' && prop === '--term-foreground') return '#222222'
                if (theme === 'openforge-dark' && prop === '--term-background') return '#333333'
                if (theme === 'openforge-dark' && prop === '--term-foreground') return '#444444'
                return target.getPropertyValue(prop)
              }
            }

            return Reflect.get(target, property, receiver)
          },
        })
      })
    })

    afterEach(() => {
      getComputedStyleSpy.mockRestore()
    })

    it('resolves light terminal theme from CSS variables', () => {
      const theme = getTerminalTheme('light')
      expect(theme.background).toBe('#111111')
      expect(theme.foreground).toBe('#222222')
    })

    it('resolves dark terminal theme from CSS variables', () => {
      const theme = getTerminalTheme('dark')
      expect(theme.background).toBe('#333333')
      expect(theme.foreground).toBe('#444444')
    })

    it('falls back to the Catppuccin Latte terminal palette if CSS variables are not present', () => {
      getComputedStyleSpy.mockRestore()
      const theme = getTerminalTheme('light')
      expect(theme.background).toBe('#EFF1F5')
      expect(theme.foreground).toBe('#4C4F69')
    })

    it('falls back to hardcoded dark theme if CSS variables are not present', () => {
      getComputedStyleSpy.mockRestore()
      const theme = getTerminalTheme('dark')
      expect(theme.background).toBe('#1C1A1F')
      expect(theme.foreground).toBe('#D8D4DE')
    })

    it('ensures dark terminal ANSI black is distinctly visible from the background', () => {
      getComputedStyleSpy.mockRestore()
      const theme = getTerminalTheme('dark')
      expect(theme.black).not.toEqual(theme.background)
      expect(theme.black).toBe('#454250')
    })

    it('uses the Catppuccin Latte ANSI palette for light terminal fallbacks', () => {
      getComputedStyleSpy.mockRestore()
      const theme = getTerminalTheme('light')
      expect(theme.black).toBe('#5C5F77')
      expect(theme.red).toBe('#D20F39')
      expect(theme.green).toBe('#40A02B')
      expect(theme.yellow).toBe('#DF8E1D')
      expect(theme.blue).toBe('#1E66F5')
      expect(theme.magenta).toBe('#EA76CB')
      expect(theme.cyan).toBe('#179299')
      expect(theme.white).toBe('#ACB0BE')
    })

    it('returns a fresh theme object on each call', () => {
      expect(getTerminalTheme('light')).not.toBe(getTerminalTheme('light'))
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
