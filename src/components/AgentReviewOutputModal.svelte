<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { listen } from '@tauri-apps/api/event'
  import type { UnlistenFn } from '@tauri-apps/api/event'
  import type { AgentEvent } from '../lib/types'
  import Modal from './Modal.svelte'

  interface Props {
    sessionKey: string
    onClose: () => void
  }

  let { sessionKey, onClose }: Props = $props()

  let output = $state('')
  let status = $state<'running' | 'completed' | 'error'>('running')
  let scrollContainer: HTMLDivElement | undefined = $state()
  let unlisten: UnlistenFn | undefined = $state()

  $effect(() => {
    const _output = output
    if (!scrollContainer) return
    scrollContainer.scrollTop = scrollContainer.scrollHeight
  })

  onMount(async () => {
    console.log('[AgentReviewOutput] Mounted, listening for sessionKey:', sessionKey)
    unlisten = await listen<AgentEvent>('agent-event', (event) => {
      const { task_id, event_type, data } = event.payload
      if (task_id !== sessionKey) return

      console.log('[AgentReviewOutput] Event received:', event_type, 'data:', data)

      if (event_type === 'message.part.delta') {
        try {
          const parsed = JSON.parse(data)
          console.log('[AgentReviewOutput] Parsed delta payload:', JSON.stringify(parsed.properties))
          const delta = parsed.properties?.delta
          if (typeof delta === 'string') {
            output += delta
          } else {
            console.warn('[AgentReviewOutput] delta is not a string:', typeof delta, delta)
          }
        } catch (e) {
          console.error('[AgentReviewOutput] Failed to parse delta:', e, 'raw data:', data)
        }
      } else if (event_type === 'session.idle' || event_type === 'session.status') {
        try {
          const parsed = JSON.parse(data)
          const statusType = parsed.properties?.status?.type
          console.log('[AgentReviewOutput] Status event:', event_type, 'statusType:', statusType)
          if (event_type === 'session.idle' || statusType === 'idle') {
            status = 'completed'
            console.log('[AgentReviewOutput] Session completed. Total output length:', output.length)
          }
        } catch {
          if (event_type === 'session.idle') {
            status = 'completed'
            console.log('[AgentReviewOutput] Session idle (parse fallback). Total output length:', output.length)
          }
        }
      } else if (event_type === 'session.error') {
        console.error('[AgentReviewOutput] Session error:', data)
        status = 'error'
      } else {
        console.log('[AgentReviewOutput] Unhandled event type:', event_type)
      }
    })
  })

  onDestroy(() => {
    unlisten?.()
  })
</script>

<Modal onClose={onClose} maxWidth="800px">
  {#snippet header()}
    <div class="flex items-center gap-3">
      <h2 class="text-[0.95rem] font-semibold text-base-content m-0">AI Review Output</h2>
      {#if status === 'running'}
        <span class="loading loading-spinner loading-xs text-primary"></span>
        <span class="text-xs text-base-content/50">Running...</span>
      {:else if status === 'completed'}
        <span class="badge badge-success badge-sm">Completed</span>
      {:else if status === 'error'}
        <span class="badge badge-error badge-sm">Error</span>
      {/if}
    </div>
  {/snippet}

  <div class="flex-1 overflow-y-auto p-5 max-h-[70vh]" bind:this={scrollContainer}>
    {#if output}
      <div class="font-mono text-sm whitespace-pre-wrap text-base-content leading-relaxed break-words">{output}</div>
    {:else if status === 'running'}
      <div class="flex flex-col items-center justify-center py-12 gap-3 text-base-content/50 text-sm">
        <span class="loading loading-spinner loading-md text-primary"></span>
        <span>Waiting for agent output...</span>
      </div>
    {:else}
      <div class="text-sm text-base-content/50 italic">No output received.</div>
    {/if}
  </div>
</Modal>
