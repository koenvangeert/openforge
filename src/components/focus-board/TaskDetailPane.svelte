<script lang="ts">
  import type { BoardStatus, Task, PullRequestInfo, PrComment } from '../../lib/types'
  import { parseCheckRuns, splitCheckRuns } from '../../lib/types'
  import { getTaskDependencySummaries, getWaitingDependencyCount } from '../../lib/taskDependencies'
  import { getPrComments, markCommentAddressed, openUrl } from '../../lib/ipc'
  import MarkdownContent from '../shared/content/MarkdownContent.svelte'
  import { getPrStatusChips } from '../../lib/prStatusPresentation'
  import { getGitHubMarkdownImageBaseUrl } from '../../lib/githubMarkdown'
  import PrStatusChip from '../shared/ui/PrStatusChip.svelte'

  interface Props {
    task: Task | null
    allTasks?: Task[]
    pullRequests: PullRequestInfo[]
    onOpenFullView: () => void
  }

  let { task, allTasks = [], pullRequests, onOpenFullView }: Props = $props()

  let comments = $state<PrComment[]>([])
  let unaddressedComments = $derived(comments.filter(c => c.addressed === 0))
  let markdownImageBaseUrlsByPrId = $derived(new Map(pullRequests.map((pr) => [pr.id, getGitHubMarkdownImageBaseUrl(pr)])))
  let dependencies = $derived(task ? getTaskDependencySummaries(task, allTasks) : [])
  let waitingDependencyCount = $derived(task ? getWaitingDependencyCount(task, allTasks) : 0)

  function dependencyStatusLabel(status: BoardStatus | null): string {
    return status ?? 'unknown'
  }

  function dependencyStatusClass(status: BoardStatus | null): string {
    if (status === 'done') return 'badge-success'
    if (status === 'doing') return 'badge-warning'
    if (status === 'backlog') return 'badge-ghost'
    return 'badge-neutral'
  }

  async function fetchComments() {
    if (!task || pullRequests.length === 0) {
      comments = []
      return
    }
    const results = await Promise.all(pullRequests.map((pr) => getPrComments(pr.id)))
    comments = results.flat()
  }

  async function handleMarkAddressed(commentId: number) {
    await markCommentAddressed(commentId)
    await fetchComments()
  }

  function getCommentImageBaseUrl(comment: PrComment): string | null {
    return markdownImageBaseUrlsByPrId.get(comment.pr_id) ?? null
  }

  $effect(() => {
    void task
    void pullRequests
    fetchComments()
  })
</script>

{#if task === null}
  <div class="rounded-[20px] bg-base-100 border border-base-300/60 shadow-sm p-5 flex flex-col gap-4 overflow-y-auto h-full items-center justify-center">
    <p class="text-xs text-base-content/40">Select a task to see details</p>
  </div>
{:else}
  <div class="rounded-[20px] bg-base-100 border border-base-300/60 shadow-sm p-5 flex flex-col gap-4 overflow-y-auto h-full">

    <div class="flex items-center gap-2 flex-wrap">
      <span class="font-mono text-sm font-bold text-primary">{task.id}</span>
      <button
        class="btn btn-ghost btn-xs ml-auto text-base-content/60 hover:text-primary"
        onclick={onOpenFullView}
      >
        Open full view →
      </button>
    </div>

    <section class="flex flex-col gap-1.5">
      <span class="font-mono text-[10px] font-bold text-primary">// INITIAL_PROMPT</span>
      <p class="text-xs text-base-content/70 leading-relaxed whitespace-pre-wrap break-words">{task.initial_prompt}</p>
    </section>

    <section class="flex flex-col gap-1.5">
      <span class="font-mono text-[10px] font-bold text-primary">// SUMMARY</span>
      {#if task.summary}
        <div class="text-xs text-base-content/70 leading-relaxed break-words [&_.markdown-body]:text-xs [&_.markdown-body_pre]:text-[10px] [&_.markdown-body_code]:text-[10px] [&_.markdown-body_p]:m-0">
          <MarkdownContent content={task.summary.replace(/\\n/g, '\n')} />
        </div>
      {:else}
        <p class="text-xs text-base-content/40">No summary yet.</p>
      {/if}
    </section>

    {#if dependencies.length > 0}
      <section class="flex flex-col gap-2" aria-label="Dependencies" aria-live="polite">
        <span class="font-mono text-[10px] font-bold text-primary">// DEPENDS_ON</span>
        <div class="flex flex-wrap gap-1.5">
          {#each dependencies as dependency (dependency.id)}
            <span class="badge badge-xs gap-1 border border-base-300 {dependencyStatusClass(dependency.status)}" title={dependency.title}>
              <span class="font-mono">{dependency.id}</span>
              <span class="opacity-80">{dependencyStatusLabel(dependency.status)}</span>
            </span>
          {/each}
        </div>
        <p class="text-xs text-base-content/40">
          {#if waitingDependencyCount === 0}
            All dependencies done
          {:else}
            Waiting on {waitingDependencyCount} {waitingDependencyCount === 1 ? 'dep' : 'deps'}
          {/if}
        </p>
      </section>
    {/if}

    {#if pullRequests.length > 0}
      <section class="flex flex-col gap-2">
        <span class="font-mono text-[10px] font-bold text-primary">// PULL_REQUESTS</span>
        {#each pullRequests as pr (pr.id)}
          <div class="rounded-xl bg-base-200/50 border border-base-300/40 p-3 flex flex-col gap-2">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-[0.65rem] font-semibold uppercase px-1.5 py-0.5 rounded tracking-wider {pr.state === 'open' ? 'bg-success/15 text-success' : pr.state === 'merged' ? 'bg-secondary/15 text-secondary' : 'bg-error/15 text-error'}">
                {pr.state}
              </span>
              {#each getPrStatusChips(pr, 'compact').filter(c => c.type === 'merge' && c.variant === 'error') as chip}
                <PrStatusChip {chip} />
              {/each}
              <span class="text-xs text-base-content font-medium">{pr.title}</span>
            </div>
            <button
              class="btn btn-link btn-xs p-0 h-auto min-h-0 text-primary no-underline hover:underline text-[0.7rem] break-all text-left justify-start"
              onclick={() => openUrl(pr.url)}
            >
              {pr.url}
            </button>
          </div>
        {/each}
      </section>
    {/if}

    {#if pullRequests.some((pr) => pr.ci_status)}
      <section class="flex flex-col gap-2">
        <span class="font-mono text-[10px] font-bold text-primary">// PIPELINE_STATUS</span>
        {#each pullRequests as pr (pr.id)}
          {#if pr.ci_status}
            {@const checkRuns = parseCheckRuns(pr.ci_check_runs)}
            {@const { visible, passingCount } = splitCheckRuns(checkRuns)}
            {@const ciChip = getPrStatusChips(pr, 'detail').find(c => c.type === 'ci')}
            <div class="flex flex-col gap-1.5">
              <div class="flex items-center justify-between gap-2">
                <span class="text-xs text-base-content/50">{pr.title}</span>
                {#if ciChip}
                  <PrStatusChip chip={ciChip} />
                {:else if pr.ci_status}
                  <span class="text-[0.65rem] font-semibold px-1.5 py-0.5 rounded {pr.ci_status === 'success' ? 'bg-success/15 text-success' : pr.ci_status === 'failure' ? 'bg-error/15 text-error' : pr.ci_status === 'pending' ? 'bg-warning/15 text-warning' : 'bg-base-content/15 text-base-content/50'} flex items-center gap-1 w-fit">
                    {#if pr.ci_status === 'success'}Passing
                    {:else if pr.ci_status === 'failure'}Failing
                    {:else if pr.ci_status === 'pending'}Running
                    {:else}— No CI{/if}
                  </span>
                {/if}
              </div>
              {#if visible.length > 0 || passingCount > 0}
                <div class="flex flex-col gap-1 pl-1">
                  {#each visible as check (check.id)}
                    <div class="flex items-center gap-1.5 font-mono text-[10px]">
                      <span class="{check.conclusion === 'failure' ? 'text-error' : check.status !== 'completed' ? 'text-warning' : 'text-base-content/40'}">
                        {#if check.conclusion === 'failure'}✗
                        {:else if check.status !== 'completed'}⏳
                        {:else}—{/if}
                      </span>
                      <span class="text-base-content/70">{check.name}</span>
                    </div>
                  {/each}
                  {#if passingCount > 0}
                    <div class="flex items-center gap-1.5 font-mono text-[10px]">
                      <span class="text-success">✓</span>
                      <span class="text-base-content/40">{passingCount} passing</span>
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {/if}
        {/each}
      </section>
    {/if}

    <section class="flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <span class="font-mono text-[10px] font-bold text-primary">// PR_COMMENTS</span>
        {#if unaddressedComments.length > 0}
          <span class="badge badge-error badge-sm text-[10px] font-mono">{unaddressedComments.length}</span>
        {/if}
      </div>
      {#if unaddressedComments.length === 0}
        <p class="text-xs text-base-content/40">No comments.</p>
      {:else}
        <div class="flex flex-col gap-2">
          {#each unaddressedComments as comment (comment.id)}
            <div class="rounded-xl bg-base-200/50 border border-base-300/40 p-3 flex flex-col gap-1.5">
              <div class="flex items-center justify-between gap-2">
                <span class="text-[0.65rem] font-semibold text-base-content/60">{comment.author}</span>
                {#if comment.addressed === 0}
                  <button
                    class="btn btn-ghost btn-xs text-success text-[0.65rem] h-auto min-h-0 py-0.5"
                    onclick={() => handleMarkAddressed(comment.id)}
                  >
                    ✓ Mark addressed
                  </button>
                {/if}
              </div>
              <div class="text-xs text-base-content/70 leading-relaxed [&_.markdown-body]:text-xs [&_.markdown-body_pre]:text-[10px] [&_.markdown-body_code]:text-[10px] [&_.markdown-body_p]:m-0">
                <MarkdownContent content={comment.body} imageBaseUrl={getCommentImageBaseUrl(comment)} />
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </section>

  </div>
{/if}
