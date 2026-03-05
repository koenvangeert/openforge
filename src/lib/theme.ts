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
  foreground: '#1f2937',
  cursor: '#1f2937',
  cursorAccent: '#ffffff',
  selectionBackground: '#bfdbfe',
  selectionForeground: '#1f2937',
  black: '#1f2937',
  red: '#dc2626',
  green: '#16a34a',
  yellow: '#ca8a04',
  blue: '#2563eb',
  magenta: '#9333ea',
  cyan: '#0891b2',
  white: '#f3f4f6',
  brightBlack: '#6b7280',
  brightRed: '#ef4444',
  brightGreen: '#22c55e',
  brightYellow: '#eab308',
  brightBlue: '#3b82f6',
  brightMagenta: '#a855f7',
  brightCyan: '#06b6d4',
  brightWhite: '#ffffff',
}

const DARK_TERMINAL_THEME: ITheme = {
  background: '#1E293B',
  foreground: '#E2E8F0',
  cursor: '#E2E8F0',
  cursorAccent: '#1E293B',
  selectionBackground: '#334155',
  selectionForeground: '#E2E8F0',
  black: '#1E293B',
  red: '#F87171',
  green: '#4ADE80',
  yellow: '#FACC15',
  blue: '#60A5FA',
  magenta: '#C084FC',
  cyan: '#22D3EE',
  white: '#E2E8F0',
  brightBlack: '#94A3B8',
  brightRed: '#FCA5A5',
  brightGreen: '#86EFAC',
  brightYellow: '#FDE68A',
  brightBlue: '#93C5FD',
  brightMagenta: '#D8B4FE',
  brightCyan: '#67E8F9',
  brightWhite: '#F8FAFC',
}

export function getTerminalTheme(mode: ThemeMode): ITheme {
  return mode === 'dark' ? DARK_TERMINAL_THEME : LIGHT_TERMINAL_THEME
}

export function getDiffTheme(mode: ThemeMode): 'light' | 'dark' {
  return mode
}
