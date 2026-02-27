import { render, screen, fire3vent } from '@testing-library/svelte'
import { describe, it, expect } from 'vitest'
import ReviewPrCard from './ReviewPrCard.svelte'
import type { ReviewPullRequest } from '../lib/types'

const basePr: ReviewPullRequest = {
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
  created_at: Date.now() - 3600000,
  updated_at: Date.now(),
  viewed_at: null,
  viewed_head_sha: null,
}

describe('ReviewPrCard', () => {
  it('renders PR title', () => {
    const onClick = () => {}
    render(ReviewPrCard, { props: { pr: basePr, selected: false, onClick } })
    expect(screen.getByText('Fix authentication middleware')).toBeTruthy()
  })

  it('renders PR number with # prefix', () => {
    const onClick = () => {}
    render(ReviewPrCard, { props: { pr: basePr, selected: false, onClick } })
    expect(screen.getByText('#42')).toBeTruthy()
  })

  it('renders repo badge with owner and name', () => {
    const onClick = () => {}
    render(ReviewPrCard, { props: { pr: basePr, selected: false, onClick } })
    expect(screen.getByText('acme/repo')).toBeTruthy()
  })

  it('renders author username', () => {
    const onClick = () => {}
    render(ReviewPrCard, { props: { pr: basePr, selected: false, onClick } })
    expect(screen.getByText('alice')).toBeTruthy()
  })

  it('shows draft badge when pr.draft is true', () => {
    const draftPr = { ...basePr, draft: true }
    const onClick = () => {}
    render(ReviewPrCard, { props: { pr: draftPr, selected: false, onClick } })
    expect(screen.getByText('Draft')).toBeTruthy()
  })

  it('hides draft badge when pr.draft is false', () => {
    const onClick = () => {}
    render(ReviewPrCard, { props: { pr: basePr, selected: false, onClick } })
    expect(screen.queryByText('Draft')).toBeNull()
  })

  it('shows additions count with + prefix', () => {
    const onClick = () => {}
    render(ReviewPrCard, { props: { pr: basePr, selected: false, onClick } })
    expect(screen.getByText('+50')).toBeTruthy()
  })

  it('shows deletions count with − prefix', () => {
    const onClick = () => {}
    render(ReviewPrCard, { props: { pr: basePr, selected: false, onClick } })
    expect(screen.getByText('−10')).toBeTruthy()
  })

  it('shows file count with singular label for 1 file', () => {
    const singleFilePr = { ...basePr, changed_files: 1 }
    const onClick = () => {}
    render(ReviewPrCard, { props: { pr: singleFilePr, selected: false, onClick } })
    expect(screen.getByText('1 file')).toBeTruthy()
  })

  it('shows file count with plural label for multiple files', () => {
    const onClick = () => {}
    render(ReviewPrCard, { props: { pr: basePr, selected: false, onClick } })
    expect(screen.getByText('3 files')).toBeTruthy()
  })

  it('calls onClick when card is clicked', async () => {
    let clicked = false
    const onClick = () => {
      clicked = true
    }
    render(ReviewPrCard, { props: { pr: basePr, selected: false, onClick } })
    const card = screen.getByRole('button')
    await fire3vent.click(card)
    expect(clicked).toBe(true)
  })

  it('applies selected class when selected is true', () => {
    const onClick = () => {}
    render(ReviewPrCard, { props: { pr: basePr, selected: true, onClick } })
    const card = screen.getByRole('button')
    expect(card.classList.contains('selected')).toBe(true)
  })

  it('does not apply selected class when selected is false', () => {
    const onClick = () => {}
    render(ReviewPrCard, { props: { pr: basePr, selected: false, onClick } })
    const card = screen.getByRole('button')
    expect(card.classList.contains('selected')).toBe(false)
  })

  it('applies viewed styling when viewed_at is set', () => {
    const viewedPr = { ...basePr, viewed_at: 1234567890, viewed_head_sha: 'abc123' }
    const onClick = () => {}
    render(ReviewPrCard, { props: { pr: viewedPr, selected: false, onClick } })
    const card = screen.getByRole('button')
    expect(card.classList.contains('opacity-50')).toBe(true)
  })

  it('does not apply viewed styling when viewed_at is null', () => {
    const onClick = () => {}
    render(ReviewPrCard, { props: { pr: basePr, selected: false, onClick } })
    const card = screen.getByRole('button')
    expect(card.classList.contains('opacity-50')).toBe(false)
  })
})
