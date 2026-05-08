<script lang="ts">
  import { renderMarkdownHtml } from '../markdown'

  interface Props {
    content: string
    imageBaseUrl?: string | null
    onOpenUrl?: (url: string) => void | Promise<void>
  }

  let { content, imageBaseUrl = null, onOpenUrl }: Props = $props()

  let html = $derived(renderMarkdownHtml(content, { imageBaseUrl }))

  function handleClick(e: MouseEvent) {
    if (!(e.target instanceof Element)) return

    const anchor = e.target.closest('a')
    if (anchor?.href) {
      e.preventDefault()
      if (onOpenUrl) {
        void onOpenUrl(anchor.href)
      }
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div role="presentation" class="markdown-body" onclick={handleClick}>
  {@html html}
</div>
