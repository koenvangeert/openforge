import { render, screen } from '@testing-library/svelte'
import { describe, it, expect } from 'vitest'
import type { TaskDependencySummary, TaskDependentSummary } from '../../../lib/taskDependencies'
import TaskRelationshipDetailSection from './TaskRelationshipDetailSection.svelte'

describe('TaskRelationshipDetailSection', () => {
  it('renders full dependency summaries with titles and long-form waiting text', () => {
    const dependencies: TaskDependencySummary[] = [
      {
        id: 'T-1',
        status: 'done',
        title: 'Finish schema changes',
        displayTitle: 'Finish schema changes',
        tooltipTitle: 'Finish schema changes',
      },
      {
        id: 'T-missing',
        status: null,
        title: 'T-missing',
        displayTitle: null,
        tooltipTitle: 'T-missing',
      },
    ]

    render(TaskRelationshipDetailSection, {
      props: {
        kind: 'dependencies',
        items: dependencies,
        waitingDependencyCount: 1,
        density: 'full',
      },
    })

    const section = screen.getByLabelText('Dependencies')
    expect(section.textContent).toContain('T-1')
    expect(section.textContent).toContain('done')
    expect(section.textContent).toContain('Finish schema changes')
    expect(screen.getByText('Finish schema changes').closest('[title]')?.getAttribute('title')).toBe('Finish schema changes')
    expect(section.textContent).toContain('T-missing')
    expect(section.textContent).toContain('unknown')
    expect(section.textContent).toContain('Waiting on 1 dependency')
  })

  it('renders compact dependent summaries with short readiness labels', () => {
    const dependents: TaskDependentSummary[] = [
      {
        id: 'T-2',
        status: 'backlog',
        title: 'Begin rollout',
        displayTitle: 'Begin rollout',
        tooltipTitle: 'Begin rollout',
        remainingDependencyCountAfterCurrentDone: 0,
      },
      {
        id: 'T-3',
        status: 'backlog',
        title: 'Deploy after second prerequisite',
        displayTitle: 'Deploy after second prerequisite',
        tooltipTitle: 'Deploy after second prerequisite',
        remainingDependencyCountAfterCurrentDone: 1,
      },
    ]

    render(TaskRelationshipDetailSection, {
      props: {
        kind: 'dependents',
        items: dependents,
        density: 'compact',
      },
    })

    const section = screen.getByLabelText('Dependent tasks')
    expect(section.textContent).toContain('T-2')
    expect(section.textContent).toContain('ready after this')
    expect(section.textContent).toContain('T-3')
    expect(section.textContent).toContain('still waits on 1 dep')
    expect(section.textContent).toContain('2 tasks depend on this one')
    expect(section.textContent).not.toContain('Begin rollout')
    expect(section.querySelector('[title="Begin rollout"]')).toBeTruthy()
  })
})
