<script lang="ts">
  type WidgetConfig = {
    lineNumber: number
    side: number
  }

  type Props = {
    diffFile?: unknown
    renderWidgetLine?: (props: {
      lineNumber: number
      side: number
      diffFile: unknown
      onClose: () => void
    }) => unknown
  }

  let { diffFile, renderWidgetLine }: Props = $props()

  const widgetConfig = $derived((globalThis as typeof globalThis & {
    __diffViewerTestWidget?: WidgetConfig
  }).__diffViewerTestWidget)
</script>

<div data-testid="mock-diff-view">
  {#if widgetConfig && renderWidgetLine}
    {@render renderWidgetLine({
      lineNumber: widgetConfig.lineNumber,
      side: widgetConfig.side,
      diffFile,
      onClose: () => {},
    })}
  {/if}
</div>
