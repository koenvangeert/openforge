/**
 * Format a timestamp as a human-readable relative time string.
 * @param timestampMs Unix timestamp in milliseconds (Date.now() format)
 */
export function timeAgo(timestampMs: number): string {
  const elapsedMs = Date.now() - timestampMs
  if (elapsedMs < 60_000) return 'just now'

  const minutes = Math.floor(elapsedMs / 60_000)
  if (elapsedMs < 3_600_000) return `${minutes}m ago`

  const hours = Math.floor(elapsedMs / 3_600_000)
  if (elapsedMs < 86_400_000) return `${hours}h ago`

  const days = Math.floor(elapsedMs / 86_400_000)
  return `${days}d ago`
}

/**
 * Format a Unix timestamp in seconds as a human-readable relative time string.
 * @param timestampSeconds Unix timestamp in seconds
 */
export function timeAgoFromSeconds(timestampSeconds: number): string {
  return timeAgo(timestampSeconds * 1000)
}

const RELATIVE_TIME_DATE_FALLBACK_MS = 7 * 86_400_000

export function relativeTimeWithFallback(timestampSeconds: number): string {
  const timestampMs = timestampSeconds * 1000
  if (Date.now() - timestampMs < RELATIVE_TIME_DATE_FALLBACK_MS) {
    return timeAgo(timestampMs)
  }

  return new Date(timestampMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
