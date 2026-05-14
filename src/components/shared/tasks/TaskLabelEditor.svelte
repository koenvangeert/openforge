<script lang="ts">
  import { getProjectTaskLabels } from '../../../lib/ipc'
  import type { TaskLabel } from '../../../lib/types'
  import { hasLabelNamed, makeTemporaryTaskLabel, normalizeTaskLabelNameInput, validateTaskLabelName } from '../../../lib/taskLabels'

  interface Props {
    projectId: string | null
    selectedLabels: TaskLabel[]
    onAdd: (label: TaskLabel | string) => void | Promise<void>
    onRemove: (label: TaskLabel) => void | Promise<void>
  }

  let { projectId, selectedLabels, onAdd, onRemove }: Props = $props()

  let availableLabels = $state<TaskLabel[]>([])
  let labelInput = $state('')
  let error = $state<string | null>(null)
  let labelLoadRequest = 0

  let unselectedLabels = $derived(
    availableLabels.filter((label) => !hasLabelNamed(selectedLabels, label.name))
  )

  $effect(() => {
    const currentProjectId = projectId
    if (!currentProjectId) {
      availableLabels = []
      return
    }

    const requestId = ++labelLoadRequest
    getProjectTaskLabels(currentProjectId)
      .then((labels) => {
        if (requestId === labelLoadRequest) availableLabels = labels
      })
      .catch(() => {
        if (requestId === labelLoadRequest) availableLabels = []
      })
  })

  async function submitLabel() {
    if (!projectId) return
    const name = normalizeTaskLabelNameInput(labelInput)
    const validationError = validateTaskLabelName(name)
    if (validationError) {
      error = validationError
      return
    }
    if (hasLabelNamed(selectedLabels, name)) {
      labelInput = ''
      error = null
      return
    }

    const existing = availableLabels.find((label) => label.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())
    await onAdd(existing ?? makeTemporaryTaskLabel(name, projectId))
    labelInput = ''
    error = null
  }

  async function handleRemove(label: TaskLabel) {
    await onRemove(label)
  }
</script>

<section class="flex flex-col gap-2.5" aria-label="Labels">
  <h3 class="text-[10px] font-bold text-primary font-mono tracking-[1.2px] m-0">// LABELS</h3>

  <div class="flex flex-wrap gap-1.5">
    {#each selectedLabels as label (label.id)}
      <button
        type="button"
        class="badge badge-sm badge-outline gap-1"
        aria-label="Remove label {label.name}"
        onclick={() => handleRemove(label)}
      >
        {label.name}<span aria-hidden="true">×</span>
      </button>
    {:else}
      <span class="text-xs text-base-content/50">No labels</span>
    {/each}
  </div>

  <div class="flex items-center gap-2">
    <input
      class="input input-bordered input-xs flex-1"
      aria-label="Add label"
      placeholder="Add label"
      bind:value={labelInput}
      disabled={!projectId}
      onkeydown={(event: KeyboardEvent) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          void submitLabel()
        }
      }}
    />
    <button type="button" class="btn btn-xs" disabled={!projectId || !labelInput.trim()} onclick={() => submitLabel()}>Add</button>
  </div>

  {#if error}
    <div class="text-xs text-error">{error}</div>
  {/if}

  {#if unselectedLabels.length > 0}
    <div class="flex flex-wrap gap-1.5" aria-label="Available labels">
      {#each unselectedLabels as label (label.id)}
        <button type="button" class="badge badge-sm badge-ghost" aria-label="Add label {label.name}" onclick={() => onAdd(label)}>{label.name}</button>
      {/each}
    </div>
  {/if}
</section>
