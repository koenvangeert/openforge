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

  it('calls onclick when clicked', async () => {
    const onclick = vi.fn()
    render(Card, { props: { onclick, children: createSnippet('Card') } })
    const card = screen.getByRole('button')
    await fireEvent.click(card)
    expect(onclick).toHaveBeenCalledOnce()
  })

})
