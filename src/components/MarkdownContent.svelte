<script lang="ts">
  import { marked } from 'marked'
  import { openUrl } from '../lib/ipc'

  interface Props {
    content: string
  }

  let { content }: Props = $props()

  marked.setOptions({
    gfm: true,
    breaks: true,
  })

  let html = $derived(marked.parse(content) as string)

  function handleClick(e: MouseEvent) {
    const anchor = (e.target as HTMLElement).closest('a')
    if (anchor?.href) {
      e.preventDefault()
      openUrl(anchor.href)
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="markdown-body" onclick={handleClick}>
  {@html html}
</div>
