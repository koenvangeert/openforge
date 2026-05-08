import { render, screen } from '@testing-library/svelte'
import { describe, it, expect } from 'vitest'
import TaskPromptSummary from './TaskPromptSummary.svelte'
import type { Task } from '../../lib/types'

const baseTask: Task = {
  id: 'T-42',
  initial_prompt: 'Implement auth middleware',
  status: 'backlog',
  prompt: 'Build the auth middleware implementation with JWT support',
  summary: 'Implemented JWT auth',
  agent: null,
  permission_mode: null,
  depends_on: [],
  project_id: null,
  created_at: 1000,
  updated_at: 2000,
}

describe('TaskPromptSummary', () => {
  it('renders initial prompt and summary', () => {
    render(TaskPromptSummary, { props: { task: baseTask } })
    expect(screen.getByText('Implement auth middleware')).toBeTruthy()
    expect(screen.getByText('Implemented JWT auth')).toBeTruthy()
  })
})
