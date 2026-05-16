import {
  Virtualizer,
  observeElementRect,
  observeElementOffset,
  elementScroll,
  type ScrollToOptions,
  type VirtualItem,
} from '@tanstack/virtual-core'

interface VirtualizerOptions {
  getCount: () => number
  getScrollElement: () => HTMLElement | null
  estimateSize: (index: number) => number
  getOverscan?: () => number
  getEnabled?: () => boolean
}

interface VirtualizerReturn {
  readonly virtualItems: VirtualItem[]
  readonly totalSize: number
  scrollToIndex(index: number, opts?: ScrollToOptions): void
  measureAction: (node: HTMLElement) => { destroy(): void }
}

export function createVirtualizer(opts: VirtualizerOptions): VirtualizerReturn {
  let version = $state(0)

  const virtualizer = new Virtualizer({
    count: opts.getCount(),
    getScrollElement: opts.getScrollElement,
    estimateSize: opts.estimateSize,
    overscan: opts.getOverscan?.() ?? 5,
    observeElementRect,
    observeElementOffset,
    scrollToFn: elementScroll,
    onChange: () => {
      version++
    },
  })

  $effect(() => {
    virtualizer.setOptions({
      count: opts.getCount(),
      getScrollElement: opts.getScrollElement,
      estimateSize: opts.estimateSize,
      overscan: opts.getOverscan?.() ?? 5,
      observeElementRect,
      observeElementOffset,
      scrollToFn: elementScroll,
      onChange: () => {
        version++
      },
    })
    virtualizer._willUpdate()
  })

  $effect(() => {
    const cleanup = virtualizer._didMount()
    return cleanup
  })

  return {
    get virtualItems() {
      // Read version to subscribe to changes
      void version

      const enabled = opts.getEnabled?.() ?? true
      if (!enabled) {
        const count = opts.getCount()
        return Array.from({ length: count }, (_, i) => ({
          key: i,
          index: i,
          start: i * opts.estimateSize(i),
          end: (i + 1) * opts.estimateSize(i),
          size: opts.estimateSize(i),
          lane: 0,
        })) as VirtualItem[]
      }

      return virtualizer.getVirtualItems()
    },

    get totalSize() {
      void version
      return virtualizer.getTotalSize()
    },

    scrollToIndex(index: number, scrollOpts?: ScrollToOptions) {
      virtualizer.scrollToIndex(index, scrollOpts)
    },

    measureAction(node: HTMLElement) {
      virtualizer.measureElement(node)
      return {
        destroy() {
          // no-op: element removed from DOM
        },
      }
    },
  }
}
