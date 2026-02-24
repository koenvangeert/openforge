import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { AgentSession } from './types'

vi.mock('./stores', () => ({
  activeSessions: writable(new Map()),
}))

vi.mock('./ipc', () => ({
  getLatestSession: vi.fn().mockResolvedValue(null),
  getWorktreeForTask: vi.fn().mockResolvedValue(null),
}))

import { createSessionHistory } from './useSessionHistory.svelte'
import { activeSessions } from './stores'
import { getLatestSession } from './ipc'

const baseSession: AgentSession = {
  id: 'ses-1',
  ticket_id: 'T-1',
  opencode_session_id: null,
  stage: 'implement',
  status: 'completed',
  checkpoint_data: null,
  error_message: null,
  created_at: 1000,
  updated_at: 2000,
}

describe('createSessionHistory', () => {
  let getOpencodePort: () => number | null
  let setOpencodePort: (port: number) => void
  let onStatusUpdate: (status: 'complete' | 'error' | 'idle', errorMessage?: string | null) => void
  const taskId = 'T-1'

  beforeEach(() => {
    vi.clearAllMocks()
    getOpencodePort = vi.fn<() => number | null>().mockReturnValue(null)
    setOpencodePort = vi.fn<(port: number) => void>()
    onStatusUpdate = vi.fn<(status: 'complete' | 'error' | 'idle', errorMessage?: string | null) => void>()
    activeSessions.set(new Map())
    vi.mocked(getLatestSession).mockResolvedValue(null)
  })

  it('starts with loadingHistory = false', () => {
    const history = createSessionHistory({ taskId, getOpencodePort, setOpencodePort, onStatusUpdate })
    expect(history.loadingHistory).toBe(false)
  })

  it('loadSessionHistory sets loadingHistory = false after completion', async () => {
    const history = createSessionHistory({ taskId, getOpencodePort, setOpencodePort, onStatusUpdate })
    await history.loadSessionHistory()
    expect(history.loadingHistory).toBe(false)
  })

  it('does not call onStatusUpdate when no session exists', async () => {
    vi.mocked(getLatestSession).mockResolvedValue(null)
    const history = createSessionHistory({ taskId, getOpencodePort, setOpencodePort, onStatusUpdate })
    await history.loadSessionHistory()
    expect(onStatusUpdate).not.toHaveBeenCalled()
  })

  it('calls onStatusUpdate("complete") for completed session from DB', async () => {
    vi.mocked(getLatestSession).mockResolvedValue({ ...baseSession, status: 'completed' })
    const history = createSessionHistory({ taskId, getOpencodePort, setOpencodePort, onStatusUpdate })
    await history.loadSessionHistory()
    expect(onStatusUpdate).toHaveBeenCalledWith('complete')
  })

  it('calls onStatusUpdate("idle") for paused session from DB', async () => {
    vi.mocked(getLatestSession).mockResolvedValue({ ...baseSession, status: 'paused' })
    const history = createSessionHistory({ taskId, getOpencodePort, setOpencodePort, onStatusUpdate })
    await history.loadSessionHistory()
    expect(onStatusUpdate).toHaveBeenCalledWith('idle')
  })

  it('calls onStatusUpdate("error") for failed session with error message', async () => {
    vi.mocked(getLatestSession).mockResolvedValue({
      ...baseSession,
      status: 'failed',
      error_message: 'Something broke',
    })
    const history = createSessionHistory({ taskId, getOpencodePort, setOpencodePort, onStatusUpdate })
    await history.loadSessionHistory()
    expect(onStatusUpdate).toHaveBeenCalledWith('error', 'Something broke')
  })

  it('does not call onStatusUpdate for running session in active sessions', async () => {
    const runningSession = { ...baseSession, status: 'running' }
    activeSessions.set(new Map([['T-1', runningSession as AgentSession]]))
    const history = createSessionHistory({ taskId, getOpencodePort, setOpencodePort, onStatusUpdate })
    await history.loadSessionHistory()
    expect(onStatusUpdate).not.toHaveBeenCalled()
  })

  it('uses existing session from activeSessions store if present', async () => {
    const completedSession = { ...baseSession, status: 'completed' }
    activeSessions.set(new Map([['T-1', completedSession as AgentSession]]))
    const history = createSessionHistory({ taskId, getOpencodePort, setOpencodePort, onStatusUpdate })
    await history.loadSessionHistory()
    // Existing session should trigger status update without needing DB lookup
    expect(onStatusUpdate).toHaveBeenCalledWith('complete')
  })
})
