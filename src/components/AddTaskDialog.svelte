<script lang="ts">
  import type { Task, KanbanColumn } from '../lib/types'
  import { COLUMNS, COLUMN_LABELS } from '../lib/types'
  import { createTask, updateTask } from '../lib/ipc'
  import { activeProjectId } from '../lib/stores'

  interface Props {
    mode?: 'create' | 'edit'
    task?: Task | null
    onClose?: () => void
    onTaskSaved?: (task?: Task) => void
  }

  let { mode = 'create', task = null, onClose, onTaskSaved }: Props = $props()

  let title = $state('')
  let jiraKey = $state('')
  let status = $state<KanbanColumn>('todo')
  let isSubmitting = $state(false)

  // Initialize form values from props
  $effect(() => {
    title = mode === 'edit' && task ? task.title : ''
    jiraKey = mode === 'edit' && task ? (task.jira_key || '') : ''
    status = mode === 'edit' && task ? (task.status as KanbanColumn) : 'todo'
  })

  async function handleSubmit() {
    if (!title.trim()) return
    
    isSubmitting = true
    try {
      if (mode === 'create') {
        const newTask = await createTask(
          title.trim(),
          status,
          jiraKey.trim() || null,
          $activeProjectId
        )
        onTaskSaved?.(newTask)
      } else if (task) {
        await updateTask(
          task.id,
          title.trim(),
          jiraKey.trim() || null
        )
        onTaskSaved?.()
      }
      close()
    } catch (e) {
      console.error('Failed to save task:', e)
    } finally {
      isSubmitting = false
    }
  }

  function close() {
    onClose?.()
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      close()
    }
  }

  function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      close()
    }
  }
</script>

<div class="overlay" onclick={handleOverlayClick} onkeydown={handleKeydown} role="dialog" aria-modal="true" tabindex="-1">
  <div class="dialog">
    <div class="dialog-header">
      <h2>{mode === 'create' ? 'Create Task' : 'Edit Task'}</h2>
      <button class="close-btn" onclick={close} type="button">X</button>
    </div>

    <form class="dialog-body" onsubmit={(e: SubmitEvent) => { e.preventDefault(); handleSubmit() }}>
      <label class="field">
        <span>Title <span class="required">*</span></span>
        <input
          type="text"
          bind:value={title}
          placeholder="Enter task title"
          required
          autofocus
        />
      </label>

      <label class="field">
        <span>JIRA Key</span>
        <input
          type="text"
          bind:value={jiraKey}
          placeholder="e.g. PROJ-123"
        />
      </label>

      {#if mode === 'create'}
        <label class="field">
          <span>Status</span>
          <select bind:value={status}>
            {#each COLUMNS as col}
              <option value={col}>{COLUMN_LABELS[col]}</option>
            {/each}
          </select>
        </label>
      {/if}
    </form>

    <div class="dialog-footer">
      <button class="btn btn-cancel" onclick={close} type="button" disabled={isSubmitting}>
        Cancel
      </button>
      <button
        class="btn btn-submit"
        onclick={handleSubmit}
        type="button"
        disabled={!title.trim() || isSubmitting}
      >
        {isSubmitting ? 'Saving...' : mode === 'create' ? 'Create Task' : 'Save Changes'}
      </button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(2px);
  }

  .dialog {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    width: 90%;
    max-width: 500px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }

  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
  }

  .dialog-header h2 {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .close-btn {
    all: unset;
    cursor: pointer;
    color: var(--text-secondary);
    font-size: 0.8rem;
    padding: 4px 8px;
    border-radius: 4px;
  }

  .close-btn:hover {
    background: var(--bg-card);
    color: var(--text-primary);
  }

  .dialog-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .field > span {
    font-size: 0.7rem;
    color: var(--text-secondary);
    font-weight: 500;
  }

  .required {
    color: var(--error);
  }

  .field input,
  .field select {
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 8px 10px;
    color: var(--text-primary);
    font-size: 0.8rem;
    outline: none;
    font-family: inherit;
  }

  .field input:focus,
  .field select:focus {
    border-color: var(--accent);
  }

  .field select {
    cursor: pointer;
  }

  .dialog-footer {
    display: flex;
    gap: 10px;
    padding: 16px 20px;
    border-top: 1px solid var(--border);
    justify-content: flex-end;
  }

  .btn {
    padding: 8px 16px;
    border: none;
    border-radius: 4px;
    font-size: 0.8rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-cancel {
    background: var(--bg-card);
    color: var(--text-primary);
    border: 1px solid var(--border);
  }

  .btn-cancel:not(:disabled):hover {
    background: var(--bg-primary);
  }

  .btn-submit {
    background: var(--accent);
    color: var(--bg-primary);
  }

  .btn-submit:not(:disabled):hover {
    filter: brightness(1.1);
  }
</style>
