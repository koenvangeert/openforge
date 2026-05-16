/** Check if the currently focused element is an input, textarea, select, or contenteditable */
export function isInputFocused(): boolean {
  const active = document.activeElement
  if (!(active instanceof HTMLElement)) return false

  const tagName = active.tagName.toLowerCase()
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || active.isContentEditable
}

export function getHTMLElement(target: EventTarget | null | undefined): HTMLElement | null {
  return target instanceof HTMLElement ? target : null
}

export function getHTMLElementAt(collection: ArrayLike<Element>, index: number): HTMLElement | null {
  const element = collection[index]
  return element instanceof HTMLElement ? element : null
}

export function getFirstHTMLElementChild(parent: Element | null | undefined): HTMLElement | null {
  let child = parent?.firstElementChild

  while (child) {
    if (child instanceof HTMLElement) return child
    child = child.nextElementSibling
  }

  return null
}
