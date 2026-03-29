import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import TaskListItem from './TaskListItem.svelte'
import type { Task, PullRequestInfo } from '../lib/types'
import type { TaskState } from '../lib/taskState'

vi.mock('../lib/ipc', () => ({
  openUrl: vi.fn(),
}))

const baseTask: Task = {
  id: 'T-100',
  initial_prompt: 'Fix login bug',
  status: 'doing',
  prompt: null,
  summary: null,
  agent: null,
  permission_mode: null,
  project_id: null,
  created_at: 1000,
  updated_at: 2000,
}

const basePr: PullRequestInfo = {
  id: 99,
  ticket_id: 'T-100',
  repo_owner: 'owner',
  repo_name: 'repo',
  title: 'Fix login',
  url: 'https://github.com/owner/repo/pull/99',
  state: 'open',
  head_sha: 'abc123',
  ci_status: null,
  ci_check_runs: null,
  review_status: null,
  mergeable: null,
  mergeable_state: null,
  merged_at: null,
  created_at: 1000,
  updated_at: 2000,
  draft: false,
  is_queued: false,
  unaddressed_comment_count: 0,
}

const baseProps = {
  task: baseTask,
  state: 'active' as TaskState,
  session: null,
  pullRequests: [] as PullRequestInfo[],
  reasonText: 'Agent is running.',
  isSelected: false,
  isFocused: false,
  onSelect: vi.fn(),
  onContextMenu: vi.fn(),
}

describe('TaskListItem', () => {
  it('renders task ID', () => {
    render(TaskListItem, { props: baseProps })
    expect(screen.getByText('T-100')).toBeTruthy()
  })

  it('renders title from initial_prompt', () => {
    render(TaskListItem, { props: baseProps })
    expect(screen.getByText('Fix login bug')).toBeTruthy()
  })

  it('renders only first line of initial_prompt as title', () => {
    const task = { ...baseTask, initial_prompt: 'First line\nSecond line' }
    render(TaskListItem, { props: { ...baseProps, task } })
    expect(screen.getByText('First line')).toBeTruthy()
    expect(screen.queryByText('Second line')).toBeNull()
  })

  it('truncates title to 80 chars with ellipsis', () => {
    const longTitle = 'A'.repeat(90)
    const task = { ...baseTask, initial_prompt: longTitle }
    render(TaskListItem, { props: { ...baseProps, task } })
    expect(screen.getByText('A'.repeat(80) + '...')).toBeTruthy()
  })

  it('renders reasonText', () => {
    render(TaskListItem, { props: baseProps })
    expect(screen.getByText('Agent is running.')).toBeTruthy()
  })

  it('truncates reasonText visually using Tailwind truncate class when selected', () => {
    render(TaskListItem, { props: { ...baseProps, isSelected: true, reasonText: 'A very long reason text that should be ellipsized' } })
    const reasonTextElement = screen.getByText('A very long reason text that should be ellipsized')
    expect(reasonTextElement.classList.contains('truncate')).toBe(true)
  })

  it('calls onSelect when clicked', async () => {
    const onSelect = vi.fn()
    render(TaskListItem, { props: { ...baseProps, onSelect } })
    const item = screen.getByRole('button')
    await fireEvent.click(item)
    expect(onSelect).toHaveBeenCalled()
  })

  it('calls onContextMenu on right-click', async () => {
    const onContextMenu = vi.fn()
    render(TaskListItem, { props: { ...baseProps, onContextMenu } })
    const item = screen.getByRole('button')
    await fireEvent.contextMenu(item)
    expect(onContextMenu).toHaveBeenCalled()
  })

  it('sets data-selected attribute to "true" when isSelected is true', () => {
    render(TaskListItem, { props: { ...baseProps, isSelected: true } })
    const item = screen.getByRole('button')
    expect(item.getAttribute('data-selected')).toBe('true')
  })

  it('does not set data-selected when isSelected is false', () => {
    render(TaskListItem, { props: { ...baseProps, isSelected: false } })
    const item = screen.getByRole('button')
    expect(item.getAttribute('data-selected')).toBeNull()
  })

  it('sets data-focused when isFocused is true', () => {
    render(TaskListItem, { props: { ...baseProps, isFocused: true } })
    const item = screen.getByRole('button')
    expect(item.getAttribute('data-focused')).toBe('true')
  })

  it('does not set data-focused when isFocused is false', () => {
    render(TaskListItem, { props: { ...baseProps, isFocused: false } })
    const item = screen.getByRole('button')
    expect(item.getAttribute('data-focused')).toBeNull()
  })

  it('renders PR chip showing PR number when pullRequests are given', () => {
    render(TaskListItem, { props: { ...baseProps, pullRequests: [basePr] } })
    expect(screen.getByText(/PR #99/)).toBeTruthy()
  })

  it('does not render PR chip when pullRequests is empty', () => {
    render(TaskListItem, { props: baseProps })
    expect(screen.queryByText(/PR #/)).toBeNull()
  })

  it('renders badge-info class on the state badge for pr-queued state', () => {
    render(TaskListItem, { props: { ...baseProps, state: 'pr-queued' as TaskState } })
    // The state badge renders with text "Queued" for pr-queued state
    const badge = screen.getByText('Queued')
    expect(badge.classList.contains('badge-info')).toBe(true)
  })
})
