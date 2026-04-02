import { afterEach, describe, expect, it } from 'vitest'
import { getFirstHTMLElementChild, getHTMLElement, getHTMLElementAt, isInputFocused } from './domUtils'

describe('isInputFocused', () => {
  let element: HTMLElement
  const activeElementDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'activeElement')

  afterEach(() => {
    element?.remove()

    if (activeElementDescriptor) {
      Object.defineProperty(document, 'activeElement', activeElementDescriptor)
    }
  })

  it('returns true when an input is focused', () => {
    element = document.createElement('input')
    document.body.appendChild(element)
    element.focus()
    expect(isInputFocused()).toBe(true)
  })

  it('returns true when a textarea is focused', () => {
    element = document.createElement('textarea')
    document.body.appendChild(element)
    element.focus()
    expect(isInputFocused()).toBe(true)
  })

  it('returns true when a select element is focused', () => {
    element = document.createElement('select')
    document.body.appendChild(element)
    element.focus()
    expect(isInputFocused()).toBe(true)
  })

  it('returns false for a non-HTMLElement active element without reading contentEditable', () => {
    const active = document.createElementNS('http://www.w3.org/2000/svg', 'svg')

    Object.defineProperty(active, 'isContentEditable', {
      configurable: true,
      get() {
        throw new Error('should not read isContentEditable')
      },
    })

    Object.defineProperty(document, 'activeElement', {
      configurable: true,
      get: () => active,
    })

    expect(isInputFocused()).toBe(false)
  })
})

describe('getHTMLElement', () => {
  it('returns the target when it is an HTMLElement', () => {
    const button = document.createElement('button')

    expect(getHTMLElement(button)).toBe(button)
  })

  it('returns null for non-HTMLElement targets', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const text = document.createTextNode('hello')

    expect(getHTMLElement(svg)).toBeNull()
    expect(getHTMLElement(text)).toBeNull()
    expect(getHTMLElement(null)).toBeNull()
  })
})

describe('getHTMLElementAt', () => {
  it('returns the HTMLElement at the requested index', () => {
    const wrapper = document.createElement('div')
    const first = document.createElement('button')
    const second = document.createElement('div')

    wrapper.append(first, second)

    expect(getHTMLElementAt(wrapper.children, 1)).toBe(second)
    expect(getHTMLElementAt(wrapper.querySelectorAll('*'), 0)).toBe(first)
  })

  it('returns null when the index is out of bounds or the item is not an HTMLElement', () => {
    const wrapper = document.createElement('div')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')

    wrapper.append(svg)

    expect(getHTMLElementAt(wrapper.children, 1)).toBeNull()
    expect(getHTMLElementAt(wrapper.querySelectorAll('*'), 0)).toBeNull()
  })
})

describe('getFirstHTMLElementChild', () => {
  it('returns the first child when it is an HTMLElement', () => {
    const wrapper = document.createElement('div')
    const child = document.createElement('span')

    wrapper.append(child)

    expect(getFirstHTMLElementChild(wrapper)).toBe(child)
  })

  it('skips non-HTMLElement children until it finds an HTMLElement', () => {
    const wrapper = document.createElement('div')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const child = document.createElement('button')

    wrapper.append(svg, child)

    expect(getFirstHTMLElementChild(wrapper)).toBe(child)
  })

  it('returns null when there is no child or the first child is not an HTMLElement', () => {
    const empty = document.createElement('div')
    const wrapper = document.createElement('div')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')

    wrapper.append(svg)

    expect(getFirstHTMLElementChild(empty)).toBeNull()
    expect(getFirstHTMLElementChild(wrapper)).toBeNull()
    expect(getFirstHTMLElementChild(null)).toBeNull()
  })
})
