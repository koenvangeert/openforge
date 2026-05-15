import { get } from 'svelte/store'
import { listenDesktopEvent } from '../desktopIpc'
import { activeProjectId, currentView, selectedTaskId } from '../stores'

type PluginHostEventName = string

type PluginHostContextSnapshot = {
  activeProjectId: string | null
  currentView: string
  selectedTaskId: string | null
}

type PluginHostListener = (payload: unknown) => void

type DesktopEventSubscription = {
  listeners: Set<PluginHostListener>
  ready: Promise<void>
  unlisten: (() => void) | null
  disposed: boolean
}

const HOST_EVENT_NAMES = new Set(['context-changed', 'navigation-changed', 'selection-changed'])
const pluginHostListeners = new Map<PluginHostEventName, Set<PluginHostListener>>()
const desktopEventSubscriptions = new Map<string, DesktopEventSubscription>()
const pluginHostUnsubscribers = new Map<string, Set<() => void>>()

let storeSubscriptionsInitialized = false

export type { PluginHostContextSnapshot, PluginHostEventName, PluginHostListener }

function ensureDesktopEventSubscription(event: string): DesktopEventSubscription {
  const existing = desktopEventSubscriptions.get(event)
  if (existing) return existing

  const subscription: DesktopEventSubscription = {
    listeners: new Set(),
    ready: Promise.resolve(),
    unlisten: null,
    disposed: false,
  }

  subscription.ready = listenDesktopEvent(event, (desktopEvent) => {
    for (const listener of Array.from(subscription.listeners)) {
      listener(desktopEvent.payload)
    }
  }).then((unlisten) => {
    subscription.unlisten = unlisten
    if (subscription.disposed || subscription.listeners.size === 0) {
      unlisten()
      desktopEventSubscriptions.delete(event)
    }
  }).catch((error) => {
    desktopEventSubscriptions.delete(event)
    console.error(`[pluginRegistry] Failed to subscribe to host event ${event}:`, error)
  })

  desktopEventSubscriptions.set(event, subscription)
  return subscription
}

function removeDesktopEventListener(event: string, handler: PluginHostListener): void {
  const subscription = desktopEventSubscriptions.get(event)
  if (!subscription) return

  subscription.listeners.delete(handler)
  if (subscription.listeners.size > 0) return

  if (subscription.unlisten) {
    subscription.unlisten()
    desktopEventSubscriptions.delete(event)
    return
  }

  subscription.disposed = true
}

async function waitForDesktopEventSubscription(event: string): Promise<void> {
  await desktopEventSubscriptions.get(event)?.ready
}

export async function waitForTerminalEventSubscriptions(commandPayload: Record<string, unknown> | undefined): Promise<void> {
  const taskId = typeof commandPayload?.taskId === 'string' ? commandPayload.taskId : ''
  const terminalIndex = Number(commandPayload?.terminalIndex)
  if (!taskId || !Number.isInteger(terminalIndex) || terminalIndex < 0) return

  const terminalKey = `${taskId}-shell-${terminalIndex}`
  await Promise.all([
    waitForDesktopEventSubscription(`pty-output-${terminalKey}`),
    waitForDesktopEventSubscription(`pty-exit-${terminalKey}`),
  ])
}

export function subscribeToPluginHostEvent(pluginId: string, event: string, handler: PluginHostListener): () => void {
  const cleanupCallbacks = pluginHostUnsubscribers.get(pluginId) ?? new Set<() => void>()
  let unsubscribe = () => {}

  if (HOST_EVENT_NAMES.has(event)) {
    const typedEvent = event as PluginHostEventName
    const listeners = pluginHostListeners.get(typedEvent) ?? new Set<PluginHostListener>()
    listeners.add(handler)
    pluginHostListeners.set(typedEvent, listeners)
    unsubscribe = () => {
      const currentListeners = pluginHostListeners.get(typedEvent)
      currentListeners?.delete(handler)
      if (currentListeners && currentListeners.size === 0) {
        pluginHostListeners.delete(typedEvent)
      }
    }
  } else {
    const subscription = ensureDesktopEventSubscription(event)
    subscription.listeners.add(handler)
    unsubscribe = () => removeDesktopEventListener(event, handler)
  }

  const cleanup = () => {
    unsubscribe()
    cleanupCallbacks.delete(cleanup)
    if (cleanupCallbacks.size === 0) {
      pluginHostUnsubscribers.delete(pluginId)
    }
  }

  cleanupCallbacks.add(cleanup)
  pluginHostUnsubscribers.set(pluginId, cleanupCallbacks)

  return cleanup
}

export function clearPluginHostSubscriptions(pluginId: string): void {
  const cleanupCallbacks = pluginHostUnsubscribers.get(pluginId)
  if (!cleanupCallbacks) return

  for (const cleanup of Array.from(cleanupCallbacks)) {
    cleanup()
  }

  pluginHostUnsubscribers.delete(pluginId)
}

export function getContextSnapshot(): PluginHostContextSnapshot {
  return {
    activeProjectId: get(activeProjectId),
    currentView: get(currentView),
    selectedTaskId: get(selectedTaskId),
  }
}

export function emitPluginHostEvent(event: PluginHostEventName, payload: unknown): void {
  const listeners = pluginHostListeners.get(event)
  if (!listeners) return

  for (const listener of listeners) {
    listener(payload)
  }
}

export function ensurePluginHostStoreSubscriptions(): void {
  if (storeSubscriptionsInitialized) return
  storeSubscriptionsInitialized = true

  let previousContext = getContextSnapshot()

  const emitContextUpdates = () => {
    const nextContext = getContextSnapshot()

    if (nextContext.selectedTaskId !== previousContext.selectedTaskId) {
      emitPluginHostEvent('selection-changed', { selectedTaskId: nextContext.selectedTaskId })
    }

    if (nextContext.activeProjectId !== previousContext.activeProjectId || nextContext.currentView !== previousContext.currentView) {
      emitPluginHostEvent('navigation-changed', {
        activeProjectId: nextContext.activeProjectId,
        currentView: nextContext.currentView,
      })
    }

    if (
      nextContext.activeProjectId !== previousContext.activeProjectId
      || nextContext.currentView !== previousContext.currentView
      || nextContext.selectedTaskId !== previousContext.selectedTaskId
    ) {
      emitPluginHostEvent('context-changed', nextContext)
    }

    previousContext = nextContext
  }

  activeProjectId.subscribe(emitContextUpdates)
  currentView.subscribe(emitContextUpdates)
  selectedTaskId.subscribe(emitContextUpdates)
}
