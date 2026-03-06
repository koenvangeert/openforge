import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import Creature from './Creature.svelte'
import type { Task } from '../lib/types'
import type { CreatureState, CreatureRoom } from '../lib/creatureState'

const baseTask: Task = {
  id: 'T-99',
  title: 'Test task for display purposes',
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
  taskOverrides: Partial<Task> = {}
) {
  const onClick = vi.fn()
  const onHover = vi.fn()
  const onHoverEnd = vi.fn()
  const task = { ...baseTask, ...taskOverrides }
  const result = render(Creature, {
    props: { task, state, room, questionText, onClick, onHover, onHoverEnd },
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

    it('applies hue-rotate filter style for color variation', () => {
      const { container } = renderCreature('active', 'forge')
      const svg = container.querySelector('svg')
      expect(svg?.style.filter).toMatch(/hue-rotate\(-?\d+deg\)/)
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

  describe('Room colors', () => {
    it('active forge creatures use text-success color class on svg', () => {
      const { container } = renderCreature('active', 'forge')
      const svg = container.querySelector('svg')
      expect(svg?.classList.contains('text-success')).toBe(true)
    })

    it('celebrating forge creatures use text-info color class on svg', () => {
      const { container } = renderCreature('celebrating', 'forge')
      const svg = container.querySelector('svg')
      expect(svg?.classList.contains('text-info')).toBe(true)
    })

    it('celebrating forge creatures do not use text-success', () => {
      const { container } = renderCreature('celebrating', 'forge')
      const svg = container.querySelector('svg')
      expect(svg?.classList.contains('text-success')).toBe(false)
    })

    it('celebrating creatures use border-info thought bubble', () => {
      const { container } = renderCreature('celebrating', 'forge')
      const bubble = container.querySelector('.border-info\\/50')
      expect(bubble).toBeTruthy()
    })

    it('celebrating creatures status label uses text-info', () => {
      const { container } = renderCreature('celebrating', 'forge')
      const statusDot = container.querySelector('.text-info')
      expect(statusDot).toBeTruthy()
    })

    it('warRoom creatures use text-warning color class on svg', () => {
      const { container } = renderCreature('needs-input', 'warRoom')
      const svg = container.querySelector('svg')
      expect(svg?.classList.contains('text-warning')).toBe(true)
    })

    it('nursery creatures use text-base-content/40 color class on svg', () => {
      const { container } = renderCreature('egg', 'nursery')
      const svg = container.querySelector('svg')
      expect(svg?.classList.contains('text-base-content/40')).toBe(true)
    })
  })

})
