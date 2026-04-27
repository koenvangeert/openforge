<script lang="ts">
  import { parseStrictFiniteNumber } from '../../../lib/numberParsing'
  import type { Snippet } from 'svelte'

  interface Props {
    storageKey: string
    defaultHeight: number
    minHeight: number | null
    maxHeight: number | null
    fillParent: boolean
    panelTestId?: string
    handleTestId?: string
    children: Snippet
  }

  let {
    storageKey,
    defaultHeight,
    minHeight = null,
    maxHeight = null,
    fillParent = false,
    panelTestId = 'resizable-bottom-panel',
    handleTestId = 'resize-handle',
    children,
  }: Props = $props()

  let panelEl = $state<HTMLElement | null>(null)

  function getMinHeight(): number {
    return minHeight !== null ? minHeight : 100
  }

  function getMaxHeight(): number {
    if (maxHeight !== null) return maxHeight
    return Math.floor(window.innerHeight * 0.7)
  }

  function clamp(value: number): number {
    return Math.max(getMinHeight(), Math.min(getMaxHeight(), value))
  }

  function loadHeight(): number {
    try {
      const stored = localStorage.getItem(`resizable-panel:${storageKey}`)
      if (stored !== null) {
        const parsed = parseStrictFiniteNumber(stored)
        if (parsed !== null) return clamp(parsed)
      }
    } catch { /* localStorage unavailable */ }
    return defaultHeight
  }

  function saveHeight(h: number) {
    try {
      localStorage.setItem(`resizable-panel:${storageKey}`, String(h))
    } catch { /* localStorage unavailable */ }
  }

  function clearHeight() {
    try {
      localStorage.removeItem(`resizable-panel:${storageKey}`)
    } catch { /* localStorage unavailable */ }
  }

  let height = $state(loadHeight())
  let isDragging = $state(false)

  function onMouseDown(e: MouseEvent) {
    e.preventDefault()
    isDragging = true

    const startY = e.clientY
    const startHeight = height
    const rect = panelEl?.getBoundingClientRect()
    if (!rect) return

    function onMouseMove(e: MouseEvent) {
      const delta = e.clientY - startY
      height = clamp(startHeight - delta)
    }

    function onMouseUp() {
      isDragging = false
      saveHeight(height)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  function onDblClick() {
    height = defaultHeight
    clearHeight()
  }

  function onKeyDown(e: KeyboardEvent) {
    let delta = 0
    if (e.key === 'ArrowUp') {
      delta = 10
    } else if (e.key === 'ArrowDown') {
      delta = -10
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onDblClick()
      return
    }

    if (delta !== 0) {
      e.preventDefault()
      height = clamp(height + delta)
      saveHeight(height)
    }
  }
</script>

<div
  data-testid={panelTestId}
  class="relative flex flex-col {fillParent ? 'flex-1' : 'shrink-0'} w-full overflow-hidden"
  style="{fillParent ? '' : `height: ${height}px`}"
  bind:this={panelEl}
>
  {#if !fillParent}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      data-testid={handleTestId}
      class="absolute top-0 left-0 right-0 z-10 h-1 hover:bg-primary/30 transition-colors {isDragging ? 'bg-primary/40' : ''} focus-visible:bg-primary/40 focus-visible:outline-none"
      style="cursor: row-resize"
      role="separator"
      aria-orientation="horizontal"
      tabindex="0"
      onmousedown={onMouseDown}
      ondblclick={onDblClick}
      onkeydown={onKeyDown}
    ></div>
  {/if}
  <div class="flex-1 overflow-hidden">
    {@render children?.()}
  </div>
</div>
