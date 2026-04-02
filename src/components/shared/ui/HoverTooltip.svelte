<script lang="ts">
  import { onMount } from 'svelte'
  import type { Snippet } from 'svelte'
  import { getFirstHTMLElementChild, getHTMLElement } from '../../../lib/domUtils'

  interface Props {
    text: string
    children: Snippet
    position?: 'bottom' | 'left'
  }

  let { text, children, position = 'bottom' }: Props = $props()

  let visible = $state(false)
  let tooltipX = $state(0)
  let tooltipY = $state(0)
  let hoverTimer: ReturnType<typeof setTimeout> | null = $state(null)
  let portalEl: HTMLDivElement | null = null

  onMount(() => {
    portalEl = document.createElement('div')
    document.body.appendChild(portalEl)
    return () => {
      portalEl?.remove()
    }
  })

  $effect(() => {
    if (!portalEl) return
    if (visible) {
      portalEl.innerHTML = `<div style="position:fixed;left:${tooltipX}px;top:${tooltipY}px;z-index:9999;max-width:280px;pointer-events:none;" class="px-3 py-2 bg-base-100 border border-base-300 rounded-lg shadow-xl text-xs text-base-content/70 whitespace-pre-wrap break-words" role="tooltip"></div>`
      const inner = getFirstHTMLElementChild(portalEl)
      if (inner) inner.textContent = text
    } else {
      portalEl.innerHTML = ''
    }
  })

  function show(e: MouseEvent | FocusEvent) {
    if (hoverTimer) clearTimeout(hoverTimer)

    const wrapper = getHTMLElement(e.currentTarget)
    if (!wrapper) return

    const targetElement = getFirstHTMLElementChild(wrapper) ?? wrapper
    const rect = targetElement.getBoundingClientRect()

    hoverTimer = setTimeout(() => {
      const tooltipWidth = 280
      const margin = 6

      if (position === 'left') {
        tooltipX = Math.max(8, rect.left - tooltipWidth - margin)
        tooltipY = Math.max(8, Math.min(rect.top + rect.height / 2 - 20, window.innerHeight - 100))
      } else {
        const centerX = rect.left + rect.width / 2 - tooltipWidth / 2
        tooltipX = Math.max(8, Math.min(centerX, window.innerWidth - tooltipWidth - 8))
        tooltipY = Math.max(8, Math.min(rect.bottom + margin, window.innerHeight - 200))
      }
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
  onmouseover={show}
  onmouseout={hide}
  onfocus={show}
  onblur={hide}
  role="group"
  class="contents"
>
  {@render children()}
</div>
