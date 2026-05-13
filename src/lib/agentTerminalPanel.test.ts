import { describe, expect, it, vi } from 'vitest'

vi.mock('./ipc', () => ({
  abortImplementation: vi.fn().mockResolvedValue(undefined),
  killPty: vi.fn().mockResolvedValue(undefined),
  writePty: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('./terminalPool', () => ({
  getShellLifecycleState: vi.fn(),
  updateShellLifecycleState: vi.fn(),
}))

import {
  abortAgentTerminalSession,
  getAgentStageLabel,
  getAgentStatusText,
  hydrateAgentTerminalPtyInstance,
  markAgentTerminalExited,
  syncAgentPanelStatusFromSession,
  writeAgentTerminalTranscription,
} from './agentTerminalPanel'
import { abortImplementation, killPty, writePty } from './ipc'
import { getShellLifecycleState, updateShellLifecycleState } from './terminalPool'

describe('agent terminal panel helpers', () => {
  it('keeps provider-specific status text configurable', () => {
    expect(getAgentStatusText('idle', 'Claude agent running...')).toBe('No active implementation')
    expect(getAgentStatusText('running', 'Claude agent running...')).toBe('Claude agent running...')
    expect(getAgentStatusText('running', 'Pi agent running...')).toBe('Pi agent running...')
    expect(getAgentStatusText('running', 'Agent running...')).toBe('Agent running...')
    expect(getAgentStatusText('complete', 'Agent running...')).toBe('Implementation complete')
    expect(getAgentStatusText('error', 'Agent running...')).toBe('Error occurred')
  })

  it('formats shared lifecycle stages with provider-specific label maps', () => {
    const lowerCaseLabels = {
      read_ticket: 'reading ticket',
      implement: 'implementing',
      create_pr: 'creating PR',
      address_comments: 'addressing comments',
    }
    const titleCaseLabels = {
      read_ticket: 'Reading Ticket',
      implement: 'Implementing',
      create_pr: 'Creating PR',
      address_comments: 'Addressing Comments',
    }

    expect(getAgentStageLabel('implement', lowerCaseLabels)).toBe('implementing')
    expect(getAgentStageLabel('implement', titleCaseLabels)).toBe('Implementing')
    expect(getAgentStageLabel('custom_stage', lowerCaseLabels)).toBe('custom_stage')
  })

  it('syncs session statuses into panel state and terminal activity from terminalPool', () => {
    vi.mocked(getShellLifecycleState).mockReturnValue({ ptyActive: true, shellExited: false, currentPtyInstance: 7 })
    const setStatus = vi.fn()
    const setTerminalActive = vi.fn()

    const nextStatus = syncAgentPanelStatusFromSession({
      taskId: 'T-1',
      sessionStatus: 'running',
      setStatus,
      setTerminalActive,
    })

    expect(nextStatus).toBe('running')
    expect(setStatus).toHaveBeenCalledWith('running')
    expect(setTerminalActive).toHaveBeenCalledWith(true)
    expect(getShellLifecycleState).toHaveBeenCalledWith('T-1')
  })

  it('aborts through PTY kill, terminalPool lifecycle update, and implementation abort', async () => {
    vi.mocked(getShellLifecycleState).mockReturnValue({ ptyActive: true, shellExited: false, currentPtyInstance: 42 })
    const setStatus = vi.fn()

    await abortAgentTerminalSession({
      taskId: 'T-1',
      logPrefix: 'TestPanel',
      setStatus,
    })

    expect(killPty).toHaveBeenCalledWith('T-1')
    expect(updateShellLifecycleState).toHaveBeenCalledWith('T-1', {
      ptyActive: false,
      shellExited: true,
      currentPtyInstance: 42,
    })
    expect(abortImplementation).toHaveBeenCalledWith('T-1')
    expect(setStatus).toHaveBeenCalledWith('error')
  })

  it('writes transcription only when terminalPool reports an active PTY', async () => {
    vi.mocked(getShellLifecycleState).mockReturnValue({ ptyActive: false, shellExited: false, currentPtyInstance: null })
    await writeAgentTerminalTranscription('T-1', 'hello', 'TestPanel')
    expect(writePty).not.toHaveBeenCalled()

    vi.mocked(getShellLifecycleState).mockReturnValue({ ptyActive: true, shellExited: false, currentPtyInstance: null })
    await writeAgentTerminalTranscription('T-1', 'hello', 'TestPanel')
    expect(writePty).toHaveBeenCalledWith('T-1', 'hello')
  })

  it('marks terminal lifecycle exited through terminalPool', () => {
    markAgentTerminalExited('T-1', 99)

    expect(updateShellLifecycleState).toHaveBeenCalledWith('T-1', {
      ptyActive: false,
      shellExited: true,
      currentPtyInstance: 99,
    })
  })

  it('hydrates current PTY instance through terminalPool lifecycle state', () => {
    vi.mocked(getShellLifecycleState).mockReturnValue({ ptyActive: false, shellExited: true, currentPtyInstance: null })

    hydrateAgentTerminalPtyInstance('T-1', 123)

    expect(updateShellLifecycleState).toHaveBeenCalledWith('T-1', {
      ptyActive: true,
      shellExited: false,
      currentPtyInstance: 123,
    })
  })
})
