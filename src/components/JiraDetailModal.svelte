<script lang="ts">
  import type { Task } from '../lib/types'
  import { openUrl } from '../lib/ipc'

  interface Props {
    task: Task
    jiraBaseUrl: string
    onClose: () => void
  }

  let { task, jiraBaseUrl, onClose }: Props = $props()

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
    }
  }

  function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }
</script>

<div class="modal modal-open" onclick={handleOverlayClick} onkeydown={handleKeydown} role="dialog" aria-modal="true" tabindex="-1">
  <div class="modal-box bg-base-100 shadow-xl max-w-[700px] p-0 flex flex-col max-h-[90vh]">
    <div class="flex items-center justify-between px-5 py-4 border-b border-base-300">
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
      <button class="btn btn-ghost btn-xs" onclick={onClose} type="button">✕</button>
    </div>

    <div class="flex-1 overflow-y-auto p-5">
      {#if task.jira_description}
        <div class="jira-content text-sm text-base-content leading-relaxed break-words">
          {@html task.jira_description}
        </div>
      {:else}
        <div class="text-sm text-base-content/50 italic">No description available from Jira</div>
      {/if}
    </div>
  </div>
</div>

<style>
  .jira-content :global(h1) { font-size: 1.25rem; font-weight: 700; margin: 0.75rem 0 0.25rem; }
  .jira-content :global(h2) { font-size: 1.1rem; font-weight: 600; margin: 0.5rem 0 0.25rem; }
  .jira-content :global(h3) { font-size: 1rem; font-weight: 600; margin: 0.5rem 0 0.25rem; }
  .jira-content :global(p) { margin: 0.25rem 0; line-height: 1.5; }
  .jira-content :global(ul), .jira-content :global(ol) { padding-left: 1.5rem; margin: 0.25rem 0; }
  .jira-content :global(li) { margin: 0.1rem 0; }
  .jira-content :global(a) { color: oklch(var(--color-primary)); text-decoration: underline; }
  .jira-content :global(code) { background: oklch(var(--color-base-200)); padding: 0.1rem 0.3rem; border-radius: 0.25rem; font-size: 0.85em; }
  .jira-content :global(pre) { background: oklch(var(--color-base-200)); padding: 0.75rem; border-radius: 0.5rem; overflow-x: auto; margin: 0.5rem 0; }
  .jira-content :global(table) { border-collapse: collapse; width: 100%; margin: 0.5rem 0; }
  .jira-content :global(th), .jira-content :global(td) { border: 1px solid oklch(var(--color-base-300)); padding: 0.4rem 0.6rem; text-align: left; }
  .jira-content :global(blockquote) { border-left: 3px solid oklch(var(--color-base-300)); padding-left: 0.75rem; margin: 0.5rem 0; color: oklch(var(--color-base-content) / 0.7); }
  .jira-content :global(img) { max-width: 100%; height: auto; border-radius: 0.25rem; }
</style>
