import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { SkillIdentity, SkillInfo } from '../lib/types'
import { requireElement } from '../test-utils/dom'

vi.mock('../lib/stores', () => ({
  skills: writable<SkillInfo[]>([]),
  selectedSkillIdentity: writable<SkillIdentity | null>(null),
  activeProjectId: writable<string | null>('proj-1'),
  currentView: writable('board'),
  selectedTaskId: writable<string | null>(null),
  selectedReviewPr: writable(null),
}))

vi.mock('../lib/ipc', () => ({
  listOpenCodeSkills: vi.fn().mockResolvedValue([]),
  saveSkillContent: vi.fn().mockResolvedValue(undefined),
}))

import SkillsView from './SkillsView.svelte'
import { skills, selectedSkillIdentity, activeProjectId } from '../lib/stores'
import { listOpenCodeSkills, saveSkillContent } from '../lib/ipc'

const projectSkill: SkillInfo = {
  name: 'git-master',
  description: 'Git operations and workflows',
  agent: null,
  template: '# Git Master\n\nUse this skill for git operations.',
  level: 'project',
  source_dir: '.agents',
  file_name: null,
}

const userSkill: SkillInfo = {
  name: 'creating-skills',
  description: 'Guides creation of effective agent skills',
  agent: null,
  template: '# Creating Skills\n\nHow to create SKILL.md files.',
  level: 'user',
  source_dir: '.agents',
  file_name: null,
}

const userSkill2: SkillInfo = {
  name: 'typescript-advanced',
  description: 'Advanced TypeScript types',
  agent: null,
  template: '# TypeScript Advanced\n\nAdvanced type patterns.',
  level: 'user',
  source_dir: '.agents',
  file_name: null,
}

const piProjectSkill: SkillInfo = {
  name: 'pi-review',
  description: 'Pi review workflow',
  agent: null,
  template: '# Pi Review\n\nUse this skill from Pi.',
  level: 'project',
  source_dir: '.pi',
  file_name: null,
}

const piRootMarkdownSkill: SkillInfo = {
  name: 'root-pi-review',
  description: 'Pi root markdown workflow',
  agent: null,
  template: '---\nname: root-pi-review\ndescription: Pi root markdown workflow\n---\n# Root Pi Review',
  level: 'project',
  source_dir: '.pi',
  file_name: 'root-pi-review.md',
}

const piUserSkill: SkillInfo = {
  name: 'pi-user-review',
  description: 'Personal Pi review workflow',
  agent: null,
  template: '# Pi User Review\n\nUse this personal Pi skill.',
  level: 'user',
  source_dir: '.pi',
  file_name: null,
}

const duplicateProjectSkill: SkillInfo = {
  name: 'shared-skill',
  description: 'Repository copy of the shared skill',
  agent: null,
  template: '# Repository Shared Skill\n\nRepository instructions.',
  level: 'project',
  source_dir: '.agents',
  file_name: null,
}

const duplicateUserSkill: SkillInfo = {
  name: 'shared-skill',
  description: 'Personal copy of the shared skill',
  agent: null,
  template: '# Personal Shared Skill\n\nPersonal instructions.',
  level: 'user',
  source_dir: '.opencode',
  file_name: null,
}

describe('SkillsView', () => {
  beforeEach(() => {
    skills.set([])
    selectedSkillIdentity.set(null)
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
    render(SkillsView, { props: { projectName: 'Test' } })

    await waitFor(() => {
      expect(screen.getByText('Test — Skills')).toBeTruthy()
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

  it('renders generic, provider-specific, and legacy skill source paths during migration', async () => {
    vi.mocked(listOpenCodeSkills).mockResolvedValue([
      projectSkill,
      { ...projectSkill, name: 'legacy-claude', source_dir: '.claude' },
      { ...projectSkill, name: 'legacy-opencode', source_dir: '.opencode' },
      piProjectSkill,
    ])
    render(SkillsView)

    await waitFor(() => {
      expect(screen.getAllByText('.agents/skills').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('.claude/skills').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('.opencode/skills').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('.pi/skills').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('renders personal Pi skills from the Pi agent skill source path', async () => {
    vi.mocked(listOpenCodeSkills).mockResolvedValue([piUserSkill])
    render(SkillsView)

    await waitFor(() => {
      expect(screen.getAllByText('~/.pi/agent/skills').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('Pi User Review')).toBeTruthy()
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
    const refreshBtn = requireElement(screen.getByText(/Refresh/).closest('button'), HTMLButtonElement)
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
    await fireEvent.click(requireElement(skillBtns[0]?.closest('button'), HTMLButtonElement))

    await waitFor(() => {
      expect(screen.getAllByText('Guides creation of effective agent skills').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('selects the clicked duplicate skill by name, level, and source directory', async () => {
    vi.mocked(listOpenCodeSkills).mockResolvedValue([duplicateProjectSkill, duplicateUserSkill])
    render(SkillsView)

    await waitFor(() => {
      expect(screen.getByText('Repository instructions.')).toBeTruthy()
    })

    await fireEvent.click(requireElement(screen.getByText('Personal copy of the shared skill').closest('button'), HTMLButtonElement))

    await waitFor(() => {
      expect(screen.getByText('Personal instructions.')).toBeTruthy()
      expect(screen.queryByText('Repository instructions.')).toBeFalsy()
      expect(screen.getAllByText('personal').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('.opencode/skills').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('saves edits to the selected duplicate skill identity', async () => {
    vi.mocked(listOpenCodeSkills).mockResolvedValue([duplicateProjectSkill, duplicateUserSkill])
    render(SkillsView)

    await waitFor(() => {
      expect(screen.getByText('Personal copy of the shared skill')).toBeTruthy()
    })

    await fireEvent.click(requireElement(screen.getByText('Personal copy of the shared skill').closest('button'), HTMLButtonElement))
    await fireEvent.click(screen.getByText('Manually Edit'))
    const editTextboxes = screen.getAllByRole('textbox')
    await fireEvent.input(requireElement(editTextboxes[1], HTMLTextAreaElement), { target: { value: '# Updated Personal Shared Skill' } })
    await fireEvent.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(saveSkillContent).toHaveBeenCalledWith(
        'proj-1',
        'shared-skill',
        'user',
        '.opencode',
        '# Updated Personal Shared Skill',
        null,
      )
    })
  })

  it('saves edits to Pi skills with the Pi source directory', async () => {
    vi.mocked(listOpenCodeSkills).mockResolvedValue([piProjectSkill])
    render(SkillsView)

    await waitFor(() => {
      expect(screen.getByText('Pi Review')).toBeTruthy()
    })

    await fireEvent.click(screen.getByText('Manually Edit'))
    const editTextboxes = screen.getAllByRole('textbox')
    await fireEvent.input(requireElement(editTextboxes[1], HTMLTextAreaElement), { target: { value: '# Updated Pi Review' } })
    await fireEvent.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(saveSkillContent).toHaveBeenCalledWith(
        'proj-1',
        'pi-review',
        'project',
        '.pi',
        '# Updated Pi Review',
        null,
      )
    })
  })

  it('saves edits to root markdown Pi skills using their source file name', async () => {
    vi.mocked(listOpenCodeSkills).mockResolvedValue([piRootMarkdownSkill])
    render(SkillsView)

    await waitFor(() => {
      expect(screen.getByText('Root Pi Review')).toBeTruthy()
    })

    await fireEvent.click(screen.getByText('Manually Edit'))
    const editTextboxes = screen.getAllByRole('textbox')
    await fireEvent.input(requireElement(editTextboxes[1], HTMLTextAreaElement), { target: { value: '# Updated Root Pi Review' } })
    await fireEvent.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(saveSkillContent).toHaveBeenCalledWith(
        'proj-1',
        'root-pi-review',
        'project',
        '.pi',
        '# Updated Root Pi Review',
        'root-pi-review.md',
      )
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
