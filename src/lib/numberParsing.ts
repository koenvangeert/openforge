const STRICT_FINITE_NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/

export function parseStrictFiniteNumber(value: string): number | null {
  if (!STRICT_FINITE_NUMBER_PATTERN.test(value)) {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
