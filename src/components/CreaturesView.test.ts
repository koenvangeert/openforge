import { render, screen, fireEvent, within } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import CreaturesView from './CreaturesView.svelte'
import type { Task, AgentSession } from '../lib/types'
import { tasks, activeSessions, ticketPrs } from '../lib/stores'

const makeTask = (id: string, status: string, title: string = 'Test task'): Task => ({
  id,
  title,
  status,
  jira_key: null,
  jira_title: null,
  jira_status: null,
  jira_assignee: null,
  jira_description: null,
  project_id: null,
  created_at: 1000,
  updated_at: 2000,
})

const makeSession = (ticketId: string, status: string): AgentSession => ({
  id: `ses-${ticketId}`,
  ticket_id: ticketId,
  opencode_session_id: null,
  stage: 'implementation',
  status,
  checkpoint_data: null,
  error_message: null,
  created_at: Date.now() - 3600000,
  updated_at: Date.now(),
  provider: 'opencode',
  claude_session_id: null,
})

beforeEach(() => {
  tasks.set([])
  activeSessions.set(new Map())
  ticketPrs.set(new Map())
})

describe('CreaturesView', () => {
  describe('room layout', () => {
    it('renders three room sections with correct titles when tasks exist', () => {
      tasks.set([makeTask('T-1', 'backlog')])
      render(CreaturesView, { props: { onCreatureClick: vi.fn() } })
      expect(screen.getByText('THE FORGE')).toBeTruthy()
      expect(screen.getByText('WAR ROOM')).toBeTruthy()
      expect(screen.getByText('THE NURSERY')).toBeTruthy()
    })

    it('places running tasks in THE FORGE room', () => {
      tasks.set([makeTask('T-forge', 'doing')])
      activeSessions.set(new Map([['T-forge', makeSession('T-forge', 'running')]]))
      render(CreaturesView, { props: { onCreatureClick: vi.fn() } })
      const forgeRoom = screen.getByTestId('room-forge')
      expect(within(forgeRoom).getByText('T-forge')).toBeTruthy()
    })

    it('places doing task with no session in THE FORGE', () => {
      tasks.set([makeTask('T-idle', 'doing')])
      render(CreaturesView, { props: { onCreatureClick: vi.fn() } })
      const forgeRoom = screen.getByTestId('room-forge')
      expect(within(forgeRoom).getByText('T-idle')).toBeTruthy()
    })

    it('places paused tasks in WAR ROOM', () => {
      tasks.set([makeTask('T-paused', 'doing')])
      activeSessions.set(new Map([['T-paused', makeSession('T-paused', 'paused')]]))
      render(CreaturesView, { props: { onCreatureClick: vi.fn() } })
      const warRoom = screen.getByTestId('room-warRoom')
      expect(within(warRoom).getByText('T-paused')).toBeTruthy()
    })

    it('places failed tasks in WAR ROOM', () => {
      tasks.set([makeTask('T-failed', 'doing')])
      activeSessions.set(new Map([['T-failed', makeSession('T-failed', 'failed')]]))
      render(CreaturesView, { props: { onCreatureClick: vi.fn() } })
      const warRoom = screen.getByTestId('room-warRoom')
      expect(within(warRoom).getByText('T-failed')).toBeTruthy()
    })

    it('places backlog tasks in THE NURSERY', () => {
      tasks.set([makeTask('T-backlog', 'backlog')])
      render(CreaturesView, { props: { onCreatureClick: vi.fn() } })
      const nursery = screen.getByTestId('room-nursery')
      expect(within(nursery).getByText('T-backlog')).toBeTruthy()
    })

    it('shows "No creatures yet" when no tasks exist', () => {
      tasks.set([])
      render(CreaturesView, { props: { onCreatureClick: vi.fn() } })
      expect(screen.getByText('No creatures yet')).toBeTruthy()
    })

    it('shows "No creatures yet" when only done tasks exist', () => {
      tasks.set([makeTask('T-done', 'done')])
      render(CreaturesView, { props: { onCreatureClick: vi.fn() } })
      expect(screen.getByText('No creatures yet')).toBeTruthy()
    })

    it('does not render done tasks in any room', () => {
      tasks.set([makeTask('T-done', 'done'), makeTask('T-backlog', 'backlog')])
      render(CreaturesView, { props: { onCreatureClick: vi.fn() } })
      expect(screen.queryByText('T-done')).toBeNull()
      expect(screen.getByText('T-backlog')).toBeTruthy()
    })
  })

  describe('legend status bar', () => {
    it('shows RUNNING label in legend bar', () => {
      tasks.set([makeTask('T-1', 'doing')])
      activeSessions.set(new Map([['T-1', makeSession('T-1', 'running')]]))
      render(CreaturesView, { props: { onCreatureClick: vi.fn() } })
      const legend = screen.getByTestId('legend-bar')
      expect(within(legend).getByText('RUNNING')).toBeTruthy()
      expect(within(legend).getByText('(1)')).toBeTruthy()
    })

    it('shows BLOCKED label in legend bar', () => {
      tasks.set([makeTask('T-1', 'doing')])
      activeSessions.set(new Map([['T-1', makeSession('T-1', 'paused')]]))
      render(CreaturesView, { props: { onCreatureClick: vi.fn() } })
      const legend = screen.getByTestId('legend-bar')
      expect(within(legend).getByText('BLOCKED')).toBeTruthy()
      expect(within(legend).getByText('(1)')).toBeTruthy()
    })

    it('shows BACKLOG label in legend bar', () => {
      tasks.set([makeTask('T-1', 'backlog')])
      render(CreaturesView, { props: { onCreatureClick: vi.fn() } })
      const legend = screen.getByTestId('legend-bar')
      expect(within(legend).getByText('BACKLOG')).toBeTruthy()
      expect(within(legend).getByText('(1)')).toBeTruthy()
    })

    it('shows hint text in legend bar', () => {
      tasks.set([makeTask('T-1', 'backlog')])
      render(CreaturesView, { props: { onCreatureClick: vi.fn() } })
      const legend = screen.getByTestId('legend-bar')
      expect(within(legend).getByText('click any creature to view task details')).toBeTruthy()
    })
  })

  describe('hover interactions', () => {
    it('hovering a creature shows the CreatureHoverCard', async () => {
      tasks.set([makeTask('T-1', 'doing')])
      activeSessions.set(new Map([['T-1', makeSession('T-1', 'running')]]))
      render(CreaturesView, { props: { onCreatureClick: vi.fn() } })

      const button = screen.getByText('T-1').closest('button')
      if (!button) throw new Error('Creature button not found')

      await fireEvent.mouseEnter(button)

      expect(screen.getByRole('tooltip')).toBeTruthy()
    })

    it('no dim overlay rendered at any point', async () => {
      tasks.set([makeTask('T-1', 'doing')])
      activeSessions.set(new Map([['T-1', makeSession('T-1', 'running')]]))
      render(CreaturesView, { props: { onCreatureClick: vi.fn() } })

      expect(screen.queryByTestId('dim-overlay')).toBeNull()

      const button = screen.getByText('T-1').closest('button')
      if (!button) throw new Error('Creature button not found')

      await fireEvent.mouseEnter(button)

      expect(screen.queryByTestId('dim-overlay')).toBeNull()
    })

    it('clicking a creature calls onCreatureClick with task id', async () => {
      const onCreatureClick = vi.fn()
      tasks.set([makeTask('T-click', 'doing')])
      render(CreaturesView, { props: { onCreatureClick } })

      const button = screen.getByText('T-click').closest('button')
      if (!button) throw new Error('Creature button not found')
      await fireEvent.click(button)

      expect(onCreatureClick).toHaveBeenCalledWith('T-click')
    })
  })

  describe('integration', () => {
    it('renders tasks in correct rooms when multiple tasks exist', () => {
      tasks.set([
        makeTask('T-forge', 'doing'),
        makeTask('T-war', 'doing'),
        makeTask('T-nursery', 'backlog'),
      ])
      activeSessions.set(new Map([
        ['T-forge', makeSession('T-forge', 'running')],
        ['T-war', makeSession('T-war', 'paused')],
      ]))
      render(CreaturesView, { props: { onCreatureClick: vi.fn() } })

      expect(within(screen.getByTestId('room-forge')).getByText('T-forge')).toBeTruthy()
      expect(within(screen.getByTestId('room-warRoom')).getByText('T-war')).toBeTruthy()
      expect(within(screen.getByTestId('room-nursery')).getByText('T-nursery')).toBeTruthy()
    })

    it('forge creature renders creature SVG', () => {
      tasks.set([makeTask('T-forge', 'doing')])
      activeSessions.set(new Map([['T-forge', makeSession('T-forge', 'running')]]))
      const { container } = render(CreaturesView, { props: { onCreatureClick: vi.fn() } })
      const creature = container.querySelector('[aria-label="creature"]')
      expect(creature).toBeTruthy()
    })

    it('nursery creature renders nest SVG', () => {
      tasks.set([makeTask('T-nursery', 'backlog')])
      const { container } = render(CreaturesView, { props: { onCreatureClick: vi.fn() } })
      const nest = container.querySelector('[aria-label="nest"]')
      expect(nest).toBeTruthy()
    })

    it('running forge creature has creature-work animation class', () => {
      tasks.set([makeTask('T-active', 'doing')])
      activeSessions.set(new Map([['T-active', makeSession('T-active', 'running')]]))
      const { container } = render(CreaturesView, { props: { onCreatureClick: vi.fn() } })
      const svg = container.querySelector('svg')
      expect(svg?.classList.contains('creature-work')).toBe(true)
    })
  })
})
