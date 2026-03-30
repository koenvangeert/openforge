import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import ContextMenuTest from './ContextMenu.test.svelte'

describe('ContextMenu', () => {
  it('renders children when visible is true', () => {
    render(ContextMenuTest, { props: { visible: true, x: 100, y: 200, onClose: vi.fn() } })
    expect(screen.getByText('Test Item')).toBeTruthy()
  })

  it('does not render when visible is false', () => {
    render(ContextMenuTest, { props: { visible: false, x: 100, y: 200, onClose: vi.fn() } })
    expect(screen.queryByText('Test Item')).toBeNull()
  })

  it('calls onClose when clicking outside', async () => {
    const onClose = vi.fn()
    render(ContextMenuTest, { props: { visible: true, x: 100, y: 200, onClose } })
    await fireEvent.click(window)
    expect(onClose).toHaveBeenCalled()
  })

  it('renders menu item with correct label', () => {
    render(ContextMenuTest, { props: { visible: true, x: 0, y: 0, onClose: vi.fn() } })
    expect(screen.getByText('Test Item')).toBeTruthy()
    expect(screen.getByText('Danger Item')).toBeTruthy()
  })

  it('calls menu item onclick when clicked', async () => {
    const onClose = vi.fn()
    render(ContextMenuTest, { props: { visible: true, x: 0, y: 0, onClose } })
    await fireEvent.click(screen.getByText('Test Item'))
    // The test harness sets a data attribute when clicked
    expect(screen.getByTestId('clicked-item').textContent).toBe('Test Item')
  })
})
