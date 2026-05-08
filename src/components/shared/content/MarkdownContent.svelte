<script lang="ts">
  import { openUrl } from '../../../lib/ipc'
  import { renderMarkdownHtml } from '../../../lib/markdown'

  interface Props {
    content: string
    imageBaseUrl?: string | null
  }

  let { content, imageBaseUrl = null }: Props = $props()

  let html = $derived(renderMarkdownHtml(content, { imageBaseUrl }))

  function handleClick(e: MouseEvent) {
    if (!(e.target instanceof Element)) return

    const anchor = e.target.closest('a')
    if (anchor?.href) {
      e.preventDefault()
      openUrl(anchor.href)
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div role="presentation" class="markdown-body" onclick={handleClick}>
  {@html html}
</div>
