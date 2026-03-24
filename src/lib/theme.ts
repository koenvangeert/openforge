import { writable } from 'svelte/store'
import { getConfig, setConfig } from './ipc'
import type { ITheme } from '@xterm/xterm'

export type ThemeMode = 'light' | 'dark'

export const themeMode = writable<ThemeMode>('light')

const THEME_NAMES: Record<ThemeMode, string> = {
  light: 'openforge',
  dark: 'openforge-dark',
}

/**
 * Apply a theme mode: sets the data-theme attribute on <html>,
 * updates the reactive store, and persists the preference.
 */
export function applyTheme(mode: ThemeMode): void {
  document.documentElement.setAttribute('data-theme', THEME_NAMES[mode])
  themeMode.set(mode)
  setConfig('theme', mode).catch((e) =>
    console.error('Failed to persist theme:', e)
  )
}

/**
 * Load stored theme preference from backend config and apply it.
 * Falls back to light mode if no preference is stored or on error.
 */
export async function initTheme(): Promise<void> {
  let mode: ThemeMode = 'light'
  try {
    const stored = await getConfig('theme')
    if (stored === 'dark') {
      mode = 'dark'
    }
  } catch {
    // fallthrough: use default light mode
  }
  document.documentElement.setAttribute('data-theme', THEME_NAMES[mode])
  themeMode.set(mode)
}

const LIGHT_TERMINAL_THEME: ITheme = {
  background: '#FAF8F5',
  foreground: '#2D2D3F',
  cursor: '#2D2D3F',
  cursorAccent: '#FAF8F5',
  selectionBackground: '#E8E4DF',
  selectionForeground: '#2D2D3F',
  black: '#2D2D3F',
  red: '#DC2626',
  green: '#4CAF50',
  yellow: '#E8A820',
  blue: '#6C63C9',
  magenta: '#9333ea',
  cyan: '#0891b2',
  white: '#F0EDE6',
  brightBlack: '#8A8AA0',
  brightRed: '#ef4444',
  brightGreen: '#66BB6A',
  brightYellow: '#eab308',
  brightBlue: '#8B82E0',
  brightMagenta: '#a855f7',
  brightCyan: '#06b6d4',
  brightWhite: '#FAF8F5',
}

const DARK_TERMINAL_THEME: ITheme = {
  background: '#1C1A1F',
  foreground: '#D8D4DE',
  cursor: '#D8D4DE',
  cursorAccent: '#1C1A1F',
  selectionBackground: '#2E2A34',
  selectionForeground: '#D8D4DE',
  black: '#1C1A1F',
  red: '#F87171',
  green: '#66BB6A',
  yellow: '#FACC15',
  blue: '#8B82E0',
  magenta: '#C084FC',
  cyan: '#22D3EE',
  white: '#D8D4DE',
  brightBlack: '#9A98AE',
  brightRed: '#FCA5A5',
  brightGreen: '#81C784',
  brightYellow: '#FDE68A',
  brightBlue: '#A9A0F0',
  brightMagenta: '#D8B4FE',
  brightCyan: '#67E8F9',
  brightWhite: '#E8E4EE',
}

export function getTerminalTheme(mode: ThemeMode): ITheme {
  return mode === 'dark' ? DARK_TERMINAL_THEME : LIGHT_TERMINAL_THEME
}

export function getDiffTheme(mode: ThemeMode): 'light' | 'dark' {
  return mode
}
