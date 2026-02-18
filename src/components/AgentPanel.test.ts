import { render, screen } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { AgentSession } from '../lib/types'

// Mock xterm.js — provide a minimal Terminal stub
vi.mock('@xterm/xterm', () => {
  const Terminal = vi.fn().mockImplementation(() => ({
    open: vi.fn(),
    write: vi.fn(),
    dispose: vi.fn(),
    onData: vi.fn(),
    loadAddon: vi.fn(),
    cols: 80,
    rows: 24,
  }))
  return { Terminal }
})

vi.mock('@xterm/addon-fit', () => {
  const FitAddon = vi.fn().mockImplementation(() => ({
    fit: vi.fn(),
  }))
  return { FitAddon }
})

vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

vi.mock('../lib/stores', () => ({
  activeSessions: writable(new Map()),
}))

vi.mock('../lib/ipc', () => ({
  abortImplementation: vi.fn().mockResolvedValue(undefined),
  getLatestSession: vi.fn().mockResolvedValue(null),
  getWorktreeForTask: vi.fn().mockResolvedValue(null),
  spawnPty: vi.fn().mockResolvedValue(undefined),
  writePty: vi.fn().mockResolvedValue(undefined),
  resizePty: vi.fn().mockResolvedValue(undefined),
  killPty: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}))

import AgentPanel from './AgentPanel.svelte'
import { activeSessions } from '../lib/stores'

describe('AgentPanel', () => {
  beforeEach(() => {
    activeSessions.set(new Map())
  })

  it('renders empty state text "No active agent session" when idle', () => {
    render(AgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByText('No active agent session')).toBeTruthy()
  })

  it('shows guidance text "Start an implementation from the Kanban board context menu"', () => {
    render(AgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByText('Start an implementation from the Kanban board context menu')).toBeTruthy()
  })

  it('status text shows "No active implementation" when idle', () => {
    render(AgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByText('No active implementation')).toBeTruthy()
  })

  it('does not show abort button when idle', () => {
    render(AgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.queryByText('Abort')).toBeNull()
  })

  it('shows running session status when session is running', () => {
    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-1',
      opencode_session_id: null,
      stage: 'implement',
      status: 'running',
      checkpoint_data: null,
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
    }

    const sessions = new Map<string, AgentSession>()
    sessions.set('T-1', session)
    activeSessions.set(sessions)

    render(AgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByText('Implementing')).toBeTruthy()
    expect(screen.getByText('running')).toBeTruthy()
  })

  it('shows different stage labels for different stages', () => {
    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-1',
      opencode_session_id: null,
      stage: 'read_ticket',
      status: 'running',
      checkpoint_data: null,
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
    }

    const sessions = new Map<string, AgentSession>()
    sessions.set('T-1', session)
    activeSessions.set(sessions)

    render(AgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByText('Reading Ticket')).toBeTruthy()
  })

  it('does not show abort button when session is running but PTY has not started', () => {
    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-1',
      opencode_session_id: 'oc-sess-1',
      stage: 'implement',
      status: 'running',
      checkpoint_data: null,
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
    }

    const sessions = new Map<string, AgentSession>()
    sessions.set('T-1', session)
    activeSessions.set(sessions)

    render(AgentPanel, { props: { taskId: 'T-1' } })
    // Abort button only shows when internal status is 'running',
    // which requires a successful PTY spawn (not testable in unit tests without full PTY mock)
    expect(screen.queryByText('Abort')).toBeNull()
  })

  it('shows completed badge when session is completed', () => {
    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-1',
      opencode_session_id: 'oc-sess-1',
      stage: 'implement',
      status: 'completed',
      checkpoint_data: null,
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
    }

    const sessions = new Map<string, AgentSession>()
    sessions.set('T-1', session)
    activeSessions.set(sessions)

    render(AgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByText('completed')).toBeTruthy()
  })
})
