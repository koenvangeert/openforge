<script lang="ts">
  import type { Task, PullRequestInfo } from '../lib/types'
  import { parseCheckRuns, splitCheckRuns, isReadyToMerge, isQueuedForMerge } from '../lib/types'
  import { ticketPrs } from '../lib/stores'
  import { forceGithubSync, getPullRequests, mergePullRequest, openUrl } from '../lib/ipc'
  import MarkdownContent from './MarkdownContent.svelte'
  import CopyButton from './CopyButton.svelte'

  interface Props {
    task: Task
    worktreePath: string | null
    jiraBaseUrl: string
  }

  interface MergeFeedback {
    kind: 'success' | 'warning' | 'error'
    message: string
  }

  type MergeSmokeOutcome = 'success' | 'warning' | 'error'

  let { task, worktreePath, jiraBaseUrl }: Props = $props()

  let mergeFeedbackByPr = $state<Map<number, MergeFeedback>>(new Map())
  let mergingPrId = $state<number | null>(null)
  const showMergeSmokeControls = typeof window !== 'undefined' && window.location.protocol.startsWith('http')

  function setMergeFeedback(prId: number, feedback: MergeFeedback | null) {
    const nextFeedback = new Map(mergeFeedbackByPr)

    if (feedback) {
      nextFeedback.set(prId, feedback)
    } else {
      nextFeedback.delete(prId)
    }

    mergeFeedbackByPr = nextFeedback
  }

  function setTaskPullRequests(nextPrs: PullRequestInfo[]) {
    const nextTicketPrs = new Map($ticketPrs)
    nextTicketPrs.set(task.id, nextPrs)
    ticketPrs.set(nextTicketPrs)
  }

  async function refreshTaskPullRequests() {
    const prs = await getPullRequests()
    setTaskPullRequests(prs.filter((pr) => pr.ticket_id === task.id))
  }

  async function handleMerge(pr: PullRequestInfo) {
    mergingPrId = pr.id
    setMergeFeedback(pr.id, null)

    try {
      await mergePullRequest(pr.repo_owner, pr.repo_name, pr.id)

      setTaskPullRequests(
        taskPrs.map((taskPr) => taskPr.id === pr.id
          ? { ...taskPr, state: 'merged', merged_at: Math.floor(Date.now() / 1000) }
          : taskPr)
      )

      setMergeFeedback(pr.id, { kind: 'success', message: 'Pull request merged successfully.' })

      try {
        const result = await forceGithubSync()

        if (result.errors > 0 || result.rate_limited) {
          const reason = result.rate_limited ? 'GitHub sync was rate limited after merge.' : 'GitHub sync reported errors after merge.'
          setMergeFeedback(pr.id, {
            kind: 'warning',
            message: `${reason} Pull request state may take a moment to fully refresh.`,
          })
        } else {
          await refreshTaskPullRequests()
        }
      } catch (e) {
        setMergeFeedback(pr.id, {
          kind: 'warning',
          message: `Pull request merged, but refresh failed: ${e instanceof Error ? e.message : String(e)}`,
        })
      }
    } catch (e) {
      setMergeFeedback(pr.id, {
        kind: 'error',
        message: e instanceof Error ? e.message : String(e),
      })
    } finally {
      mergingPrId = null
    }
  }

  function runMergeSmokeTest(pr: PullRequestInfo, outcome: MergeSmokeOutcome) {
    if (outcome === 'success') {
      setTaskPullRequests(
        taskPrs.map((taskPr) => taskPr.id === pr.id
          ? { ...taskPr, state: 'merged', merged_at: Math.floor(Date.now() / 1000) }
          : taskPr)
      )
      setMergeFeedback(pr.id, { kind: 'success', message: 'Smoke test: merge success message.' })
      return
    }

    if (outcome === 'warning') {
      setTaskPullRequests(
        taskPrs.map((taskPr) => taskPr.id === pr.id
          ? { ...taskPr, state: 'merged', merged_at: Math.floor(Date.now() / 1000) }
          : taskPr)
      )
      setMergeFeedback(pr.id, { kind: 'warning', message: 'Smoke test: merged, but refresh warning.' })
      return
    }

    setMergeFeedback(pr.id, { kind: 'error', message: 'Smoke test: merge failure message.' })
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
    <div class="text-xs text-base-content/80 leading-relaxed whitespace-pre-wrap break-words">{task.prompt ?? ''}</div>
  </section>

  <!-- Summary Section -->
  <section class="flex flex-col gap-2.5">
    <h3 class="text-[10px] font-bold text-primary font-mono tracking-[1.2px] m-0" aria-label="Summary">// SUMMARY</h3>
    {#if task.summary}
      <div class="text-sm [&_.markdown-body]:text-sm [&_.markdown-body_pre]:text-xs [&_.markdown-body_code]:text-xs [&_.markdown-body_p]:my-1">
        <MarkdownContent content={task.summary.replace(/\\n/g, '\n')} />
      </div>
    {:else}
      <div class="text-[11px] text-base-content/40">No summary yet</div>
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
  {#if taskPrs.some(pr => pr.state === 'merged' || isReadyToMerge(pr) || isQueuedForMerge(pr))}
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
            {#if mergeFeedbackByPr.has(pr.id)}
              {@const feedback = mergeFeedbackByPr.get(pr.id)}
              {#if feedback}
                <div class="text-[0.7rem] mt-1 {feedback.kind === 'success' ? 'text-success' : feedback.kind === 'warning' ? 'text-warning' : 'text-error'}">
                  {feedback.message}
                </div>
              {/if}
            {/if}
          </div>
        {:else if isQueuedForMerge(pr)}
          <div class="mb-3">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs text-base-content/50">{pr.title}</span>
              <span class="text-[0.65rem] font-semibold px-1.5 py-0.5 rounded bg-info/15 text-info merge-ready">&#x25CF; In Merge Queue</span>
            </div>
          </div>
        {:else if isReadyToMerge(pr)}
          <div class="mb-3">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs text-base-content/50">{pr.title}</span>
              <span class="text-[0.65rem] font-semibold px-1.5 py-0.5 rounded bg-info/15 text-info animate-pulse">&#x25CF; Ready to Merge</span>
            </div>
            <div class="mt-1.5 flex items-center gap-2">
              <button
                class="btn btn-success btn-xs"
                disabled={mergingPrId === pr.id}
                onclick={() => handleMerge(pr)}
              >
                {#if mergingPrId === pr.id}
                  <span class="loading loading-spinner loading-xs"></span>
                  Merging...
                {:else}
                  Merge
                {/if}
              </button>
              {#if mergeFeedbackByPr.has(pr.id)}
                {@const feedback = mergeFeedbackByPr.get(pr.id)}
                {#if feedback}
                  <span class="text-[0.7rem] {feedback.kind === 'success' ? 'text-success' : feedback.kind === 'warning' ? 'text-warning' : 'text-error'}">{feedback.message}</span>
                {/if}
              {/if}
            </div>
            {#if showMergeSmokeControls}
              <div class="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-base-300 bg-base-100 px-2 py-1.5">
                <span class="text-[0.65rem] font-mono text-base-content/50">smoke:</span>
                <button class="btn btn-ghost btn-xs" onclick={() => runMergeSmokeTest(pr, 'success')}>Success</button>
                <button class="btn btn-ghost btn-xs" onclick={() => runMergeSmokeTest(pr, 'warning')}>Warning</button>
                <button class="btn btn-ghost btn-xs" onclick={() => runMergeSmokeTest(pr, 'error')}>Failure</button>
              </div>
            {/if}
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
          {@const { visible, passingCount } = splitCheckRuns(checkRuns)}
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
            {#if visible.length > 0 || passingCount > 0}
              <div class="flex flex-col gap-1">
                {#each visible as check (check.id)}
                  <div class="flex items-center gap-1.5 text-xs">
                    <span class="w-4 text-center font-semibold {check.conclusion === 'failure' ? 'text-error' : check.status !== 'completed' ? 'text-warning' : 'text-base-content/50'}">
                      {#if check.conclusion === 'failure'}✗
                      {:else if check.status !== 'completed'}⏳
                      {:else}—{/if}
                    </span>
                    <span class="text-base-content">{check.name}</span>
                  </div>
                {/each}
                {#if passingCount > 0}
                  <div class="flex items-center gap-1.5 text-xs">
                    <span class="w-4 text-center font-semibold text-success">✓</span>
                    <span class="text-base-content/50">{passingCount} passing</span>
                  </div>
                {/if}
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

 </div>
