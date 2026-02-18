import { render, screen } from '@testing-library/svelte'
import { describe, it, expect, beforeEach } from 'vitest'
import CiFailureToast from './CiFailureToast.svelte'
import { ciFailureNotification, selectedTaskId } from '../lib/stores'
import type { CiFailureNotification } from '../lib/types'

const baseNotification: CiFailureNotification = {
  task_id: 'T-1',
  pr_id: 42,
  pr_title: 'Fix login bug',
  ci_status: 'failure',
  timestamp: Date.now(),
}

describe('CiFailureToast', () => {
  beforeEach(() => {
    ciFailureNotification.set(null)
    selectedTaskId.set(null)
  })

  it('renders when ciFailureNotification store has a value', async () => {
    render(CiFailureToast)
    ciFailureNotification.set(baseNotification)

    await new Promise((r) => setTimeout(r, 10))
    expect(screen.getByText(/Fix login bug/)).toBeTruthy()
  })
})
