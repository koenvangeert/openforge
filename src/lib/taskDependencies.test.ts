import { describe, expect, it } from 'vitest'
import type { Task } from './types'
import { getDependencyWaitLabel, getTaskDependentSummaries, getTaskDependencySummaries, getWaitingDependencyCount } from './taskDependencies'

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    initial_prompt: `Task ${id}`,
    status: 'backlog',
    prompt: null,
    summary: null,
    agent: null,
    permission_mode: null,
    depends_on: [],
    project_id: 'project-1',
    created_at: 1000,
    updated_at: 2000,
    ...overrides,
  }
}

describe('task dependency summaries', () => {
  it('counts unfinished and unknown dependencies as waiting', () => {
    const task = makeTask('T-1', { depends_on: ['T-done', 'T-doing', 'T-missing'] })
    const knownTasks = [
      task,
      makeTask('T-done', { status: 'done' }),
      makeTask('T-doing', { status: 'doing' }),
    ]

    expect(getWaitingDependencyCount(task, knownTasks)).toBe(2)
    expect(getDependencyWaitLabel(task, knownTasks)).toBe('Waiting on 2 deps')
  })

  it('omits compact wait label when all dependencies are done', () => {
    const task = makeTask('T-1', { depends_on: ['T-done'] })
    const knownTasks = [task, makeTask('T-done', { status: 'done' })]

    expect(getDependencyWaitLabel(task, knownTasks)).toBeNull()
  })

  it('returns dependency titles and statuses for detail surfaces', () => {
    const task = makeTask('T-1', { depends_on: ['T-2', 'T-missing'] })
    const knownTasks = [task, makeTask('T-2', { status: 'doing', initial_prompt: 'Prepare the API' })]

    expect(getTaskDependencySummaries(task, knownTasks)).toEqual([
      {
        id: 'T-2',
        status: 'doing',
        title: 'Prepare the API',
        displayTitle: 'Prepare the API',
        tooltipTitle: 'Prepare the API',
      },
      {
        id: 'T-missing',
        status: null,
        title: 'T-missing',
        displayTitle: null,
        tooltipTitle: 'T-missing',
      },
    ])
  })

  it('returns tasks that depend on the selected task with readiness after it completes', () => {
    const selectedTask = makeTask('T-1')
    const alreadyDoneDependency = makeTask('T-done', { status: 'done' })
    const unfinishedDependency = makeTask('T-doing', { status: 'doing' })
    const readyDependent = makeTask('T-2', {
      depends_on: ['T-1', 'T-done'],
      initial_prompt: 'Start after current task',
    })
    const stillBlockedDependent = makeTask('T-3', {
      depends_on: ['T-1', 'T-doing', 'T-missing'],
      initial_prompt: 'Needs more prerequisites',
    })
    const unrelatedTask = makeTask('T-4', { depends_on: ['T-done'] })

    expect(getTaskDependentSummaries(selectedTask, [
      selectedTask,
      readyDependent,
      stillBlockedDependent,
      unrelatedTask,
      alreadyDoneDependency,
      unfinishedDependency,
    ])).toEqual([
      {
        id: 'T-2',
        status: 'backlog',
        title: 'Start after current task',
        displayTitle: 'Start after current task',
        tooltipTitle: 'Start after current task',
        remainingDependencyCountAfterCurrentDone: 0,
      },
      {
        id: 'T-3',
        status: 'backlog',
        title: 'Needs more prerequisites',
        displayTitle: 'Needs more prerequisites',
        tooltipTitle: 'Needs more prerequisites',
        remainingDependencyCountAfterCurrentDone: 2,
      },
    ])
  })
})
