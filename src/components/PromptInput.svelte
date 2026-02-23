<script lang="ts">
  import { listOpenCodeAgents, listOpenCodeCommands, searchOpenCodeFiles } from '../lib/ipc'
  import type { AutocompleteAgentInfo, CommandInfo } from '../lib/types'
  import AutocompletePopover from './AutocompletePopover.svelte'
  import type { AutocompleteItem } from './AutocompletePopover.svelte'
  import VoiceInput from './VoiceInput.svelte'
  import ModelDownloadProgress from './ModelDownloadProgress.svelte'

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

  let autocompleteItems = $state<AutocompleteItem[]>([])
  let popoverVisible = $state(false)
  let selectedIndex = $state(0)

  let cachedAgents = $state<AutocompleteAgentInfo[] | null>(null)
  let cachedCommands = $state<CommandInfo[] | null>(null)

  let textareaEl = $state<HTMLTextAreaElement | null>(null)

  type TriggerType = 'at' | 'slash' | null
  let activeTrigger = $state<TriggerType>(null)

  let fileSearchTimer: ReturnType<typeof setTimeout> | null = null

  // ── Auto-focus ───────────────────────────────────────────────────────────────
  $effect(() => {
    if (textareaEl && autofocus) {
      textareaEl.focus()
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

  // ── Trigger detection ────────────────────────────────────────────────────────
  function detectTrigger(text: string, cursorPos: number): { trigger: TriggerType; query: string } {
    // `/` trigger: ONLY when entire input is `/` + optional word (nothing else)
    if (/^\/(\S*)$/.test(text)) {
      const query = text.slice(1)
      // Cursor must be within the slash+word
      if (cursorPos <= text.length) {
        return { trigger: 'slash', query }
      }
    }

    // `@` trigger: after whitespace or at start of input, before cursor
    const textBeforeCursor = text.slice(0, cursorPos)
    const atMatch = textBeforeCursor.match(/(^|[\s\n])@(\S*)$/)
    if (atMatch) {
      return { trigger: 'at', query: atMatch[2] }
    }

    return { trigger: null, query: '' }
  }

  // ── Input handler ────────────────────────────────────────────────────────────
  async function handleInput() {
    autoGrow()
    if (!textareaEl) return

    const text = textareaEl.value
    const cursorPos = textareaEl.selectionStart ?? text.length

    const { trigger, query } = detectTrigger(text, cursorPos)
    activeTrigger = trigger

    if (trigger === 'slash') {
      await handleSlashTrigger(query)
    } else if (trigger === 'at') {
      await handleAtTrigger(query)
    } else {
      closePopover()
    }
  }

  // ── Slash trigger (/commands) ─────────────────────────────────────────────────
  async function handleSlashTrigger(query: string) {
    try {
      if (!cachedCommands) {
        cachedCommands = await listOpenCodeCommands(projectId)
      }

      const lower = query.toLowerCase()
      const filtered = cachedCommands.filter(cmd =>
        !query || cmd.name.toLowerCase().includes(lower)
      )

      autocompleteItems = filtered.map(cmd => ({
        label: cmd.name,
        description: cmd.description,
        type: (cmd.source === 'skill' ? 'skill' : 'command') as AutocompleteItem['type'],
        source: cmd.source
      }))

      popoverVisible = autocompleteItems.length > 0
      selectedIndex = 0
    } catch (e) {
      console.error('Failed to fetch commands:', e)
      closePopover()
    }
  }

  // ── At trigger (@files + @agents) ────────────────────────────────────────────
  async function handleAtTrigger(query: string) {
    // Fetch agents once, filter client-side
    try {
      if (!cachedAgents) {
        cachedAgents = await listOpenCodeAgents(projectId)
      }
    } catch (e) {
      console.error('Failed to fetch agents:', e)
      cachedAgents = []
    }

    const lower = query.toLowerCase()
    const agentItems: AutocompleteItem[] = (cachedAgents ?? [])
      .filter(a => !a.hidden && a.mode !== 'primary')
      .filter(a => !query || a.name.toLowerCase().includes(lower))
      .map(a => ({ label: a.name, description: null, type: 'agent' as const }))

    // Show agents immediately, then fetch files with debounce
    autocompleteItems = agentItems
    popoverVisible = agentItems.length > 0
    selectedIndex = 0

    if (fileSearchTimer) clearTimeout(fileSearchTimer)

    fileSearchTimer = setTimeout(async () => {
      try {
        const filePaths = query ? await searchOpenCodeFiles(projectId, query) : []
        const fileItems: AutocompleteItem[] = filePaths.map(path => ({
          label: path,
          description: null,
          type: (path.endsWith('/') ? 'directory' : 'file') as AutocompleteItem['type']
        }))

        // Re-filter agents in case value changed during debounce
        const lower2 = query.toLowerCase()
        const freshAgentItems: AutocompleteItem[] = (cachedAgents ?? [])
          .filter(a => !a.hidden && a.mode !== 'primary')
          .filter(a => !query || a.name.toLowerCase().includes(lower2))
          .map(a => ({ label: a.name, description: null, type: 'agent' as const }))

        autocompleteItems = [...freshAgentItems, ...fileItems]
        popoverVisible = autocompleteItems.length > 0
        if (selectedIndex >= autocompleteItems.length) selectedIndex = 0
      } catch (e) {
        console.error('Failed to search files:', e)
        // Keep agent-only results visible
        popoverVisible = agentItems.length > 0
      }
    }, 150)
  }

  // ── Popover close ─────────────────────────────────────────────────────────────
  function closePopover() {
    if (fileSearchTimer) {
      clearTimeout(fileSearchTimer)
      fileSearchTimer = null
    }
    popoverVisible = false
    autocompleteItems = []
    selectedIndex = 0
    activeTrigger = null
  }

  // ── Item selection ────────────────────────────────────────────────────────────
  function handleSelect(item: AutocompleteItem) {
    if (!textareaEl) return

    if (activeTrigger === 'slash') {
      // Replace entire input with /command + trailing space
      textValue = `/${item.label} `
    } else if (activeTrigger === 'at') {
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

    closePopover()
    // Let the DOM update, then auto-grow
    setTimeout(() => autoGrow(), 0)
    textareaEl.focus()
  }

  // ── Keyboard handler ──────────────────────────────────────────────────────────
  function handleKeydown(e: KeyboardEvent) {
    if (popoverVisible) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        selectedIndex = Math.min(selectedIndex + 1, autocompleteItems.length - 1)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        selectedIndex = Math.max(selectedIndex - 1, 0)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const item = autocompleteItems[selectedIndex]
        if (item) handleSelect(item)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        closePopover()
        return
      }
    }

    if (e.key === 'Enter' && e.shiftKey) {
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
      items={autocompleteItems}
      visible={popoverVisible}
      selectedIndex={selectedIndex}
      onSelect={handleSelect}
      onClose={closePopover}
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
          onkeydown={(e) => e.key === 'Enter' && (showJiraKey = false) && (jiraKeyValue = '')}
        >✕</span>
      {:else}
        <span
          class="text-xs text-primary cursor-pointer"
          role="button"
          tabindex="0"
          onclick={() => { showJiraKey = true }}
          onkeydown={(e) => { if (e.key === 'Enter') showJiraKey = true }}
        >+ Add JIRA key</span>
      {/if}
    </div>
    <span class="text-xs text-base-content/40">Shift+Enter to submit · Enter for newline</span>
  </div>

  {#if showModelDownload}
    <div class="px-3 pb-2">
      <ModelDownloadProgress
        onComplete={() => { showModelDownload = false }}
        onError={() => { showModelDownload = false }}
      />
    </div>
  {/if}
</div>
