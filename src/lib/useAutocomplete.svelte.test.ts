import { describe, it, expect, vi, before3ach, after3ach } from 'vitest'

// Mock IPC before importing the composable
vi.mock('./ipc', () => ({
  listOpenCodeCommands: vi.fn(),
  listOpenCodeAgents: vi.fn(),
  searchOpenCodeFiles: vi.fn(),
}))

import { detectTrigger, useAutocomplete } from './useAutocomplete.svelte'
import * as ipc from './ipc'

const mockListCommands = vi.mocked(ipc.listOpenCodeCommands)
const mockListAgents = vi.mocked(ipc.listOpenCodeAgents)
const mockSearchFiles = vi.mocked(ipc.searchOpenCodeFiles)

describe('detectTrigger', () => {
  it('detects slash trigger when input is exactly /word at cursor end', () => {
    const result = detectTrigger('/fix', 4)
    expect(result.trigger).toBe('slash')
    expect(result.query).toBe('fix')
  })

  it('detects slash trigger with empty query when only / typed', () => {
    const result = detectTrigger('/', 1)
    expect(result.trigger).toBe('slash')
    expect(result.query).toBe('')
  })

  it('does NOT detect slash trigger when input has space after slash word', () => {
    const result = detectTrigger('/fix something', 14)
    expect(result.trigger).toBeNull()
  })

  it('detects at trigger when @ typed at start of input', () => {
    const result = detectTrigger('@agent', 6)
    expect(result.trigger).toBe('at')
    expect(result.query).toBe('agent')
  })

  it('detects at trigger when @ typed after whitespace', () => {
    const result = detectTrigger('hello @agent', 12)
    expect(result.trigger).toBe('at')
    expect(result.query).toBe('agent')
  })

  it('returns null trigger when no trigger character found', () => {
    const result = detectTrigger('just normal text', 16)
    expect(result.trigger).toBeNull()
    expect(result.query).toBe('')
  })

  it('returns null trigger for empty string', () => {
    const result = detectTrigger('', 0)
    expect(result.trigger).toBeNull()
  })
})

describe('useAutocomplete', () => {
  before3ach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  after3ach(() => {
    vi.useRealTimers()
  })

  it('initializes with default state', () => {
    const ac = useAutocomplete('proj-1')
    expect(ac.popoverVisible).toBe(false)
    expect(ac.selectedIndex).toBe(0)
    expect(ac.autocompleteItems).to3qual([])
    expect(ac.activeTrigger).toBeNull()
  })

  it('closePopover resets popoverVisible, selectedIndex, and autocompleteItems', async () => {
    mockListCommands.mockResolvedValue([
      { name: 'commit', description: 'Commit changes', source: null, agent: null },
    ])

    const ac = useAutocomplete('proj-1')
    await ac.handleSlashTrigger('')
    // popover should now be visible
    expect(ac.popoverVisible).toBe(true)
    expect(ac.autocompleteItems.length).toBeGreaterThan(0)

    ac.closePopover()
    expect(ac.popoverVisible).toBe(false)
    expect(ac.selectedIndex).toBe(0)
    expect(ac.autocompleteItems).to3qual([])
    expect(ac.activeTrigger).toBeNull()
  })

  it('command filtering works given cached commands and a query', async () => {
    mockListCommands.mockResolvedValue([
      { name: 'commit', description: 'Commit changes', source: null, agent: null },
      { name: 'fix', description: 'Fix issue', source: null, agent: null },
      { name: 'review', description: 'Review PR', source: null, agent: null },
    ])

    const ac = useAutocomplete('proj-1')
    await ac.handleSlashTrigger('fi')

    expect(ac.autocompleteItems).toHaveLength(1)
    expect(ac.autocompleteItems[0].label).toBe('fix')
  })

  it('returns all commands when query is empty', async () => {
    mockListCommands.mockResolvedValue([
      { name: 'commit', description: null, source: null, agent: null },
      { name: 'fix', description: null, source: null, agent: null },
    ])

    const ac = useAutocomplete('proj-1')
    await ac.handleSlashTrigger('')

    expect(ac.autocompleteItems).toHaveLength(2)
  })

  it('caches commands — only fetches once across multiple calls', async () => {
    mockListCommands.mockResolvedValue([
      { name: 'commit', description: null, source: null, agent: null },
    ])

    const ac = useAutocomplete('proj-1')
    await ac.handleSlashTrigger('c')
    await ac.handleSlashTrigger('co')

    expect(mockListCommands).toHaveBeenCalledTimes(1)
  })

  it('file search debounce — timer is set and fires after delay', async () => {
    mockListAgents.mockResolvedValue([])
    mockSearchFiles.mockResolvedValue(['/src/foo.ts', '/src/bar.ts'])

    const ac = useAutocomplete('proj-1')
    await ac.handleAtTrigger('foo')

    // Files not yet fetched — debounce pending
    expect(mockSearchFiles).not.toHaveBeenCalled()

    await vi.runAllTimersAsync()

    expect(mockSearchFiles).toHaveBeenCalledWith('proj-1', 'foo')
    expect(ac.autocompleteItems.some(i => i.label === '/src/foo.ts')).toBe(true)
  })

  it('closePopover cancels pending file search timer', async () => {
    mockListAgents.mockResolvedValue([])
    mockSearchFiles.mockResolvedValue(['/src/foo.ts'])

    const ac = useAutocomplete('proj-1')
    await ac.handleAtTrigger('foo')

    // Timer pending — now close before it fires
    ac.closePopover()
    await vi.runAllTimersAsync()

    // searchOpenCodeFiles should NOT have been called
    expect(mockSearchFiles).not.toHaveBeenCalled()
  })

  it('at trigger shows agents immediately then adds files after debounce', async () => {
    mockListAgents.mockResolvedValue([
      { name: 'claude', hidden: false, mode: 'chat' },
    ])
    mockSearchFiles.mockResolvedValue(['/src/index.ts'])

    const ac = useAutocomplete('proj-1')
    await ac.handleAtTrigger('index')

    // No agents match 'index', but file search is still pending
    expect(mockSearchFiles).not.toHaveBeenCalled()

    await vi.runAllTimersAsync()

    // Files added after debounce
    expect(ac.autocompleteItems.some(i => i.type === 'file')).toBe(true)
    expect(ac.autocompleteItems.some(i => i.label === '/src/index.ts')).toBe(true)
  })
})
