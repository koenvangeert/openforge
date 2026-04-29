import { render, screen, fireEvent } from '@testing-library/svelte'
import { tick } from 'svelte'
import { describe, it, expect, vi } from 'vitest'
import ModalTestWrapper from './ModalTestWrapper.svelte'

describe('Modal', () => {
  it('focuses the dialog by default when opened', async () => {
    render(ModalTestWrapper, { props: { onClose: vi.fn() } })

    await tick()

    expect(document.activeElement).toBe(screen.getByRole('dialog'))
  })

  it('focuses the requested element returned by initialFocus', async () => {
    render(ModalTestWrapper, { props: { onClose: vi.fn(), initialFocusTarget: 'primary-button' } })

    await tick()

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Primary action' }))
  })

  it('focuses the requested selector target when initialFocus is a selector', async () => {
    render(ModalTestWrapper, { props: { onClose: vi.fn(), initialFocusTarget: 'input-selector' } })

    await tick()

    expect(document.activeElement).toBe(screen.getByLabelText('Modal input'))
  })

  it('falls back to dialog focus when initialFocus does not resolve a target', async () => {
    render(ModalTestWrapper, { props: { onClose: vi.fn(), initialFocusTarget: 'missing-selector' } })

    await tick()

    expect(document.activeElement).toBe(screen.getByRole('dialog'))
  })

  it('calls onClose when Escape is pressed', async () => {
    const onClose = vi.fn()
    render(ModalTestWrapper, { props: { onClose } })

    const dialog = screen.getByRole('dialog')
    await fireEvent.keyDown(dialog, { key: 'Escape' })

    expect(onClose).toHaveBeenCalled()
  })

  it('stops propagation of Escape key events', async () => {
    const onClose = vi.fn()
    render(ModalTestWrapper, { props: { onClose } })

    const dialog = screen.getByRole('dialog')
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    const stopSpy = vi.spyOn(event, 'stopPropagation')

    dialog.dispatchEvent(event)

    expect(stopSpy).toHaveBeenCalled()
  })

  it('stops propagation of Enter key events so they do not reach parent handlers', async () => {
    render(ModalTestWrapper, { props: { onClose: vi.fn() } })

    const dialog = screen.getByRole('dialog')
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    const stopSpy = vi.spyOn(event, 'stopPropagation')

    dialog.dispatchEvent(event)

    expect(stopSpy).toHaveBeenCalled()
  })

  it('stops propagation of letter key events so vim navigation does not fire', async () => {
    render(ModalTestWrapper, { props: { onClose: vi.fn() } })

    const dialog = screen.getByRole('dialog')

    for (const key of ['j', 'k', 'g', 'G', 'x', 'h', 'l', 'q']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true })
      const stopSpy = vi.spyOn(event, 'stopPropagation')

      dialog.dispatchEvent(event)

      expect(stopSpy).toHaveBeenCalled()
    }
  })

  it('stops propagation of ArrowDown/ArrowUp key events', async () => {
    render(ModalTestWrapper, { props: { onClose: vi.fn() } })

    const dialog = screen.getByRole('dialog')

    for (const key of ['ArrowDown', 'ArrowUp']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true })
      const stopSpy = vi.spyOn(event, 'stopPropagation')

      dialog.dispatchEvent(event)

      expect(stopSpy).toHaveBeenCalled()
    }
  })

  it('does not stop propagation of modifier key combos (Cmd+T etc.)', async () => {
    render(ModalTestWrapper, { props: { onClose: vi.fn() } })

    const dialog = screen.getByRole('dialog')

    const metaEvent = new KeyboardEvent('keydown', { key: 't', metaKey: true, bubbles: true })
    const metaSpy = vi.spyOn(metaEvent, 'stopPropagation')
    dialog.dispatchEvent(metaEvent)
    expect(metaSpy).not.toHaveBeenCalled()

    const ctrlEvent = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true })
    const ctrlSpy = vi.spyOn(ctrlEvent, 'stopPropagation')
    dialog.dispatchEvent(ctrlEvent)
    expect(ctrlSpy).not.toHaveBeenCalled()
  })
})
