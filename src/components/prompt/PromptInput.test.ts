import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { requireElement } from '../../test-utils/dom'
import PromptInput from './PromptInput.svelte'

// Mock IPC functions
vi.mock('../../lib/ipc', () => ({
  listOpenCodeCommands: vi.fn().mockResolvedValue([]),
  searchOpenCodeFiles: vi.fn().mockResolvedValue([]),
  listOpenCodeAgents: vi.fn().mockResolvedValue([]),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  getProjectConfig: vi.fn().mockResolvedValue('test-board'),
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

    const textarea = requireElement(
      screen.getByPlaceholderText('Describe what you want to implement...'),
      HTMLTextAreaElement,
    )
    textarea.value = 'Fix the bug'
    await fireEvent.input(textarea)
    await fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })

    expect(onSubmit).toHaveBeenCalledWith('Fix the bug')
  })

  it('does not submit on plain Enter (allows newline)', async () => {
    const onSubmit = vi.fn()
    render(PromptInput, {
      props: {
        ...baseProps,
        onSubmit,
      },
    })

    const textarea = requireElement(
      screen.getByPlaceholderText('Describe what you want to implement...'),
      HTMLTextAreaElement,
    )
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

  it('renders a submit button', () => {
    render(PromptInput, { props: { ...baseProps } })
    const button = screen.getByRole('button', { name: 'Submit' })
    expect(button).toBeTruthy()
  })

  it('submit button is disabled when textarea is empty', () => {
    render(PromptInput, { props: { ...baseProps } })
    const button = requireElement(screen.getByRole('button', { name: 'Submit' }), HTMLButtonElement)
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

    const textarea = requireElement(
      screen.getByPlaceholderText('Describe what you want to implement...'),
      HTMLTextAreaElement,
    )
    textarea.value = 'Fix the bug'
    await fireEvent.input(textarea)
    const button = screen.getByRole('button', { name: 'Submit' })
    await fireEvent.click(button)

    expect(onSubmit).toHaveBeenCalledWith('Fix the bug')
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
      },
    })

    const textarea = requireElement(
      screen.getByPlaceholderText('Describe what you want to implement...'),
      HTMLTextAreaElement,
    )
    expect(textarea.value).toBe('Fix the bug')
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
      const textarea = requireElement(
        screen.getByPlaceholderText('Describe what you want to implement...'),
        HTMLTextAreaElement,
      )
      textarea.value = 'New feature'
      await fireEvent.input(textarea)
      await fireEvent.click(screen.getByText('Add to Backlog', { exact: false }))
      expect(onSubmit).toHaveBeenCalledWith('New feature')
    })

    it('calls onStartTask when Start Task is clicked', async () => {
      const onStartTask = vi.fn()
      render(PromptInput, {
        props: {
          ...baseProps,
          onStartTask,
        },
      })
      const textarea = requireElement(
        screen.getByPlaceholderText('Describe what you want to implement...'),
        HTMLTextAreaElement,
      )
      textarea.value = 'New feature'
      await fireEvent.input(textarea)
      await fireEvent.click(screen.getByText('Start Task', { exact: false }))
      expect(onStartTask).toHaveBeenCalledWith('New feature')
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
      const textarea = requireElement(
        screen.getByPlaceholderText('Describe what you want to implement...'),
        HTMLTextAreaElement,
      )
      textarea.value = 'New feature'
      await fireEvent.input(textarea)
      await fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })
      expect(onStartTask).toHaveBeenCalledWith('New feature')
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
      const textarea = requireElement(
        screen.getByPlaceholderText('Describe what you want to implement...'),
        HTMLTextAreaElement,
      )
      textarea.value = 'New feature'
      await fireEvent.input(textarea)
      await fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
      expect(onSubmit).toHaveBeenCalledWith('New feature')
      expect(onStartTask).not.toHaveBeenCalled()
    })
  })

  describe('List Navigation', () => {
    beforeEach(() => {
      Element.prototype.scrollIntoView = vi.fn()
    })

    it('navigates @ autocomplete with Ctrl+J and Enter', async () => {
      const { listOpenCodeAgents } = await import('../../lib/ipc')
      vi.mocked(listOpenCodeAgents).mockResolvedValue([
        { name: 'alpha', hidden: false, mode: 'chat' },
        { name: 'beta', hidden: false, mode: 'chat' },
      ])

      render(PromptInput, { props: { ...baseProps } })
      const textarea = requireElement(
        screen.getByPlaceholderText('Describe what you want to implement...'),
        HTMLTextAreaElement,
      )

      textarea.value = '@'
      textarea.selectionStart = 1
      textarea.selectionEnd = 1
      await fireEvent.input(textarea)

      await waitFor(() => {
        expect(screen.queryAllByRole('option').length).toBeGreaterThan(0)
      })

      await fireEvent.keyDown(textarea, { key: 'j', ctrlKey: true })
      await fireEvent.keyDown(textarea, { key: 'Enter' })

      expect(textarea.value).toBe('@beta')
    })

    it('navigates autocomplete popover with ArrowDown/ArrowUp and Ctrl+J/Ctrl+K', async () => {
      const { listOpenCodeCommands } = await import('../../lib/ipc')
      vi.mocked(listOpenCodeCommands).mockResolvedValue([
        { name: 'cmd1', description: '', source: null, agent: null },
        { name: 'cmd2', description: '', source: null, agent: null },
        { name: 'cmd3', description: '', source: null, agent: null },
      ])
      
      render(PromptInput, { props: { ...baseProps } })
      const textarea = requireElement(
        screen.getByPlaceholderText('Describe what you want to implement...'),
        HTMLTextAreaElement,
      )
      
      textarea.value = '/'
      textarea.selectionStart = 1
      textarea.selectionEnd = 1
      await fireEvent.input(textarea)
      
      await waitFor(() => {
        expect(screen.queryAllByRole('option').length).toBeGreaterThan(0)
      })
      
      await fireEvent.keyDown(textarea, { key: 'ArrowDown' })
      await fireEvent.keyDown(textarea, { key: 'j', ctrlKey: true })
      await fireEvent.keyDown(textarea, { key: 'ArrowUp' })
      await fireEvent.keyDown(textarea, { key: 'k', ctrlKey: true })
      
      await fireEvent.keyDown(textarea, { key: 'Enter' })
      
      expect(textarea.value).toBe('/cmd1 ')
    })
  })
})
