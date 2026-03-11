<script lang="ts">
  import type { Task, PrComment } from '../lib/types'
  import { parseCheckRuns, isReadyToMerge } from '../lib/types'
  import { ticketPrs } from '../lib/stores'
  import { getPrComments, markCommentAddressed, openUrl } from '../lib/ipc'
  import { timeAgo } from '../lib/timeAgo'
  import MarkdownContent from './MarkdownContent.svelte'
  import CopyButton from './CopyButton.svelte'

  interface Props {
    task: Task
    worktreePath: string | null
    jiraBaseUrl: string
  }

  let { task, worktreePath, jiraBaseUrl }: Props = $props()

  let prCommentsByPr = $state<Map<number, PrComment[]>>(new Map())

  async function loadPrComments() {
    const prs = $ticketPrs.get(task.id) || []
    prCommentsByPr = new Map()
    
    for (const pr of prs) {
      try {
        const comments = await getPrComments(pr.id)
        prCommentsByPr.set(pr.id, comments)
      } catch (e) {
        console.error(`Failed to load comments for PR ${pr.id}:`, e)
      }
    }
    prCommentsByPr = prCommentsByPr
  }

  $effect(() => {
    // Reload PR comments when task changes or ticketPrs updates
    const prs = $ticketPrs.get(task.id)
    if (prs) {
      loadPrComments()
    }
  })

  async function handleMarkAddressed(commentId: number, prId: number) {
    try {
      await markCommentAddressed(commentId)
      // Reload comments for this PR
      const comments = await getPrComments(prId)
      prCommentsByPr.set(prId, comments)
      prCommentsByPr = prCommentsByPr
    } catch (e) {
      console.error('Failed to mark comment as addressed:', e)
    }
  }

  function formatDate(timestamp: number): string {
    return new Date(timestamp * 1000).toLocaleDateString()
  }



  let taskPrs = $derived($ticketPrs.get(task.id) || [])
</script>

<div class="flex flex-col gap-5 p-5 overflow-y-auto bg-base-200 h-full">
  <!-- Initial Prompt Section -->
  <section class="flex flex-col gap-2.5">
    <h3 class="text-[10px] font-bold text-primary font-mono tracking-[1.2px] m-0" aria-label="Initial Prompt">// INITIAL_PROMPT</h3>
    <div class="text-sm text-base-content leading-relaxed whitespace-pre-wrap break-words">{task.prompt ?? ''}</div>
  </section>

  <!-- Summary Section -->
  <section class="flex flex-col gap-2.5">
    <h3 class="text-[10px] font-bold text-primary font-mono tracking-[1.2px] m-0" aria-label="Summary">// SUMMARY</h3>
    {#if task.summary}
      <div class="text-sm [&_.markdown-body]:text-sm [&_.markdown-body_pre]:text-xs [&_.markdown-body_code]:text-xs [&_.markdown-body_p]:my-1">
        <MarkdownContent content={task.summary.replace(/\\n/g, '\n')} />
      </div>
    {:else}
      <div class="text-xs text-base-content/50">No summary yet</div>
    {/if}
  </section>


  <!-- Worktree Path Section -->
  {#if worktreePath}
    <section class="flex flex-col gap-2.5">
      <h3 class="text-[10px] font-bold text-primary font-mono tracking-[1.2px] m-0" aria-label="Worktree">// WORKTREE</h3>
      <div class="flex items-center gap-2 bg-base-100 border border-base-300 rounded-md px-3 py-2">
        <span class="text-xs font-mono text-base-content/70 truncate flex-1" title={worktreePath}>{worktreePath}</span>
        <CopyButton text={worktreePath} label="Copy worktree path" />
      </div>
    </section>
  {/if}

  <!-- Jira Section -->
  {#if task.jira_key}
    <section class="flex flex-col gap-2.5">
      <h3 class="text-[10px] font-bold text-primary font-mono tracking-[1.2px] m-0" aria-label="Jira">// JIRA</h3>
      <div class="bg-base-100 border border-base-300 rounded-md p-3 flex flex-col gap-2">
        <span class="text-sm font-semibold text-base-content">{task.jira_key}</span>
        {#if task.jira_title}
          <span class="text-xs text-base-content/70 truncate" title={task.jira_title}>{task.jira_title}</span>
        {/if}
        {#if jiraBaseUrl}
          <button
            class="btn btn-link btn-xs p-0 h-auto min-h-0 text-primary no-underline hover:underline text-[0.7rem] text-left justify-start"
            onclick={() => openUrl(`${jiraBaseUrl}/browse/${task.jira_key}`)}
          >Open in Jira ↗</button>
        {/if}
      </div>
    </section>
  {/if}

  <!-- Merge Status Section -->
  {#if taskPrs.some(pr => pr.state === 'merged' || isReadyToMerge(pr))}
    <section class="flex flex-col gap-2.5">
      <h3 class="text-[10px] font-bold text-primary font-mono tracking-[1.2px] m-0" aria-label="Merge Status">// MERGE_STATUS</h3>
      {#each taskPrs as pr (pr.id)}
        {#if pr.state === 'merged'}
          <div class="mb-3">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs text-base-content/50">{pr.title}</span>
              <span class="text-[0.65rem] font-semibold px-1.5 py-0.5 rounded bg-secondary/15 text-secondary">&#x2714; Merged</span>
            </div>
            {#if pr.merged_at}
              <div class="text-[0.7rem] text-base-content/50 mt-1">
                Merged on {formatDate(pr.merged_at)}
              </div>
            {/if}
          </div>
        {:else if isReadyToMerge(pr)}
          <div class="mb-3">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs text-base-content/50">{pr.title}</span>
              <span class="text-[0.65rem] font-semibold px-1.5 py-0.5 rounded bg-info/15 text-info merge-ready">&#x25CF; Ready to Merge</span>
            </div>
          </div>
        {/if}
      {/each}
    </section>
  {/if}

  <!-- PR Links Section -->
  {#if taskPrs.length > 0}
    <section class="flex flex-col gap-2.5">
      <h3 class="text-[10px] font-bold text-primary font-mono tracking-[1.2px] m-0" aria-label="Pull Requests">// PULL_REQUESTS</h3>
      <div class="flex flex-col gap-2">
        {#each taskPrs as pr (pr.id)}
          <div class="bg-base-100 border border-base-300 rounded-md p-3 flex flex-col gap-2">
            <div class="flex items-center gap-2">
              <span class="text-[0.65rem] font-semibold uppercase px-1.5 py-0.5 rounded tracking-wider {pr.state === 'open' ? 'bg-success text-success-content' : pr.state === 'merged' ? 'bg-secondary text-secondary-content' : 'bg-error text-error-content'}">
                {pr.state}
              </span>
              {#if pr.draft && pr.state === 'open'}
                <span class="text-[0.65rem] font-semibold px-1.5 py-0.5 rounded text-base-content/50 bg-base-200 border border-base-300">Draft</span>
              {/if}
              <span class="text-sm text-base-content font-medium">{pr.title}</span>
            </div>
            <button class="btn btn-link btn-xs p-0 h-auto min-h-0 text-primary no-underline hover:underline text-[0.7rem] break-all text-left justify-start" onclick={() => openUrl(pr.url)}>
              {pr.url}
            </button>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <!-- Pipeline Status Section -->
  {#if taskPrs.some(pr => pr.ci_status)}
    <section class="flex flex-col gap-2.5">
      <h3 class="text-[10px] font-bold text-primary font-mono tracking-[1.2px] m-0" aria-label="Pipeline Status">// PIPELINE_STATUS</h3>
      {#each taskPrs as pr (pr.id)}
        {#if pr.ci_status}
          {@const checkRuns = parseCheckRuns(pr.ci_check_runs)}
          <div class="mb-3">
            <div class="flex items-center justify-between gap-2 mb-1.5">
              <span class="text-xs text-base-content/50">{pr.title}</span>
              <span class="text-[0.65rem] font-semibold px-1.5 py-0.5 rounded {pr.ci_status === 'success' ? 'bg-success/15 text-success' : pr.ci_status === 'failure' ? 'bg-error/15 text-error' : pr.ci_status === 'pending' ? 'bg-warning/15 text-warning' : 'bg-base-content/15 text-base-content/50'}">
                {#if pr.ci_status === 'success'}✓ Passing
                {:else if pr.ci_status === 'failure'}✗ Failing
                {:else if pr.ci_status === 'pending'}⏳ Running
                {:else if pr.ci_status === 'none'}— No CI
                {/if}
              </span>
            </div>
            {#if checkRuns.length > 0}
              <div class="flex flex-col gap-1">
                {#each checkRuns as check (check.id)}
                  <div class="flex items-center gap-1.5 text-xs">
                    <span class="w-4 text-center font-semibold {check.conclusion === 'success' ? 'text-success' : check.conclusion === 'failure' ? 'text-error' : check.status !== 'completed' ? 'text-warning' : 'text-base-content/50'}">
                      {#if check.conclusion === 'success'}✓
                      {:else if check.conclusion === 'failure'}✗
                      {:else if check.status !== 'completed'}⏳
                      {:else}—{/if}
                    </span>
                    <span class="text-base-content">{check.name}</span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      {/each}
    </section>
  {/if}

  <!-- Review Status Section -->
  {#if taskPrs.some(pr => pr.review_status && pr.review_status !== 'none')}
    <section class="flex flex-col gap-2.5">
      <h3 class="text-[10px] font-bold text-primary font-mono tracking-[1.2px] m-0" aria-label="Review Status">// REVIEW_STATUS</h3>
      {#each taskPrs as pr (pr.id)}
        {#if pr.review_status && pr.review_status !== 'none'}
          <div class="mb-3">
            <div class="flex items-center justify-between gap-2 mb-1.5">
              <span class="text-xs text-base-content/50">{pr.title}</span>
              <span class="text-[0.65rem] font-semibold px-1.5 py-0.5 rounded {pr.review_status === 'approved' ? 'bg-success/15 text-success' : pr.review_status === 'changes_requested' ? 'bg-warning/15 text-warning' : 'bg-base-content/15 text-base-content/50'}">
                {#if pr.review_status === 'approved'}✓ Approved
                {:else if pr.review_status === 'changes_requested'}✗ Changes Requested
                {:else if pr.review_status === 'review_required'}⏳ Review Required
                {/if}
              </span>
            </div>
          </div>
        {/if}
      {/each}
    </section>
  {/if}

  <!-- PR Comments Section -->
  {#if taskPrs.length > 0}
    {@const allComments = taskPrs.flatMap(pr => (prCommentsByPr.get(pr.id) || []).map(c => ({ ...c, prTitle: pr.title })))}
    {@const totalUnaddressed = allComments.filter(c => c.addressed === 0).length}
    {#if allComments.length > 0}
      <section class="flex flex-col gap-2.5">
        <div class="flex items-center gap-2">
          <h3 class="text-[10px] font-bold text-primary font-mono tracking-[1.2px] m-0" aria-label="PR Comments">// PR_COMMENTS</h3>
          {#if totalUnaddressed > 0}
            <span class="badge badge-error badge-xs">{totalUnaddressed}</span>
          {:else}
            <span class="badge badge-success badge-xs">All addressed</span>
          {/if}
        </div>
        {#each taskPrs as pr (pr.id)}
          {@const comments = prCommentsByPr.get(pr.id) || []}
          {#if comments.length > 0}
            <div class="flex flex-col gap-2">
              {#each comments as comment (comment.id)}
                <div class="bg-base-100 border border-base-300 rounded-lg overflow-hidden {comment.addressed === 1 ? 'opacity-50' : ''}">
                  <div class="flex items-center gap-2 px-3 py-2 bg-base-200 border-b border-base-300">
                    <div class="w-5 h-5 rounded-full bg-primary/15 flex items-center justify-center text-[0.6rem] font-bold text-primary shrink-0">
                      {comment.author.charAt(0).toUpperCase()}
                    </div>
                    <span class="text-xs font-semibold text-base-content">@{comment.author}</span>
                    <span class="text-[0.65rem] text-base-content/40 ml-auto">{timeAgo(comment.created_at * 1000)}</span>
                  </div>
                  {#if comment.file_path}
                    <div class="px-3 py-1 bg-base-200/50 border-b border-base-300 text-[0.65rem] font-mono text-base-content/50">
                      {comment.file_path}{#if comment.line_number}:{comment.line_number}{/if}
                    </div>
                  {/if}
                  <div class="px-3 py-2.5 text-sm [&_.markdown-body]:text-sm [&_.markdown-body_pre]:text-xs [&_.markdown-body_code]:text-xs [&_.markdown-body_p]:my-1">
                    <MarkdownContent content={comment.body} />
                  </div>
                  <div class="px-3 py-1.5 border-t border-base-300 bg-base-200/30">
                    {#if comment.addressed === 0}
                      <button
                        class="btn btn-ghost btn-xs text-base-content/50 hover:text-success hover:bg-success/10"
                        onclick={() => handleMarkAddressed(comment.id, pr.id)}>
                        ✓ Mark addressed
                      </button>
                    {:else}
                      <span class="text-[0.65rem] text-success font-medium">✓ Addressed</span>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        {/each}
      </section>
    {/if}
   {/if}

 </div>
 
 <style>
  @keyframes ready-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }
  .merge-ready {
    animation: ready-pulse 2s ease-in-out infinite;
  }
</style>
