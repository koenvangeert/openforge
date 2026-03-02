import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import ChatInput from './ChatInput.svelte'

describe('ChatInput', () => {
  it('renders textarea and send button', () => {
    render(ChatInput, { props: { onSend: vi.fn() } })
    const textarea = screen.getByRole('textbox')
    const button = screen.getByRole('button', { name: 'Send' })
    expect(textarea).toBeTruthy()
    expect(button).toBeTruthy()
  })

  it('calls onSend with text on Enter key', async () => {
    const onSend = vi.fn()
    render(ChatInput, { props: { onSend } })
    const textarea = screen.getByRole('textbox')
    await fireEvent.input(textarea, { target: { value: 'Hello Claude' } })
    await fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })
    expect(onSend).toHaveBeenCalledWith('Hello Claude')
  })

  it('clears input after successful send', async () => {
    const onSend = vi.fn()
    render(ChatInput, { props: { onSend } })
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    await fireEvent.input(textarea, { target: { value: 'Hello Claude' } })
    await fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })
    expect(textarea.value).toBe('')
  })

  it('does not send empty or whitespace-only text', async () => {
    const onSend = vi.fn()
    render(ChatInput, { props: { onSend } })
    const textarea = screen.getByRole('textbox')
    // Empty text
    await fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })
    expect(onSend).not.toHaveBeenCalled()
    // Whitespace only
    await fireEvent.input(textarea, { target: { value: '   ' } })
    await fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('disabled state prevents interaction', () => {
    const onSend = vi.fn()
    render(ChatInput, { props: { onSend, disabled: true } })
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    const button = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement
    expect(textarea.disabled).toBe(true)
    expect(button.disabled).toBe(true)
  })

  it('Shift+Enter does not send message', async () => {
    const onSend = vi.fn()
    render(ChatInput, { props: { onSend } })
    const textarea = screen.getByRole('textbox')
    await fireEvent.input(textarea, { target: { value: 'Hello Claude' } })
    await fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
    expect(onSend).not.toHaveBeenCalled()
  })
})
