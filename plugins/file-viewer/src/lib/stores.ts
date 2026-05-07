import { writable } from 'svelte/store'

export const activeProjectId = writable<string | null>(null)
export const pendingFileReveal = writable<string | null>(null)

export function requestFileReveal(path: string): void {
  pendingFileReveal.set(path)
}
