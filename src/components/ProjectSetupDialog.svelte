<script lang="ts">
  import { onMount, tick } from 'svelte'
  import type { Project } from '../lib/types'
  import { createProject, setProjectConfig } from '../lib/ipc'
  import Modal from './Modal.svelte'

  interface Props {
    onClose?: () => void
    onProjectCreated?: (project: Project) => void
  }

  let { onClose, onProjectCreated }: Props = $props()

  let projectName = $state('')
  let path = $state('')
  let githubDefaultRepo = $state('')
  let isSubmitting = $state(false)
  let showGithubSection = $state(false)
  let projectNameInput = $state<HTMLInputElement | null>(null)

  onMount(async () => {
    await tick()
    projectNameInput?.focus()
  })

  async function handleSubmit() {
    if (!projectName.trim() || !path.trim()) return

    isSubmitting = true
    try {
      const project = await createProject(projectName.trim(), path.trim())

      // Set GitHub config if provided
      if (githubDefaultRepo.trim()) {
        await setProjectConfig(project.id, 'github_default_repo', githubDefaultRepo.trim())
      }

      onProjectCreated?.(project)
      close()
    } catch (e) {
      console.error('Failed to create project:', e)
    } finally {
      isSubmitting = false
    }
  }

  function close() {
    onClose?.()
  }
</script>

<Modal onClose={close} maxWidth="550px">
  {#snippet header()}
    <h2 class="text-[0.95rem] font-semibold text-base-content m-0">New Project</h2>
  {/snippet}

  <form class="flex-1 overflow-y-auto p-5 flex flex-col gap-4" onsubmit={(e: SubmitEvent) => { e.preventDefault(); handleSubmit() }}>
    <label class="flex flex-col gap-1.5">
      <span class="text-xs text-base-content/60 font-medium">Project Name <span class="text-error">*</span></span>
      <input
        bind:this={projectNameInput}
        type="text"
        class="input input-bordered input-sm w-full"
        bind:value={projectName}
        placeholder="My Awesome Project"
        required
      />
    </label>

    <label class="flex flex-col gap-1.5">
      <span class="text-xs text-base-content/60 font-medium">Local Repository Path <span class="text-error">*</span></span>
      <input
        type="text"
        class="input input-bordered input-sm w-full"
        bind:value={path}
        placeholder="/Users/you/workspace/my-project"
        required
      />
      <span class="text-[0.65rem] text-base-content/40">Absolute path to the git repository on your machine</span>
    </label>

    <div class="divider my-2"></div>

    <div class="my-1">
      <button
        class="btn btn-ghost btn-xs gap-2 text-base-content/60 font-semibold"
        onclick={() => showGithubSection = !showGithubSection}
        type="button"
      >
        <span class="text-[0.6rem] transition-transform duration-200 {showGithubSection ? 'rotate-90' : ''}">▶</span>
        <span>GitHub Configuration (Optional)</span>
      </button>
    </div>

    {#if showGithubSection}
      <div class="flex flex-col gap-3.5 pl-4 mt-2">
        <label class="flex flex-col gap-1.5">
          <span class="text-xs text-base-content/60 font-medium">Default GitHub Repository</span>
          <input
            type="text"
            class="input input-bordered input-sm w-full"
            bind:value={githubDefaultRepo}
            placeholder="owner/repo-name"
          />
          <span class="text-[0.65rem] text-base-content/40">GitHub remote repository for PRs and reviews (e.g. collibra/openforge)</span>
        </label>
      </div>
    {/if}
  </form>

  <div class="flex gap-2.5 px-5 py-4 border-t border-base-300 justify-end">
    <button class="btn btn-ghost btn-sm" onclick={close} type="button" disabled={isSubmitting}>Cancel</button>
    <button
      class="btn btn-primary btn-sm"
      onclick={handleSubmit}
      type="button"
      disabled={!projectName.trim() || !path.trim() || isSubmitting}
    >
      {isSubmitting ? 'Creating...' : 'Create Project'}
    </button>
  </div>
</Modal>
