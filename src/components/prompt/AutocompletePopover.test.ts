import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AutocompletePopover from './AutocompletePopover.svelte'
import type { AutocompleteItem } from '../../lib/types'

const sampleItems: AutocompleteItem[] = [
  { label: 'main.ts', description: null, type: 'file' },
  { label: 'src/', description: null, type: 'directory' },
  { label: 'playwright', description: 'Browser automation', type: 'skill', source: 'skill' },
  { label: 'oracle', description: null, type: 'agent' },
]

// Mock scrollIntoView for jsdom
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

describe('AutocompletePopover', () => {
  it('renders nothing when not visible', () => {
    render(AutocompletePopover, {
      props: { items: sampleItems, visible: false, selectedIndex: 0, onSelect: vi.fn(), onClose: vi.fn() }
    })
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('renders items when visible', () => {
    render(AutocompletePopover, {
      props: { items: sampleItems, visible: true, selectedIndex: 0, onSelect: vi.fn(), onClose: vi.fn() }
    })
    expect(screen.getByRole('listbox')).toBeTruthy()
    expect(screen.getAllByRole('option')).toHaveLength(4)
  })

  it('shows item labels', () => {
    render(AutocompletePopover, {
      props: { items: sampleItems, visible: true, selectedIndex: 0, onSelect: vi.fn(), onClose: vi.fn() }
    })
    expect(screen.getByText('main.ts')).toBeTruthy()
    expect(screen.getByText('src/')).toBeTruthy()
    expect(screen.getByText('playwright')).toBeTruthy()
    expect(screen.getByText('oracle')).toBeTruthy()
  })

  it('shows description when present', () => {
    render(AutocompletePopover, {
      props: { items: sampleItems, visible: true, selectedIndex: 0, onSelect: vi.fn(), onClose: vi.fn() }
    })
    expect(screen.getByText('Browser automation')).toBeTruthy()
  })

  it('calls onSelect when item is clicked', async () => {
    const onSelect = vi.fn()
    render(AutocompletePopover, {
      props: { items: sampleItems, visible: true, selectedIndex: 0, onSelect, onClose: vi.fn() }
    })
    const options = screen.getAllByRole('option')
    await fireEvent.click(options[2])
    expect(onSelect).toHaveBeenCalledWith(sampleItems[2])
  })

  it('renders empty when items array is empty', () => {
    render(AutocompletePopover, {
      props: { items: [], visible: true, selectedIndex: 0, onSelect: vi.fn(), onClose: vi.fn() }
    })
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('highlights selected item', () => {
    render(AutocompletePopover, {
      props: { items: sampleItems, visible: true, selectedIndex: 2, onSelect: vi.fn(), onClose: vi.fn() }
    })
    const options = screen.getAllByRole('option')
    expect(options[2].getAttribute('aria-selected')).toBe('true')
    expect(options[0].getAttribute('aria-selected')).toBe('false')
  })

  it('calls onClose when Escape key is pressed', async () => {
    const onClose = vi.fn()
    render(AutocompletePopover, {
      props: { items: sampleItems, visible: true, selectedIndex: 0, onSelect: vi.fn(), onClose }
    })
    const listbox = screen.getByRole('listbox')
    await fireEvent.keyDown(listbox, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
