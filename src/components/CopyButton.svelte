<script lang="ts">
  interface Props {
    text: string
    label?: string
    timeout?: number
  }

  let { text, label = 'Copy', timeout = 2000 }: Props = $props()

  let copied = $state(false)
  let timer: ReturnType<typeof setTimeout> | null = null

  async function handleCopy() {
    if (copied) return
    try {
      await navigator.clipboard.writeText(text)
      copied = true
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { copied = false }, timeout)
    } catch (e) {
      console.error('Failed to copy:', e)
    }
  }
</script>

<button
  class="copy-btn"
  class:copied
  disabled={copied}
  title={copied ? 'Copied!' : label}
  onclick={handleCopy}
>
  {#if copied}
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
  {:else}
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
  {/if}
</button>

<style>
  .copy-btn {
    all: unset;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 26px;
    height: 26px;
    border-radius: 4px;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .copy-btn:hover:not(:disabled) {
    color: var(--accent);
    background: rgba(122, 162, 247, 0.1);
  }

  .copy-btn:disabled {
    cursor: default;
  }

  .copy-btn.copied {
    color: var(--success);
  }
</style>
