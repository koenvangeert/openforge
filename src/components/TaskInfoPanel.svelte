<script lang="ts">
  import { onMount } from 'svelte'
  import type { Task, PrComment, KanbanColumn, WorktreeInfo } from '../lib/types'
  import { COLUMN_LABELS, parseCheckRuns, isReadyToMerge } from '../lib/types'
  import { ticketPrs, selectedTaskId } from '../lib/stores'
  import { 
    updateTaskStatus, 
    getPrComments, 
    markCommentAddressed, 
    openUrl, 
    getWorktreeForTask,
    getConfig
  } from '../lib/ipc'
  import CopyButton from './CopyButton.svelte'
  import JiraDetailModal from './JiraDetailModal.svelte'

  interface Props {
    task: Task
  }

  let { task }: Props = $props()

  let worktree = $state<WorktreeInfo | null>(null)
  let prCommentsByPr = $state<Map<number, PrComment[]>>(new Map())
  let jiraBaseUrl = $state('')
  let showJiraDetail = $state(false)

  async function loadWorktree(taskId: string) {
    try {
      worktree = await getWorktreeForTask(taskId)
    } catch (e) {
      console.error('Failed to load worktree:', e)
      worktree = null
    }
  }

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
    loadWorktree(task.id)
  })

  $effect(() => {
    // Reload PR comments when task changes or ticketPrs updates
    const prs = $ticketPrs.get(task.id)
    if (prs) {
      loadPrComments()
    }
  })


  onMount(async () => {
    loadPrComments()
    jiraBaseUrl = (await getConfig('jira_base_url')) || ''
  })

  async function handleStatusChange(newStatus: KanbanColumn) {
    if (newStatus === task.status) return
    try {
      await updateTaskStatus(task.id, newStatus)
      if (newStatus === 'done') {
        $selectedTaskId = null
      }
    } catch (e) {
      console.error('Failed to update status:', e)
    }
  }

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

  function getUnaddressedCount(comments: PrComment[]): number {
    return comments.filter(c => c.addressed === 0).length
  }

  let statusLabel = $derived(COLUMN_LABELS[task.status as KanbanColumn] || task.status)
  let taskPrs = $derived($ticketPrs.get(task.id) || [])
</script>

<div class="flex flex-col gap-5 p-5 overflow-y-auto bg-base-200 h-full">
  <!-- Title / Initial Prompt Section -->
  <section class="flex flex-col gap-2.5">
    <h3 class="text-xs font-semibold text-primary uppercase tracking-wider m-0">Initial Prompt</h3>
    <div class="text-sm text-base-content leading-relaxed whitespace-pre-wrap break-words">{task.title}</div>
  </section>

  <!-- Metadata Section -->
  <section class="flex flex-col gap-2.5">
    <h3 class="text-xs font-semibold text-primary uppercase tracking-wider m-0">Task Info</h3>
    
    <div class="flex flex-col gap-1">
      <span class="text-[0.7rem] text-base-content/50 uppercase tracking-wider">Status</span>
      <span class="inline-block px-2 py-1 bg-base-300 border border-base-300 rounded text-sm font-medium w-fit text-base-content">{statusLabel}</span>
    </div>

    {#if task.jira_key}
      <div class="flex flex-col gap-1">
        <span class="text-[0.7rem] text-base-content/50 uppercase tracking-wider">JIRA</span>
        <span class="text-sm text-base-content">{task.jira_key}</span>
      </div>
      {#if task.jira_status}
        <div class="flex flex-col gap-1">
          <span class="text-[0.7rem] text-base-content/50 uppercase tracking-wider">JIRA Status</span>
          <span class="text-sm text-base-content">{task.jira_status}</span>
        </div>
      {/if}
      {#if task.jira_assignee}
        <div class="flex flex-col gap-1">
          <span class="text-[0.7rem] text-base-content/50 uppercase tracking-wider">JIRA Assignee</span>
          <span class="text-sm text-base-content">{task.jira_assignee}</span>
        </div>
      {/if}
      <div class="flex flex-col gap-2 pt-2">
        {#if jiraBaseUrl}
          <button
            class="btn btn-link btn-xs p-0 h-auto min-h-0 text-primary no-underline hover:underline text-[0.7rem]"
            onclick={() => openUrl(`${jiraBaseUrl}/browse/${task.jira_key}`)}
          >
            Open in Jira
          </button>
        {/if}
        {#if task.jira_description}
          <button
            class="btn btn-ghost btn-xs border border-base-300"
            onclick={() => showJiraDetail = true}
          >
            View Jira Details
          </button>
        {/if}
      </div>
    {/if}

    <div class="flex flex-col gap-1">
      <span class="text-[0.7rem] text-base-content/50 uppercase tracking-wider">Created</span>
      <span class="text-sm text-base-content">{formatDate(task.created_at)}</span>
    </div>

    <div class="flex flex-col gap-1">
      <span class="text-[0.7rem] text-base-content/50 uppercase tracking-wider">Updated</span>
      <span class="text-sm text-base-content">{formatDate(task.updated_at)}</span>
    </div>

    {#if worktree}
      <div class="flex flex-col gap-1">
        <span class="text-[0.7rem] text-base-content/50 uppercase tracking-wider">Worktree Branch</span>
        <div class="flex items-start gap-1.5">
          <span class="text-sm text-base-content font-mono flex-1 min-w-0">{worktree.branch_name}</span>
          <CopyButton text={worktree.branch_name} label="Copy branch name" />
        </div>
      </div>
      <div class="flex flex-col gap-1">
        <span class="text-[0.7rem] text-base-content/50 uppercase tracking-wider">Worktree Path</span>
        <div class="flex items-start gap-1.5">
          <span class="text-sm text-base-content font-mono text-xs break-all flex-1 min-w-0">{worktree.worktree_path}</span>
          <CopyButton text={worktree.worktree_path} label="Copy path" />
        </div>
      </div>
      {#if worktree.opencode_port}
        <div class="flex flex-col gap-1">
          <span class="text-[0.7rem] text-base-content/50 uppercase tracking-wider">Server</span>
          <span class="text-sm text-base-content">Port {worktree.opencode_port} · {worktree.status}</span>
        </div>
      {/if}
    {/if}
  </section>


  {#if task.status !== 'done'}
    <section class="flex flex-col gap-2.5">
      <button class="btn btn-success btn-block text-base font-bold shadow-sm hover:shadow-md transition-shadow" onclick={() => handleStatusChange('done')}>
        Move to Done
      </button>
    </section>
  {/if}

  <!-- Merge Status Section -->
  {#if taskPrs.some(pr => pr.state === 'merged' || isReadyToMerge(pr))}
    <section class="flex flex-col gap-2.5">
      <h3 class="text-xs font-semibold text-primary uppercase tracking-wider m-0">Merge Status</h3>
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
              <span class="text-[0.65rem] font-semibold px-1.5 py-0.5 rounded bg-success/25 text-success merge-ready">&#x25CF; Ready to Merge</span>
            </div>
          </div>
        {/if}
      {/each}
    </section>
  {/if}

  <!-- PR Links Section -->
  {#if taskPrs.length > 0}
    <section class="flex flex-col gap-2.5">
      <h3 class="text-xs font-semibold text-primary uppercase tracking-wider m-0">Pull Requests</h3>
      <div class="flex flex-col gap-2">
        {#each taskPrs as pr (pr.id)}
          <div class="bg-base-100 border border-base-300 rounded-md p-3 flex flex-col gap-2">
            <div class="flex items-center gap-2">
              <span class="text-[0.65rem] font-semibold uppercase px-1.5 py-0.5 rounded tracking-wider {pr.state === 'open' ? 'bg-success text-success-content' : pr.state === 'merged' ? 'bg-secondary text-secondary-content' : 'bg-error text-error-content'}">
                {pr.state}
              </span>
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
      <h3 class="text-xs font-semibold text-primary uppercase tracking-wider m-0">Pipeline Status</h3>
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
      <h3 class="text-xs font-semibold text-primary uppercase tracking-wider m-0">Review Status</h3>
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
    <section class="flex flex-col gap-2.5">
      <h3 class="text-xs font-semibold text-primary uppercase tracking-wider m-0">PR Comments</h3>
      {#each taskPrs as pr (pr.id)}
        {@const comments = prCommentsByPr.get(pr.id) || []}
        {@const unaddressedCount = getUnaddressedCount(comments)}
        {#if comments.length > 0}
          <div class="mb-4">
            <div class="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-base-300">
              <span class="text-xs text-base-content/50 font-medium">{pr.title}</span>
              {#if unaddressedCount > 0}
                <span class="badge badge-error badge-sm">{unaddressedCount} unaddressed</span>
              {/if}
            </div>
            <div class="flex flex-col gap-2">
              {#each comments as comment (comment.id)}
                <div class="bg-base-100 border border-base-300 rounded-md p-3 flex flex-col gap-2 {comment.addressed === 1 ? 'opacity-60' : ''}">
                  <div class="flex gap-2 items-center flex-wrap">
                    <span class="text-xs font-semibold text-primary">@{comment.author}</span>
                    {#if comment.file_path}
                      <span class="text-[0.7rem] text-base-content/50 font-mono">
                        {comment.file_path}{#if comment.line_number}:{comment.line_number}{/if}
                      </span>
                    {/if}
                  </div>
                  <div class="text-sm text-base-content leading-snug whitespace-pre-wrap break-words">{comment.body}</div>
                  {#if comment.addressed === 0}
                    <button 
                      class="btn btn-soft btn-xs w-fit shadow-sm hover:shadow-md transition-shadow"
                      onclick={() => handleMarkAddressed(comment.id, pr.id)}>
                      Mark Addressed
                    </button>
                  {:else}
                    <span class="text-[0.7rem] text-success font-medium">✓ Addressed</span>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/if}
      {/each}
     </section>
   {/if}

   {#if showJiraDetail && task.jira_key}
     <JiraDetailModal {task} {jiraBaseUrl} onClose={() => showJiraDetail = false} />
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
