<script lang="ts">
  import type { Task } from '../lib/types'
  import { openUrl } from '../lib/ipc'
  import { sanitizeHtml } from '../lib/sanitize'
  import Modal from './Modal.svelte'

  interface Props {
    task: Task
    jiraBaseUrl: string
    onClose: () => void
  }

  let { task, jiraBaseUrl, onClose }: Props = $props()
  let contentEl: HTMLDivElement | undefined = $state()

  $effect(() => {
    const _desc = task.jira_description
    if (!contentEl || !_desc) return

    const images = contentEl.querySelectorAll('img')
    for (const img of images) {
      img.onerror = () => { img.style.display = 'none' }
      if (img.complete && img.naturalHeight === 0) {
        img.style.display = 'none'
      }
    }
  })
</script>

<Modal onClose={onClose} maxWidth="900px">
  {#snippet header()}
    <div class="flex flex-col gap-0.5 min-w-0">
      <div class="flex items-center gap-3">
        <h2 class="text-[0.95rem] font-semibold text-base-content m-0">{task.jira_key}</h2>
        {#if jiraBaseUrl}
          <button
            class="btn btn-link btn-xs p-0 h-auto min-h-0 text-primary no-underline hover:underline text-[0.7rem]"
            onclick={() => openUrl(`${jiraBaseUrl}/browse/${task.jira_key}`)}
          >
            Open in Jira ↗
          </button>
        {/if}
      </div>
      {#if task.jira_title}
        <span class="text-sm text-base-content/60 truncate">{task.jira_title}</span>
      {/if}
    </div>
  {/snippet}

  <div class="flex-1 overflow-y-auto p-5">
    {#if task.jira_description}
      <div class="jira-content text-sm text-base-content leading-relaxed break-words" bind:this={contentEl}>
        {@html sanitizeHtml(task.jira_description)}
      </div>
    {:else}
      <div class="text-sm text-base-content/50 italic">No description available from Jira</div>
    {/if}
  </div>
</Modal>
