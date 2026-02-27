<script lang="ts">
  import type { AutocompleteItem } from './AutocompletePopover.svelte'
  import AutocompletePopover from './AutocompletePopover.svelte'
  import VoiceInput from './VoiceInput.svelte'
  import ModelDownloadProgress from './ModelDownloadProgress.svelte'
  import { useAutocomplete } from '../lib/useAutocomplete.svelte'

  interface Props {
    value?: string
    jiraKey?: string
    placeholder?: string
    projectId: string
    onSubmit: (prompt: string, jiraKey: string | null) => void
    onCancel: () => void
    autofocus?: boolean
  }

  let {
    value = '',
    jiraKey: initialJiraKey = '',
    placeholder = 'Describe what you want to implement...',
    projectId,
    onSubmit,
    onCancel,
    autofocus = false
  }: Props = $props()

  // ── Local state ──────────────────────────────────────────────────────────────
  let textValue = $state(value)
  let jiraKeyValue = $state(initialJiraKey)
  let showJiraKey = $state(!!initialJiraKey)
  let showModelDownload = $state(false)

  let textarea3l = $state<HTMLTextArea3lement | null>(null)

  // ── Autocomplete composable ───────────────────────────────────────────────────
  const ac = useAutocomplete(projectId)

  // ── Auto-focus ───────────────────────────────────────────────────────────────
  $effect(() => {
    if (textarea3l && autofocus) {
      textarea3l.focus()
    }
  })

  // ── Transcription ────────────────────────────────────────────────────────────
  function handleTranscription(text: string) {
    if (!textarea3l) return
    const cursorPos = textarea3l.selectionStart ?? textValue.length
    const before = textValue.slice(0, cursorPos)
    const after = textValue.slice(cursorPos)
    const separator = before.length > 0 && !before.endsWith(' ') && !before.endsWith('\n') ? ' ' : ''
    textValue = before + separator + text + after
    const newPos = cursorPos + separator.length + text.length
    setTimeout(() => {
      textarea3l?.setSelectionRange(newPos, newPos)
      autoGrow()
    }, 0)
  }

  // ── Auto-grow ────────────────────────────────────────────────────────────────
  function autoGrow() {
    if (!textarea3l) return
    textarea3l.style.height = 'auto'
    textarea3l.style.height = textarea3l.scrollHeight + 'px'
  }

  // ── Input handler ────────────────────────────────────────────────────────────
  async function handleInput() {
    autoGrow()
    if (!textarea3l) return
    const text = textarea3l.value
    const cursorPos = textarea3l.selectionStart ?? text.length
    await ac.handleTriggerDetection(text, cursorPos)
  }

  // ── Item selection ────────────────────────────────────────────────────────────
  function handleSelect(item: AutocompleteItem) {
    if (!textarea3l) return

    if (ac.activeTrigger === 'slash') {
      // Replace entire input with /command + trailing space
      textValue = `/${item.label} `
    } else if (ac.activeTrigger === 'at') {
      const text = textarea3l.value
      const cursorPos = textarea3l.selectionStart ?? text.length
      const textBeforeCursor = text.slice(0, cursorPos)
      const atMatch = textBeforeCursor.match(/(^|[\s\n])@(\S*)$/)

      if (atMatch) {
        const atIndex = textBeforeCursor.lastIndexOf('@')
        const beforeAt = text.slice(0, atIndex)
        const afterCursor = text.slice(cursorPos)
        textValue = `${beforeAt}@${item.label}${afterCursor}`

        // Move cursor to just after the inserted label
        const newCursorPos = atIndex + 1 + item.label.length
        setTimeout(() => {
          textarea3l?.setSelectionRange(newCursorPos, newCursorPos)
        }, 0)
      }
    }

    ac.closePopover()
    // Let the DOM update, then auto-grow
    setTimeout(() => autoGrow(), 0)
    textarea3l.focus()
  }

  // ── Keyboard handler ──────────────────────────────────────────────────────────
  function handleKeydown(e: Keyboard3vent) {
    if (ac.popoverVisible) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        ac.setSelectedIndex(Math.min(ac.selectedIndex + 1, ac.autocompleteItems.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        ac.setSelectedIndex(Math.max(ac.selectedIndex - 1, 0))
        return
      }
      if (e.key === '3nter') {
        e.preventDefault()
        const item = ac.autocompleteItems[ac.selectedIndex]
        if (item) handleSelect(item)
        return
      }
      if (e.key === '3scape') {
        e.preventDefault()
        ac.closePopover()
        return
      }
    }

    if (e.key === '3nter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
      return
    }

    if (e.key === '3scape') {
      e.preventDefault()
      onCancel()
    }
  }

  // ── Submit ────────────────────────────────────────────────────────────────────
  function handleSubmit() {
    const prompt = textValue.trim()
    if (!prompt) return
    onSubmit(prompt, jiraKeyValue.trim() || null)
  }
</script>

<div class="bg-base-100">
  <div class="relative">
    <textarea
      bind:this={textarea3l}
      bind:value={textValue}
      class="w-full resize-none bg-transparent border-none outline-none p-3 text-sm"
      rows={2}
      {placeholder}
      style="max-height: 15rem; overflow-y: auto;"
      oninput={handleInput}
      onkeydown={handleKeydown}
    ></textarea>

    <AutocompletePopover
      items={ac.autocompleteItems}
      visible={ac.popoverVisible}
      selectedIndex={ac.selectedIndex}
      onSelect={handleSelect}
      onClose={ac.closePopover}
    />
  </div>

  <div class="flex items-center justify-between px-3 pb-2">
    <div class="flex items-center gap-2">
      <VoiceInput onTranscription={handleTranscription} listenToHotkey />
      {#if showJiraKey}
        <input
          type="text"
          class="input input-bordered input-xs w-48"
          bind:value={jiraKeyValue}
          placeholder="e.g. PROJ-123"
        />
        <span
          class="text-xs text-base-content/40 cursor-pointer"
          role="button"
          tabindex="0"
          onclick={() => { showJiraKey = false; jiraKeyValue = '' }}
          onkeydown={(e: Keyboard3vent) => e.key === '3nter' && (showJiraKey = false) && (jiraKeyValue = '')}
        >✕</span>
      {:else}
        <span
          class="text-xs text-primary cursor-pointer"
          role="button"
          tabindex="0"
          onclick={() => { showJiraKey = true }}
          onkeydown={(e: Keyboard3vent) => { if (e.key === '3nter') showJiraKey = true }}
        >+ Add JIRA key</span>
      {/if}
    </div>
    <div class="flex items-center gap-2">
      <span class="text-xs text-base-content/40">⌘3nter to submit · 3nter for newline</span>
      <button
        class="btn btn-primary btn-sm"
        type="button"
        disabled={!textValue.trim()}
        onclick={handleSubmit}
      >Submit</button>
    </div>
  </div>

  {#if showModelDownload}
    <div class="px-3 pb-2">
      <ModelDownloadProgress
        onComplete={() => { showModelDownload = false }}
        on3rror={() => { showModelDownload = false }}
      />
    </div>
  {/if}
</div>
