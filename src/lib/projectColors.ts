export interface ProjectColor {
  id: string
  label: string
  /** Swatch color shown in the picker (same in both themes) */
  swatch: string
  /** Very subtle background for light theme */
  light: string
  /** Very subtle background for dark theme */
  dark: string
  /** Slightly deeper tint for headers/icon rail in light theme */
  lightAlt: string
  /** Slightly deeper tint for headers/icon rail in dark theme */
  darkAlt: string
}

export const DEFAULT_PROJECT_COLOR: ProjectColor = {
  id: 'default',
  label: 'Default Gray',
  swatch: '#9ca3af',
  light: '#f6f7f8',
  dark: '#1b1f24',
  lightAlt: '#eceff1',
  darkAlt: '#161a1f',
}

export const PROJECT_COLORS: ProjectColor[] = [
  { id: 'slate',    label: 'Slate',    swatch: '#94a3b8', light: '#f8fafc', dark: '#1a1f2e', lightAlt: '#f1f5f9', darkAlt: '#161b28' },
  { id: 'rose',     label: 'Rose',     swatch: '#fb7185', light: '#fff5f5', dark: '#2a1a1e', lightAlt: '#ffe4e6', darkAlt: '#24161a' },
  { id: 'amber',    label: 'Amber',    swatch: '#fbbf24', light: '#fffbeb', dark: '#2a2518', lightAlt: '#fef3c7', darkAlt: '#242014' },
  { id: 'emerald',  label: 'Emerald',  swatch: '#34d399', light: '#f0fdf4', dark: '#1a2a22', lightAlt: '#dcfce7', darkAlt: '#16241e' },
  { id: 'sky',      label: 'Sky',      swatch: '#38bdf8', light: '#f0f9ff', dark: '#1a222e', lightAlt: '#e0f2fe', darkAlt: '#161e28' },
  { id: 'violet',   label: 'Violet',   swatch: '#a78bfa', light: '#f5f3ff', dark: '#221a2e', lightAlt: '#ede9fe', darkAlt: '#1e1628' },
  { id: 'pink',     label: 'Pink',     swatch: '#f472b6', light: '#fdf2f8', dark: '#2a1a26', lightAlt: '#fce7f3', darkAlt: '#241622' },
  { id: 'teal',     label: 'Teal',     swatch: '#2dd4bf', light: '#f0fdfa', dark: '#1a2a28', lightAlt: '#ccfbf1', darkAlt: '#162424' },
  { id: 'orange',   label: 'Orange',   swatch: '#fb923c', light: '#fff7ed', dark: '#2a2018', lightAlt: '#ffedd5', darkAlt: '#241c14' },
  { id: 'indigo',   label: 'Indigo',   swatch: '#818cf8', light: '#eef2ff', dark: '#1e1a2e', lightAlt: '#e0e7ff', darkAlt: '#1a1628' },
]

export function getNextAvailableColor(usedColorIds: string[]): string {
  const usedSet = new Set(usedColorIds)

  for (const color of PROJECT_COLORS) {
    if (!usedSet.has(color.id)) {
      return color.id
    }
  }

  return PROJECT_COLORS[0].id
}

export function getProjectColor(colorId: string | null): ProjectColor {
  if (!colorId) return DEFAULT_PROJECT_COLOR
  return PROJECT_COLORS.find(c => c.id === colorId) ?? DEFAULT_PROJECT_COLOR
}
