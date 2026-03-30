<script lang="ts">
  import { Brain } from 'lucide-svelte'
  import ModelDownloadProgress from '../shared/input/ModelDownloadProgress.svelte'
  import type { WhisperModelStatus, WhisperModelSizeId } from '../../lib/types'

  interface Props {
    modelStatuses: WhisperModelStatus[]
    activeModelSize: string | null
    downloadingModel: string | null
    onWhisperModelSelect: (modelSize: string) => void
    onDownloadModel: (modelSize: string) => void
    onDownloadComplete: () => void
    onDownloadError: () => void
  }

  let {
    modelStatuses,
    activeModelSize,
    downloadingModel,
    onWhisperModelSelect,
    onDownloadModel,
    onDownloadComplete,
    onDownloadError
  }: Props = $props()

  function formatSize(mb: number): string {
    return mb >= 1000 ? (mb / 1000).toFixed(1) + ' GB' : mb + ' MB'
  }

  const activeModel = $derived(modelStatuses.find(m => m.size === activeModelSize))
</script>

<div id="section-ai" class="rounded-lg border border-base-300 overflow-hidden" style="background-color: var(--project-bg, oklch(var(--b1)))">
  <!-- Header -->
  <div class="px-5 py-4 border-b border-base-300 flex items-center gap-3">
    <Brain size={16} class="text-primary" />
    <h2 class="text-sm font-semibold">Voice & Whisper</h2>
  </div>

  <!-- Body -->
  <div class="p-5 flex flex-col gap-4">
    <!-- Whisper Model Select -->
    <label class="flex flex-col gap-1">
      <span class="text-[0.7rem] text-base-content/50">Whisper Model</span>
      <select
        class="select select-bordered select-sm w-full max-w-xs"
        value={activeModelSize ?? 'small'}
        onchange={(e) => onWhisperModelSelect((e.currentTarget as HTMLSelectElement).value)}
      >
        {#each modelStatuses as model}
          <option value={model.size}>
            {model.display_name} — {formatSize(model.disk_size_mb)} download, ~{formatSize(model.ram_usage_mb)} RAM{model.downloaded ? ' ✓' : ''}
          </option>
        {/each}
      </select>
    </label>

    <!-- Whisper Model Download Status / Progress -->
    {#if downloadingModel}
      <ModelDownloadProgress
        modelSize={downloadingModel as WhisperModelSizeId}
        modelDisplayName={modelStatuses.find(m => m.size === downloadingModel)?.display_name ?? downloadingModel}
        diskSizeMb={modelStatuses.find(m => m.size === downloadingModel)?.disk_size_mb ?? 0}
        onComplete={onDownloadComplete}
        onError={onDownloadError}
      />
    {:else if activeModel?.downloaded}
      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-2">
          <span class="badge badge-success badge-sm">Downloaded</span>
          <span class="text-[0.7rem] text-base-content/50">{activeModel.model_name}</span>
        </div>
        {#if activeModel.model_size_bytes}
          <span class="text-[0.7rem] text-base-content/50">
            Size: {(activeModel.model_size_bytes / 1024 / 1024).toFixed(0)} MB
          </span>
        {/if}
        {#if activeModel.model_path}
          <span class="text-[0.7rem] text-base-content/50 break-all">
            Path: {activeModel.model_path}
          </span>
        {/if}
        <button class="btn btn-ghost btn-sm mt-1" onclick={() => onDownloadModel(activeModel.size)}>
          Re-download Model
        </button>
      </div>
    {:else if activeModel}
      <div class="flex flex-col gap-2">
        <p class="text-[0.7rem] text-base-content/50">Whisper {activeModel.display_name} model required for voice dictation (~{formatSize(activeModel.disk_size_mb)} download).</p>
        <button class="btn btn-primary btn-sm" onclick={() => onDownloadModel(activeModel.size)}>
          Download Model
        </button>
      </div>
    {/if}

    <p class="text-[0.7rem] text-base-content/50 mt-1">
      {#if activeModel}
        Uses approximately {formatSize(activeModel.ram_usage_mb)} of RAM during transcription.
      {:else}
        Uses approximately 1 GB of RAM during transcription.
      {/if}
    </p>
    <p class="text-[0.7rem] text-base-content/50">Note: macOS may re-prompt for microphone permission on each app launch (Tauri v2 known issue).</p>
  </div>
</div>
