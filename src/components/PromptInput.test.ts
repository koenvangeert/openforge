import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import PromptInput from './PromptInput.svelte'

// Mock IPC functions
vi.mock('../lib/ipc', () => ({
  listOpenCodeCommands: vi.fn().mockResolvedValue([]),
  searchOpenCodeFiles: vi.fn().mockResolvedValue([]),
  listOpenCodeAgents: vi.fn().mockResolvedValue([]),
  createTask: vi.fn(),
  updateTask: vi.fn(),
}))

describe('PromptInput', () => {
  const baseProps = {
    projectId: 'test-project',
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('focuses textarea when autofocus is true', async () => {
    render(PromptInput, {
      props: {
        ...baseProps,
        autofocus: true,
      },
    })

    const textarea = screen.getByPlaceholderText('Describe what you want to implement...')
    // The focus uses requestAnimationFrame, so we need to wait for it
    await new Promise((resolve) => requestAnimationFrame(resolve))
    expect(document.activeElement).toBe(textarea)
  })

  it('does not focus textarea when autofocus is false', () => {
    render(PromptInput, {
      props: {
        ...baseProps,
        autofocus: false,
      },
    })

    const textarea = screen.getByPlaceholderText('Describe what you want to implement...')
    expect(document.activeElement).not.toBe(textarea)
  })

  it('renders textarea with placeholder', () => {
    const placeholder = 'Enter your prompt here'
    render(PromptInput, {
      props: {
        ...baseProps,
        placeholder,
      },
    })

    const textarea = screen.getByPlaceholderText(placeholder)
    expect(textarea).toBeTruthy()
  })

  it('calls onSubmit with text on Cmd+Enter', async () => {
    const onSubmit = vi.fn()
    render(PromptInput, {
      props: {
        ...baseProps,
        onSubmit,
      },
    })

    const textarea = screen.getByPlaceholderText('Describe what you want to implement...') as HTMLTextAreaElement
    textarea.value = 'Fix the bug'
    await fireEvent.input(textarea)
    await fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })

    expect(onSubmit).toHaveBeenCalledWith('Fix the bug', null)
  })

  it('does not submit on plain Enter (allows newline)', async () => {
    const onSubmit = vi.fn()
    render(PromptInput, {
      props: {
        ...baseProps,
        onSubmit,
      },
    })

    const textarea = screen.getByPlaceholderText('Describe what you want to implement...') as HTMLTextAreaElement
    textarea.value = 'Fix the bug'
    await fireEvent.input(textarea)
    await fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('calls onCancel on Escape', async () => {
    const onCancel = vi.fn()
    render(PromptInput, {
      props: {
        ...baseProps,
        onCancel,
      },
    })

    const textarea = screen.getByPlaceholderText('Describe what you want to implement...')
    await fireEvent.keyDown(textarea, { key: 'Escape' })

    expect(onCancel).toHaveBeenCalled()
  })

  it('shows JIRA key field when toggled', async () => {
    render(PromptInput, {
      props: {
        ...baseProps,
      },
    })

    const addJiraLink = screen.getByText('+ Add JIRA key')
    await fireEvent.click(addJiraLink)

    const jiraInput = screen.getByPlaceholderText('e.g. PROJ-123')
    expect(jiraInput).toBeTruthy()
  })

  it('shows JIRA key field when the add control is activated with Space', async () => {
    render(PromptInput, {
      props: {
        ...baseProps,
      },
    })

    const addJiraButton = screen.getByRole('button', { name: '+ Add JIRA key' })
    await fireEvent.keyDown(addJiraButton, { key: ' ' })

    expect(screen.getByPlaceholderText('e.g. PROJ-123')).toBeTruthy()
  })

  it('clears the JIRA key when the clear control is activated with Enter', async () => {
    render(PromptInput, {
      props: {
        ...baseProps,
        jiraKey: 'PROJ-42',
      },
    })

    const clearJiraButton = screen.getByRole('button', { name: '✕' })
    await fireEvent.keyDown(clearJiraButton, { key: 'Enter' })

    expect(screen.queryByPlaceholderText('e.g. PROJ-123')).toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: '+ Add JIRA key' }))

    expect((screen.getByPlaceholderText('e.g. PROJ-123') as HTMLInputElement).value).toBe('')
  })


  it('renders a submit button', () => {
    render(PromptInput, { props: { ...baseProps } })
    const button = screen.getByRole('button', { name: 'Submit' })
    expect(button).toBeTruthy()
  })

  it('submit button is disabled when textarea is empty', () => {
    render(PromptInput, { props: { ...baseProps } })
    const button = screen.getByRole('button', { name: 'Submit' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('calls onSubmit when submit button is clicked', async () => {
    const onSubmit = vi.fn()
    render(PromptInput, {
      props: {
        ...baseProps,
        onSubmit,
      },
    })

    const textarea = screen.getByPlaceholderText('Describe what you want to implement...') as HTMLTextAreaElement
    textarea.value = 'Fix the bug'
    await fireEvent.input(textarea)
    const button = screen.getByRole('button', { name: 'Submit' })
    await fireEvent.click(button)

    expect(onSubmit).toHaveBeenCalledWith('Fix the bug', null)
  })

  it('does not submit empty text', async () => {
    const onSubmit = vi.fn()
    render(PromptInput, {
      props: {
        ...baseProps,
        onSubmit,
      },
    })

    const textarea = screen.getByPlaceholderText('Describe what you want to implement...')
    await fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('pre-populates in edit mode', () => {
    render(PromptInput, {
      props: {
        ...baseProps,
        value: 'Fix the bug',
        jiraKey: 'PROJ-42',
      },
    })

    const textarea = screen.getByPlaceholderText('Describe what you want to implement...')
    expect((textarea as HTMLTextAreaElement).value).toBe('Fix the bug')

    const jiraInput = screen.getByPlaceholderText('e.g. PROJ-123')
    expect((jiraInput as HTMLInputElement).value).toBe('PROJ-42')
  })

  describe('dual buttons (onStartTask provided)', () => {
    it('shows Add to Backlog and Start Task buttons', () => {
      render(PromptInput, {
        props: {
          ...baseProps,
          onStartTask: vi.fn(),
        },
      })
      expect(screen.getByText('Add to Backlog', { exact: false })).toBeTruthy()
      expect(screen.getByText('Start Task', { exact: false })).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull()
    })

    it('calls onSubmit when Add to Backlog is clicked', async () => {
      const onSubmit = vi.fn()
      render(PromptInput, {
        props: {
          ...baseProps,
          onSubmit,
          onStartTask: vi.fn(),
        },
      })
      const textarea = screen.getByPlaceholderText('Describe what you want to implement...') as HTMLTextAreaElement
      textarea.value = 'New feature'
      await fireEvent.input(textarea)
      await fireEvent.click(screen.getByText('Add to Backlog', { exact: false }))
      expect(onSubmit).toHaveBeenCalledWith('New feature', null)
    })

    it('calls onStartTask when Start Task is clicked', async () => {
      const onStartTask = vi.fn()
      render(PromptInput, {
        props: {
          ...baseProps,
          onStartTask,
        },
      })
      const textarea = screen.getByPlaceholderText('Describe what you want to implement...') as HTMLTextAreaElement
      textarea.value = 'New feature'
      await fireEvent.input(textarea)
      await fireEvent.click(screen.getByText('Start Task', { exact: false }))
      expect(onStartTask).toHaveBeenCalledWith('New feature', null)
    })

    it('Cmd+Enter calls onStartTask (primary action)', async () => {
      const onSubmit = vi.fn()
      const onStartTask = vi.fn()
      render(PromptInput, {
        props: {
          ...baseProps,
          onSubmit,
          onStartTask,
        },
      })
      const textarea = screen.getByPlaceholderText('Describe what you want to implement...') as HTMLTextAreaElement
      textarea.value = 'New feature'
      await fireEvent.input(textarea)
      await fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })
      expect(onStartTask).toHaveBeenCalledWith('New feature', null)
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('Shift+Enter calls onSubmit (add to backlog)', async () => {
      const onSubmit = vi.fn()
      const onStartTask = vi.fn()
      render(PromptInput, {
        props: {
          ...baseProps,
          onSubmit,
          onStartTask,
        },
      })
      const textarea = screen.getByPlaceholderText('Describe what you want to implement...') as HTMLTextAreaElement
      textarea.value = 'New feature'
      await fireEvent.input(textarea)
      await fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
      expect(onSubmit).toHaveBeenCalledWith('New feature', null)
      expect(onStartTask).not.toHaveBeenCalled()
    })
  })
})
