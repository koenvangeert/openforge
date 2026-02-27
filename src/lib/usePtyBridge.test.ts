import { describe, it, expect, vi, before3ach } from 'vitest'

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}))

vi.mock('./ipc', () => ({
  getWorktreeForTask: vi.fn().mockResolvedValue(null),
  spawnPty: vi.fn().mockResolvedValue(1),
  writePty: vi.fn().mockResolvedValue(undefined),
  killPty: vi.fn().mockResolvedValue(undefined),
}))

import { createPtyBridge } from './usePtyBridge.svelte'
import { getWorktreeForTask, spawnPty, killPty } from './ipc'

describe('createPtyBridge', () => {
  let getTerminal: () => { cols: number; rows: number; write: (data: string) => void; focus: () => void } | null
  let setOpencodePort: (port: number) => void
  let onAttached: (sessionStatus?: string) => void
  const taskId = 'T-1'

  before3ach(() => {
    vi.clearAllMocks()
    getTerminal = vi.fn<() => { cols: number; rows: number; write: (data: string) => void; focus: () => void } | null>().mockReturnValue({ cols: 80, rows: 24, write: vi.fn(), focus: vi.fn() })
    setOpencodePort = vi.fn<(port: number) => void>()
    onAttached = vi.fn<(sessionStatus?: string) => void>()
    vi.mocked(getWorktreeForTask).mockResolvedValue(null)
    vi.mocked(spawnPty).mockResolvedValue(1)
    vi.mocked(killPty).mockResolvedValue(undefined)
  })

  it('starts with ptySpawned = false', () => {
    const bridge = createPtyBridge({ taskId, getTerminal, setOpencodePort, onAttached })
    expect(bridge.ptySpawned).toBe(false)
  })

  it('attachPty does nothing when getWorktreeForTask returns null', async () => {
    vi.mocked(getWorktreeForTask).mockResolvedValue(null)
    const bridge = createPtyBridge({ taskId, getTerminal, setOpencodePort, onAttached })
    await bridge.attachPty('ses-1')
    expect(bridge.ptySpawned).toBe(false)
    expect(onAttached).not.toHaveBeenCalled()
  })

  it('attachPty spawns PTY when worktree has opencode_port', async () => {
    vi.mocked(getWorktreeForTask).mockResolvedValue({ opencode_port: 9000 } as never)
    const bridge = createPtyBridge({ taskId, getTerminal, setOpencodePort, onAttached })
    await bridge.attachPty('ses-1')
    expect(bridge.ptySpawned).toBe(true)
    expect(spawnPty).toHaveBeenCalledWith(taskId, 9000, 'ses-1', 80, 24)
    expect(onAttached).toHaveBeenCalled()
  })

  it('attachPty calls setOpencodePort with discovered port', async () => {
    vi.mocked(getWorktreeForTask).mockResolvedValue({ opencode_port: 9001 } as never)
    const bridge = createPtyBridge({ taskId, getTerminal, setOpencodePort, onAttached })
    await bridge.attachPty('ses-1')
    expect(setOpencodePort).toHaveBeenCalledWith(9001)
  })

  it('attachPty is idempotent — second call does nothing when already spawned', async () => {
    vi.mocked(getWorktreeForTask).mockResolvedValue({ opencode_port: 9000 } as never)
    const bridge = createPtyBridge({ taskId, getTerminal, setOpencodePort, onAttached })
    await bridge.attachPty('ses-1')
    await bridge.attachPty('ses-1')
    expect(spawnPty).toHaveBeenCalledTimes(1)
  })

  it('killPty calls ipc killPty and sets ptySpawned to false', async () => {
    vi.mocked(getWorktreeForTask).mockResolvedValue({ opencode_port: 9000 } as never)
    const bridge = createPtyBridge({ taskId, getTerminal, setOpencodePort, onAttached })
    await bridge.attachPty('ses-1')
    expect(bridge.ptySpawned).toBe(true)
    await bridge.killPty()
    expect(killPty).toHaveBeenCalledWith(taskId)
    expect(bridge.ptySpawned).toBe(false)
  })

  it('writeToPty does not throw', () => {
    const bridge = createPtyBridge({ taskId, getTerminal, setOpencodePort, onAttached })
    expect(() => bridge.writeToPty('hello')).not.toThrow()
  })

  it('dispose does not throw', () => {
    const bridge = createPtyBridge({ taskId, getTerminal, setOpencodePort, onAttached })
    expect(() => bridge.dispose()).not.toThrow()
  })
})
