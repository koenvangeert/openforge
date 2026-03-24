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
  background: '#ffffff',
  foreground: '#374151',
  cursor: '#374151',
  cursorAccent: '#ffffff',
  selectionBackground: '#dbeafe',
  selectionForeground: '#374151',
  black: '#374151',
  red: '#dc2626',
  green: '#34d399',
  yellow: '#ca8a04',
  blue: '#2563eb',
  magenta: '#9333ea',
  cyan: '#0891b2',
  white: '#f3f4f6',
  brightBlack: '#6b7280',
  brightRed: '#ef4444',
  brightGreen: '#6ee7b7',
  brightYellow: '#eab308',
  brightBlue: '#3b82f6',
  brightMagenta: '#a855f7',
  brightCyan: '#06b6d4',
  brightWhite: '#ffffff',
}

const DARK_TERMINAL_THEME: ITheme = {
  background: '#1A1D23',
  foreground: '#D1D5DB',
  cursor: '#D1D5DB',
  cursorAccent: '#1A1D23',
  selectionBackground: '#2A2E37',
  selectionForeground: '#D1D5DB',
  black: '#1A1D23',
  red: '#F87171',
  green: '#34D399',
  yellow: '#FACC15',
  blue: '#60A5FA',
  magenta: '#C084FC',
  cyan: '#22D3EE',
  white: '#D1D5DB',
  brightBlack: '#9CA3AF',
  brightRed: '#FCA5A5',
  brightGreen: '#6EE7B7',
  brightYellow: '#FDE68A',
  brightBlue: '#93C5FD',
  brightMagenta: '#D8B4FE',
  brightCyan: '#67E8F9',
  brightWhite: '#F3F4F6',
}

export function getTerminalTheme(mode: ThemeMode): ITheme {
  return mode === 'dark' ? DARK_TERMINAL_THEME : LIGHT_TERMINAL_THEME
}

export function getDiffTheme(mode: ThemeMode): 'light' | 'dark' {
  return mode
}
