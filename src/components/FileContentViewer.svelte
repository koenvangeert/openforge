<script lang="ts">
  import type { FileContent } from '../lib/types'
  import { getLanguageForFile, highlightCode } from '../lib/fileHighlighter'

  interface Props {
    content: FileContent | null
    fileName: string
    error: string | null
  }

  let { content, fileName, error }: Props = $props()

  const textLines = $derived(content?.type === 'text' ? content.content.split('\n') : [])
  const language = $derived(getLanguageForFile(fileName))

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
</script>

<div class="flex-1 overflow-auto bg-base-100">
  {#if content === null && error === null}
    <div class="h-full flex items-center justify-center" aria-label="Loading file content">
      <span class="loading loading-spinner loading-md text-primary"></span>
    </div>
  {:else if error !== null}
    <div class="h-full flex items-center justify-center p-6">
      <div class="max-w-lg text-center space-y-2">
        <div class="text-warning text-2xl" aria-hidden="true">!</div>
        <h3 class="text-base font-semibold">Unable to load file</h3>
        <p class="text-sm text-base-content/70 break-all">{fileName}</p>
        <p class="text-sm text-error">{error}</p>
      </div>
    </div>
  {:else if content?.type === 'text'}
    <div class="p-4 overflow-auto">
      <div class="font-mono text-sm min-w-max" aria-label="File text content">
        {#each textLines as line, index}
          <div class="flex leading-6">
            <span class="w-12 shrink-0 pr-3 text-right text-base-content/30 select-none">{index + 1}</span>
            <code
              class="flex-1 whitespace-pre {language ? `language-${language}` : ''}"
            >{@html highlightCode(line, fileName) || ' '}</code>
          </div>
        {/each}
      </div>
    </div>
  {:else if content?.type === 'image'}
    <div class="h-full w-full flex items-center justify-center p-4">
      <img
        src={`data:${content.mimeType ?? 'image/*'};base64,${content.content}`}
        alt={`${fileName} preview`}
        class="max-w-full max-h-full object-contain"
      />
    </div>
  {:else if content?.type === 'binary'}
    <div class="h-full flex items-center justify-center p-6">
      <div class="text-center space-y-2">
        <div class="text-2xl text-base-content/50" aria-hidden="true">[]</div>
        <h3 class="text-base font-semibold">Cannot preview this file type</h3>
        <p class="text-sm text-base-content/70 break-all">{fileName}</p>
        <p class="text-sm text-base-content/50">{formatFileSize(content.size)}</p>
      </div>
    </div>
  {/if}
</div>
