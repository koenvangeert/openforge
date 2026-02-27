<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { listen } from '@tauri-apps/api/event'
  import type { UnlistenFn } from '@tauri-apps/api/event'
  import { downloadWhisperModel } from '../lib/ipc'
  import type { WhisperModelSizeId } from '../lib/types'

  interface Props {
    modelSize: WhisperModelSizeId
    modelDisplayName: string
    diskSizeMb: number
    onComplete?: () => void
    on3rror?: (error: string) => void
  }

  let { modelSize, modelDisplayName, diskSizeMb, onComplete, on3rror }: Props = $props()

  let progress = $state(0)
  let bytesDownloaded = $state(0)
  let totalBytes = $state(0)
  let status = $state<'downloading' | 'complete' | 'error'>('downloading')
  let errorMessage = $state<string | null>(null)

  let unlisten: UnlistenFn | null = null
  let completed = false
  function formatMB(bytes: number): string {
    return (bytes / 1024 / 1024).toFixed(0) + ' MB'
  }
  async function startDownload() {
    status = 'downloading'
    errorMessage = null
    progress = 0
    bytesDownloaded = 0
    totalBytes = 0
    completed = false

    try {
      await downloadWhisperModel(modelSize)
      if (!completed) {
        completed = true
        status = 'complete'
        progress = 100
        onComplete?.()
      }
    } catch (e) {
      status = 'error'
      errorMessage = 'Failed to download model. Please try again.'
      on3rror?.('Failed to download model. Please try again.')
    }
  }

  onMount(async () => {
    unlisten = await listen<{ model_size: string; bytes_downloaded: number; total_bytes: number; percentage: number }>(
      'whisper-download-progress',
      (event) => {
        if (event.payload.model_size !== modelSize) return
        bytesDownloaded = event.payload.bytes_downloaded
        totalBytes = event.payload.total_bytes
        progress = event.payload.percentage
        if (progress >= 100 && !completed) {
          completed = true
          status = 'complete'
          onComplete?.()
        }
      }
    )

    await startDownload()
  })

  onDestroy(() => {
    unlisten?.()
  })
</script>

<div class="flex flex-col gap-3 p-4 bg-base-200 rounded-lg w-full">
  <div class="flex items-center gap-2">
    {#if status === 'downloading'}
      <span class="loading loading-spinner loading-xs text-primary"></span>
    {/if}
    <span class="text-sm font-medium text-base-content">
      {#if status === 'complete'}
        {modelDisplayName} downloaded
      {:else if status === 'error'}
        Download failed
      {:else}
        Downloading Whisper {modelDisplayName} (~{diskSizeMb >= 1000 ? (diskSizeMb / 1000).toFixed(1) + ' GB' : diskSizeMb + ' MB'})...
      {/if}
    </span>
    {#if status === 'complete'}
      <span class="badge badge-success badge-sm ml-auto">Ready</span>
    {/if}
  </div>

  {#if status === 'downloading'}
    <div class="flex flex-col gap-1">
      <progress
        class="progress progress-primary w-full"
        value={progress}
        max="100"
      ></progress>
      <span class="text-xs text-base-content/50">
        {#if totalBytes > 0}
          {progress.toFixed(0)}% — {formatMB(bytesDownloaded)} / {formatMB(totalBytes)}
        {:else}
          Preparing download...
        {/if}
      </span>
    </div>
  {/if}

  {#if status === 'error' && errorMessage}
    <div class="flex items-center gap-2">
      <span class="text-error text-sm flex-1">{errorMessage}</span>
      <button
        class="btn btn-sm btn-ghost"
        onclick={() => startDownload()}
      >
        Retry
      </button>
    </div>
  {/if}
</div>
