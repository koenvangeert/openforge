import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import { createRawSnippet } from 'svelte'
import Card from './Card.svelte'

function createSnippet(text: string) {
  return createRawSnippet(() => ({
    render: () => `<span>${text}</span>`,
  }))
}

describe('Card', () => {
  it('renders children content', () => {
    render(Card, { props: { children: createSnippet('Hello Card') } })
    expect(screen.getByText('Hello Card')).toBeTruthy()
  })

  it('renders as a button element', () => {
    render(Card, { props: { children: createSnippet('Card') } })
    expect(screen.getByRole('button')).toBeTruthy()
  })

  it('applies bg-base-100 for consistent white background', () => {
    render(Card, { props: { children: createSnippet('Card') } })
    const card = screen.getByRole('button')
    expect(card.className).toContain('bg-base-100')
  })

  it('applies border and rounded-lg by default', () => {
    render(Card, { props: { children: createSnippet('Card') } })
    const card = screen.getByRole('button')
    expect(card.className).toContain('border')
    expect(card.className).toContain('rounded-lg')
  })

  it('applies default border-base-300 when not selected', () => {
    render(Card, { props: { children: createSnippet('Card') } })
    const card = screen.getByRole('button')
    expect(card.className).toContain('border-base-300')
  })

  it('calls onclick when clicked', async () => {
    const onclick = vi.fn()
    render(Card, { props: { onclick, children: createSnippet('Card') } })
    const card = screen.getByRole('button')
    await fireEvent.click(card)
    expect(onclick).toHaveBeenCalledOnce()
  })

  it('applies selected class when selected is true', () => {
    render(Card, { props: { selected: true, children: createSnippet('Card') } })
    const card = screen.getByRole('button')
    expect(card.classList.contains('selected')).toBe(true)
  })

  it('does not apply selected class when selected is false', () => {
    render(Card, { props: { selected: false, children: createSnippet('Card') } })
    const card = screen.getByRole('button')
    expect(card.classList.contains('selected')).toBe(false)
  })

  it('applies border-primary when selected', () => {
    render(Card, { props: { selected: true, children: createSnippet('Card') } })
    const card = screen.getByRole('button')
    expect(card.className).toContain('border-primary')
  })

  it('applies additional classes from class prop', () => {
    render(Card, { props: { class: 'custom-extra p-4', children: createSnippet('Card') } })
    const card = screen.getByRole('button')
    expect(card.className).toContain('custom-extra')
    expect(card.className).toContain('p-4')
  })
})
