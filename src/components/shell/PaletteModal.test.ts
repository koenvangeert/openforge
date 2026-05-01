import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import PaletteModalTestWrapper from './PaletteModalTestWrapper.svelte'

describe('PaletteModal', () => {
  it('focuses the palette search input when opened', async () => {
    render(PaletteModalTestWrapper, { props: { onClose: vi.fn() } })

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText('Palette search'))
    })
  })

  it('closes through shared modal Escape handling', async () => {
    const onClose = vi.fn()
    render(PaletteModalTestWrapper, { props: { onClose } })

    await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes through shared modal backdrop handling', async () => {
    const onClose = vi.fn()
    render(PaletteModalTestWrapper, { props: { onClose, testId: 'shared-palette-backdrop' } })

    await fireEvent.click(screen.getByTestId('shared-palette-backdrop'))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('lets palette keyboard navigation handle keys before default modal Escape close', async () => {
    const onClose = vi.fn()
    const onKeydown = vi.fn((event: KeyboardEvent) => {
      if (event.key === 'Escape') return true
      return false
    })
    render(PaletteModalTestWrapper, { props: { onClose, onKeydown } })

    await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    expect(onKeydown).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()
  })
})
