<script lang="ts">
  import type { SDKChatMessage, SDKToolApprovalRequest } from '../lib/types'
  import ToolCallCard from './ToolCallCard.svelte'
  import ToolApprovalCard from './ToolApprovalCard.svelte'

  interface Props {
    messages: SDKChatMessage[]
    pendingApprovals: SDKToolApprovalRequest[]
    isStreaming: boolean
    onApprove: (id: string) => void
    onDeny: (id: string, reason: string) => void
  }

  let { messages, pendingApprovals, isStreaming, onApprove, onDeny }: Props = $props()

  // DOM ref — plain let per AGENTS.md (not $state)
  let scrollContainer: HTMLDivElement

  let userScrolledUp = $state(false)
  const SCROLL_THRESHOLD = 64

  function handleScroll() {
    if (!scrollContainer) return
    const { scrollTop, clientHeight, scrollHeight } = scrollContainer
    userScrolledUp = scrollTop + clientHeight < scrollHeight - SCROLL_THRESHOLD
  }

  function scrollToBottom() {
    if (!scrollContainer) return
    scrollContainer.scrollTop = scrollContainer.scrollHeight
  }

  // Auto-scroll when messages change, unless user has scrolled up
  $effect(() => {
    // Access reactive dependencies to track changes
    void messages.length
    void pendingApprovals.length
    void isStreaming
    if (!userScrolledUp) {
      requestAnimationFrame(() => scrollToBottom())
    }
  })

  function formatTimestamp(ts: number): string {
    const ms = ts < 1e12 ? ts * 1000 : ts
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
</script>

<div class="flex flex-col h-full bg-base-100 relative">
  <!-- Messages scroll area -->
  <div
    class="flex-1 overflow-y-auto p-4"
    bind:this={scrollContainer}
    onscroll={handleScroll}
  >
    {#if messages.length === 0 && !isStreaming}
      <!-- Empty state -->
      <div class="flex flex-col items-center justify-center h-full gap-3 text-center">
        <svg
          class="w-10 h-10 text-base-content/25"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <p class="text-sm text-base-content/50">No messages yet. Start a session to begin.</p>
      </div>
    {:else}
      <div class="space-y-2">
        {#each messages as message (message.id)}
          {#if message.role === 'system'}
            <!-- System message: centered, muted pill -->
            <div class="flex justify-center py-1">
              <span class="text-[0.6875rem] text-base-content/40 bg-base-200 border border-base-300 px-3 py-0.5 rounded-full">
                {message.content}
              </span>
            </div>

          {:else if message.role === 'user'}
            <!-- User message: right-aligned, primary tint -->
            <div class="flex justify-end">
              <div class="max-w-[80%] flex flex-col gap-0.5">
                <div class="bg-primary/10 border border-primary/20 rounded-lg px-3 py-2">
                  <p class="text-sm text-base-content whitespace-pre-wrap break-words">{message.content}</p>
                </div>
                <div class="flex justify-end">
                  <span class="text-[0.6rem] text-base-content/35">{formatTimestamp(message.timestamp)}</span>
                </div>
              </div>
            </div>

          {:else}
            <!-- Assistant message: left-aligned, base-200 bg -->
            <div class="flex flex-col gap-1">
              <!-- Role header -->
              <div class="flex items-center gap-1.5 px-0.5">
                <span class="text-[0.6rem] font-semibold text-base-content/50 uppercase tracking-widest">Claude</span>
                {#if message.status === 'streaming'}
                  <span class="loading loading-dots loading-xs text-primary"></span>
                {:else if message.status === 'error'}
                  <span class="badge badge-error badge-xs">error</span>
                {/if}
                <span class="text-[0.6rem] text-base-content/35 ml-auto">{formatTimestamp(message.timestamp)}</span>
              </div>

              <!-- Message content -->
              {#if message.content}
                <div class="bg-base-200 rounded-lg p-3">
                  <p class="text-sm text-base-content whitespace-pre-wrap break-words prose prose-sm max-w-none">{message.content}</p>
                </div>
              {/if}

              <!-- Inline tool calls -->
              {#if message.toolCalls && message.toolCalls.length > 0}
                <div class="flex flex-col gap-1 pl-3 border-l-2 border-base-300 ml-1">
                  {#each message.toolCalls as toolCall (toolCall.id)}
                    <ToolCallCard {toolCall} />
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        {/each}

        <!-- Pending approval cards: above the streaming indicator -->
        {#if pendingApprovals.length > 0}
          <div class="flex flex-col gap-2 pt-2 border-t border-base-300">
            <span class="text-[0.6rem] font-semibold text-warning uppercase tracking-widest px-0.5">
              Awaiting Approval
            </span>
            {#each pendingApprovals as approval (approval.id)}
              {#if approval.pending}
                <ToolApprovalCard
                  request={approval}
                  {onApprove}
                  {onDeny}
                />
              {/if}
            {/each}
          </div>
        {/if}

        <!-- Streaming indicator -->
        {#if isStreaming}
          <div class="flex items-center gap-2 py-1 pl-0.5">
            <span class="loading loading-dots loading-sm text-primary"></span>
            <span class="text-xs text-base-content/50">Claude is thinking…</span>
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Scroll-to-bottom hint overlay when user has scrolled up -->
  {#if userScrolledUp && (messages.length > 0 || isStreaming)}
    <div class="absolute bottom-3 left-0 right-0 flex justify-center pointer-events-none">
      <button
        class="btn btn-xs btn-neutral shadow-md pointer-events-auto gap-1"
        onclick={scrollToBottom}
        aria-label="Scroll to latest messages"
      >
        <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M12 5v14M5 12l7 7 7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        New messages
      </button>
    </div>
  {/if}
</div>
