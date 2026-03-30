import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect } from 'vitest'
import ToolCallCard from './ToolCallCard.svelte'
import type { SDKToolCall } from '../../lib/types'

const baseToolCall: SDKToolCall = {
  id: 'tool-1',
  toolName: 'Read',
  input: '{"path": "/foo/bar.ts"}',
  output: '"file contents here"',
  status: 'completed',
  duration: 42,
}

describe('ToolCallCard', () => {
  it('renders tool name and status badge', () => {
    render(ToolCallCard, { props: { toolCall: baseToolCall } })
    expect(screen.getByText('Read')).toBeTruthy()
    expect(screen.getByText('done')).toBeTruthy()
  })

  it('is collapsed by default and expands on click', async () => {
    render(ToolCallCard, { props: { toolCall: baseToolCall } })
    expect(screen.queryByText('Input')).toBeNull()
    const button = screen.getByRole('button')
    await fireEvent.click(button)
    expect(screen.getByText('Input')).toBeTruthy()
  })

  it('shows running status badge', () => {
    const running: SDKToolCall = { ...baseToolCall, status: 'running', output: null, duration: null }
    render(ToolCallCard, { props: { toolCall: running } })
    expect(screen.getByText('running')).toBeTruthy()
  })

  it('shows error status badge', () => {
    const errored: SDKToolCall = { ...baseToolCall, status: 'error' }
    render(ToolCallCard, { props: { toolCall: errored } })
    expect(screen.getByText('error')).toBeTruthy()
  })

  it('shows duration in ms when available', () => {
    render(ToolCallCard, { props: { toolCall: baseToolCall } })
    expect(screen.getByText('42ms')).toBeTruthy()
  })

  it('shows output section after expanding when completed', async () => {
    render(ToolCallCard, { props: { toolCall: baseToolCall } })
    const button = screen.getByRole('button')
    await fireEvent.click(button)
    expect(screen.getByText('Output')).toBeTruthy()
  })

  it('collapses again on second click', async () => {
    render(ToolCallCard, { props: { toolCall: baseToolCall } })
    const button = screen.getByRole('button')
    await fireEvent.click(button)
    expect(screen.getByText('Input')).toBeTruthy()
    await fireEvent.click(button)
    expect(screen.queryByText('Input')).toBeNull()
  })

  it('does not show duration when null', () => {
    const noTime: SDKToolCall = { ...baseToolCall, duration: null }
    render(ToolCallCard, { props: { toolCall: noTime } })
    expect(screen.queryByText(/ms/)).toBeNull()
  })
})
