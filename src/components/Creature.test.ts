import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import Creature from './Creature.svelte'
import type { Task } from '../lib/types'
import type { CreatureState, CreatureRoom } from '../lib/creatureState'

const baseTask: Task = {
  id: 'T-99',
  initial_prompt: 'Test task for display purposes',
  status: 'doing',
  jira_key: null,
  jira_title: null,
  jira_status: null,
  jira_assignee: null,
  jira_description: null,
  project_id: null,
  created_at: 1000,
  updated_at: 2000,
}

function renderCreature(
  state: CreatureState,
  room: CreatureRoom = 'forge',
  questionText: string | null = null,
  taskOverrides: Partial<Task> = {},
  onStart?: (taskId: string) => void
) {
  const onClick = vi.fn()
  const onHover = vi.fn()
  const onHoverEnd = vi.fn()
  const task = { ...baseTask, ...taskOverrides }
  const result = render(Creature, {
    props: { task, state, room, questionText, onClick, onHover, onHoverEnd, onStart },
  })
  return { ...result, onClick, onHover, onHoverEnd }
}

describe('Creature', () => {
  describe('Pixel character scene (forge / warRoom)', () => {
    it('renders pixel-char element for forge room', () => {
      const { container } = renderCreature('active', 'forge')
      expect(container.querySelector('[data-testid="pixel-char"]')).toBeTruthy()
    })

    it('renders head element for forge room', () => {
      const { container } = renderCreature('active', 'forge')
      expect(container.querySelector('[data-testid="head"]')).toBeTruthy()
    })

    it('renders body element for forge room', () => {
      const { container } = renderCreature('active', 'forge')
      expect(container.querySelector('[data-testid="body"]')).toBeTruthy()
    })

    it('renders pixel-char element for warRoom', () => {
      const { container } = renderCreature('needs-input', 'warRoom')
      expect(container.querySelector('[data-testid="pixel-char"]')).toBeTruthy()
    })

    it('svg has aria-label="creature" for forge room', () => {
      const { container } = renderCreature('active', 'forge')
      expect(container.querySelector('[aria-label="creature"]')).toBeTruthy()
    })

    it('svg has aria-label="creature" for warRoom', () => {
      const { container } = renderCreature('needs-input', 'warRoom')
      expect(container.querySelector('[aria-label="creature"]')).toBeTruthy()
    })

    it('renders status label "RUNNING" for active state', () => {
      renderCreature('active', 'forge')
      expect(screen.getByText('RUNNING')).toBeTruthy()
    })

    it('renders status label "BLOCKED" for needs-input state', () => {
      renderCreature('needs-input', 'warRoom')
      expect(screen.getByText('BLOCKED')).toBeTruthy()
    })

    it('renders status label "PAUSED" for resting state', () => {
      renderCreature('resting', 'warRoom')
      expect(screen.getByText('PAUSED')).toBeTruthy()
    })

    it('renders status label "FAILED" for sad state', () => {
      renderCreature('sad', 'warRoom')
      expect(screen.getByText('FAILED')).toBeTruthy()
    })

    it('renders task ID label for pixel character scene', () => {
      renderCreature('active', 'forge')
      expect(screen.getByText('T-99')).toBeTruthy()
    })

    it('renders thought bubble with task title', () => {
      renderCreature('active', 'forge')
      expect(screen.getByText('Test task for display purposes')).toBeTruthy()
    })

    it('war room creatures show alert badge element', () => {
      const { container } = renderCreature('needs-input', 'warRoom')
      expect(container.querySelector('[data-testid="alert-badge"]')).toBeTruthy()
    })

    it('war room creatures show frown element', () => {
      const { container } = renderCreature('needs-input', 'warRoom')
      expect(container.querySelector('[data-testid="frown"]')).toBeTruthy()
    })

    it('forge creatures show mouth element instead of frown', () => {
      const { container } = renderCreature('active', 'forge')
      expect(container.querySelector('[data-testid="frown"]')).toBeNull()
      expect(container.querySelector('[data-testid="mouth"]')).toBeTruthy()
    })

    it('renders two legs', () => {
      const { container } = renderCreature('active', 'forge')
      expect(container.querySelector('[data-testid="leg-l"]')).toBeTruthy()
      expect(container.querySelector('[data-testid="leg-r"]')).toBeTruthy()
    })

    it('forge room does not show alert badge', () => {
      const { container } = renderCreature('active', 'forge')
      expect(container.querySelector('[data-testid="alert-badge"]')).toBeNull()
    })

    it('applies creature-work animation class for active state', () => {
      const { container } = renderCreature('active', 'forge')
      const svg = container.querySelector('svg')
      expect(svg?.classList.contains('creature-work')).toBe(true)
    })

    it('applies creature-alert animation class for needs-input state', () => {
      const { container } = renderCreature('needs-input', 'warRoom')
      const svg = container.querySelector('svg')
      expect(svg?.classList.contains('creature-alert')).toBe(true)
    })

    it('applies creature-alert animation class for sad state', () => {
      const { container } = renderCreature('sad', 'warRoom')
      const svg = container.querySelector('svg')
      expect(svg?.classList.contains('creature-alert')).toBe(true)
    })

    it('applies creature-celebrate animation class for celebrating state', () => {
      const { container } = renderCreature('celebrating', 'forge')
      const svg = container.querySelector('svg')
      expect(svg?.classList.contains('creature-celebrate')).toBe(true)
    })

    it('applies creature-sleep animation class for resting state', () => {
      const { container } = renderCreature('resting', 'warRoom')
      const svg = container.querySelector('svg')
      expect(svg?.classList.contains('creature-sleep')).toBe(true)
    })
  })

  describe('Status-specific scene elements', () => {
    it('celebrating creature renders chair element', () => {
      const { container } = renderCreature('celebrating', 'forge')
      expect(container.querySelector('[data-testid="chair"]')).toBeTruthy()
    })

    it('active creature renders anvil element', () => {
      const { container } = renderCreature('active', 'forge')
      expect(container.querySelector('[data-testid="anvil"]')).toBeTruthy()
    })

    it('sad creature renders rain-cloud element', () => {
      const { container } = renderCreature('sad', 'warRoom')
      expect(container.querySelector('[data-testid="rain-cloud"]')).toBeTruthy()
    })

    it('frozen creature renders ice-block element', () => {
      const { container } = renderCreature('frozen', 'warRoom')
      expect(container.querySelector('[data-testid="ice-block"]')).toBeTruthy()
    })

    it('needs-input creature renders question-bubble element', () => {
      const { container } = renderCreature('needs-input', 'warRoom')
      expect(container.querySelector('[data-testid="question-bubble"]')).toBeTruthy()
    })

    it('resting creature renders sleep-bubble element', () => {
      const { container } = renderCreature('resting', 'warRoom')
      expect(container.querySelector('[data-testid="sleep-bubble"]')).toBeTruthy()
    })

    it('idle creature does not render any scene prop', () => {
      const { container } = renderCreature('idle', 'forge')
      expect(container.querySelector('[data-testid="chair"]')).toBeNull()
      expect(container.querySelector('[data-testid="anvil"]')).toBeNull()
      expect(container.querySelector('[data-testid="rain-cloud"]')).toBeNull()
      expect(container.querySelector('[data-testid="ice-block"]')).toBeNull()
      expect(container.querySelector('[data-testid="question-bubble"]')).toBeNull()
      expect(container.querySelector('[data-testid="sleep-bubble"]')).toBeNull()
    })
  })

  describe('Assignee display', () => {
    it('displays assignee when jira_assignee is set', () => {
      renderCreature('active', 'forge', null, { jira_assignee: 'alice' })
      expect(screen.getByText('alice')).toBeTruthy()
    })

    it('does not display assignee when jira_assignee is null', () => {
      renderCreature('active', 'forge', null, { jira_assignee: null })
      expect(screen.queryByText('alice')).toBeNull()
    })
  })

  describe('Nest scene (nursery)', () => {
    it('renders bed element for nursery room', () => {
      const { container } = renderCreature('egg', 'nursery')
      expect(container.querySelector('[data-testid="bed"]')).toBeTruthy()
    })

    it('renders egg element for nursery room', () => {
      const { container } = renderCreature('egg', 'nursery')
      expect(container.querySelector('[data-testid="egg"]')).toBeTruthy()
    })

    it('renders "zzz" text for nursery creatures', () => {
      renderCreature('egg', 'nursery')
      expect(screen.getByText('zzz')).toBeTruthy()
    })

    it('renders task ID label for nursery scene', () => {
      renderCreature('egg', 'nursery')
      expect(screen.getByText('T-99')).toBeTruthy()
    })

    it('applies creature-sleep animation class for nursery room', () => {
      const { container } = renderCreature('egg', 'nursery')
      const svg = container.querySelector('svg')
      expect(svg?.classList.contains('creature-sleep')).toBe(true)
    })

    it('does not render pixel character in nursery', () => {
      const { container } = renderCreature('egg', 'nursery')
      expect(container.querySelector('[data-testid="pixel-char"]')).toBeNull()
    })
  })

  describe('Interaction', () => {
    it('calls onClick with task.id when clicked', async () => {
      const { onClick } = renderCreature('active', 'forge')
      const button = screen.getByRole('button')
      await fireEvent.click(button)
      expect(onClick).toHaveBeenCalledWith('T-99')
    })

    it('calls onClick with task.id for warRoom creature', async () => {
      const { onClick } = renderCreature('needs-input', 'warRoom')
      const button = screen.getByRole('button')
      await fireEvent.click(button)
      expect(onClick).toHaveBeenCalledWith('T-99')
    })

    it('calls onHover with task.id and rect on mouseenter', async () => {
      const { onHover } = renderCreature('active', 'forge')
      const button = screen.getByRole('button')
      await fireEvent.mouseEnter(button)
      expect(onHover).toHaveBeenCalledWith('T-99', expect.any(Object))
    })

    it('calls onHoverEnd on mouseleave', async () => {
      const { onHoverEnd } = renderCreature('active', 'forge')
      const button = screen.getByRole('button')
      await fireEvent.mouseLeave(button)
      expect(onHoverEnd).toHaveBeenCalled()
    })
  })

  describe('Start button (nursery)', () => {
    it('renders a start button for nursery creatures when onStart is provided', () => {
      renderCreature('egg', 'nursery', null, {}, vi.fn())
      expect(screen.getByTitle('Start task')).toBeTruthy()
    })

    it('does not render a start button when onStart is not provided', () => {
      renderCreature('egg', 'nursery')
      expect(screen.queryByTitle('Start task')).toBeNull()
    })

    it('does not render a start button for non-nursery creatures', () => {
      renderCreature('active', 'forge', null, {}, vi.fn())
      expect(screen.queryByTitle('Start task')).toBeNull()
    })

    it('calls onStart with task.id when start button is clicked', async () => {
      const onStart = vi.fn()
      renderCreature('egg', 'nursery', null, {}, onStart)
      const startBtn = screen.getByTitle('Start task')
      await fireEvent.click(startBtn)
      expect(onStart).toHaveBeenCalledWith('T-99')
    })

    it('does not call onClick when start button is clicked', async () => {
      const onStart = vi.fn()
      const { onClick } = renderCreature('egg', 'nursery', null, {}, onStart)
      const startBtn = screen.getByTitle('Start task')
      await fireEvent.click(startBtn)
      expect(onClick).not.toHaveBeenCalled()
    })
  })

})
