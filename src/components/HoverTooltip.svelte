<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    text: string
    children: Snippet
  }

  let { text, children }: Props = $props()

  let triggerEl: HTMLDivElement | null = $state(null)
  let visible = $state(false)
  let tooltipX = $state(0)
  let tooltipY = $state(0)
  let hoverTimer: ReturnType<typeof setTimeout> | null = $state(null)

  function show() {
    if (hoverTimer) clearTimeout(hoverTimer)
    hoverTimer = setTimeout(() => {
      if (!triggerEl) return
      const rect = triggerEl.getBoundingClientRect()
      const tooltipWidth = 280
      const margin = 8

      // Try right side first, fall back to left
      if (rect.right + margin + tooltipWidth < window.innerWidth) {
        tooltipX = rect.right + margin
      } else {
        tooltipX = rect.left - margin - tooltipWidth
      }

      // Align top of tooltip with top of trigger, clamp to viewport
      tooltipY = Math.max(8, Math.min(rect.top, window.innerHeight - 200))
      visible = true
    }, 200)
  }

  function hide() {
    if (hoverTimer) {
      clearTimeout(hoverTimer)
      hoverTimer = null
    }
    visible = false
  }
</script>

<div
  bind:this={triggerEl}
  onmouseover={show}
  onmouseout={hide}
  onfocus={show}
  onblur={hide}
  role="group"
  class="contents"
>
  {@render children()}
</div>

{#if visible}
  <div
    class="fixed z-[110] max-w-[280px] px-3 py-2 bg-base-100 border border-base-300 rounded-lg shadow-xl text-xs text-base-content/70 whitespace-pre-wrap break-words pointer-events-none"
    style="left: {tooltipX}px; top: {tooltipY}px;"
    role="tooltip"
  >
    {text}
  </div>
{/if}
