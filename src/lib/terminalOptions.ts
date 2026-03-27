import type { ITerminalOptions } from '@xterm/xterm'
import type { ThemeMode } from './theme'
import { getTerminalTheme } from './theme'

/**
 * Shared font family stack for all xterm terminals in the application.
 * Prioritizes JetBrains Mono with Nerd Font symbol support, with fallbacks
 * to monospace fonts available on most systems.
 */
export const TERMINAL_FONT_FAMILY = "'JetBrains Mono', 'Symbols Nerd Font', 'Symbols Nerd Font Mono', 'SF Mono', 'Fira Code', 'Consolas', monospace"

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
    fontSize: 13,
    lineHeight: 1.4,
    cursorBlink: true,
    cursorStyle: 'block',
    scrollback: 10000,
    theme: getTerminalTheme(themeMode),
    allowProposedApi: true,
  }
}
