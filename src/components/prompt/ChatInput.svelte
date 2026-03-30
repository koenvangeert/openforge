<script lang="ts">
  import { onMount } from 'svelte'

  interface Props {
    onSend: (text: string) => void
    disabled?: boolean
    placeholder?: string
  }

  let { onSend, disabled = false, placeholder = 'Send a message...' }: Props = $props()

  let text = $state('')
  let textareaEl: HTMLTextAreaElement | null = null

  const MAX_HEIGHT_PX = 120 // ~5 rows at standard line height

  function adjustHeight() {
    if (!textareaEl) return
    textareaEl.style.height = 'auto'
    textareaEl.style.height = `${Math.min(textareaEl.scrollHeight, MAX_HEIGHT_PX)}px`
  }

  function handleInput() {
    adjustHeight()
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  function send() {
    if (disabled || !text.trim()) return
    onSend(text)
    text = ''
    if (textareaEl) {
      textareaEl.style.height = 'auto'
    }
  }

  onMount(() => {
    if (textareaEl) {
      textareaEl.focus()
    }
  })
</script>

<div class="flex items-end gap-2 p-3 bg-base-100 border-t border-base-300">
  <textarea
    bind:this={textareaEl}
    bind:value={text}
    rows={1}
    {placeholder}
    {disabled}
    aria-label="Send message to Claude"
    class="textarea textarea-bordered flex-1 resize-none overflow-y-auto leading-normal {disabled ? 'opacity-50 cursor-not-allowed' : ''}"
    oninput={handleInput}
    onkeydown={handleKeydown}
  ></textarea>
  <button
    type="button"
    class="btn btn-primary btn-sm self-end"
    onclick={send}
    {disabled}
  >
    Send
  </button>
</div>
