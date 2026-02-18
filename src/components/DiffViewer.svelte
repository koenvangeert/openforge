<script lang="ts">
  import { onMount } from 'svelte'
  import { html as diff2htmlHtml } from 'diff2html'
  import { ColorSchemeType } from 'diff2html/lib/types'
  import 'diff2html/bundles/css/diff2html.min.css'
  import type { PrFileDiff, ReviewComment, ReviewSubmissionComment } from '../lib/types'
  import { pendingManualComments, reviewComments } from '../lib/stores'

  interface Props {
    files?: PrFileDiff[]
    existingComments?: ReviewComment[]
    repoOwner?: string
    repoName?: string
  }

  let { files = [], existingComments = [], repoOwner = '', repoName = '' }: Props = $props()

  let container: HTMLElement
  let outputFormat = $state<'side-by-side' | 'line-by-line'>('side-by-side')
  let activeCommentLine = $state<{ path: string; line: number; side: string } | null>(null)
  let commentText = $state('')

  $effect(() => {
    if (container && files.length > 0) {
      renderDiffs()
    }
  })

  function renderDiffs() {
    if (!container) return

    const diffStrings = files
      .filter(f => f.patch)
      .map(f => {
        const header = `--- a/${f.filename}\n+++ b/${f.filename}\n`
        return header + f.patch
      })

    const fullDiff = diffStrings.join('\n')

    if (!fullDiff.trim()) {
      container.innerHTML = '<div class="no-diff">No diff data available</div>'
      return
    }

    try {
      const html = diff2htmlHtml(fullDiff, {
        drawFileList: false,
        outputFormat,
        matching: 'lines',
        colorScheme: ColorSchemeType.DARK,
      })
      container.innerHTML = html
      attachLineHandlers()
    } catch (e) {
      console.error('Failed to render diff:', e)
      container.innerHTML = '<div class="error">Failed to render diff</div>'
    }
  }

  function attachLineHandlers() {
    if (!container) return
    
    // Add "+" buttons to line number cells
    const lineNumbers = container.querySelectorAll('.d2h-code-linenumber, .d2h-code-side-linenumber')
    for (const cell of lineNumbers) {
      const lineNum = extractLineNumber(cell)
      if (lineNum === null) continue
      
      const btn = document.createElement('span')
      btn.className = 'comment-add-btn'
      btn.textContent = '+'
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const path = getFilePathForElement(cell)
        if (path) {
          activeCommentLine = { path, line: lineNum, side: 'RIGHT' }
          commentText = ''
          insertCommentForm(cell.closest('tr'))
        }
      })
      const cellEl = cell as HTMLElement
      cellEl.style.position = 'relative'
      cellEl.appendChild(btn)
    }
    
    // Render existing comments
    renderExistingComments()
    // Render pending comments
    renderPendingComments()
  }

  function extractLineNumber(cell: Element): number | null {
    // diff2html puts the line number as text content in the cell
    const text = cell.textContent?.trim() ?? ''
    const num = parseInt(text, 10)
    return isNaN(num) ? null : num
  }

  function getFilePathForElement(el: Element): string | null {
    const fileWrapper = el.closest('.d2h-file-wrapper')
    if (!fileWrapper) return null
    const nameEl = fileWrapper.querySelector('.d2h-file-name')
    return nameEl?.textContent?.trim() ?? null
  }

  function insertCommentForm(afterRow: Element | null) {
    if (!afterRow || !container) return
    // Remove any existing form
    container.querySelectorAll('.inline-comment-form').forEach(el => el.remove())
    
    const formRow = document.createElement('tr')
    formRow.className = 'inline-comment-form'
    const td = document.createElement('td')
    td.colSpan = 20 // span all columns
    td.innerHTML = `
      <div class="comment-form-inner">
        <textarea class="comment-textarea" placeholder="Leave a comment..." rows="3"></textarea>
        <div class="comment-form-actions">
          <button class="comment-cancel-btn">Cancel</button>
          <button class="comment-submit-btn">Add Comment</button>
        </div>
      </div>
    `
    formRow.appendChild(td)
    afterRow.after(formRow)
    
    const textarea = td.querySelector('.comment-textarea') as HTMLTextAreaElement
    textarea?.focus()
    
    td.querySelector('.comment-cancel-btn')?.addEventListener('click', () => {
      formRow.remove()
      activeCommentLine = null
    })
    
    td.querySelector('.comment-submit-btn')?.addEventListener('click', () => {
      if (!activeCommentLine || !textarea?.value.trim()) return
      const comment: ReviewSubmissionComment = {
        path: activeCommentLine.path,
        line: activeCommentLine.line,
        side: activeCommentLine.side,
        body: textarea.value.trim()
      }
      $pendingManualComments = [...$pendingManualComments, comment]
      formRow.remove()
      activeCommentLine = null
      // Re-render pending comments
      renderPendingComments()
    })
  }

  function renderExistingComments() {
    if (!container) return
    container.querySelectorAll('.existing-comment-row').forEach(el => el.remove())
    
    for (const comment of existingComments) {
      if (comment.line === null) continue
      const row = findLineRow(comment.path, comment.line)
      if (!row) continue
      
      const commentRow = document.createElement('tr')
      commentRow.className = 'existing-comment-row'
      const td = document.createElement('td')
      td.colSpan = 20
      td.innerHTML = `
        <div class="inline-comment existing">
          <div class="comment-header">
            <strong class="comment-author">${escapeHtml(comment.author)}</strong>
            <span class="comment-time">${comment.created_at}</span>
          </div>
          <div class="comment-body">${escapeHtml(comment.body)}</div>
        </div>
      `
      commentRow.appendChild(td)
      row.after(commentRow)
    }
  }

  function renderPendingComments() {
    if (!container) return
    container.querySelectorAll('.pending-comment-row').forEach(el => el.remove())
    
    $pendingManualComments.forEach((comment, index) => {
      const row = findLineRow(comment.path, comment.line)
      if (!row) return
      
      const commentRow = document.createElement('tr')
      commentRow.className = 'pending-comment-row'
      const td = document.createElement('td')
      td.colSpan = 20
      td.innerHTML = `
        <div class="inline-comment pending">
          <div class="comment-header">
            <span class="pending-badge">Pending</span>
            <button class="comment-delete-btn" data-index="${index}">✕</button>
          </div>
          <div class="comment-body">${escapeHtml(comment.body)}</div>
        </div>
      `
      commentRow.appendChild(td)
      
      td.querySelector('.comment-delete-btn')?.addEventListener('click', () => {
        $pendingManualComments = $pendingManualComments.filter((_, i) => i !== index)
        renderPendingComments()
      })
      
      row.after(commentRow)
    })
  }

  function findLineRow(path: string, line: number): Element | null {
    if (!container) return null
    const fileWrappers = container.querySelectorAll('.d2h-file-wrapper')
    for (const wrapper of fileWrappers) {
      const nameEl = wrapper.querySelector('.d2h-file-name')
      const fileName = nameEl?.textContent?.trim() ?? ''
      if (fileName !== path && !path.endsWith(fileName) && !fileName.endsWith(path)) continue
      
      const lineNumbers = wrapper.querySelectorAll('.d2h-code-linenumber, .d2h-code-side-linenumber')
      for (const cell of lineNumbers) {
        const num = parseInt(cell.textContent?.trim() ?? '', 10)
        if (num === line) {
          return cell.closest('tr')
        }
      }
    }
    return null
  }

  function escapeHtml(text: string): string {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  export function scrollToFile(filename: string) {
    if (!container) return
    const fileHeaders = container.querySelectorAll('.d2h-file-name')
    for (const header of fileHeaders) {
      const text = header.textContent?.trim() ?? ''
      if (text === filename || text.endsWith('/' + filename) || filename.endsWith(text)) {
        const wrapper = header.closest('.d2h-file-wrapper')
        if (wrapper) {
          wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' })
          return
        }
      }
    }
  }

  onMount(() => {
    if (files.length > 0) {
      renderDiffs()
    }
  })
</script>

<div class="diff-viewer">
  <div class="controls">
    <button class:active={outputFormat === 'side-by-side'} onclick={() => outputFormat = 'side-by-side'}>
      Split
    </button>
    <button class:active={outputFormat === 'line-by-line'} onclick={() => outputFormat = 'line-by-line'}>
      Unified
    </button>
  </div>
  
  <div class="diff-container" bind:this={container}>
    {#if files.length === 0}
      <div class="empty">No files to display</div>
    {/if}
  </div>
</div>

<style>
  .diff-viewer {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    height: 100%;
    overflow: hidden;
  }

  .controls {
    display: flex;
    gap: 4px;
    padding: 12px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
  }

  .controls button {
    all: unset;
    padding: 6px 12px;
    font-size: 0.75rem;
    color: var(--text-secondary);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .controls button:hover {
    color: var(--text-primary);
    border-color: var(--accent);
  }

  .controls button.active {
    color: var(--accent);
    border-color: var(--accent);
    background: rgba(122, 162, 247, 0.1);
  }

  .diff-container {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    background: var(--bg-primary);
  }

  .empty,
  .no-diff,
  .error {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-secondary);
    font-size: 0.85rem;
  }

  .error {
    color: var(--error);
  }

  :global(.d2h-wrapper) {
    font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', 'Droid Sans Mono', 'Source Code Pro', monospace;
    font-size: 12px;
    overflow-x: hidden;
  }

  :global(.d2h-file-wrapper) {
    overflow-x: auto;
  }

  :global(.d2h-file-header) {
    background: var(--bg-card) !important;
    border-color: var(--border) !important;
    color: var(--text-primary) !important;
  }

  :global(.d2h-file-name) {
    color: var(--accent) !important;
  }

  :global(.d2h-code-line) {
    background: var(--bg-secondary) !important;
    color: var(--text-primary) !important;
  }

  :global(.d2h-code-line-ctn) {
    color: var(--text-primary) !important;
  }

  :global(.d2h-ins) {
    background: rgba(158, 206, 106, 0.15) !important;
  }

  :global(.d2h-del) {
    background: rgba(247, 118, 142, 0.15) !important;
  }

  :global(.d2h-info) {
    background: var(--bg-card) !important;
    color: var(--text-secondary) !important;
    border-color: var(--border) !important;
  }

  :global(.d2h-diff-table) {
    border-collapse: separate !important;
    border-spacing: 0;
  }

  :global(.d2h-code-linenumber) {
    position: sticky !important;
    left: 0;
    z-index: 1;
    background: var(--bg-card) !important;
    color: var(--text-secondary) !important;
    border-color: var(--border) !important;
  }

  :global(.d2h-code-side-linenumber) {
    position: sticky !important;
    left: 0;
    z-index: 1;
    background: var(--bg-card) !important;
    color: var(--text-secondary) !important;
    border-color: var(--border) !important;
  }

  :global(.d2h-moved-tag) {
    background: rgba(224, 175, 104, 0.2) !important;
    color: var(--warning) !important;
  }

  :global(.comment-add-btn) {
    display: none;
    position: absolute;
    right: -2px;
    top: 50%;
    transform: translateY(-50%);
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--bg-primary);
    font-size: 14px;
    font-weight: bold;
    line-height: 20px;
    text-align: center;
    cursor: pointer;
    z-index: 10;
  }

  :global(.d2h-code-linenumber:hover .comment-add-btn),
  :global(.d2h-code-side-linenumber:hover .comment-add-btn) {
    display: block;
  }

  :global(.inline-comment-form td),
  :global(.existing-comment-row td),
  :global(.pending-comment-row td) {
    padding: 0 !important;
    background: var(--bg-primary) !important;
    border: none !important;
  }

  :global(.comment-form-inner) {
    padding: 12px 16px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 6px;
    margin: 8px 16px;
  }

  :global(.comment-textarea) {
    width: 100%;
    min-height: 60px;
    padding: 8px;
    background: var(--bg-primary);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-family: inherit;
    font-size: 0.8rem;
    resize: vertical;
  }

  :global(.comment-textarea:focus) {
    outline: none;
    border-color: var(--accent);
  }

  :global(.comment-form-actions) {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 8px;
  }

  :global(.comment-cancel-btn) {
    all: unset;
    padding: 6px 12px;
    font-size: 0.75rem;
    color: var(--text-secondary);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
  }

  :global(.comment-cancel-btn:hover) {
    color: var(--text-primary);
  }

  :global(.comment-submit-btn) {
    all: unset;
    padding: 6px 12px;
    font-size: 0.75rem;
    color: var(--bg-primary);
    background: var(--accent);
    border-radius: 4px;
    cursor: pointer;
    font-weight: 500;
  }

  :global(.comment-submit-btn:hover) {
    opacity: 0.9;
  }

  :global(.inline-comment) {
    padding: 10px 16px;
    margin: 6px 16px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 0.8rem;
  }

  :global(.inline-comment.pending) {
    border-color: var(--warning);
    border-left: 3px solid var(--warning);
  }

  :global(.inline-comment.existing) {
    border-left: 3px solid var(--accent);
  }

  :global(.comment-header) {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }

  :global(.comment-author) {
    color: var(--text-primary);
    font-weight: 600;
    font-size: 0.75rem;
  }

  :global(.comment-time) {
    color: var(--text-secondary);
    font-size: 0.7rem;
  }

  :global(.pending-badge) {
    padding: 2px 6px;
    font-size: 0.65rem;
    font-weight: 600;
    color: var(--warning);
    background: rgba(224, 175, 104, 0.15);
    border-radius: 3px;
  }

  :global(.comment-delete-btn) {
    all: unset;
    margin-left: auto;
    padding: 2px 6px;
    font-size: 0.7rem;
    color: var(--text-secondary);
    cursor: pointer;
  }

  :global(.comment-delete-btn:hover) {
    color: var(--error);
  }

  :global(.comment-body) {
    color: var(--text-primary);
    line-height: 1.5;
    white-space: pre-wrap;
  }
</style>
