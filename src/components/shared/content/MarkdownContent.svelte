<script lang="ts">
  import { marked } from 'marked'
  import { openUrl } from '../../../lib/ipc'
  import { sanitizeHtml } from '../../../lib/sanitize'

  interface Props {
    content: string
  }

  let { content }: Props = $props()

  marked.setOptions({
    gfm: true,
    breaks: true,
  })

  let html = $derived(sanitizeHtml(marked.parse(content) as string))

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
