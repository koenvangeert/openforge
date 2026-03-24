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
  light: '#f9fafb',
  dark: '#1a1d23',
  lightAlt: '#f3f4f6',
  darkAlt: '#15171c',
}

export const PROJECT_COLORS: ProjectColor[] = [
  { id: 'slate',    label: 'Slate',    swatch: '#94a3b8', light: '#f9fafb', dark: '#1a1d25', lightAlt: '#f3f4f6', darkAlt: '#161920' },
  { id: 'rose',     label: 'Rose',     swatch: '#fb7185', light: '#fef7f7', dark: '#1e1a1c', lightAlt: '#fce8ea', darkAlt: '#1a1618' },
  { id: 'amber',    label: 'Amber',    swatch: '#fbbf24', light: '#fefce8', dark: '#1e1d18', lightAlt: '#fef9c3', darkAlt: '#1a1914' },
  { id: 'emerald',  label: 'Emerald',  swatch: '#34d399', light: '#f0fdf4', dark: '#1a1e1c', lightAlt: '#dcfce7', darkAlt: '#161a18' },
  { id: 'sky',      label: 'Sky',      swatch: '#38bdf8', light: '#f0f9ff', dark: '#1a1d22', lightAlt: '#e0f2fe', darkAlt: '#16191e' },
  { id: 'violet',   label: 'Violet',   swatch: '#a78bfa', light: '#f5f3ff', dark: '#1c1a22', lightAlt: '#ede9fe', darkAlt: '#18161e' },
  { id: 'pink',     label: 'Pink',     swatch: '#f472b6', light: '#fdf2f8', dark: '#1e1a1e', lightAlt: '#fce7f3', darkAlt: '#1a161a' },
  { id: 'teal',     label: 'Teal',     swatch: '#2dd4bf', light: '#f0fdfa', dark: '#1a1e1e', lightAlt: '#ccfbf1', darkAlt: '#161a1a' },
  { id: 'orange',   label: 'Orange',   swatch: '#fb923c', light: '#fff7ed', dark: '#1e1c18', lightAlt: '#ffedd5', darkAlt: '#1a1814' },
  { id: 'indigo',   label: 'Indigo',   swatch: '#818cf8', light: '#eef2ff', dark: '#1c1a22', lightAlt: '#e0e7ff', darkAlt: '#18161e' },
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
