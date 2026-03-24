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
  light: '#FAF8F5',
  dark: '#1C1A1F',
  lightAlt: '#F0EDE6',
  darkAlt: '#16141A',
}

export const PROJECT_COLORS: ProjectColor[] = [
  { id: 'slate',    label: 'Slate',    swatch: '#94a3b8', light: '#FAF8F5', dark: '#1C1A22', lightAlt: '#F0EDE6', darkAlt: '#16141C' },
  { id: 'rose',     label: 'Rose',     swatch: '#fb7185', light: '#FEF7F7', dark: '#1F1A1C', lightAlt: '#FCE8EA', darkAlt: '#1A1618' },
  { id: 'amber',    label: 'Amber',    swatch: '#fbbf24', light: '#FEFCE8', dark: '#1F1D18', lightAlt: '#FEF9C3', darkAlt: '#1A1914' },
  { id: 'emerald',  label: 'Emerald',  swatch: '#4CAF50', light: '#F0FDF4', dark: '#1A1F1C', lightAlt: '#DCFCE7', darkAlt: '#161A18' },
  { id: 'sky',      label: 'Sky',      swatch: '#38bdf8', light: '#F0F9FF', dark: '#1A1D22', lightAlt: '#E0F2FE', darkAlt: '#16191E' },
  { id: 'violet',   label: 'Violet',   swatch: '#6C63C9', light: '#F5F3FF', dark: '#1E1A24', lightAlt: '#EDE9FE', darkAlt: '#1A161E' },
  { id: 'pink',     label: 'Pink',     swatch: '#f472b6', light: '#FDF2F8', dark: '#1F1A1E', lightAlt: '#FCE7F3', darkAlt: '#1A161A' },
  { id: 'teal',     label: 'Teal',     swatch: '#2dd4bf', light: '#F0FDFA', dark: '#1A1F1F', lightAlt: '#CCFBF1', darkAlt: '#161A1A' },
  { id: 'orange',   label: 'Orange',   swatch: '#fb923c', light: '#FFF7ED', dark: '#1F1C18', lightAlt: '#FFEDD5', darkAlt: '#1A1814' },
  { id: 'indigo',   label: 'Indigo',   swatch: '#818cf8', light: '#EEF2FF', dark: '#1E1A24', lightAlt: '#E0E7FF', darkAlt: '#1A161E' },
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
