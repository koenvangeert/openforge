import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect } from 'vitest'
import AuthoredPrCard from './AuthoredPrCard.svelte'
import type { AuthoredPullRequest } from '../lib/types'

const basePr: AuthoredPullRequest = {
  id: 12345,
  number: 42,
  title: 'Fix authentication middleware',
  body: 'This PR fixes the auth middleware',
  state: 'open',
  draft: false,
  html_url: 'https://github.com/acme/repo/pull/42',
  user_login: 'alice',
  user_avatar_url: null,
  repo_owner: 'acme',
  repo_name: 'repo',
  head_ref: 'fix/auth',
  base_ref: 'main',
  head_sha: 'abc123',
  additions: 50,
  deletions: 10,
  changed_files: 3,
  ci_status: null,
  ci_check_runs: null,
  review_status: null,
  merged_at: null,
  task_id: null,
  created_at: Math.floor(Date.now() / 1000) - 3600,
  updated_at: Math.floor(Date.now() / 1000),
}

describe('AuthoredPrCard', () => {
  it('renders PR title', () => {
    render(AuthoredPrCard, { props: { pr: basePr, selected: false, onClick: () => {} } })
    expect(screen.getByText('Fix authentication middleware')).toBeTruthy()
  })

  it('renders PR number with # prefix', () => {
    render(AuthoredPrCard, { props: { pr: basePr, selected: false, onClick: () => {} } })
    expect(screen.getByText('#42')).toBeTruthy()
  })

  it('renders repo badge', () => {
    render(AuthoredPrCard, { props: { pr: basePr, selected: false, onClick: () => {} } })
    expect(screen.getByText('acme/repo')).toBeTruthy()
  })

  it('renders branch name', () => {
    render(AuthoredPrCard, { props: { pr: basePr, selected: false, onClick: () => {} } })
    expect(screen.getByText('fix/auth')).toBeTruthy()
  })

  it('shows draft badge when draft is true', () => {
    const draftPr = { ...basePr, draft: true }
    render(AuthoredPrCard, { props: { pr: draftPr, selected: false, onClick: () => {} } })
    expect(screen.getByText('Draft')).toBeTruthy()
  })

  it('hides draft badge when draft is false', () => {
    render(AuthoredPrCard, { props: { pr: basePr, selected: false, onClick: () => {} } })
    expect(screen.queryByText('Draft')).toBeNull()
  })

  it('shows task link when task_id is present', () => {
    const prWithTask = { ...basePr, task_id: 'T-123' }
    render(AuthoredPrCard, { props: { pr: prWithTask, selected: false, onClick: () => {} } })
    expect(screen.getByText('T-123')).toBeTruthy()
  })

  it('hides task link when task_id is null', () => {
    render(AuthoredPrCard, { props: { pr: basePr, selected: false, onClick: () => {} } })
    expect(screen.queryByText('T-123')).toBeNull()
  })

  it('shows CI Passed badge when ci_status is success', () => {
    const prWithCi = { ...basePr, ci_status: 'success' }
    render(AuthoredPrCard, { props: { pr: prWithCi, selected: false, onClick: () => {} } })
    expect(screen.getByText('CI Passed')).toBeTruthy()
  })

  it('shows CI Failed badge when ci_status is failure', () => {
    const prWithCi = { ...basePr, ci_status: 'failure' }
    render(AuthoredPrCard, { props: { pr: prWithCi, selected: false, onClick: () => {} } })
    expect(screen.getByText('CI Failed')).toBeTruthy()
  })

  it('shows CI Pending badge when ci_status is pending', () => {
    const prWithCi = { ...basePr, ci_status: 'pending' }
    render(AuthoredPrCard, { props: { pr: prWithCi, selected: false, onClick: () => {} } })
    expect(screen.getByText('CI Pending')).toBeTruthy()
  })

  it('shows Approved badge when review_status is approved', () => {
    const prWithReview = { ...basePr, review_status: 'approved' }
    render(AuthoredPrCard, { props: { pr: prWithReview, selected: false, onClick: () => {} } })
    expect(screen.getByText('Approved')).toBeTruthy()
  })

  it('shows Changes Req. badge when review_status is changes_requested', () => {
    const prWithReview = { ...basePr, review_status: 'changes_requested' }
    render(AuthoredPrCard, { props: { pr: prWithReview, selected: false, onClick: () => {} } })
    expect(screen.getByText('Changes Req.')).toBeTruthy()
  })

  it('shows Pending Review badge when review_status is pending', () => {
    const prWithReview = { ...basePr, review_status: 'pending' }
    render(AuthoredPrCard, { props: { pr: prWithReview, selected: false, onClick: () => {} } })
    expect(screen.getByText('Pending Review')).toBeTruthy()
  })

  it('shows additions and deletions', () => {
    render(AuthoredPrCard, { props: { pr: basePr, selected: false, onClick: () => {} } })
    expect(screen.getByText('+50')).toBeTruthy()
    expect(screen.getByText('−10')).toBeTruthy()
  })

  it('shows file count', () => {
    render(AuthoredPrCard, { props: { pr: basePr, selected: false, onClick: () => {} } })
    expect(screen.getByText('3 files')).toBeTruthy()
  })

  it('calls onClick when clicked', async () => {
    let clicked = false
    const onClick = () => { clicked = true }
    render(AuthoredPrCard, { props: { pr: basePr, selected: false, onClick } })
    const card = screen.getByRole('button')
    await fireEvent.click(card)
    expect(clicked).toBe(true)
  })
})
