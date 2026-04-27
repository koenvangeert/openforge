import { render, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { requireElement } from '../../../test-utils/dom'
import ResizablePanel from './ResizablePanel.svelte'

function getPanel(container: HTMLElement) {
  return requireElement(container.querySelector('[data-testid="resizable-panel"]'), HTMLElement)
}

function getHandle(container: HTMLElement) {
  return requireElement(container.querySelector('[data-testid="resize-handle"]'), HTMLElement)
}

beforeEach(() => {
  localStorage.clear()
})

describe('ResizablePanel', () => {
  it('renders with default width', () => {
    const { container } = render(ResizablePanel, {
      props: { storageKey: 'test-panel', defaultWidth: 250 },
    })
    const panel = getPanel(container)
    expect(panel).toBeTruthy()
    expect(panel.style.width).toBe('250px')
  })

  it('renders the drag handle', () => {
    const { container } = render(ResizablePanel, {
      props: { storageKey: 'test-panel', defaultWidth: 250 },
    })
    const handle = container.querySelector('[data-testid="resize-handle"]')
    expect(handle).toBeTruthy()
  })

  it('restores width from localStorage', () => {
    localStorage.setItem('resizable-panel:test-panel', '320')
    const { container } = render(ResizablePanel, {
      props: { storageKey: 'test-panel', defaultWidth: 250 },
    })
    const panel = getPanel(container)
    expect(panel.style.width).toBe('320px')
  })

  it('ignores invalid localStorage values', () => {
    localStorage.setItem('resizable-panel:test-panel', 'garbage')
    const { container } = render(ResizablePanel, {
      props: { storageKey: 'test-panel', defaultWidth: 250 },
    })
    const panel = getPanel(container)
    expect(panel.style.width).toBe('250px')
  })

  it('rejects partially numeric localStorage values', () => {
    localStorage.setItem('resizable-panel:test-panel', '320px')
    const { container } = render(ResizablePanel, {
      props: { storageKey: 'test-panel', defaultWidth: 250 },
    })
    const panel = getPanel(container)
    expect(panel.style.width).toBe('250px')
  })

  it('clamps restored width to minWidth', () => {
    localStorage.setItem('resizable-panel:test-panel', '50')
    const { container } = render(ResizablePanel, {
      props: { storageKey: 'test-panel', defaultWidth: 250, minWidth: 150 },
    })
    const panel = getPanel(container)
    expect(panel.style.width).toBe('150px')
  })

  it('clamps restored width to maxWidth', () => {
    localStorage.setItem('resizable-panel:test-panel', '900')
    const { container } = render(ResizablePanel, {
      props: { storageKey: 'test-panel', defaultWidth: 250, maxWidth: 500 },
    })
    const panel = getPanel(container)
    expect(panel.style.width).toBe('500px')
  })

  it('starts dragging on mousedown on the handle', async () => {
    const { container } = render(ResizablePanel, {
      props: { storageKey: 'test-panel', defaultWidth: 250, side: 'left' },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)

    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      left: 0, right: 250, top: 0, bottom: 500,
      width: 250, height: 500, x: 0, y: 0, toJSON: () => {},
    })

    await fireEvent.mouseDown(handle, { clientX: 250 })
    await fireEvent.mouseMove(document, { clientX: 300 })
    expect(panel.style.width).toBe('300px')

    await fireEvent.mouseUp(document)
  })

  it('persists width to localStorage after drag ends', async () => {
    const { container } = render(ResizablePanel, {
      props: { storageKey: 'test-persist', defaultWidth: 250, side: 'left' },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)

    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      left: 0, right: 250, top: 0, bottom: 500,
      width: 250, height: 500, x: 0, y: 0, toJSON: () => {},
    })

    await fireEvent.mouseDown(handle, { clientX: 250 })
    await fireEvent.mouseMove(document, { clientX: 300 })
    await fireEvent.mouseUp(document)

    expect(localStorage.getItem('resizable-panel:test-persist')).toBe('300')
  })

  it('respects minWidth during drag', async () => {
    const { container } = render(ResizablePanel, {
      props: { storageKey: 'test-min', defaultWidth: 250, minWidth: 150, side: 'left' },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)

    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      left: 0, right: 250, top: 0, bottom: 500,
      width: 250, height: 500, x: 0, y: 0, toJSON: () => {},
    })

    await fireEvent.mouseDown(handle, { clientX: 250 })
    await fireEvent.mouseMove(document, { clientX: 50 })
    expect(panel.style.width).toBe('150px')

    await fireEvent.mouseUp(document)
  })

  it('respects maxWidth during drag', async () => {
    const { container } = render(ResizablePanel, {
      props: { storageKey: 'test-max', defaultWidth: 250, maxWidth: 400, side: 'left' },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)

    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      left: 0, right: 250, top: 0, bottom: 500,
      width: 250, height: 500, x: 0, y: 0, toJSON: () => {},
    })

    await fireEvent.mouseDown(handle, { clientX: 250 })
    await fireEvent.mouseMove(document, { clientX: 600 })
    expect(panel.style.width).toBe('400px')

    await fireEvent.mouseUp(document)
  })

  it('handles right-side panel dragging (handle on left edge)', async () => {
    const { container } = render(ResizablePanel, {
      props: { storageKey: 'test-right', defaultWidth: 300, side: 'right' },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)

    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      left: 700, right: 1000, top: 0, bottom: 500,
      width: 300, height: 500, x: 700, y: 0, toJSON: () => {},
    })

    await fireEvent.mouseDown(handle, { clientX: 700 })
    await fireEvent.mouseMove(document, { clientX: 650 })
    expect(panel.style.width).toBe('350px')

    await fireEvent.mouseUp(document)
  })

  it('resets to default width on double-click', async () => {
    localStorage.setItem('resizable-panel:test-reset', '400')
    const { container } = render(ResizablePanel, {
      props: { storageKey: 'test-reset', defaultWidth: 250 },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)
    expect(panel.style.width).toBe('400px')

    await fireEvent.dblClick(handle)
    expect(panel.style.width).toBe('250px')
    expect(localStorage.getItem('resizable-panel:test-reset')).toBeNull()
  })

  it('resizes panel with ArrowRight and ArrowLeft keys on left-side handle', async () => {
    const { container } = render(ResizablePanel, {
      props: { storageKey: 'test-keys-left', defaultWidth: 250, side: 'left' },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)

    await fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(panel.style.width).toBe('260px')

    await fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(panel.style.width).toBe('250px')
  })

  it('resizes panel with ArrowLeft and ArrowRight keys on right-side handle', async () => {
    const { container } = render(ResizablePanel, {
      props: { storageKey: 'test-keys-right', defaultWidth: 250, side: 'right' },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)

    await fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(panel.style.width).toBe('260px')

    await fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(panel.style.width).toBe('250px')
  })

  it('resets to default width on Enter key', async () => {
    localStorage.setItem('resizable-panel:test-key-reset', '400')
    const { container } = render(ResizablePanel, {
      props: { storageKey: 'test-key-reset', defaultWidth: 250 },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)
    expect(panel.style.width).toBe('400px')

    await fireEvent.keyDown(handle, { key: 'Enter' })
    expect(panel.style.width).toBe('250px')
    expect(localStorage.getItem('resizable-panel:test-key-reset')).toBeNull()
  })

  it('resets to default width on Space key', async () => {
    localStorage.setItem('resizable-panel:test-space-reset', '400')
    const { container } = render(ResizablePanel, {
      props: { storageKey: 'test-space-reset', defaultWidth: 250 },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)
    expect(panel.style.width).toBe('400px')

    await fireEvent.keyDown(handle, { key: ' ' })
    expect(panel.style.width).toBe('250px')
    expect(localStorage.getItem('resizable-panel:test-space-reset')).toBeNull()
  })
})
