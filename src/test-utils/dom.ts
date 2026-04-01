type Constructor<T> = {
  new (...args: never[]): T
  name: string
}

export function requireDefined<T>(value: T | null | undefined, message = 'Expected value to be defined'): T {
  if (value == null) {
    throw new Error(message)
  }

  return value
}

export function requireElement<T extends Element>(
  value: Element | null | undefined,
  ctor: Constructor<T>,
  message = `Expected ${ctor.name}`,
): T {
  if (!(value instanceof ctor)) {
    throw new Error(message)
  }

  return value
}
