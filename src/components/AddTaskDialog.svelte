<script lang="ts">
  import { tick, onMount } from 'svelte'
  import type { Task, KanbanColumn, PermissionMode } from '../lib/types'
  import { createTask, updateTask, getConfig, getAgents } from '../lib/ipc'
  import { activeProjectId } from '../lib/stores'
  import Modal from './Modal.svelte'

  interface Props {
    mode?: 'create' | 'edit'
    task?: Task | null
    onClose?: () => void
    onTaskSaved?: (task?: Task) => void
  }

  let { mode = 'create', task = null, onClose, onTaskSaved }: Props = $props()

  let title = $state('')
  let jiraKey = $state('')
  let status = $state<KanbanColumn>('backlog')
  let isSubmitting = $state(false)
  let titleInputEl = $state<HTMLInputElement | null>(null)
  let selectedAgent = $state('')
  let selectedPermissionMode = $state<PermissionMode>('default')
  let aiProvider = $state<string | null>(null)
  let availableAgents = $state<string[]>([])

  // Focus the title input after Modal's own focus effect has run
  $effect(() => {
    if (titleInputEl) {
      tick().then(() => titleInputEl?.focus())
    }
  })

  onMount(async () => {
    const provider = await getConfig('ai_provider')
    aiProvider = provider ?? 'claude-code'
    if (aiProvider !== 'claude-code') {
      const agents = await getAgents()
      availableAgents = agents.map(a => a.name)
    }
  })

  // Initialize form values from props
  $effect(() => {
    title = mode === 'edit' && task ? task.title : ''
    jiraKey = mode === 'edit' && task ? (task.jira_key || '') : ''
    status = mode === 'edit' && task ? (task.status as KanbanColumn) : 'backlog'
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
          $activeProjectId,
          selectedAgent || null,
          selectedPermissionMode
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
</script>

<Modal onClose={close} maxWidth="500px">
  {#snippet header()}
    <h2 class="text-[0.95rem] font-semibold text-base-content m-0">{mode === 'create' ? 'Create Task' : 'Edit Task'}</h2>
  {/snippet}

  <form onsubmit={(e: SubmitEvent) => { e.preventDefault(); handleSubmit() }}>
    <div class="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
      <label class="flex flex-col gap-1.5">
        <span class="text-xs text-base-content/60 font-medium">Prompt <span class="text-error">*</span></span>
        <input
          type="text"
          class="input input-bordered input-sm w-full"
          bind:this={titleInputEl}
          bind:value={title}
          placeholder="Describe what you want the agent to do"
          required
        />
      </label>

      <label class="flex flex-col gap-1.5">
        <span class="text-xs text-base-content/60 font-medium">JIRA Key</span>
        <input
          type="text"
          class="input input-bordered input-sm w-full"
          bind:value={jiraKey}
          placeholder="e.g. PROJ-123"
        />
      </label>

      {#if mode === 'create'}
        {#if aiProvider === 'claude-code'}
          <label class="flex flex-col gap-1.5">
            <span class="text-xs text-base-content/60 font-medium">Permission Mode</span>
            <select
              class="select select-bordered select-sm w-full"
              bind:value={selectedPermissionMode}
            >
              <option value="default">Default</option>
              <option value="acceptEdits">Accept Edits</option>
              <option value="plan">Plan</option>
              <option value="bypassPermissions">Bypass Permissions</option>
              <option value="dontAsk" class="text-error">Don't Ask (dangerous)</option>
            </select>
          </label>
        {:else if aiProvider !== null}
          <label class="flex flex-col gap-1.5">
            <span class="text-xs text-base-content/60 font-medium">Agent</span>
            <select
              class="select select-bordered select-sm w-full"
              bind:value={selectedAgent}
            >
              <option value="">Default</option>
              {#each availableAgents as agent}
                <option value={agent}>{agent}</option>
              {/each}
            </select>
          </label>
        {/if}
      {/if}
    </div>

    <div class="flex gap-2.5 px-5 py-4 border-t border-base-300 justify-end">
      <button class="btn btn-ghost btn-sm" onclick={close} type="button" disabled={isSubmitting}>
        Cancel
      </button>
      <button
        class="btn btn-primary btn-sm"
        type="submit"
        disabled={!title.trim() || isSubmitting}
      >
        {isSubmitting ? 'Saving...' : mode === 'create' ? 'Create Task' : 'Save Changes'}
      </button>
    </div>
  </form>
</Modal>
