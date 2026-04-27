import { render, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { requireElement } from '../../../test-utils/dom'
import ResizableBottomPanel from './ResizableBottomPanel.svelte'

function getPanel(container: HTMLElement) {
  return requireElement(container.querySelector('[data-testid="resizable-bottom-panel"]'), HTMLElement)
}

function getHandle(container: HTMLElement) {
  return requireElement(container.querySelector('[data-testid="resize-handle"]'), HTMLElement)
}

beforeEach(() => {
  localStorage.clear()
})

describe('ResizableBottomPanel', () => {
  it('renders with default height', () => {
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-panel', defaultHeight: 250, minHeight: null, maxHeight: null, fillParent: false },
    })
    const panel = getPanel(container)
    expect(panel).toBeTruthy()
    expect(panel.style.height).toBe('250px')
  })

  it('renders the drag handle', () => {
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-panel', defaultHeight: 250, minHeight: null, maxHeight: null, fillParent: false },
    })
    const handle = container.querySelector('[data-testid="resize-handle"]')
    expect(handle).toBeTruthy()
  })

  it('restores height from localStorage', () => {
    localStorage.setItem('resizable-panel:test-panel', '320')
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-panel', defaultHeight: 250, minHeight: null, maxHeight: null, fillParent: false },
    })
    const panel = getPanel(container)
    expect(panel.style.height).toBe('320px')
  })

  it('ignores invalid localStorage values', () => {
    localStorage.setItem('resizable-panel:test-panel', 'garbage')
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-panel', defaultHeight: 250, minHeight: null, maxHeight: null, fillParent: false },
    })
    const panel = getPanel(container)
    expect(panel.style.height).toBe('250px')
  })

  it('rejects partially numeric localStorage values', () => {
    localStorage.setItem('resizable-panel:test-panel', '320px')
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-panel', defaultHeight: 250, minHeight: null, maxHeight: null, fillParent: false },
    })
    const panel = getPanel(container)
    expect(panel.style.height).toBe('250px')
  })

  it('clamps restored height to minHeight', () => {
    localStorage.setItem('resizable-panel:test-panel', '50')
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-panel', defaultHeight: 250, minHeight: 150, maxHeight: null, fillParent: false },
    })
    const panel = getPanel(container)
    expect(panel.style.height).toBe('150px')
  })

  it('clamps restored height to maxHeight', () => {
    localStorage.setItem('resizable-panel:test-panel', '900')
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-panel', defaultHeight: 250, minHeight: null, maxHeight: 500, fillParent: false },
    })
    const panel = getPanel(container)
    expect(panel.style.height).toBe('500px')
  })

  it('increases height when dragging handle up (negative Y delta)', async () => {
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-panel', defaultHeight: 250, minHeight: null, maxHeight: null, fillParent: false },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)

    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      left: 0, right: 1000, top: 250, bottom: 500,
      width: 1000, height: 250, x: 0, y: 250, toJSON: () => {},
    })

    await fireEvent.mouseDown(handle, { clientY: 250 })
    await fireEvent.mouseMove(document, { clientY: 200 })
    expect(panel.style.height).toBe('300px')

    await fireEvent.mouseUp(document)
  })

  it('decreases height when dragging handle down (positive Y delta)', async () => {
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-panel', defaultHeight: 250, minHeight: null, maxHeight: null, fillParent: false },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)

    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      left: 0, right: 1000, top: 250, bottom: 500,
      width: 1000, height: 250, x: 0, y: 250, toJSON: () => {},
    })

    await fireEvent.mouseDown(handle, { clientY: 250 })
    await fireEvent.mouseMove(document, { clientY: 300 })
    expect(panel.style.height).toBe('200px')

    await fireEvent.mouseUp(document)
  })

  it('persists height to localStorage after drag ends', async () => {
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-persist', defaultHeight: 250, minHeight: null, maxHeight: null, fillParent: false },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)

    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      left: 0, right: 1000, top: 250, bottom: 500,
      width: 1000, height: 250, x: 0, y: 250, toJSON: () => {},
    })

    await fireEvent.mouseDown(handle, { clientY: 250 })
    await fireEvent.mouseMove(document, { clientY: 300 })
    await fireEvent.mouseUp(document)

    expect(localStorage.getItem('resizable-panel:test-persist')).toBe('200')
  })

  it('respects minHeight during drag', async () => {
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-min', defaultHeight: 250, minHeight: 150, maxHeight: null, fillParent: false },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)

    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      left: 0, right: 1000, top: 250, bottom: 500,
      width: 1000, height: 250, x: 0, y: 250, toJSON: () => {},
    })

    await fireEvent.mouseDown(handle, { clientY: 250 })
    await fireEvent.mouseMove(document, { clientY: 50 })
    expect(panel.style.height).toBe('450px')

    await fireEvent.mouseUp(document)
  })

  it('respects maxHeight during drag', async () => {
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-max', defaultHeight: 250, minHeight: null, maxHeight: 400, fillParent: false },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)

    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      left: 0, right: 1000, top: 250, bottom: 500,
      width: 1000, height: 250, x: 0, y: 250, toJSON: () => {},
    })

    await fireEvent.mouseDown(handle, { clientY: 250 })
    await fireEvent.mouseMove(document, { clientY: 600 })
    expect(panel.style.height).toBe('100px')

    await fireEvent.mouseUp(document)
  })

  it('resets to default height on double-click', async () => {
    localStorage.setItem('resizable-panel:test-reset', '400')
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-reset', defaultHeight: 250, minHeight: null, maxHeight: null, fillParent: false },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)
    expect(panel.style.height).toBe('400px')

    await fireEvent.dblClick(handle)
    expect(panel.style.height).toBe('250px')
    expect(localStorage.getItem('resizable-panel:test-reset')).toBeNull()
  })

  it('increases height with ArrowUp key', async () => {
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-keys-up', defaultHeight: 250, minHeight: null, maxHeight: null, fillParent: false },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)

    await fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(panel.style.height).toBe('260px')
  })

  it('decreases height with ArrowDown key', async () => {
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-keys-down', defaultHeight: 250, minHeight: null, maxHeight: null, fillParent: false },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)

    await fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(panel.style.height).toBe('240px')
  })

  it('resets to default height on Enter key', async () => {
    localStorage.setItem('resizable-panel:test-key-reset', '400')
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-key-reset', defaultHeight: 250, minHeight: null, maxHeight: null, fillParent: false },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)
    expect(panel.style.height).toBe('400px')

    await fireEvent.keyDown(handle, { key: 'Enter' })
    expect(panel.style.height).toBe('250px')
    expect(localStorage.getItem('resizable-panel:test-key-reset')).toBeNull()
  })

  it('resets to default height on Space key', async () => {
    localStorage.setItem('resizable-panel:test-space-reset', '400')
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-space-reset', defaultHeight: 250, minHeight: null, maxHeight: null, fillParent: false },
    })
    const handle = getHandle(container)
    const panel = getPanel(container)
    expect(panel.style.height).toBe('400px')

    await fireEvent.keyDown(handle, { key: ' ' })
    expect(panel.style.height).toBe('250px')
    expect(localStorage.getItem('resizable-panel:test-space-reset')).toBeNull()
  })

  it('uses default minHeight of 100 when not specified', () => {
    localStorage.setItem('resizable-panel:test-default-min', '50')
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-default-min', defaultHeight: 250, minHeight: null, maxHeight: null, fillParent: false },
    })
    const panel = getPanel(container)
    expect(panel.style.height).toBe('100px')
  })

  it('uses default maxHeight of 70% window height when not specified', () => {
    const windowHeight = window.innerHeight
    const expectedMax = Math.floor(windowHeight * 0.7)
    localStorage.setItem('resizable-panel:test-default-max', String(expectedMax + 100))
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-default-max', defaultHeight: 250, minHeight: null, maxHeight: null, fillParent: false },
    })
    const panel = getPanel(container)
    expect(panel.style.height).toBe(String(expectedMax) + 'px')
  })

  it('hides drag handle when fillParent is true', () => {
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-fillparent', defaultHeight: 250, minHeight: null, maxHeight: null, fillParent: true },
    })
    const handle = container.querySelector('[data-testid="resize-handle"]')
    expect(handle).toBeNull()
  })

  it('uses flex-1 class when fillParent is true', () => {
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-fillparent-flex', defaultHeight: 250, minHeight: null, maxHeight: null, fillParent: true },
    })
    const panel = getPanel(container)
    expect(panel.classList.contains('flex-1')).toBe(true)
    expect(panel.classList.contains('shrink-0')).toBe(false)
  })

  it('uses shrink-0 class when fillParent is false', () => {
    const { container } = render(ResizableBottomPanel, {
      props: { storageKey: 'test-fillparent-shrink', defaultHeight: 250, minHeight: null, maxHeight: null, fillParent: false },
    })
    const panel = getPanel(container)
    expect(panel.classList.contains('shrink-0')).toBe(true)
    expect(panel.classList.contains('flex-1')).toBe(false)
  })
})
