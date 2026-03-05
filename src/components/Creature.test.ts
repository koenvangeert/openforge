import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import Creature from './Creature.svelte'
import type { Task } from '../lib/types'
import type { CreatureState } from '../lib/creatureState'

const baseTask: Task = {
  id: 'T-99',
  title: 'Test task',
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

function renderCreature(state: CreatureState, questionText: string | null = null) {
  const onClick = vi.fn()
  const result = render(Creature, { props: { task: baseTask, state, questionText, onClick } })
  return { ...result, onClick }
}

describe('Creature', () => {
  it('renders task id label below creature', () => {
    renderCreature('idle')
    expect(screen.getByText('T-99')).toBeTruthy()
  })

  it('shows "zzz" for egg state', () => {
    renderCreature('egg')
    expect(screen.getByText('zzz')).toBeTruthy()
  })

  it('hides "zzz" for active state', () => {
    renderCreature('active')
    expect(screen.queryByText('zzz')).toBeNull()
  })

  it('hides "zzz" for idle state', () => {
    renderCreature('idle')
    expect(screen.queryByText('zzz')).toBeNull()
  })

  it('shows exclamation mark for needs-input state', () => {
    renderCreature('needs-input', 'Are you sure?')
    expect(screen.getByText('❗')).toBeTruthy()
  })

  it('hides exclamation mark for active state', () => {
    renderCreature('active')
    expect(screen.queryByText('❗')).toBeNull()
  })

  it('hides exclamation mark for idle state', () => {
    renderCreature('idle')
    expect(screen.queryByText('❗')).toBeNull()
  })

  it('applies creature-exclaim class to exclamation element in needs-input state', () => {
    const { container } = renderCreature('needs-input', 'Some question')
    const exclaim = container.querySelector('.creature-exclaim')
    expect(exclaim).toBeTruthy()
  })

  it('sets title attribute on button when needs-input with questionText', () => {
    render(Creature, {
      props: { task: baseTask, state: 'needs-input', questionText: 'What to do?', onClick: vi.fn() },
    })
    const button = screen.getByRole('button')
    expect(button.getAttribute('title')).toBe('What to do?')
  })

  it('no title attribute when state is idle', () => {
    render(Creature, {
      props: { task: baseTask, state: 'idle', questionText: null, onClick: vi.fn() },
    })
    const button = screen.getByRole('button')
    expect(button.getAttribute('title')).toBeNull()
  })

  it('applies creature-bounce class for active state', () => {
    const { container } = renderCreature('active')
    const svg = container.querySelector('svg')
    expect(svg?.classList.contains('creature-bounce')).toBe(true)
  })

  it('applies creature-sleep class for egg state', () => {
    const { container } = renderCreature('egg')
    const svg = container.querySelector('svg')
    expect(svg?.classList.contains('creature-sleep')).toBe(true)
  })

  it('applies creature-sleep class for resting state', () => {
    const { container } = renderCreature('resting')
    const svg = container.querySelector('svg')
    expect(svg?.classList.contains('creature-sleep')).toBe(true)
  })

  it('applies creature-celebrate class for celebrating state', () => {
    const { container } = renderCreature('celebrating')
    const svg = container.querySelector('svg')
    expect(svg?.classList.contains('creature-celebrate')).toBe(true)
  })

  it('applies creature-wobble class for sad state', () => {
    const { container } = renderCreature('sad')
    const svg = container.querySelector('svg')
    expect(svg?.classList.contains('creature-wobble')).toBe(true)
  })

  it('applies no animation class for idle state', () => {
    const { container } = renderCreature('idle')
    const svg = container.querySelector('svg')
    expect(svg?.classList.contains('creature-bounce')).toBe(false)
    expect(svg?.classList.contains('creature-sleep')).toBe(false)
    expect(svg?.classList.contains('creature-celebrate')).toBe(false)
    expect(svg?.classList.contains('creature-wobble')).toBe(false)
  })

  it('applies no animation class for frozen state', () => {
    const { container } = renderCreature('frozen')
    const svg = container.querySelector('svg')
    expect(svg?.classList.contains('creature-bounce')).toBe(false)
    expect(svg?.classList.contains('creature-sleep')).toBe(false)
    expect(svg?.classList.contains('creature-celebrate')).toBe(false)
    expect(svg?.classList.contains('creature-wobble')).toBe(false)
  })

  it('applies no animation class to svg for needs-input state', () => {
    const { container } = renderCreature('needs-input')
    const svg = container.querySelector('svg')
    expect(svg?.classList.contains('creature-bounce')).toBe(false)
    expect(svg?.classList.contains('creature-sleep')).toBe(false)
  })

  it('applies text-success color for active state', () => {
    const { container } = renderCreature('active')
    const svg = container.querySelector('svg')
    expect(svg?.classList.contains('text-success')).toBe(true)
  })

  it('applies text-warning color for needs-input state', () => {
    const { container } = renderCreature('needs-input')
    const svg = container.querySelector('svg')
    expect(svg?.classList.contains('text-warning')).toBe(true)
  })

  it('applies text-error color for sad state', () => {
    const { container } = renderCreature('sad')
    const svg = container.querySelector('svg')
    expect(svg?.classList.contains('text-error')).toBe(true)
  })

  it('applies text-info color for celebrating state', () => {
    const { container } = renderCreature('celebrating')
    const svg = container.querySelector('svg')
    expect(svg?.classList.contains('text-info')).toBe(true)
  })

  it('calls onClick with task id when clicked', async () => {
    const onClick = vi.fn()
    render(Creature, { props: { task: baseTask, state: 'idle', questionText: null, onClick } })
    const button = screen.getByRole('button')
    await fireEvent.click(button)
    expect(onClick).toHaveBeenCalledWith('T-99')
  })

  it('calls onClick with task id when creature is in active state', async () => {
    const { onClick } = renderCreature('active')
    const button = screen.getByRole('button')
    await fireEvent.click(button)
    expect(onClick).toHaveBeenCalledWith('T-99')
  })

  it('applies reduced opacity for frozen state', () => {
    const { container } = renderCreature('frozen')
    const button = container.querySelector('button')
    expect(button?.classList.contains('opacity-50')).toBe(true)
  })

  it('does not apply opacity-50 for active state', () => {
    const { container } = renderCreature('active')
    const button = container.querySelector('button')
    expect(button?.classList.contains('opacity-50')).toBe(false)
  })
})
