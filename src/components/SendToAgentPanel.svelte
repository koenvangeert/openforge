<script lang="ts">
  import { pendingManualComments, selfReviewGeneralComments, selfReviewArchivedComments } from '../lib/stores'
  import { archiveSelfReviewComments, getActiveSelfReviewComments, getArchivedSelfReviewComments } from '../lib/ipc'
  import { compileReviewPrompt } from '../lib/reviewPrompt'
  import type { PrComment } from '../lib/types'

  interface Props {
    taskId: string
    taskTitle: string
    agentStatus: string | null
    onSendToAgent: (prompt: string) => void
    onRefresh: () => void
    selectedPrComments?: PrComment[]
    onSendComplete?: () => void
  }

  let { taskId, taskTitle, agentStatus, onSendToAgent, onRefresh, selectedPrComments = [], onSendComplete }: Props = $props()

  let isSending = $state(false)
  let error = $state<string | null>(null)
  let successMessage = $state<string | null>(null)

  let inlineCount = $derived($pendingManualComments.length)
  let generalCount = $derived($selfReviewGeneralComments.length)
  let prCommentCount = $derived(selectedPrComments.length)
  let hasComments = $derived(inlineCount > 0 || generalCount > 0 || prCommentCount > 0)
  let isAgentBusy = $derived(agentStatus === 'running' || agentStatus === 'paused')
  let canSend = $derived(hasComments && !isAgentBusy && !isSending)

  async function handleSendToAgent() {
    if (!canSend) return

    const inlineComments = $pendingManualComments.map(c => ({ path: c.path, line: c.line, body: c.body }))
    const generalComments = $selfReviewGeneralComments.map(c => ({ body: c.body }))
    const prReviewComments = selectedPrComments.map(c => ({
      body: c.body,
      author: c.author,
      file_path: c.file_path,
      line_number: c.line_number
    }))
    const prompt = compileReviewPrompt(taskTitle, inlineComments, generalComments, prReviewComments)

    isSending = true
    error = null
    successMessage = null

    try {
      // CRITICAL ORDER: archive → clear stores → reload → call callback
      await archiveSelfReviewComments(taskId)

      // Clear inline comments from store
      $pendingManualComments = []

      // Reload archived comments into store
      const archived = await getArchivedSelfReviewComments(taskId)
      selfReviewArchivedComments.set(archived)

      // Reload active comments (should be empty after archive)
      const active = await getActiveSelfReviewComments(taskId)
      selfReviewGeneralComments.set(active.filter(c => c.comment_type === 'general'))

      successMessage = 'Feedback sent to agent!'
      setTimeout(() => {
        successMessage = null
      }, 3000)

      onSendToAgent(prompt)
      onSendComplete?.()
    } catch (e) {
      console.error('Failed to send to agent:', e)
      error = String(e)
    } finally {
      isSending = false
    }
  }
</script>

{#if isAgentBusy}
  <div class="flex items-center gap-2 px-6 py-2 bg-warning/10 border-t border-warning/30 border-b border-b-warning/20 text-warning text-[0.78rem] font-medium">
    <span class="text-[0.9rem] shrink-0">⚡</span>
    <span>Agent is working — diff may be stale. Refresh when ready.</span>
  </div>
{/if}

<div class="flex items-center justify-between gap-4 px-6 py-3 bg-base-200 border-t border-base-300 min-h-14">
  <div class="flex items-center gap-2 flex-1 min-w-0">
    {#if hasComments}
      <div class="flex items-center gap-2 flex-wrap">
        {#if inlineCount > 0}
          <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[0.72rem] font-semibold whitespace-nowrap text-primary bg-primary/12 border border-primary/25">
            <span class="inline-block w-[5px] h-[5px] rounded-full bg-current shrink-0"></span>
            {inlineCount} inline {inlineCount === 1 ? 'comment' : 'comments'}
          </span>
        {/if}
        {#if generalCount > 0}
          <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[0.72rem] font-semibold whitespace-nowrap text-warning bg-warning/12 border border-warning/25">
            <span class="inline-block w-[5px] h-[5px] rounded-full bg-current shrink-0"></span>
            {generalCount} general {generalCount === 1 ? 'comment' : 'comments'}
          </span>
        {/if}
        {#if prCommentCount > 0}
          <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[0.72rem] font-semibold whitespace-nowrap text-error bg-error/12 border border-error/25">
            <span class="inline-block w-[5px] h-[5px] rounded-full bg-current shrink-0"></span>
            {prCommentCount} PR {prCommentCount === 1 ? 'comment' : 'comments'}
          </span>
        {/if}
      </div>
    {:else}
      <span class="text-sm text-base-content/50 italic">No feedback collected yet</span>
    {/if}
  </div>

  <div class="flex items-center gap-2.5 shrink-0">
    {#if error}
      <span class="inline-flex items-center gap-1.5 text-xs text-error max-w-[280px] overflow-hidden text-ellipsis whitespace-nowrap">
        <span>⚠</span>
        {error}
      </span>
    {/if}
    {#if successMessage}
      <span class="inline-flex items-center gap-1.5 text-xs text-success whitespace-nowrap">
        <span>✓</span>
        {successMessage}
      </span>
    {/if}

    <button
      class="btn btn-soft btn-sm shadow-sm hover:shadow-md transition-shadow"
      onclick={onRefresh}
      disabled={isSending}
      title="Refresh diff"
    >
      ↻ Refresh Diff
    </button>

    <button
      class="btn btn-primary btn-sm font-semibold tracking-wide shadow-sm hover:shadow-md transition-shadow"
      onclick={handleSendToAgent}
      disabled={!canSend}
      title={!hasComments ? 'Add comments before sending' : isAgentBusy ? 'Agent is currently running' : 'Send feedback to agent'}
    >
      {isSending ? 'Sending…' : '→ Send to Agent'}
    </button>
  </div>
</div>
