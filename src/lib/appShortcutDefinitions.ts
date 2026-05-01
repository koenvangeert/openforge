export type AppShortcutAction =
  | 'showShortcuts'
  | 'openActionPalette'
  | 'toggleProjectSwitcher'
  | 'toggleSidebar'
  | 'openNewTaskDialog'
  | 'goBack'
  | 'toggleVoiceRecording'
  | 'toggleCommandPalette'
  | 'toggleFileQuickOpen'
  | 'resetToBoard'
  | 'navigateToSettings'
  | 'cycleNextProjectOnBoard'
  | 'cyclePreviousProjectOnBoard'
  | 'cyclePreviousProject'
  | 'cycleNextProject'

export interface AppShortcutRegistration {
  key: string
  action: AppShortcutAction
}

export interface ShortcutHelpEntry {
  id: string
  label: string
  keys: readonly (readonly string[])[]
}

export interface AppShortcutDefinition {
  id: string
  registrations: readonly AppShortcutRegistration[]
  help: ShortcutHelpEntry | null
}

export const APP_SHORTCUT_DEFINITIONS: readonly AppShortcutDefinition[] = [
  {
    id: 'switch-project',
    registrations: [{ key: '⌘⇧P', action: 'toggleProjectSwitcher' }],
    help: { id: 'switch-project', label: 'Switch Project', keys: [['⌘', '⇧', 'P']] },
  },
  {
    id: 'new-task',
    registrations: [{ key: '⌘N', action: 'openNewTaskDialog' }],
    help: { id: 'new-task', label: 'New Task', keys: [['⌘N']] },
  },
  {
    id: 'go-back',
    registrations: [
      { key: '⌘[', action: 'goBack' },
      { key: '⌘ArrowLeft', action: 'goBack' },
      { key: '⌃[', action: 'goBack' },
      { key: '⌃ArrowLeft', action: 'goBack' },
    ],
    help: { id: 'go-back', label: 'Go Back', keys: [['⌘[']] },
  },
  {
    id: 'refresh-github',
    registrations: [],
    help: { id: 'refresh-github', label: 'Refresh GitHub', keys: [['⌘', '⇧', 'R']] },
  },
  {
    id: 'voice-input',
    registrations: [
      { key: '⌘D', action: 'toggleVoiceRecording' },
      { key: '⌃D', action: 'toggleVoiceRecording' },
    ],
    help: { id: 'voice-input', label: 'Voice input', keys: [['⌘D']] },
  },
  {
    id: 'files',
    registrations: [
      { key: '⌘⇧O', action: 'toggleFileQuickOpen' },
      { key: '⌃⇧O', action: 'toggleFileQuickOpen' },
    ],
    help: { id: 'files', label: 'Files', keys: [['⌘', '⇧', 'O']] },
  },
  {
    id: 'terminal',
    registrations: [],
    help: { id: 'terminal', label: 'Terminal', keys: [['⌘J']] },
  },
  {
    id: 'search-tasks',
    registrations: [{ key: '⌘⇧F', action: 'toggleCommandPalette' }],
    help: { id: 'search-tasks', label: 'Search Tasks', keys: [['⌘', '⇧', 'F']] },
  },
  {
    id: 'action-palette',
    registrations: [{ key: '⌘K', action: 'openActionPalette' }],
    help: { id: 'action-palette', label: 'Action palette', keys: [['⌘K']] },
  },
  {
    id: 'show-shortcuts',
    registrations: [{ key: '?', action: 'showShortcuts' }],
    help: { id: 'show-shortcuts', label: 'Show shortcuts', keys: [['?']] },
  },
  {
    id: 'toggle-sidebar',
    registrations: [{ key: '⌘B', action: 'toggleSidebar' }],
    help: null,
  },
  {
    id: 'board',
    registrations: [{ key: '⌘H', action: 'resetToBoard' }],
    help: null,
  },
  {
    id: 'settings',
    registrations: [{ key: '⌘,', action: 'navigateToSettings' }],
    help: null,
  },
  {
    id: 'next-project-on-board',
    registrations: [{ key: '⌃N', action: 'cycleNextProjectOnBoard' }],
    help: null,
  },
  {
    id: 'previous-project-on-board',
    registrations: [{ key: '⌃P', action: 'cyclePreviousProjectOnBoard' }],
    help: null,
  },
  {
    id: 'previous-project',
    registrations: [{ key: '1', action: 'cyclePreviousProject' }],
    help: null,
  },
  {
    id: 'next-project',
    registrations: [{ key: '2', action: 'cycleNextProject' }],
    help: null,
  },
] as const

export function formatShortcutKeySequence(keys: readonly string[]): string {
  return keys.join('')
}

export function getAppShortcutDefinition(id: string): AppShortcutDefinition | null {
  return APP_SHORTCUT_DEFINITIONS.find((definition) => definition.id === id) ?? null
}

export function getAppShortcutHelpLabel(id: string): string | null {
  return getAppShortcutDefinition(id)?.help?.label ?? null
}

export function getPrimaryAppShortcutKey(id: string): string | null {
  const definition = getAppShortcutDefinition(id)
  return definition?.registrations[0]?.key ?? (definition?.help?.keys[0] ? formatShortcutKeySequence(definition.help.keys[0]) : null)
}

export function getGlobalShortcutHelpEntries(): ShortcutHelpEntry[] {
  return APP_SHORTCUT_DEFINITIONS
    .map((definition) => definition.help)
    .filter((entry): entry is ShortcutHelpEntry => entry !== null)
}
