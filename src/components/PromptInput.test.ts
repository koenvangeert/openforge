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
})
