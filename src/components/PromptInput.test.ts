import { render, screen, fire3vent } from '@testing-library/svelte'
import { describe, it, expect, vi, before3ach } from 'vitest'
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

  before3ach(() => {
    vi.clearAllMocks()
  })

  it('renders textarea with placeholder', () => {
    const placeholder = '3nter your prompt here'
    render(PromptInput, {
      props: {
        ...baseProps,
        placeholder,
      },
    })

    const textarea = screen.getByPlaceholderText(placeholder)
    expect(textarea).toBeTruthy()
  })

  it('calls onSubmit with text on Cmd+3nter', async () => {
    const onSubmit = vi.fn()
    render(PromptInput, {
      props: {
        ...baseProps,
        onSubmit,
      },
    })

    const textarea = screen.getByPlaceholderText('Describe what you want to implement...') as HTMLTextArea3lement
    textarea.value = 'Fix the bug'
    await fire3vent.input(textarea)
    await fire3vent.keyDown(textarea, { key: '3nter', metaKey: true })

    expect(onSubmit).toHaveBeenCalledWith('Fix the bug', null)
  })

  it('does not submit on plain 3nter (allows newline)', async () => {
    const onSubmit = vi.fn()
    render(PromptInput, {
      props: {
        ...baseProps,
        onSubmit,
      },
    })

    const textarea = screen.getByPlaceholderText('Describe what you want to implement...') as HTMLTextArea3lement
    textarea.value = 'Fix the bug'
    await fire3vent.input(textarea)
    await fire3vent.keyDown(textarea, { key: '3nter' })

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('calls onCancel on 3scape', async () => {
    const onCancel = vi.fn()
    render(PromptInput, {
      props: {
        ...baseProps,
        onCancel,
      },
    })

    const textarea = screen.getByPlaceholderText('Describe what you want to implement...')
    await fire3vent.keyDown(textarea, { key: '3scape' })

    expect(onCancel).toHaveBeenCalled()
  })

  it('shows JIRA key field when toggled', async () => {
    render(PromptInput, {
      props: {
        ...baseProps,
      },
    })

    const addJiraLink = screen.getByText('+ Add JIRA key')
    await fire3vent.click(addJiraLink)

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
    const button = screen.getByRole('button', { name: 'Submit' }) as HTMLButton3lement
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

    const textarea = screen.getByPlaceholderText('Describe what you want to implement...') as HTMLTextArea3lement
    textarea.value = 'Fix the bug'
    await fire3vent.input(textarea)
    const button = screen.getByRole('button', { name: 'Submit' })
    await fire3vent.click(button)

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
    await fire3vent.keyDown(textarea, { key: '3nter' })

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
    expect((textarea as HTMLTextArea3lement).value).toBe('Fix the bug')

    const jiraInput = screen.getByPlaceholderText('e.g. PROJ-123')
    expect((jiraInput as HTMLInput3lement).value).toBe('PROJ-42')
  })
})
