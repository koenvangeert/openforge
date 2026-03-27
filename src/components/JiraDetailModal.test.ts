import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import JiraDetailModal from './JiraDetailModal.svelte'

describe('JiraDetailModal', () => {
  const mockTask = {
    id: 1,
    project_id: 'PRJ-1',
    status: 'todo',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    jira_key: 'TEST-123',
    jira_title: 'Test Issue',
    jira_description: '<p>Test description</p>'
  }

  it('renders modal with title and content', () => {
    const handleClose = vi.fn()
    render(JiraDetailModal, {
      props: {
        task: mockTask,
        jiraBaseUrl: 'https://jira.example.com',
        onClose: handleClose
      }
    })

    expect(screen.getByText('TEST-123')).toBeTruthy()
    expect(screen.getByText('Test Issue')).toBeTruthy()
    expect(screen.getByText('Test description')).toBeTruthy()
  })

  it('calls onClose when close is triggered', async () => {
    const handleClose = vi.fn()
    render(JiraDetailModal, {
      props: {
        task: mockTask,
        jiraBaseUrl: 'https://jira.example.com',
        onClose: handleClose
      }
    })

    const closeButton = screen.getByRole('button', { name: /✕/i })
    await fireEvent.click(closeButton)
    expect(handleClose).toHaveBeenCalled()
  })
})
