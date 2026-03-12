import type { AppView } from './types'

const GOTO_MAP: Record<string, AppView> = {
  b: 'board',
  p: 'pr_review',
  s: 'skills',
  c: 'creatures',
  w: 'workqueue',
  ',': 'settings',
}

/**
 * Resolve a second key in a `g`-prefix sequence to a target view.
 * Returns null if the key doesn't map to a view (e.g. `g` + unknown key).
 * Note: `gg` (go to top) is NOT handled here — it's special-cased in board view.
 */
export function resolveGotoKey(key: string): AppView | null {
  return GOTO_MAP[key] ?? null
}
