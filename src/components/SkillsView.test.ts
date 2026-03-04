import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { SkillInfo } from '../lib/types'

vi.mock('../lib/stores', () => ({
  skills: writable<SkillInfo[]>([]),
  selectedSkillName: writable<string | null>(null),
  activeProjectId: writable<string | null>('proj-1'),
  currentView: writable('skills'),
  selectedTaskId: writable<string | null>(null),
}))

vi.mock('../lib/navigation', () => ({
  pushNavState: vi.fn(),
}))

vi.mock('../lib/ipc', () => ({
  listOpenCodeSkills: vi.fn().mockResolvedValue([]),
  createTask: vi.fn().mockResolvedValue({
    id: 'T-99',
    title: 'Test task',
    status: 'backlog',
    jira_key: null,
    jira_title: null,
    jira_status: null,
    jira_assignee: null,
    plan_text: null,
    project_id: 'proj-1',
    created_at: 1000,
    updated_at: 2000,
  }),
}))

import SkillsView from './SkillsView.svelte'
import { skills, selectedSkillName, activeProjectId, currentView, selectedTaskId } from '../lib/stores'
import { listOpenCodeSkills, createTask } from '../lib/ipc'
import { pushNavState } from '../lib/navigation'

const projectSkill: SkillInfo = {
  name: 'git-master',
  description: 'Git operations and workflows',
  agent: null,
  template: '# Git Master\n\nUse this skill for git operations.',
  level: 'project',
}

const userSkill: SkillInfo = {
  name: 'creating-skills',
  description: 'Guides creation of effective agent skills',
  agent: null,
  template: '# Creating Skills\n\nHow to create SKILL.md files.',
  level: 'user',
}

const userSkill2: SkillInfo = {
  name: 'typescript-advanced',
  description: 'Advanced TypeScript types',
  agent: null,
  template: '# TypeScript Advanced\n\nAdvanced type patterns.',
  level: 'user',
}

describe('SkillsView', () => {
  const mockOnRunAction = vi.fn()

  beforeEach(() => {
    skills.set([])
    selectedSkillName.set(null)
    activeProjectId.set('proj-1')
    currentView.set('skills')
    selectedTaskId.set(null)
    vi.clearAllMocks()
    vi.mocked(listOpenCodeSkills).mockResolvedValue([])
    vi.mocked(createTask).mockResolvedValue({
      id: 'T-99',
      title: 'Test task',
      status: 'backlog',
      jira_key: null,
      jira_title: null,
      jira_status: null,
      jira_assignee: null,
      plan_text: null,
      project_id: 'proj-1',
      created_at: 1000,
      updated_at: 2000,
    })
  })

  it('shows loading state initially', async () => {
    vi.mocked(listOpenCodeSkills).mockImplementation(
      () => new Promise(() => {}) // never resolves
    )
    render(SkillsView, { props: { onRunAction: mockOnRunAction } })

    expect(screen.getByText('Loading skills...')).toBeTruthy()
  })

  it('shows header with skill count', async () => {
    vi.mocked(listOpenCodeSkills).mockResolvedValue([projectSkill, userSkill])
    render(SkillsView, { props: { onRunAction: mockOnRunAction } })

    await waitFor(() => {
      expect(screen.getByText('Skills')).toBeTruthy()
      expect(screen.getByText('2 skills')).toBeTruthy()
    })
  })

  it('shows singular skill count for 1 skill', async () => {
    vi.mocked(listOpenCodeSkills).mockResolvedValue([userSkill])
    render(SkillsView, { props: { onRunAction: mockOnRunAction } })

    await waitFor(() => {
      expect(screen.getByText('1 skill')).toBeTruthy()
    })
  })

  it('shows empty state when no skills found', async () => {
    vi.mocked(listOpenCodeSkills).mockResolvedValue([])
    render(SkillsView, { props: { onRunAction: mockOnRunAction } })

    await waitFor(() => {
      expect(screen.getByText('No skills found. Create your first skill!')).toBeTruthy()
    })
  })

  it('shows error state when loading fails', async () => {
    vi.mocked(listOpenCodeSkills).mockRejectedValue(new Error('Connection refused'))
    render(SkillsView, { props: { onRunAction: mockOnRunAction } })

    await waitFor(() => {
      expect(screen.getByText('Failed to load skills. Is OpenCode running?')).toBeTruthy()
    })
  })

  it('calls listOpenCodeSkills on mount', async () => {
    render(SkillsView, { props: { onRunAction: mockOnRunAction } })

    await waitFor(() => {
      expect(listOpenCodeSkills).toHaveBeenCalledWith('proj-1')
    })
  })

  it('renders skill list grouped by level', async () => {
    vi.mocked(listOpenCodeSkills).mockResolvedValue([projectSkill, userSkill])
    render(SkillsView, { props: { onRunAction: mockOnRunAction } })

    await waitFor(() => {
      expect(screen.getByText('Project')).toBeTruthy()
      expect(screen.getByText('User')).toBeTruthy()
      // git-master appears in both list and detail (auto-selected)
      expect(screen.getAllByText('git-master').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('creating-skills').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('shows skill descriptions in list', async () => {
    vi.mocked(listOpenCodeSkills).mockResolvedValue([projectSkill])
    render(SkillsView, { props: { onRunAction: mockOnRunAction } })

    await waitFor(() => {
      // Description appears in list; may also appear in detail panel
      expect(screen.getAllByText('Git operations and workflows').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('auto-selects first skill on load', async () => {
    vi.mocked(listOpenCodeSkills).mockResolvedValue([projectSkill, userSkill])
    render(SkillsView, { props: { onRunAction: mockOnRunAction } })

    await waitFor(() => {
      // First skill is selected — its name should appear in the detail header
      expect(screen.getAllByText('git-master').length).toBeGreaterThan(1)
    })
  })

  it('shows skill detail with level badge when selected', async () => {
    vi.mocked(listOpenCodeSkills).mockResolvedValue([projectSkill])
    render(SkillsView, { props: { onRunAction: mockOnRunAction } })

    await waitFor(() => {
      // 'project' badge appears in list item and detail header
      expect(screen.getAllByText('project').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('shows Edit and Ask action buttons for selected skill', async () => {
    vi.mocked(listOpenCodeSkills).mockResolvedValue([projectSkill])
    render(SkillsView, { props: { onRunAction: mockOnRunAction } })

    await waitFor(() => {
      expect(screen.getByText('Edit')).toBeTruthy()
      expect(screen.getByText('Ask')).toBeTruthy()
    })
  })

  it('shows + New Skill button in header', async () => {
    render(SkillsView, { props: { onRunAction: mockOnRunAction } })

    await waitFor(() => {
      expect(screen.getByText('+ New Skill')).toBeTruthy()
    })
  })

  it('shows Refresh button', async () => {
    render(SkillsView, { props: { onRunAction: mockOnRunAction } })

    await waitFor(() => {
      expect(screen.getByText(/Refresh/)).toBeTruthy()
    })
  })

  it('calls listOpenCodeSkills again when Refresh is clicked', async () => {
    render(SkillsView, { props: { onRunAction: mockOnRunAction } })

    await waitFor(() => {
      expect(screen.getByText(/Refresh/)).toBeTruthy()
    })

    vi.mocked(listOpenCodeSkills).mockClear()
    const refreshBtn = screen.getByText(/Refresh/).closest('button')!
    await fireEvent.click(refreshBtn)

    await waitFor(() => {
      expect(listOpenCodeSkills).toHaveBeenCalledWith('proj-1')
    })
  })

  it('selects a different skill when clicked', async () => {
    vi.mocked(listOpenCodeSkills).mockResolvedValue([projectSkill, userSkill])
    render(SkillsView, { props: { onRunAction: mockOnRunAction } })

    await waitFor(() => {
      expect(screen.getAllByText('creating-skills').length).toBeGreaterThanOrEqual(1)
    })

    // Click the second skill
    const skillBtns = screen.getAllByText('creating-skills')
    await fireEvent.click(skillBtns[0].closest('button')!)

    await waitFor(() => {
      // After clicking, creating-skills should be selected and its description visible
      expect(screen.getAllByText('Guides creation of effective agent skills').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('filters skills by search input', async () => {
    vi.mocked(listOpenCodeSkills).mockResolvedValue([projectSkill, userSkill, userSkill2])
    render(SkillsView, { props: { onRunAction: mockOnRunAction } })

    await waitFor(() => {
      expect(screen.getAllByText('git-master').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('creating-skills').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('typescript-advanced').length).toBeGreaterThanOrEqual(1)
    })

    const filterInput = screen.getByPlaceholderText('Filter skills...')
    await fireEvent.input(filterInput, { target: { value: 'typescript' } })

    await waitFor(() => {
      expect(screen.getAllByText('typescript-advanced').length).toBeGreaterThanOrEqual(1)
      expect(screen.queryByText('git-master')).toBeFalsy()
      expect(screen.queryByText('creating-skills')).toBeFalsy()
    })
  })

  it('shows no match message when filter has no results', async () => {
    vi.mocked(listOpenCodeSkills).mockResolvedValue([projectSkill])
    render(SkillsView, { props: { onRunAction: mockOnRunAction } })

    await waitFor(() => {
      expect(screen.getAllByText('git-master').length).toBeGreaterThanOrEqual(1)
    })

    const filterInput = screen.getByPlaceholderText('Filter skills...')
    await fireEvent.input(filterInput, { target: { value: 'nonexistent' } })

    await waitFor(() => {
      expect(screen.getByText('No skills match your filter.')).toBeTruthy()
    })
  })

  it('calls createTask and onRunAction when Edit is clicked', async () => {
    vi.mocked(listOpenCodeSkills).mockResolvedValue([projectSkill])
    render(SkillsView, { props: { onRunAction: mockOnRunAction } })

    await waitFor(() => {
      expect(screen.getByText('Edit')).toBeTruthy()
    })

    await fireEvent.click(screen.getByText('Edit'))

    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith('Edit skill: git-master', 'backlog', null, 'proj-1')
      expect(mockOnRunAction).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'T-99',
          agent: null,
        })
      )
      // Prompt should include skill name and content
      const callArgs = mockOnRunAction.mock.calls[0][0]
      expect(callArgs.actionPrompt).toContain('git-master')
      expect(callArgs.actionPrompt).toContain('# Git Master')
    })
  })

  it('calls createTask and onRunAction when + New Skill is clicked', async () => {
    vi.mocked(listOpenCodeSkills).mockResolvedValue([])
    render(SkillsView, { props: { onRunAction: mockOnRunAction } })

    await waitFor(() => {
      // Both header and empty state show '+ New Skill' — get the header one
      const newSkillBtns = screen.getAllByText('+ New Skill')
      expect(newSkillBtns.length).toBeGreaterThanOrEqual(1)
    })

    // Click the first (header) button
    await fireEvent.click(screen.getAllByText('+ New Skill')[0])

    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith('Create new skill', 'backlog', null, 'proj-1')
      expect(mockOnRunAction).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'T-99',
          agent: null,
        })
      )
      const callArgs = mockOnRunAction.mock.calls[0][0]
      expect(callArgs.actionPrompt).toContain('creating-skills')
    })
  })

  it('toggles Ask input when Ask button is clicked', async () => {
    vi.mocked(listOpenCodeSkills).mockResolvedValue([projectSkill])
    render(SkillsView, { props: { onRunAction: mockOnRunAction } })

    await waitFor(() => {
      expect(screen.getByText('Ask')).toBeTruthy()
    })

    // Click Ask to show input
    await fireEvent.click(screen.getByText('Ask'))

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Ask a question about this skill...')).toBeTruthy()
      expect(screen.getByText('Send')).toBeTruthy()
    })

    // Click Ask again to hide input
    await fireEvent.click(screen.getByText('Ask'))

    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Ask a question about this skill...')).toBeFalsy()
    })
  })

  it('Send button is disabled when ask prompt is empty', async () => {
    vi.mocked(listOpenCodeSkills).mockResolvedValue([projectSkill])
    render(SkillsView, { props: { onRunAction: mockOnRunAction } })

    await waitFor(() => {
      expect(screen.getByText('Ask')).toBeTruthy()
    })

    await fireEvent.click(screen.getByText('Ask'))

    await waitFor(() => {
      const sendBtn = screen.getByText('Send')
      expect(sendBtn.closest('button')!.disabled).toBe(true)
    })
  })

  it('sends ask question and creates task when Send is clicked', async () => {
    vi.mocked(listOpenCodeSkills).mockResolvedValue([projectSkill])
    render(SkillsView, { props: { onRunAction: mockOnRunAction } })

    await waitFor(() => {
      expect(screen.getByText('Ask')).toBeTruthy()
    })

    await fireEvent.click(screen.getByText('Ask'))

    const askInput = screen.getByPlaceholderText('Ask a question about this skill...')
    await fireEvent.input(askInput, { target: { value: 'How do I rebase?' } })

    await fireEvent.click(screen.getByText('Send'))

    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith('Question about skill: git-master', 'backlog', null, 'proj-1')
      expect(mockOnRunAction).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'T-99',
          agent: null,
        })
      )
      const callArgs = mockOnRunAction.mock.calls[0][0]
      expect(callArgs.actionPrompt).toContain('How do I rebase?')
      expect(callArgs.actionPrompt).toContain('git-master')
    })
  })

  it('shows "No content available" when skill has no template', async () => {
    const noTemplateSkill: SkillInfo = { ...projectSkill, template: null }
    vi.mocked(listOpenCodeSkills).mockResolvedValue([noTemplateSkill])
    render(SkillsView, { props: { onRunAction: mockOnRunAction } })

    await waitFor(() => {
      expect(screen.getByText('No content available for this skill.')).toBeTruthy()
    })
  })

  it('shows only Project group when no user skills exist', async () => {
    vi.mocked(listOpenCodeSkills).mockResolvedValue([projectSkill])
    render(SkillsView, { props: { onRunAction: mockOnRunAction } })

    await waitFor(() => {
      expect(screen.getByText('Project')).toBeTruthy()
      expect(screen.queryByText('User')).toBeFalsy()
    })
  })

  it('shows only User group when no project skills exist', async () => {
    vi.mocked(listOpenCodeSkills).mockResolvedValue([userSkill])
    render(SkillsView, { props: { onRunAction: mockOnRunAction } })

    await waitFor(() => {
      expect(screen.queryByText('Project')).toBeFalsy()
      expect(screen.getByText('User')).toBeTruthy()
    })
  })

  it('navigates to board view after Edit action', async () => {
    vi.mocked(listOpenCodeSkills).mockResolvedValue([projectSkill])
    render(SkillsView, { props: { onRunAction: mockOnRunAction } })

    await waitFor(() => {
      expect(screen.getByText('Edit')).toBeTruthy()
    })

    await fireEvent.click(screen.getByText('Edit'))

    await waitFor(() => {
      expect(pushNavState).toHaveBeenCalled()
    })
  })

  it('does not load skills when no active project', async () => {
    activeProjectId.set(null)
    render(SkillsView, { props: { onRunAction: mockOnRunAction } })

    // Give it a tick
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(listOpenCodeSkills).not.toHaveBeenCalled()
  })
})
