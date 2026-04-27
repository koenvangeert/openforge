<script lang="ts">
  import { parseStrictFiniteNumber } from '../../../lib/numberParsing'
  import type { Snippet } from 'svelte'

  interface Props {
    storageKey: string
    defaultWidth: number
    minWidth?: number
    maxWidth?: number
    side?: 'left' | 'right'
    children?: Snippet
  }

  let {
    storageKey,
    defaultWidth,
    minWidth = 120,
    maxWidth = 600,
    side = 'left',
    children,
  }: Props = $props()

  let panelEl = $state<HTMLElement | null>(null)

  function clamp(value: number): number {
    return Math.max(minWidth, Math.min(maxWidth, value))
  }

  function loadWidth(): number {
    try {
      const stored = localStorage.getItem(`resizable-panel:${storageKey}`)
      if (stored !== null) {
        const parsed = parseStrictFiniteNumber(stored)
        if (parsed !== null) return clamp(parsed)
      }
    } catch { /* localStorage unavailable */ }
    return defaultWidth
  }

  function saveWidth(w: number) {
    try {
      localStorage.setItem(`resizable-panel:${storageKey}`, String(w))
    } catch { /* localStorage unavailable */ }
  }

  function clearWidth() {
    try {
      localStorage.removeItem(`resizable-panel:${storageKey}`)
    } catch { /* localStorage unavailable */ }
  }

  let width = $state(loadWidth())
  let isDragging = $state(false)

  function onMouseDown(e: MouseEvent) {
    e.preventDefault()
    isDragging = true

    const startX = e.clientX
    const startWidth = width
    const rect = panelEl?.getBoundingClientRect()
    if (!rect) return

    function onMouseMove(e: MouseEvent) {
      const delta = side === 'left'
        ? e.clientX - startX
        : startX - e.clientX
      width = clamp(startWidth + delta)
    }

    function onMouseUp() {
      isDragging = false
      saveWidth(width)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  function onDblClick() {
    width = defaultWidth
    clearWidth()
  }

  function onKeyDown(e: KeyboardEvent) {
    let delta = 0
    if (e.key === 'ArrowRight') {
      delta = side === 'left' ? 10 : -10
    } else if (e.key === 'ArrowLeft') {
      delta = side === 'left' ? -10 : 10
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onDblClick()
      return
    }

    if (delta !== 0) {
      e.preventDefault()
      width = clamp(width + delta)
      saveWidth(width)
    }
  }
</script>

<div
  data-testid="resizable-panel"
  class="relative flex shrink-0 h-full overflow-hidden"
  style="width: {width}px"
  bind:this={panelEl}
>
  {#if side === 'right'}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      data-testid="resize-handle"
      class="absolute left-0 top-0 bottom-0 z-10 w-1 hover:bg-primary/30 transition-colors {isDragging ? 'bg-primary/40' : ''} focus-visible:bg-primary/40 focus-visible:outline-none"
      style="cursor: col-resize"
      role="separator"
      aria-orientation="vertical"
      tabindex="0"
      onmousedown={onMouseDown}
      ondblclick={onDblClick}
      onkeydown={onKeyDown}
    ></div>
  {/if}
  <div class="flex-1 overflow-hidden">
    {@render children?.()}
  </div>
  {#if side === 'left'}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      data-testid="resize-handle"
      class="absolute right-0 top-0 bottom-0 z-10 w-1 hover:bg-primary/30 transition-colors {isDragging ? 'bg-primary/40' : ''} focus-visible:bg-primary/40 focus-visible:outline-none"
      style="cursor: col-resize"
      role="separator"
      aria-orientation="vertical"
      tabindex="0"
      onmousedown={onMouseDown}
      ondblclick={onDblClick}
      onkeydown={onKeyDown}
    ></div>
  {/if}
</div>
