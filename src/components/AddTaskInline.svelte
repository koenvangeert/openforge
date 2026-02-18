<script lang="ts">
  import type { KanbanColumn } from '../lib/types'
  import { createTask } from '../lib/ipc'
  import { activeProjectId } from '../lib/stores'
  import { createEventDispatcher } from 'svelte'

  export let column: KanbanColumn

  const dispatch = createEventDispatcher()

  let expanded = false
  let title = ''
  let loading = false
  let inputElement: HTMLInputElement

  function expand() {
    expanded = true
    // Focus input on next tick after DOM update
    setTimeout(() => {
      inputElement?.focus()
    }, 0)
  }

  function collapse() {
    expanded = false
    title = ''
  }

  async function handleSubmit() {
    const trimmedTitle = title.trim()
    if (!trimmedTitle || loading) return

    loading = true
    try {
      await createTask(trimmedTitle, column, null, $activeProjectId)
      dispatch('task-created')
      collapse()
    } catch (error) {
      console.error('Failed to create task:', error)
      // Keep expanded so user can retry
      loading = false
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault()
      handleSubmit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      collapse()
    }
  }

  function handleBlur() {
    // Only submit on blur if there's content
    if (title.trim()) {
      handleSubmit()
    } else {
      collapse()
    }
  }
</script>

{#if expanded}
  <div class="add-inline expanded">
    <input
      bind:this={inputElement}
      bind:value={title}
      type="text"
      placeholder="Task title..."
      class="task-input"
      disabled={loading}
      on:keydown={handleKeydown}
      on:blur={handleBlur}
    />
  </div>
{:else}
  <button class="add-inline collapsed" on:click={expand} title="Add task">
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M6 1V11M1 6H11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>
  </button>
{/if}

<style>
  .add-inline {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .add-inline.collapsed {
    all: unset;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    cursor: pointer;
    color: var(--text-secondary);
    background: transparent;
    border: 1px solid transparent;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }

  .add-inline.collapsed:hover {
    color: var(--accent);
    background: var(--bg-card);
    border-color: var(--border);
  }

  .add-inline.collapsed:active {
    transform: scale(0.95);
  }

  .add-inline.expanded {
    width: 100%;
    margin-left: 8px;
  }

  .task-input {
    all: unset;
    display: block;
    width: 100%;
    box-sizing: border-box;
    padding: 4px 8px;
    font-size: 0.75rem;
    color: var(--text-primary);
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 4px;
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  .task-input::placeholder {
    color: var(--text-secondary);
    opacity: 0.6;
  }

  .task-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgba(125, 207, 255, 0.1);
    outline: none;
  }

  .task-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
