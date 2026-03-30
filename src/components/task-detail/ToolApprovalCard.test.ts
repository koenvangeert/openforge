import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import ToolApprovalCard from './ToolApprovalCard.svelte'
import type { SDKToolApprovalRequest } from '../../lib/types'

const baseRequest: SDKToolApprovalRequest = {
  id: 'approval-1',
  toolName: 'Bash',
  toolInput: '{"command": "rm -rf /tmp/test"}',
  description: 'Run a shell command',
  pending: true,
}

describe('ToolApprovalCard', () => {
  it('renders tool name and approval buttons', () => {
    render(ToolApprovalCard, { props: { request: baseRequest, onApprove: vi.fn(), onDeny: vi.fn() } })
    expect(screen.getByText('Bash')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Deny' })).toBeTruthy()
  })

  it('calls onApprove with request id when Approve is clicked', async () => {
    const onApprove = vi.fn()
    render(ToolApprovalCard, { props: { request: baseRequest, onApprove, onDeny: vi.fn() } })
    await fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(onApprove).toHaveBeenCalledWith('approval-1')
  })

  it('shows reason input when Deny is clicked', async () => {
    render(ToolApprovalCard, { props: { request: baseRequest, onApprove: vi.fn(), onDeny: vi.fn() } })
    await fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
    expect(screen.getByPlaceholderText('Reason for denial (optional)')).toBeTruthy()
  })

  it('calls onDeny with id and reason when confirmed', async () => {
    const onDeny = vi.fn()
    render(ToolApprovalCard, { props: { request: baseRequest, onApprove: vi.fn(), onDeny } })
    await fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
    const input = screen.getByPlaceholderText('Reason for denial (optional)')
    await fireEvent.input(input, { target: { value: 'Too dangerous' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm Deny' }))
    expect(onDeny).toHaveBeenCalledWith('approval-1', 'Too dangerous')
  })

  it('shows description when available', () => {
    render(ToolApprovalCard, { props: { request: baseRequest, onApprove: vi.fn(), onDeny: vi.fn() } })
    expect(screen.getByText('Run a shell command')).toBeTruthy()
  })

  it('does not show description when null', () => {
    const noDesc: SDKToolApprovalRequest = { ...baseRequest, description: null }
    render(ToolApprovalCard, { props: { request: noDesc, onApprove: vi.fn(), onDeny: vi.fn() } })
    expect(screen.queryByText('Run a shell command')).toBeNull()
  })

  it('hides approve/deny buttons and shows reason input after Deny click', async () => {
    render(ToolApprovalCard, { props: { request: baseRequest, onApprove: vi.fn(), onDeny: vi.fn() } })
    await fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Deny' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Confirm Deny' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
  })

  it('returns to approve/deny state after Cancel', async () => {
    render(ToolApprovalCard, { props: { request: baseRequest, onApprove: vi.fn(), onDeny: vi.fn() } })
    await fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Deny' })).toBeTruthy()
  })
})
