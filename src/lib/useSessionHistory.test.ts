import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { AgentSession } from './types'

vi.mock('./stores', () => ({
  activeSessions: writable(new Map()),
}))

vi.mock('./ipc', () => ({
  getLatestSession: vi.fn().mockResolvedValue(null),
  getSessionOutput: vi.fn().mockResolvedValue(''),
}))

import { createSessionHistory } from './useSessionHistory.svelte'
import { activeSessions } from './stores'
import { getLatestSession, getSessionOutput } from './ipc'

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
  provider: 'opencode',
  claude_session_id: null,
  pi_session_id: null,
}

describe('createSessionHistory', () => {
  let onStatusUpdate: (status: 'complete' | 'error' | 'idle', errorMessage?: string | null) => void
  let onOutputLoaded: (output: string) => void
  const taskId = 'T-1'

  beforeEach(() => {
    vi.clearAllMocks()
    onStatusUpdate = vi.fn<(status: 'complete' | 'error' | 'idle', errorMessage?: string | null) => void>()
    onOutputLoaded = vi.fn<(output: string) => void>()
    activeSessions.set(new Map())
    vi.mocked(getLatestSession).mockResolvedValue(null)
    vi.mocked(getSessionOutput).mockResolvedValue('')
  })

  it('starts with loadingHistory = false', () => {
    const history = createSessionHistory({ taskId, onStatusUpdate })
    expect(history.loadingHistory).toBe(false)
  })

  it('loadSessionHistory sets loadingHistory = false after completion', async () => {
    const history = createSessionHistory({ taskId, onStatusUpdate })
    await history.loadSessionHistory()
    expect(history.loadingHistory).toBe(false)
  })

  it('does not call onStatusUpdate when no session exists', async () => {
    vi.mocked(getLatestSession).mockResolvedValue(null)
    const history = createSessionHistory({ taskId, onStatusUpdate })
    await history.loadSessionHistory()
    expect(onStatusUpdate).not.toHaveBeenCalled()
  })

  it('calls onStatusUpdate("complete") for completed session from DB', async () => {
    vi.mocked(getLatestSession).mockResolvedValue({ ...baseSession, status: 'completed' })
    const history = createSessionHistory({ taskId, onStatusUpdate })
    await history.loadSessionHistory()
    expect(onStatusUpdate).toHaveBeenCalledWith('complete')
  })

  it('loads legacy OpenCode session output for terminal sessions when requested', async () => {
    vi.mocked(getLatestSession).mockResolvedValue({ ...baseSession, status: 'completed' })
    vi.mocked(getSessionOutput).mockResolvedValue('previous tty output')
    const history = createSessionHistory({ taskId, onStatusUpdate, onOutputLoaded })
    await history.loadSessionHistory()
    expect(getSessionOutput).toHaveBeenCalledWith(taskId)
    expect(onOutputLoaded).toHaveBeenCalledWith('previous tty output')
  })

  it('ignores legacy OpenCode session output failures while preserving status history', async () => {
    vi.mocked(getLatestSession).mockResolvedValue({ ...baseSession, status: 'completed' })
    vi.mocked(getSessionOutput).mockRejectedValue(new Error('legacy server unavailable'))
    const history = createSessionHistory({ taskId, onStatusUpdate, onOutputLoaded })
    await history.loadSessionHistory()
    expect(onStatusUpdate).toHaveBeenCalledWith('complete')
    expect(onOutputLoaded).not.toHaveBeenCalled()
  })

  it('calls onStatusUpdate("idle") for paused session from DB', async () => {
    vi.mocked(getLatestSession).mockResolvedValue({ ...baseSession, status: 'paused' })
    const history = createSessionHistory({ taskId, onStatusUpdate })
    await history.loadSessionHistory()
    expect(onStatusUpdate).toHaveBeenCalledWith('idle')
  })

  it('calls onStatusUpdate("error") for failed session with error message', async () => {
    vi.mocked(getLatestSession).mockResolvedValue({
      ...baseSession,
      status: 'failed',
      error_message: 'Something broke',
    })
    const history = createSessionHistory({ taskId, onStatusUpdate })
    await history.loadSessionHistory()
    expect(onStatusUpdate).toHaveBeenCalledWith('error', 'Something broke')
  })

  it('does not call onStatusUpdate for running session in active sessions', async () => {
    const runningSession = { ...baseSession, status: 'running' }
    activeSessions.set(new Map([['T-1', runningSession as AgentSession]]))
    const history = createSessionHistory({ taskId, onStatusUpdate })
    await history.loadSessionHistory()
    expect(onStatusUpdate).not.toHaveBeenCalled()
  })

  it('uses existing session from activeSessions store if present', async () => {
    const completedSession = { ...baseSession, status: 'completed' }
    activeSessions.set(new Map([['T-1', completedSession as AgentSession]]))
    const history = createSessionHistory({ taskId, onStatusUpdate })
    await history.loadSessionHistory()
    expect(onStatusUpdate).toHaveBeenCalledWith('complete')
  })
})
