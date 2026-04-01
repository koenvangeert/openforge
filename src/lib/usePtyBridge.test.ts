import { beforeEach, describe, expect, it, vi } from 'vitest'

const listenCallbacks = new Map<string, (event: { payload?: { instance_id?: number } }) => void>()

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (eventName: string, callback: (event: { payload?: { instance_id?: number } }) => void) => {
    listenCallbacks.set(eventName, callback)
    return () => {
      listenCallbacks.delete(eventName)
    }
  }),
}))

vi.mock('./ipc', () => ({
  getTaskWorkspace: vi.fn().mockResolvedValue(null),
  spawnPty: vi.fn().mockResolvedValue(1),
  writePty: vi.fn().mockResolvedValue(undefined),
  killPty: vi.fn().mockResolvedValue(undefined),
}))

import { createPtyBridge } from './usePtyBridge.svelte'
import { getTaskWorkspace, spawnPty, killPty } from './ipc'

describe('createPtyBridge', () => {
  let getTerminal: () => { cols: number; rows: number; write: (data: string) => void; focus: () => void } | null
  let setOpencodePort: (port: number) => void
  let onAttached: (sessionStatus?: string) => void
  const taskId = 'T-1'

  beforeEach(() => {
    vi.clearAllMocks()
    listenCallbacks.clear()
    getTerminal = vi.fn<() => { cols: number; rows: number; write: (data: string) => void; focus: () => void } | null>().mockReturnValue({ cols: 80, rows: 24, write: vi.fn(), focus: vi.fn() })
    setOpencodePort = vi.fn<(port: number) => void>()
    onAttached = vi.fn<(sessionStatus?: string) => void>()
    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
    vi.mocked(spawnPty).mockResolvedValue(1)
    vi.mocked(killPty).mockResolvedValue(undefined)
  })

  it('starts with ptySpawned = false', () => {
    const bridge = createPtyBridge({ taskId, getTerminal, setOpencodePort, onAttached })
    expect(bridge.ptySpawned).toBe(false)
  })

  it('attachPty does nothing when getTaskWorkspace returns null (opencode)', async () => {
    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
    const bridge = createPtyBridge({ taskId, getTerminal, setOpencodePort, onAttached })
    await bridge.attachPty({ opencodeSessionId: 'ses-1' })
    expect(bridge.ptySpawned).toBe(false)
    expect(onAttached).not.toHaveBeenCalled()
  })

  it('attachPty spawns PTY when workspace has opencode_port', async () => {
    vi.mocked(getTaskWorkspace).mockResolvedValue({ opencode_port: 9000 } as never)
    const bridge = createPtyBridge({ taskId, getTerminal, setOpencodePort, onAttached })
    await bridge.attachPty({ opencodeSessionId: 'ses-1' })
    expect(bridge.ptySpawned).toBe(true)
    expect(spawnPty).toHaveBeenCalledWith(taskId, 9000, 'ses-1', 80, 24)
    expect(onAttached).toHaveBeenCalled()
  })

  it('attachPty calls setOpencodePort with discovered port', async () => {
    vi.mocked(getTaskWorkspace).mockResolvedValue({ opencode_port: 9001 } as never)
    const bridge = createPtyBridge({ taskId, getTerminal, setOpencodePort, onAttached })
    await bridge.attachPty({ opencodeSessionId: 'ses-1' })
    expect(setOpencodePort).toHaveBeenCalledWith(9001)
  })

  it('attachPty is idempotent — second call does nothing when already spawned', async () => {
    vi.mocked(getTaskWorkspace).mockResolvedValue({ opencode_port: 9000 } as never)
    const bridge = createPtyBridge({ taskId, getTerminal, setOpencodePort, onAttached })
    await bridge.attachPty({ opencodeSessionId: 'ses-1' })
    await bridge.attachPty({ opencodeSessionId: 'ses-1' })
    expect(spawnPty).toHaveBeenCalledTimes(1)
  })

  it('killPty calls ipc killPty and sets ptySpawned to false', async () => {
    vi.mocked(getTaskWorkspace).mockResolvedValue({ opencode_port: 9000 } as never)
    const bridge = createPtyBridge({ taskId, getTerminal, setOpencodePort, onAttached })
    await bridge.attachPty({ opencodeSessionId: 'ses-1' })
    expect(bridge.ptySpawned).toBe(true)
    await bridge.killPty()
    expect(killPty).toHaveBeenCalledWith(taskId)
    expect(bridge.ptySpawned).toBe(false)
  })

  it('accepts a legitimate early pty-exit before spawnPty resolves', async () => {
    vi.mocked(getTaskWorkspace).mockResolvedValue({ opencode_port: 9000 } as never)

    let resolveSpawn!: (instanceId: number) => void
    vi.mocked(spawnPty).mockImplementation(() => new Promise<number>((resolve) => {
      resolveSpawn = resolve
    }))

    const bridge = createPtyBridge({ taskId, getTerminal, setOpencodePort, onAttached })
    const attachPromise = bridge.attachPty({ opencodeSessionId: 'ses-1' })

    await vi.waitFor(() => {
      expect(listenCallbacks.has(`pty-exit-${taskId}`)).toBe(true)
    })

    const exitCb = listenCallbacks.get(`pty-exit-${taskId}`)
    expect(exitCb).toBeDefined()

    exitCb?.({ payload: { instance_id: 7 } })
    resolveSpawn(7)
    await attachPromise

    expect(bridge.ptySpawned).toBe(false)
    expect(onAttached).not.toHaveBeenCalled()
  })

  it('keeps the PTY spawned when an early pty-exit is for a different instance', async () => {
    vi.mocked(getTaskWorkspace).mockResolvedValue({ opencode_port: 9000 } as never)

    let resolveSpawn!: (instanceId: number) => void
    vi.mocked(spawnPty).mockImplementation(() => new Promise<number>((resolve) => {
      resolveSpawn = resolve
    }))

    const bridge = createPtyBridge({ taskId, getTerminal, setOpencodePort, onAttached })
    const attachPromise = bridge.attachPty({ opencodeSessionId: 'ses-1' })

    await vi.waitFor(() => {
      expect(listenCallbacks.has(`pty-exit-${taskId}`)).toBe(true)
    })

    const exitCb = listenCallbacks.get(`pty-exit-${taskId}`)
    expect(exitCb).toBeDefined()

    exitCb?.({ payload: { instance_id: 6 } })
    resolveSpawn(7)
    await attachPromise

    expect(bridge.ptySpawned).toBe(true)
    expect(onAttached).toHaveBeenCalled()
  })

  it('ignores late pty-exit events once the active attach cycle has ended', async () => {
    vi.mocked(getTaskWorkspace).mockResolvedValue({ opencode_port: 9000 } as never)
    vi.mocked(spawnPty).mockResolvedValue(7)

    const bridge = createPtyBridge({ taskId, getTerminal, setOpencodePort, onAttached })
    await bridge.attachPty({ opencodeSessionId: 'ses-1' })

    const exitCb = listenCallbacks.get(`pty-exit-${taskId}`)
    expect(exitCb).toBeDefined()

    await bridge.killPty()
    exitCb?.({ payload: { instance_id: 7 } })
    await bridge.attachPty({ opencodeSessionId: 'ses-2' })

    expect(bridge.ptySpawned).toBe(true)
    expect(onAttached).toHaveBeenCalledTimes(2)
  })

  it('ignores pty-exit events without an instance_id', async () => {
    vi.mocked(getTaskWorkspace).mockResolvedValue({ opencode_port: 9000 } as never)

    const bridge = createPtyBridge({ taskId, getTerminal, setOpencodePort, onAttached })
    await bridge.attachPty({ opencodeSessionId: 'ses-1' })

    const exitCb = listenCallbacks.get(`pty-exit-${taskId}`)
    expect(exitCb).toBeDefined()

    exitCb?.({ payload: {} })

    expect(bridge.ptySpawned).toBe(true)
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
