import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, beforeEach } from 'vitest'
import { get } from 'svelte/store'
import CheckpointToast from './CheckpointToast.svelte'
import { checkpointNotification, selectedTaskId } from '../lib/stores'
import type { CheckpointNotification } from '../lib/types'

const baseNotification: CheckpointNotification = {
  ticketId: 't-1',
  ticketKey: 'PROJ-42',
  sessionId: 'ses-1',
  stage: 'implement',
  message: 'Agent needs approval',
  timestamp: Date.now(),
}

describe('CheckpointToast', () => {
  beforeEach(() => {
    checkpointNotification.set(null)
    selectedTaskId.set(null)
  })

  it('is hidden when checkpointNotification store is null', () => {
    render(CheckpointToast)
    expect(screen.queryByText(/Agent needs input/)).toBeNull()
  })

  it('renders when checkpointNotification store has a value', async () => {
    render(CheckpointToast)
    checkpointNotification.set(baseNotification)

    await new Promise((r) => setTimeout(r, 10))
    expect(screen.getByText(/PROJ-42/)).toBeTruthy()
  })

  it('navigates to ticket on click', async () => {
    render(CheckpointToast)
    checkpointNotification.set(baseNotification)

    await new Promise((r) => setTimeout(r, 10))
    const toast = screen.getByText(/PROJ-42/).closest('[role="button"]') as HTMLElement
    await fireEvent.click(toast)

    expect(get(selectedTaskId)).toBe('t-1')
    expect(get(checkpointNotification)).toBeNull()
  })

  it('dismisses without navigation when close button is clicked', async () => {
    render(CheckpointToast)
    checkpointNotification.set(baseNotification)

    await new Promise((r) => setTimeout(r, 10))
    const closeBtn = screen.getByText('X')
    await fireEvent.click(closeBtn)

    expect(get(checkpointNotification)).toBeNull()
    expect(get(selectedTaskId)).toBeNull()
  })

  it('uses ticketId when ticketKey is null', async () => {
    render(CheckpointToast)
    checkpointNotification.set({ ...baseNotification, ticketKey: null })

    await new Promise((r) => setTimeout(r, 10))
    expect(screen.getByText(/t-1/)).toBeTruthy()
  })
})
