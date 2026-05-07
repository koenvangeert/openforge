import { writable } from 'svelte/store'
import type { FileBrowserProjectState } from './fileExplorer'

export const activeProjectId = writable<string | null>(null)
export const pendingFileReveal = writable<string | null>(null)
export const fileBrowserStates = writable<Map<string, FileBrowserProjectState>>(new Map())

export function requestFileReveal(path: string): void {
  pendingFileReveal.set(path)
}
