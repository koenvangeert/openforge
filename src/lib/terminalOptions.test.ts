import { describe, expect, it, vi } from 'vitest'
import { getTerminalOptions, TERMINAL_CELL_HEIGHT, TERMINAL_FONT_FAMILY, TERMINAL_FONT_SIZE, TERMINAL_WEB_FONT_FACES } from './terminalOptions'
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

  it('exports the web font faces that must be preloaded before terminals open', () => {
    expect(TERMINAL_WEB_FONT_FACES).toEqual([
      { family: 'JetBrains Mono', weight: 400, style: 'normal' },
      { family: 'JetBrains Mono', weight: 700, style: 'normal' },
      { family: 'JetBrains Mono', weight: 400, style: 'italic' },
      { family: 'JetBrains Mono', weight: 700, style: 'italic' },
      { family: 'NerdFontsSymbols Nerd Font', weight: 400, style: 'normal' },
    ])
  })

  it('keeps WebGL/canvas terminal cells on integer CSS pixels to avoid glyph atlas drift', () => {
    expect(TERMINAL_FONT_SIZE).toBe(13)
    expect(TERMINAL_CELL_HEIGHT).toBe(18)
    expect(getTerminalOptions('light').lineHeight).toBe(TERMINAL_CELL_HEIGHT / TERMINAL_FONT_SIZE)
  })

  it('getTerminalOptions returns default options with correct properties', () => {
    const options = getTerminalOptions('light')
    expect(options).toEqual({
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: TERMINAL_FONT_SIZE,
      fontWeight: 400,
      fontWeightBold: 700,
      letterSpacing: 0,
      lineHeight: TERMINAL_CELL_HEIGHT / TERMINAL_FONT_SIZE,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 10000,
      minimumContrastRatio: 4.5,
      theme: getTerminalTheme('light'),
      allowProposedApi: true,
    })
  })

  it('enforces WCAG AA contrast for ANSI colors that would otherwise be hard to read in light theme output', () => {
    expect(getTerminalOptions('light').minimumContrastRatio).toBe(4.5)
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
