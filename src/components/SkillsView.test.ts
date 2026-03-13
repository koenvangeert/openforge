import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { SkillInfo } from '../lib/types'

vi.mock('../lib/stores', () => ({
  skills: writable<SkillInfo[]>([]),
  selectedSkillName: writable<string | null>(null),
  activeProjectId: writable<string | null>('proj-1'),
}))

vi.mock('../lib/navigation', () => ({
  pushNavState: vi.fn(),
}))

vi.mock('../lib/ipc', () => ({
  listOpenCodeSkills: vi.fn().mockResolvedValue([]),
}))

import SkillsView from './SkillsView.svelte'
import { skills, selectedSkillName, activeProjectId } from '../lib/stores'
import { listOpenCodeSkills } from '../lib/ipc'

const projectSkill: SkillInfo = {
  name: 'git-master',
  description: 'Git operations and workflows',
  agent: null,
  template: '# Git Master\n\nUse this skill for git operations.',
  level: 'project',
  source_dir: '.claude',
}

const userSkill: SkillInfo = {
  name: 'creating-skills',
  description: 'Guides creation of effective agent skills',
  agent: null,
  template: '# Creating Skills\n\nHow to create SKILL.md files.',
  level: 'user',
  source_dir: '.claude',
}

const userSkill2: SkillInfo = {
  name: 'typescript-advanced',
  description: 'Advanced TypeScript types',
  agent: null,
  template: '# TypeScript Advanced\n\nAdvanced type patterns.',
  level: 'user',
  source_dir: '.agents',
}

describe('SkillsView', () => {
  beforeEach(() => {
    skills.set([])
    selectedSkillName.set(null)
    activeProjectId.set('proj-1')
    vi.clearAllMocks()
    vi.mocked(listOpenCodeSkills).mockResolvedValue([])
  })

  it('shows loading state initially', async () => {
    vi.mocked(listOpenCodeSkills).mockImplementation(
      () => new Promise(() => {}) // never resolves
    )
    render(SkillsView)

    expect(screen.getByText('Loading skills...')).toBeTruthy()
  })

  it('shows header with skill count', async () => {
    vi.mocked(listOpenCodeSkills).mockResolvedValue([projectSkill, userSkill])
    render(SkillsView)

    await waitFor(() => {
      expect(screen.getByText('Skills')).toBeTruthy()
      expect(screen.getByText('2 skills')).toBeTruthy()
    })
  })

  it('shows singular skill count for 1 skill', async () => {
    vi.mocked(listOpenCodeSkills).mockResolvedValue([userSkill])
    render(SkillsView)

    await waitFor(() => {
      expect(screen.getByText('1 skill')).toBeTruthy()
    })
  })

  it('shows empty state when no skills found', async () => {
    vi.mocked(listOpenCodeSkills).mockResolvedValue([])
    render(SkillsView)

    await waitFor(() => {
      expect(screen.getByText('No skills found. Create your first skill!')).toBeTruthy()
    })
  })

  it('shows error state when loading fails', async () => {
    vi.mocked(listOpenCodeSkills).mockRejectedValue(new Error('Connection refused'))
    render(SkillsView)

    await waitFor(() => {
      expect(screen.getByText('Failed to load skills. Is OpenCode running?')).toBeTruthy()
    })
  })

  it('calls listOpenCodeSkills on mount', async () => {
    render(SkillsView)

    await waitFor(() => {
      expect(listOpenCodeSkills).toHaveBeenCalledWith('proj-1')
    })
  })

  it('renders skill list grouped by level', async () => {
    vi.mocked(listOpenCodeSkills).mockResolvedValue([projectSkill, userSkill])
    render(SkillsView)

    await waitFor(() => {
      expect(screen.getByText('Repository')).toBeTruthy()
      expect(screen.getByText('Personal')).toBeTruthy()
      expect(screen.getAllByText('git-master').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('creating-skills').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('shows skill descriptions in list', async () => {
    vi.mocked(listOpenCodeSkills).mockResolvedValue([projectSkill])
    render(SkillsView)

    await waitFor(() => {
      expect(screen.getAllByText('Git operations and workflows').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('auto-selects first skill on load', async () => {
    vi.mocked(listOpenCodeSkills).mockResolvedValue([projectSkill, userSkill])
    render(SkillsView)

    await waitFor(() => {
      expect(screen.getAllByText('git-master').length).toBeGreaterThan(1)
    })
  })

  it('shows skill detail with level badge when selected', async () => {
    vi.mocked(listOpenCodeSkills).mockResolvedValue([projectSkill])
    render(SkillsView)

    await waitFor(() => {
      expect(screen.getAllByText('repository').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('shows Refresh button', async () => {
    render(SkillsView)

    await waitFor(() => {
      expect(screen.getByText(/Refresh/)).toBeTruthy()
    })
  })

  it('calls listOpenCodeSkills again when Refresh is clicked', async () => {
    render(SkillsView)

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
    render(SkillsView)

    await waitFor(() => {
      expect(screen.getAllByText('creating-skills').length).toBeGreaterThanOrEqual(1)
    })

    const skillBtns = screen.getAllByText('creating-skills')
    await fireEvent.click(skillBtns[0].closest('button')!)

    await waitFor(() => {
      expect(screen.getAllByText('Guides creation of effective agent skills').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('filters skills by search input', async () => {
    vi.mocked(listOpenCodeSkills).mockResolvedValue([projectSkill, userSkill, userSkill2])
    render(SkillsView)

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
    render(SkillsView)

    await waitFor(() => {
      expect(screen.getAllByText('git-master').length).toBeGreaterThanOrEqual(1)
    })

    const filterInput = screen.getByPlaceholderText('Filter skills...')
    await fireEvent.input(filterInput, { target: { value: 'nonexistent' } })

    await waitFor(() => {
      expect(screen.getByText('No skills match your filter.')).toBeTruthy()
    })
  })

  it('shows "No content available" when skill has no template', async () => {
    const noTemplateSkill: SkillInfo = { ...projectSkill, template: null }
    vi.mocked(listOpenCodeSkills).mockResolvedValue([noTemplateSkill])
    render(SkillsView)

    await waitFor(() => {
      expect(screen.getByText('No content available for this skill.')).toBeTruthy()
    })
  })

  it('shows only Repository group when no user skills exist', async () => {
    vi.mocked(listOpenCodeSkills).mockResolvedValue([projectSkill])
    render(SkillsView)

    await waitFor(() => {
      expect(screen.getByText('Repository')).toBeTruthy()
      expect(screen.queryByText('Personal')).toBeFalsy()
    })
  })

  it('shows only Personal group when no project skills exist', async () => {
    vi.mocked(listOpenCodeSkills).mockResolvedValue([userSkill])
    render(SkillsView)

    await waitFor(() => {
      expect(screen.queryByText('Repository')).toBeFalsy()
      expect(screen.getByText('Personal')).toBeTruthy()
    })
  })

  it('does not load skills when no active project', async () => {
    activeProjectId.set(null)
    render(SkillsView)

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(listOpenCodeSkills).not.toHaveBeenCalled()
  })
})
