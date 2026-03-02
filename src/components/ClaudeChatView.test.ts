import { render, screen } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import ClaudeChatView from './ClaudeChatView.svelte'
import type { SDKChatMessage, SDKToolApprovalRequest } from '../lib/types'

const baseMessage: SDKChatMessage = {
  id: 'msg-1',
  role: 'assistant',
  content: 'Hello, I will help you with this task.',
  timestamp: Date.now(),
  status: 'complete',
  toolCalls: null,
}

const toolCallMessage: SDKChatMessage = {
  id: 'msg-2',
  role: 'assistant',
  content: 'Let me read the file.',
  timestamp: Date.now(),
  status: 'complete',
  toolCalls: [{
    id: 'tc-1',
    toolName: 'Read',
    input: '{"path": "src/main.ts"}',
    output: 'file contents here',
    status: 'completed',
    duration: 150,
  }],
}

const defaultProps = {
  pendingApprovals: [] as SDKToolApprovalRequest[],
  isStreaming: false,
  onApprove: vi.fn(),
  onDeny: vi.fn(),
}

describe('ClaudeChatView', () => {
  it('renders empty state when messages array is empty', () => {
    render(ClaudeChatView, { props: { ...defaultProps, messages: [] } })
    expect(screen.getByText('No messages yet. Start a session to begin.')).toBeTruthy()
  })

  it('renders assistant message content', () => {
    render(ClaudeChatView, { props: { ...defaultProps, messages: [baseMessage] } })
    expect(screen.getByText('Hello, I will help you with this task.')).toBeTruthy()
  })

  it('renders tool call cards when message has tool calls', () => {
    render(ClaudeChatView, { props: { ...defaultProps, messages: [toolCallMessage] } })
    expect(screen.getByText('Read')).toBeTruthy()
  })

  it('shows streaming indicator when isStreaming is true', () => {
    render(ClaudeChatView, { props: { ...defaultProps, messages: [], isStreaming: true } })
    expect(screen.getByText('Claude is thinking…')).toBeTruthy()
  })

  it('does not render empty state when isStreaming is true with no messages', () => {
    render(ClaudeChatView, { props: { ...defaultProps, messages: [], isStreaming: true } })
    expect(screen.queryByText('No messages yet. Start a session to begin.')).toBeNull()
  })

  it('renders user messages right-aligned', () => {
    const userMessage: SDKChatMessage = {
      ...baseMessage,
      id: 'msg-user',
      role: 'user',
      content: 'What is the bug?',
    }
    render(ClaudeChatView, { props: { ...defaultProps, messages: [userMessage] } })
    expect(screen.getByText('What is the bug?')).toBeTruthy()
  })
})
