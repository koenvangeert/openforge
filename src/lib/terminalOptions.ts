import type { ITerminalOptions } from '@xterm/xterm'
import type { ThemeMode } from './theme'
import { getTerminalTheme } from './theme'

const TERMINAL_FONT_SIZE = 13
const TERMINAL_FONT_PRELOAD_TIMEOUT_MS = 3000

export const TERMINAL_WEB_FONT_FAMILIES = ['JetBrains Mono', 'NerdFontsSymbols Nerd Font']

/**
 * Shared font family stack for all xterm terminals in the application.
 * Prioritizes JetBrains Mono with bundled Nerd Font symbol support, then
 * falls back to system-installed symbol and monospace fonts.
 */
export const TERMINAL_FONT_FAMILY = "'JetBrains Mono', 'NerdFontsSymbols Nerd Font', 'Symbols Nerd Font', 'Symbols Nerd Font Mono', 'SF Mono', 'Fira Code', 'Consolas', monospace"

/**
 * Preloads the bundled terminal fonts so xterm measures glyph widths against
 * the correct font faces before opening into the DOM.
 */
export async function preloadTerminalFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) {
    return
  }

  const fontLoads = TERMINAL_WEB_FONT_FAMILIES.map(fontFamily => document.fonts.load(`${TERMINAL_FONT_SIZE}px "${fontFamily}"`))

  await Promise.race([
    Promise.allSettled(fontLoads).then(() => undefined),
    new Promise<void>(resolve => setTimeout(resolve, TERMINAL_FONT_PRELOAD_TIMEOUT_MS)),
  ])
}

/**
 * Returns the default xterm terminal options.
 * These options are shared across all terminal instances in the application
 * to ensure consistent font, sizing, behavior, and theming.
 *
 * @param themeMode The current theme mode ('light' or 'dark')
 * @returns Terminal options compatible with xterm's ITerminalOptions interface
 */
export function getTerminalOptions(themeMode: ThemeMode): ITerminalOptions {
  return {
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: TERMINAL_FONT_SIZE,
    lineHeight: 1.4,
    cursorBlink: true,
    cursorStyle: 'block',
    scrollback: 10000,
    theme: getTerminalTheme(themeMode),
    allowProposedApi: true,
  }
}
