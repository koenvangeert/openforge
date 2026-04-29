<script lang="ts">
  import { onMount } from 'svelte'
  import type { Task, PermissionMode, Action } from '../lib/types'
  import { createTask, updateTask, getProjectConfig, listOpenCodeAgents } from '../lib/ipc'
  import { getTaskPromptText } from '../lib/taskPrompt'
  import { activeProjectId } from '../lib/stores'
  import Modal from './shared/ui/Modal.svelte'
  import PromptInput from './prompt/PromptInput.svelte'
  import SearchableSelect from './shared/ui/SearchableSelect.svelte'
  import { shouldLoadTaskDialogAgents, shouldShowTaskDialogAgentSelector } from '../lib/taskDialogVisibility'
  import { getEnabledActions, loadActions } from '../lib/actions'

  interface Props {
    mode?: 'create' | 'edit'
    task?: Task | null
    onClose?: () => void
    onTaskSaved?: (task?: Task) => void | Promise<void>
    onRunAction?: (taskId: string, actionPrompt: string, agent: string | null) => Promise<void>
  }

  let { mode = 'create', task = null, onClose, onTaskSaved, onRunAction }: Props = $props()

  let selectedPermissionMode = $state<PermissionMode>('default')
  let selectedAgent = $state('')
  let aiProvider = $state<string | null>(null)
  let availableAgents = $state<string[]>([])
  let availableActions = $state<Action[]>([])
  let error = $state<string | null>(null)

  onMount(async () => {
    selectedAgent = ''
    selectedPermissionMode = 'default'
    try {
      if ($activeProjectId) {
        const provider = await getProjectConfig($activeProjectId, 'ai_provider')
        aiProvider = provider ?? 'claude-code'

        if (shouldLoadTaskDialogAgents(aiProvider)) {
          const agents = await listOpenCodeAgents($activeProjectId)
          availableAgents = agents.filter(a => !a.hidden).map(a => a.name)
        } else {
          availableAgents = []
        }

        const allActions = await loadActions($activeProjectId)
        availableActions = getEnabledActions(allActions)
      } else {
        aiProvider = 'claude-code'
        availableAgents = []
        availableActions = []
      }
    } catch {
      aiProvider = null
      availableAgents = []
      availableActions = []
    }
  })

  async function handleCreateOrUpdate(prompt: string, actionPrompt: string | null = null, autoStart: boolean = false) {
    if (!$activeProjectId) return
    error = null

    try {
      let savedTask: Task
      const agent = selectedAgent || null

      if (mode === 'edit' && task) {
        await updateTask(task.id, prompt)
        savedTask = task
        await onTaskSaved?.()
      } else {
        savedTask = await createTask(
          prompt,
          'backlog',
          $activeProjectId,
          agent,
          selectedPermissionMode
        )

        if (autoStart && onRunAction) {
          onClose?.()
          await onRunAction(savedTask.id, actionPrompt || '', agent)
          return
        } else {
          await onTaskSaved?.(savedTask)
        }
      }
      onClose?.()
    } catch (e) {
      console.error('Failed to save task:', e)
      error = String(e)
    }
  }
</script>

<Modal onClose={onClose} maxWidth="640px" overflowVisible initialFocus="textarea">
  {#snippet header()}
    <h2 class="text-[0.95rem] font-semibold text-base-content m-0">{mode === 'create' ? 'Create Task' : 'Edit Task'}</h2>
  {/snippet}

  <div class="p-4 overflow-visible">
    {#if error}
      <div class="text-error text-sm mb-4">{error}</div>
    {/if}
    <PromptInput
      projectId={$activeProjectId || ''}
      value={mode === 'edit' && task ? getTaskPromptText(task) : ''}
      autofocus={false}
      actions={mode === 'edit' ? [] : availableActions}
      onSubmit={(prompt) => handleCreateOrUpdate(prompt)}
      onStartTask={mode === 'edit' ? undefined : (prompt) => handleCreateOrUpdate(prompt, '', true)}
      onRunAction={mode === 'edit' ? undefined : (prompt, actionPrompt) => handleCreateOrUpdate(prompt, actionPrompt, true)}
      onCancel={() => onClose?.()}
    >
      {#snippet extras()}
        {#if mode === 'create' && aiProvider === 'claude-code'}
          <div class="flex items-center gap-2">
            <span class="text-xs text-base-content/50 font-medium shrink-0">Mode</span>
            <select
              class="select select-bordered select-xs flex-1"
              bind:value={selectedPermissionMode}
            >
              <option value="default">Default</option>
              <option value="acceptEdits">Accept Edits</option>
              <option value="plan">Plan</option>
              <option value="bypassPermissions">Bypass Permissions</option>
              <option value="dontAsk">Don't Ask (dangerous)</option>
            </select>
          </div>
        {/if}
        {#if shouldShowTaskDialogAgentSelector({ isEditing: mode === 'edit', aiProvider, availableAgents })}
          <div class="flex items-center gap-2">
            <span class="text-xs text-base-content/50 font-medium shrink-0">Agent</span>
            <div class="flex-1">
              <SearchableSelect
                options={[{ value: '', label: 'Default' }, ...availableAgents.map(a => ({ value: a, label: a }))]}
                value={selectedAgent}
                placeholder="Search agents..."
                size="xs"
                onSelect={(v) => { selectedAgent = v }}
              />
            </div>
          </div>
        {/if}
      {/snippet}
    </PromptInput>
  </div>
</Modal>
