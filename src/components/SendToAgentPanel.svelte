<script lang="ts">
  import { pendingManualComments, selfReviewGeneralComments, selfReviewArchivedComments } from '../lib/stores'
  import { archiveSelfReviewComments, getActiveSelfReviewComments, getArchivedSelfReviewComments } from '../lib/ipc'
  import { compileReviewPrompt } from '../lib/reviewPrompt'

  interface Props {
    taskId: string
    taskTitle: string
    agentStatus: string | null
    onSendToAgent: (prompt: string) => void
    onRefresh: () => void
  }

  let { taskId, taskTitle, agentStatus, onSendToAgent, onRefresh }: Props = $props()

  let isSending = $state(false)
  let error = $state<string | null>(null)
  let successMessage = $state<string | null>(null)

  let inlineCount = $derived($pendingManualComments.length)
  let generalCount = $derived($selfReviewGeneralComments.length)
  let hasComments = $derived(inlineCount > 0 || generalCount > 0)
  let isAgentBusy = $derived(agentStatus === 'running' || agentStatus === 'paused')
  let canSend = $derived(hasComments && !isAgentBusy && !isSending)

  async function handleSendToAgent() {
    if (!canSend) return

    const inlineComments = $pendingManualComments.map(c => ({ path: c.path, line: c.line, body: c.body }))
    const generalComments = $selfReviewGeneralComments.map(c => ({ body: c.body }))
    const prompt = compileReviewPrompt(taskTitle, inlineComments, generalComments)

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
    } catch (e) {
      console.error('Failed to send to agent:', e)
      error = String(e)
    } finally {
      isSending = false
    }
  }
</script>

{#if isAgentBusy}
  <div class="agent-running-banner">
    <span class="banner-icon">⚡</span>
    <span>Agent is working — diff may be stale. Refresh when ready.</span>
  </div>
{/if}

<div class="send-to-agent-panel">
  <div class="panel-left">
    {#if hasComments}
      <div class="comment-summary">
        {#if inlineCount > 0}
          <span class="summary-chip inline-chip">
            <span class="chip-dot"></span>
            {inlineCount} inline {inlineCount === 1 ? 'comment' : 'comments'}
          </span>
        {/if}
        {#if generalCount > 0}
          <span class="summary-chip general-chip">
            <span class="chip-dot"></span>
            {generalCount} general {generalCount === 1 ? 'comment' : 'comments'}
          </span>
        {/if}
      </div>
    {:else}
      <span class="no-comments">No feedback collected yet</span>
    {/if}
  </div>

  <div class="panel-right">
    {#if error}
      <span class="error-inline">
        <span>⚠</span>
        {error}
      </span>
    {/if}
    {#if successMessage}
      <span class="success-inline">
        <span>✓</span>
        {successMessage}
      </span>
    {/if}

    <button
      class="action-btn refresh-btn"
      onclick={onRefresh}
      disabled={isSending}
      title="Refresh diff"
    >
      ↻ Refresh Diff
    </button>

    <button
      class="action-btn send-btn"
      onclick={handleSendToAgent}
      disabled={!canSend}
      title={!hasComments ? 'Add comments before sending' : isAgentBusy ? 'Agent is currently running' : 'Send feedback to agent'}
    >
      {isSending ? 'Sending…' : '→ Send to Agent'}
    </button>
  </div>
</div>

<style>
  .agent-running-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 24px;
    background: rgba(224, 175, 104, 0.1);
    border-top: 1px solid rgba(224, 175, 104, 0.3);
    border-bottom: 1px solid rgba(224, 175, 104, 0.2);
    color: var(--warning);
    font-size: 0.78rem;
    font-weight: 500;
  }

  .banner-icon {
    font-size: 0.9rem;
    flex-shrink: 0;
  }

  .send-to-agent-panel {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 24px;
    background: var(--bg-secondary);
    border-top: 1px solid var(--border);
    min-height: 56px;
  }

  .panel-left {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
  }

  .comment-summary {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .summary-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 12px;
    font-size: 0.72rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .inline-chip {
    color: var(--accent);
    background: rgba(122, 162, 247, 0.12);
    border: 1px solid rgba(122, 162, 247, 0.25);
  }

  .general-chip {
    color: var(--warning);
    background: rgba(224, 175, 104, 0.12);
    border: 1px solid rgba(224, 175, 104, 0.25);
  }

  .chip-dot {
    display: inline-block;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: currentColor;
    flex-shrink: 0;
  }

  .no-comments {
    font-size: 0.8rem;
    color: var(--text-secondary);
    font-style: italic;
  }

  .panel-right {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }

  .error-inline {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.75rem;
    color: var(--error);
    max-width: 280px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .success-inline {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.75rem;
    color: var(--success);
    white-space: nowrap;
  }

  .action-btn {
    all: unset;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
    font-size: 0.8rem;
    font-weight: 500;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s;
    border: 1px solid;
    white-space: nowrap;
  }

  .action-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .refresh-btn {
    color: var(--text-secondary);
    background: transparent;
    border-color: var(--border);
  }

  .refresh-btn:hover:not(:disabled) {
    color: var(--text-primary);
    border-color: var(--text-secondary);
    background: rgba(255, 255, 255, 0.04);
  }

  .send-btn {
    color: var(--bg-primary);
    background: var(--accent);
    border-color: var(--accent);
    font-weight: 600;
    letter-spacing: 0.01em;
  }

  .send-btn:hover:not(:disabled) {
    opacity: 0.88;
    box-shadow: 0 0 0 2px rgba(122, 162, 247, 0.3);
  }
</style>
