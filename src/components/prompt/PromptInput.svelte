<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { AutocompleteItem, Action } from '../../lib/types'
  import AutocompletePopover from './AutocompletePopover.svelte'
  import VoiceInput from '../shared/input/VoiceInput.svelte'
  import ModelDownloadProgress from '../shared/input/ModelDownloadProgress.svelte'
  import ActionDropdown from '../shared/ui/ActionDropdown.svelte'
  import { useAutocomplete } from '../../lib/useAutocomplete.svelte'
  import { getProjectConfig } from '../../lib/ipc'
  import { useListNavigation } from '../../lib/useListNavigation.svelte'
  import { onMount } from 'svelte'

  interface Props {
    value?: string
    placeholder?: string
    projectId: string
    onSubmit: (prompt: string) => void
    onStartTask?: (prompt: string) => void
    onRunAction?: (prompt: string, actionPrompt: string) => void
    onCancel: () => void
    autofocus?: boolean
    extras?: Snippet
    actions?: Action[]
  }

  let {
    value = '',
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

  const getInitialTextValue = () => value
  const getAutocompleteProjectId = () => projectId

  // ── Local state ──────────────────────────────────────────────────────────────
  let textValue = $state(getInitialTextValue())
  let showModelDownload = $state(false)

  let textareaEl = $state<HTMLTextAreaElement | null>(null)

  // ── Autocomplete composable ───────────────────────────────────────────────────
  const ac = useAutocomplete(getAutocompleteProjectId())

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
  const listNav = useListNavigation({
    get itemCount() { return ac.autocompleteItems.length },
    get selectedIndex() { return ac.selectedIndex },
    set selectedIndex(index: number) { ac.setSelectedIndex(index) },
    wrap: false,
    onSelect() {
      const item = ac.autocompleteItems[ac.selectedIndex]
      if (item) handleSelect(item)
    },
    onCancel() { ac.closePopover() }
  })

  function handleKeydown(e: KeyboardEvent) {
    if (ac.popoverVisible) {
      const handled = listNav.handleKeydown(e)
      if (handled) return
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
    onSubmit(prompt)
  }

  function handleStart() {
    const prompt = textValue.trim()
    if (!prompt) return
    onStartTask?.(prompt)
  }

  function handleCustomAction(actionPrompt: string) {
    const prompt = textValue.trim()
    if (!prompt) return
    onRunAction?.(prompt, actionPrompt)
  }

  function handleActionFromDropdown(action: Action) {
    handleCustomAction(action.prompt)
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
    </div>
    <div class="flex items-center gap-2">
      {#if onStartTask}
        <button
          class="btn btn-ghost btn-sm"
          type="button"
          disabled={!textValue.trim()}
          onclick={handleSubmit}
          title="⇧Enter"
        >Add to Backlog <kbd class="kbd kbd-xs ml-1 bg-base-content/5 text-base-content/50 border-base-content/10">⇧↵</kbd></button>
        <button
          class="btn btn-primary btn-sm"
          type="button"
          disabled={!textValue.trim()}
          onclick={handleStart}
          title="⌘Enter"
        >Start Task <kbd class="kbd kbd-xs ml-1 bg-primary-content text-primary border-primary-content/30">⌘↵</kbd></button>
      {:else}
        <span class="text-xs text-base-content opacity-70">⌘Enter to submit</span>
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
    <div class="flex items-center justify-end px-3 pb-2">
      <ActionDropdown {actions} disabled={!textValue.trim()} onAction={handleActionFromDropdown} />
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
