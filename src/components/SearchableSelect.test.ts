import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import SearchableSelect from './SearchableSelect.svelte'

const options = [
  { value: '', label: 'Default' },
  { value: 'coder', label: 'coder' },
  { value: 'architect', label: 'architect' },
  { value: 'reviewer', label: 'reviewer' },
]

describe('SearchableSelect', () => {
  it('renders trigger showing the selected label', () => {
    render(SearchableSelect, { props: { options, value: 'coder', onSelect: vi.fn() } })
    expect(screen.getByRole('combobox').textContent).toContain('coder')
  })

  it('shows selected label when value matches an option', () => {
    render(SearchableSelect, { props: { options, value: '', placeholder: 'Pick one', onSelect: vi.fn() } })
    expect(screen.getByRole('combobox').textContent).toContain('Default')
  })

  it('opens dropdown and shows search input on click', async () => {
    render(SearchableSelect, { props: { options, value: '', onSelect: vi.fn() } })
    await fireEvent.click(screen.getByRole('combobox'))
    expect(screen.getByPlaceholderText('Search...')).toBeTruthy()
    expect(screen.getByRole('listbox')).toBeTruthy()
  })

  it('filters options by search query', async () => {
    render(SearchableSelect, { props: { options, value: '', onSelect: vi.fn() } })
    await fireEvent.click(screen.getByRole('combobox'))

    const input = screen.getByPlaceholderText('Search...')
    await fireEvent.input(input, { target: { value: 'arch' } })

    const listItems = screen.getAllByRole('option')
    expect(listItems).toHaveLength(1)
    expect(listItems[0].textContent).toContain('architect')
  })

  it('calls onSelect when an option is clicked', async () => {
    const onSelect = vi.fn()
    render(SearchableSelect, { props: { options, value: '', onSelect } })
    await fireEvent.click(screen.getByRole('combobox'))

    await fireEvent.click(screen.getByText('reviewer'))
    expect(onSelect).toHaveBeenCalledWith('reviewer')
  })

  it('selects highlighted option on Enter', async () => {
    const onSelect = vi.fn()
    render(SearchableSelect, { props: { options, value: '', onSelect } })
    await fireEvent.click(screen.getByRole('combobox'))

    const input = screen.getByPlaceholderText('Search...')
    await fireEvent.keyDown(input, { key: 'ArrowDown' })
    await fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSelect).toHaveBeenCalledWith('coder')
  })

  it('closes dropdown on Escape', async () => {
    render(SearchableSelect, { props: { options, value: '', onSelect: vi.fn() } })
    await fireEvent.click(screen.getByRole('combobox'))
    expect(screen.getByRole('listbox')).toBeTruthy()

    await fireEvent.keyDown(screen.getByPlaceholderText('Search...'), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('shows "No matches" when filter yields no results', async () => {
    render(SearchableSelect, { props: { options, value: '', onSelect: vi.fn() } })
    await fireEvent.click(screen.getByRole('combobox'))

    const input = screen.getByPlaceholderText('Search...')
    await fireEvent.input(input, { target: { value: 'zzzzz' } })

    expect(screen.getByText('No matches')).toBeTruthy()
  })
})
