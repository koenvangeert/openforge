<script lang="ts">
  import type { SDKToolApprovalRequest } from '../../lib/types'

  interface Props {
    request: SDKToolApprovalRequest
    onApprove: (id: string) => void
    onDeny: (id: string, reason: string) => void
  }

  let { request, onApprove, onDeny }: Props = $props()

  let showDenyReason = $state(false)
  let denyReason = $state('')

  function formatJsonPreview(str: string, maxLen: number = 200): string {
    try {
      const formatted = JSON.stringify(JSON.parse(str))
      return formatted.length > maxLen ? formatted.slice(0, maxLen) + '…' : formatted
    } catch {
      return str.length > maxLen ? str.slice(0, maxLen) + '…' : str
    }
  }

  function handleApprove() {
    onApprove(request.id)
  }

  function handleDenyClick() {
    showDenyReason = true
  }

  function handleDenySubmit() {
    onDeny(request.id, denyReason)
    showDenyReason = false
    denyReason = ''
  }

  function handleDenyCancel() {
    showDenyReason = false
    denyReason = ''
  }
</script>

<div
  class="flex rounded overflow-hidden border border-base-300 bg-base-100 text-sm"
  aria-live="polite"
>
  <div class="w-1 bg-warning flex-shrink-0"></div>

  <div class="flex-1 p-3">
    <div class="flex items-center gap-2 mb-2">
      <span class="badge badge-warning badge-xs">Approval Required</span>
      <span class="font-mono font-semibold text-base-content text-xs">{request.toolName}</span>
    </div>

    {#if request.description}
      <p class="text-xs text-base-content/70 mb-2">{request.description}</p>
    {/if}

    <pre class="text-xs font-mono bg-base-200 rounded p-2 mb-3 overflow-x-auto whitespace-pre-wrap break-all"><code>{formatJsonPreview(request.toolInput)}</code></pre>

    {#if !showDenyReason}
      <div class="flex gap-2">
        <button
          class="btn btn-success btn-sm"
          onclick={handleApprove}
        >
          Approve
        </button>
        <button
          class="btn btn-error btn-sm"
          onclick={handleDenyClick}
        >
          Deny
        </button>
      </div>
    {:else}
      <div class="flex flex-col gap-2">
        <input
          type="text"
          class="input input-sm input-bordered w-full"
          placeholder="Reason for denial (optional)"
          bind:value={denyReason}
        />
        <div class="flex gap-2">
          <button
            class="btn btn-error btn-sm"
            onclick={handleDenySubmit}
          >
            Confirm Deny
          </button>
          <button
            class="btn btn-ghost btn-sm"
            onclick={handleDenyCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    {/if}
  </div>
</div>
