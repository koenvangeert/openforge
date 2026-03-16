<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { AutocompleteItem, Action } from '../lib/types'
  import AutocompletePopover from './AutocompletePopover.svelte'
  import VoiceInput from './VoiceInput.svelte'
  import ModelDownloadProgress from './ModelDownloadProgress.svelte'
  import HoverTooltip from './HoverTooltip.svelte'
  import { useAutocomplete } from '../lib/useAutocomplete.svelte'

  interface Props {
    value?: string
    jiraKey?: string
    placeholder?: string
    projectId: string
    onSubmit: (prompt: string, jiraKey: string | null) => void
    onStartTask?: (prompt: string, jiraKey: string | null) => void
    onRunAction?: (prompt: string, jiraKey: string | null, actionPrompt: string) => void
    onCancel: () => void
    autofocus?: boolean
    extras?: Snippet
    actions?: Action[]
  }

  let {
    value = '',
    jiraKey: initialJiraKey = '',
    placeholder = 'Describe what you want to implement...',
    projectId,
    onSubmit,
    onStartTask,
    onRunAction,
    onCancel,
    autofocus = false,
    extras,
    actions = []
  }: Props = $props()

  // ── Local state ──────────────────────────────────────────────────────────────
  let textValue = $state(value)
  let jiraKeyValue = $state(initialJiraKey)
  let showJiraKey = $state(!!initialJiraKey)
  let showModelDownload = $state(false)

  let textareaEl = $state<HTMLTextAreaElement | null>(null)

  // ── Autocomplete composable ───────────────────────────────────────────────────
  const ac = useAutocomplete(projectId)

  // ── Auto-focus ───────────────────────────────────────────────────────────────
  // Use requestAnimationFrame to ensure focus happens after any parent (e.g. Modal)
  // steals focus with its own $effect.
  $effect(() => {
    if (textareaEl && autofocus) {
      requestAnimationFrame(() => textareaEl?.focus())
    }
  })

  // ── Transcription ────────────────────────────────────────────────────────────
  function handleTranscription(text: string) {
    if (!textareaEl) return
    const cursorPos = textareaEl.selectionStart ?? textValue.length
    const before = textValue.slice(0, cursorPos)
    const after = textValue.slice(cursorPos)
    const separator = before.length > 0 && !before.endsWith(' ') && !before.endsWith('\n') ? ' ' : ''
    textValue = before + separator + text + after
    const newPos = cursorPos + separator.length + text.length
    setTimeout(() => {
      textareaEl?.setSelectionRange(newPos, newPos)
      autoGrow()
    }, 0)
  }

  // ── Auto-grow ────────────────────────────────────────────────────────────────
  function autoGrow() {
    if (!textareaEl) return
    textareaEl.style.height = 'auto'
    textareaEl.style.height = textareaEl.scrollHeight + 'px'
  }

  // ── Input handler ────────────────────────────────────────────────────────────
  async function handleInput() {
    autoGrow()
    if (!textareaEl) return
    const text = textareaEl.value
    const cursorPos = textareaEl.selectionStart ?? text.length
    await ac.handleTriggerDetection(text, cursorPos)
  }

  // ── Item selection ────────────────────────────────────────────────────────────
  function handleSelect(item: AutocompleteItem) {
    if (!textareaEl) return

    if (ac.activeTrigger === 'slash') {
      // Replace entire input with /command + trailing space
      textValue = `/${item.label} `
    } else if (ac.activeTrigger === 'at') {
      const text = textareaEl.value
      const cursorPos = textareaEl.selectionStart ?? text.length
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
          textareaEl?.setSelectionRange(newCursorPos, newCursorPos)
        }, 0)
      }
    }

    ac.closePopover()
    // Let the DOM update, then auto-grow
    setTimeout(() => autoGrow(), 0)
    textareaEl.focus()
  }

  // ── Keyboard handler ──────────────────────────────────────────────────────────
  function handleKeydown(e: KeyboardEvent) {
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
      if (e.key === 'Enter') {
        e.preventDefault()
        const item = ac.autocompleteItems[ac.selectedIndex]
        if (item) handleSelect(item)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        ac.closePopover()
        return
      }
    }

    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      if (onStartTask) {
        handleStart()
      } else {
        handleSubmit()
      }
      return
    }

    if (e.key === 'Enter' && e.shiftKey && onStartTask) {
      e.preventDefault()
      handleSubmit()
      return
    }

    if (e.key === 'Escape') {
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

  function handleStart() {
    const prompt = textValue.trim()
    if (!prompt) return
    onStartTask?.(prompt, jiraKeyValue.trim() || null)
  }

  function handleCustomAction(actionPrompt: string) {
    const prompt = textValue.trim()
    if (!prompt) return
    onRunAction?.(prompt, jiraKeyValue.trim() || null, actionPrompt)
  }
</script>

<div class="bg-base-100">
  <div class="relative">
    <textarea
      bind:this={textareaEl}
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

  {#if extras}
    <div class="px-3 pb-1">
      {@render extras()}
    </div>
  {/if}

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
          onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && (showJiraKey = false) && (jiraKeyValue = '')}
        >✕</span>
      {:else}
        <span
          class="text-xs text-primary cursor-pointer"
          role="button"
          tabindex="0"
          onclick={() => { showJiraKey = true }}
          onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') showJiraKey = true }}
        >+ Add JIRA key</span>
      {/if}
    </div>
    <div class="flex items-center gap-2">
      {#if onStartTask}
        <button
          class="btn btn-ghost btn-sm"
          type="button"
          disabled={!textValue.trim()}
          onclick={handleSubmit}
          title="⇧Enter"
        >Add to Backlog <kbd class="kbd kbd-xs ml-1 opacity-50">⇧↵</kbd></button>
        <button
          class="btn btn-primary btn-sm"
          type="button"
          disabled={!textValue.trim()}
          onclick={handleStart}
          title="⌘Enter"
        >Start Task <kbd class="kbd kbd-xs ml-1 opacity-50">⌘↵</kbd></button>
      {:else}
        <span class="text-xs text-base-content/40">⌘Enter to submit</span>
        <button
          class="btn btn-primary btn-sm"
          type="button"
          disabled={!textValue.trim()}
          onclick={handleSubmit}
        >Submit</button>
      {/if}
    </div>
  </div>

  {#if onStartTask && actions.length > 0}
    <div class="flex items-center justify-end px-3 pb-2 gap-2">
      {#each actions as action (action.id)}
        <HoverTooltip text={action.prompt}>
          <button
            class="btn btn-ghost btn-sm"
            type="button"
            disabled={!textValue.trim()}
            onclick={() => handleCustomAction(action.prompt)}
          >{action.name}</button>
        </HoverTooltip>
      {/each}
    </div>
  {/if}

  {#if showModelDownload}
    <div class="px-3 pb-2">
      <ModelDownloadProgress
        onComplete={() => { showModelDownload = false }}
        onError={() => { showModelDownload = false }}
      />
    </div>
  {/if}
</div>
