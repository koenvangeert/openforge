import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, beforeEach } from 'vitest'
import { get } from 'svelte/store'
import Toast from './Toast.svelte'
import { error } from '../../../lib/stores'

describe('Toast', () => {
  beforeEach(() => {
    error.set(null)
  })

  it('is hidden when error store is null', () => {
    render(Toast)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows the error message when error store has a value', async () => {
    render(Toast)
    error.set('Something went wrong')

    await new Promise((r) => setTimeout(r, 10))
    expect(screen.getByText('Something went wrong')).toBeTruthy()
  })

  it('dismisses when close button is clicked', async () => {
    render(Toast)
    error.set('Dismiss me')

    await new Promise((r) => setTimeout(r, 10))
    const closeBtn = screen.getByText('✕')
    await fireEvent.click(closeBtn)

    expect(get(error)).toBeNull()
  })
})
