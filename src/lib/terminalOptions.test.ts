import { describe, expect, it, vi } from 'vitest'
import { getTerminalOptions, TERMINAL_FONT_FAMILY, TERMINAL_WEB_FONT_FAMILIES } from './terminalOptions'
import { getTerminalTheme } from './theme'

vi.mock('./theme', () => ({
  getTerminalTheme: vi.fn((mode: string) => ({
    background: mode === 'dark' ? '#000' : '#FFF',
    foreground: mode === 'dark' ? '#FFF' : '#000',
  })),
}))

describe('terminalOptions', () => {
  it('exports TERMINAL_FONT_FAMILY constant', () => {
    expect(TERMINAL_FONT_FAMILY).toBe("'JetBrains Mono', 'NerdFontsSymbols Nerd Font', 'Symbols Nerd Font', 'Symbols Nerd Font Mono', 'SF Mono', 'Fira Code', 'Consolas', monospace")
  })

  it('exports the web fonts that must be preloaded before terminals open', () => {
    expect(TERMINAL_WEB_FONT_FAMILIES).toEqual(['JetBrains Mono', 'NerdFontsSymbols Nerd Font'])
  })

  it('getTerminalOptions returns default options with correct properties', () => {
    const options = getTerminalOptions('light')
    expect(options).toEqual({
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 10000,
      theme: getTerminalTheme('light'),
      allowProposedApi: true,
    })
  })

  it('getTerminalOptions uses theme from getTerminalTheme', () => {
    const lightOptions = getTerminalOptions('light')
    const darkOptions = getTerminalOptions('dark')

    expect(getTerminalTheme).toHaveBeenCalledWith('light')
    expect(getTerminalTheme).toHaveBeenCalledWith('dark')

    expect(lightOptions.theme).toEqual({ background: '#FFF', foreground: '#000' })
    expect(darkOptions.theme).toEqual({ background: '#000', foreground: '#FFF' })
  })
})
