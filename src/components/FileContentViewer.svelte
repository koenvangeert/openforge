<script lang="ts">
  import type { FileContent } from '../lib/types'
  import { getLanguageForFile, highlightCode } from '../lib/fileHighlighter'
  import MarkdownContent from './shared/content/MarkdownContent.svelte'

  interface Props {
    content: FileContent | null
    fileName: string
    error: string | null
    modifiedAt: number | null
  }

  let { content, fileName, error, modifiedAt = null }: Props = $props()

  const textLines = $derived(content?.type === 'text' ? content.content.split('\n') : [])
  const language = $derived(getLanguageForFile(fileName))
  const isMarkdown = $derived(language === 'markdown')
  const lineCount = $derived(content?.type === 'text' ? textLines.length : null)

  const highlightedCode = $derived.by(() => {
    if (content?.type !== 'text' || isMarkdown) return ''
    return highlightCode(content.content, fileName)
  })

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  function formatModifiedAt(value: number): string {
    return new Date(value).toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
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
  {:else if content !== null}
    <div class="flex h-full flex-col">
      <div class="shrink-0 border-b border-base-300 px-4 py-3 bg-base-100/70">
        <div class="text-sm font-medium text-base-content break-all">{fileName}</div>
        <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-base-content/60">
          <span>{formatFileSize(content.size)}</span>
          {#if content.mimeType}
            <span class="font-mono">{content.mimeType}</span>
          {/if}
          {#if lineCount !== null}
            <span>{lineCount} {lineCount === 1 ? 'line' : 'lines'}</span>
          {/if}
          {#if modifiedAt !== null}
            <span>Modified {formatModifiedAt(modifiedAt)}</span>
          {/if}
        </div>
      </div>

      {#if content.type === 'text'}
        {#if isMarkdown}
          <div class="flex-1 overflow-auto p-6">
            <MarkdownContent content={content.content} />
          </div>
        {:else}
          <div class="flex-1 overflow-auto p-4">
            <div class="font-mono text-sm min-w-max" aria-label="File text content">
              <div class="flex leading-6">
                <div
                  class="w-12 shrink-0 pr-3 text-right text-base-content/30 select-none flex flex-col"
                  aria-hidden="true"
                >
                  {#each textLines as _, index}
                    <span>{index + 1}</span>
                  {/each}
                </div>
                <code class="file-preview-code block flex-1 whitespace-pre {language ? `language-${language}` : ''}">{@html highlightedCode || ' '}</code>
              </div>
            </div>
          </div>
        {/if}
      {:else if content.type === 'image'}
        <div class="flex-1 w-full flex items-center justify-center p-4 overflow-auto">
          <img
            src={`data:${content.mimeType ?? 'image/*'};base64,${content.content}`}
            alt={`${fileName} preview`}
            class="max-w-full max-h-full object-contain"
          />
        </div>
      {:else if content.type === 'binary'}
        <div class="flex-1 flex items-center justify-center p-6">
          <div class="max-w-md text-center space-y-2">
            <div class="text-2xl text-base-content/50" aria-hidden="true">[]</div>
            <h3 class="text-base font-semibold">Binary preview unavailable</h3>
            <p class="text-sm text-base-content/60">
              This file is stored as binary data and cannot be rendered in the preview pane.
            </p>
          </div>
        </div>
      {:else if content.type === 'document'}
        <div class="flex-1 flex items-center justify-center p-6">
          <div class="max-w-md text-center space-y-2">
            <div class="text-2xl text-base-content/50" aria-hidden="true">📄</div>
            <h3 class="text-base font-semibold">Document preview unavailable</h3>
            <p class="text-sm text-base-content/60">
              PDFs and similar document formats are shown as metadata-only previews for now.
            </p>
          </div>
        </div>
      {:else if content.type === 'large-file'}
        <div class="flex-1 flex items-center justify-center p-6">
          <div class="max-w-md text-center space-y-2">
            <div class="text-2xl text-base-content/50" aria-hidden="true">⚠️</div>
            <h3 class="text-base font-semibold">File too large to preview</h3>
            <p class="text-sm text-base-content/60">
              This file exceeds the in-app preview limit, so only its metadata is shown.
            </p>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>
