import { listOpenCodeAgents, listOpenCodeCommands, searchOpenCodeFiles } from './ipc'
import type { AutocompleteAgentInfo, AutocompleteItem, CommandInfo } from './types'

// ── Types ──────────────────────────────────────────────────────────────────────

export type TriggerType = 'at' | 'slash' | null

export interface AutocompleteState {
  readonly activeTrigger: TriggerType
  readonly autocompleteItems: AutocompleteItem[]
  readonly popoverVisible: boolean
  readonly selectedIndex: number

  handleTriggerDetection: (text: string, cursorPos: number) => Promise<void>
  handleSlashTrigger: (query: string) => Promise<void>
  handleAtTrigger: (query: string) => Promise<void>
  closePopover: () => void
  setSelectedIndex: (index: number) => void
}

// ── Pure helper — exported for testing ────────────────────────────────────────

export function detectTrigger(text: string, cursorPos: number): { trigger: TriggerType; query: string } {
  // `/` trigger: ONLY when entire input is `/` + optional word (nothing else)
  if (/^\/(\S*)$/.test(text)) {
    const query = text.slice(1)
    // Cursor must be within the slash+word
    if (cursorPos <= text.length) {
      return { trigger: 'slash', query }
    }
  }

  // `@` trigger: after whitespace or at start of input, before cursor
  const textBeforeCursor = text.slice(0, cursorPos)
  const atMatch = textBeforeCursor.match(/(^|[\s\n])@(\S*)$/)
  if (atMatch) {
    return { trigger: 'at', query: atMatch[2] }
  }

  return { trigger: null, query: '' }
}

// ── Composable ────────────────────────────────────────────────────────────────

export function useAutocomplete(projectId: string): AutocompleteState {
  let activeTrigger = $state<TriggerType>(null)
  let autocompleteItems = $state<AutocompleteItem[]>([])
  let popoverVisible = $state(false)
  let selectedIndex = $state(0)

  let cachedAgents = $state<AutocompleteAgentInfo[] | null>(null)
  let cachedCommands = $state<CommandInfo[] | null>(null)

  let fileSearchTimer: ReturnType<typeof setTimeout> | null = null

  async function handleTriggerDetection(text: string, cursorPos: number): Promise<void> {
    const { trigger, query } = detectTrigger(text, cursorPos)
    activeTrigger = trigger

    if (trigger === 'slash') {
      await handleSlashTrigger(query)
    } else if (trigger === 'at') {
      await handleAtTrigger(query)
    } else {
      closePopover()
    }
  }

  async function handleSlashTrigger(query: string): Promise<void> {
    try {
      if (!cachedCommands) {
        cachedCommands = await listOpenCodeCommands(projectId)
      }

      const lower = query.toLowerCase()
      const filtered = cachedCommands.filter(cmd =>
        !query || cmd.name.toLowerCase().includes(lower)
      )

      autocompleteItems = filtered.map(cmd => ({
        label: cmd.name,
        description: cmd.description,
        type: (cmd.source === 'skill' ? 'skill' : 'command') as AutocompleteItem['type'],
        source: cmd.source
      }))

      popoverVisible = autocompleteItems.length > 0
      selectedIndex = 0
    } catch (e) {
      console.error('[useAutocomplete] Failed to fetch commands:', e)
      closePopover()
    }
  }

  async function handleAtTrigger(query: string): Promise<void> {
    // Fetch agents once, filter client-side
    try {
      if (!cachedAgents) {
        cachedAgents = await listOpenCodeAgents(projectId)
      }
    } catch (e) {
      console.error('[useAutocomplete] Failed to fetch agents:', e)
      cachedAgents = []
    }

    const lower = query.toLowerCase()
    const agentItems: AutocompleteItem[] = (cachedAgents ?? [])
      .filter(a => !a.hidden && a.mode !== 'primary')
      .filter(a => !query || a.name.toLowerCase().includes(lower))
      .map(a => ({ label: a.name, description: null, type: 'agent' as const }))

    // Show agents immediately, then fetch files with debounce
    autocompleteItems = agentItems
    popoverVisible = agentItems.length > 0
    selectedIndex = 0

    if (fileSearchTimer) clearTimeout(fileSearchTimer)

    fileSearchTimer = setTimeout(async () => {
      fileSearchTimer = null
      try {
        const filePaths = query ? await searchOpenCodeFiles(projectId, query) : []
        const fileItems: AutocompleteItem[] = filePaths.map(path => ({
          label: path,
          description: null,
          type: (path.endsWith('/') ? 'directory' : 'file') as AutocompleteItem['type']
        }))

        // Re-filter agents in case value changed during debounce
        const lower2 = query.toLowerCase()
        const freshAgentItems: AutocompleteItem[] = (cachedAgents ?? [])
          .filter(a => !a.hidden && a.mode !== 'primary')
          .filter(a => !query || a.name.toLowerCase().includes(lower2))
          .map(a => ({ label: a.name, description: null, type: 'agent' as const }))

        autocompleteItems = [...freshAgentItems, ...fileItems]
        popoverVisible = autocompleteItems.length > 0
        if (selectedIndex >= autocompleteItems.length) selectedIndex = 0
      } catch (e) {
        console.error('[useAutocomplete] Failed to search files:', e)
        // Keep agent-only results visible
        popoverVisible = agentItems.length > 0
      }
    }, 150)
  }

  function closePopover(): void {
    if (fileSearchTimer) {
      clearTimeout(fileSearchTimer)
      fileSearchTimer = null
    }
    popoverVisible = false
    autocompleteItems = []
    selectedIndex = 0
    activeTrigger = null
  }

  function setSelectedIndex(index: number): void {
    selectedIndex = index
  }

  return {
    get activeTrigger() { return activeTrigger },
    get autocompleteItems() { return autocompleteItems },
    get popoverVisible() { return popoverVisible },
    get selectedIndex() { return selectedIndex },

    handleTriggerDetection,
    handleSlashTrigger,
    handleAtTrigger,
    closePopover,
    setSelectedIndex,
  }
}
