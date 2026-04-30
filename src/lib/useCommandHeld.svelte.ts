import { commandHeld } from './stores'

export function setupCommandHeldListeners() {
  let showTimer: ReturnType<typeof setTimeout> | null = null

  function clearShowTimer() {
    if (showTimer) clearTimeout(showTimer)
    showTimer = null
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Meta') return
    if (e.repeat) return
    clearShowTimer()
    showTimer = setTimeout(() => {
      commandHeld.set(true)
    }, 150)
  }

  function onKeyUp(e: KeyboardEvent) {
    if (e.key !== 'Meta') return
    clearShowTimer()
    commandHeld.set(false)
  }

  function onBlur() {
    clearShowTimer()
    commandHeld.set(false)
  }

  function onVisibilityChange() {
    if (document.hidden) {
      clearShowTimer()
      commandHeld.set(false)
    }
  }

  window.addEventListener('keydown', onKeyDown, { capture: true })
  window.addEventListener('keyup', onKeyUp, { capture: true })
  window.addEventListener('blur', onBlur)
  document.addEventListener('visibilitychange', onVisibilityChange)

  return () => {
    clearShowTimer()
    window.removeEventListener('keydown', onKeyDown, { capture: true })
    window.removeEventListener('keyup', onKeyUp, { capture: true })
    window.removeEventListener('blur', onBlur)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    commandHeld.set(false)
  }
}

export function useCommandHeld() {
  $effect(() => {
    return setupCommandHeldListeners()
  })
}
