<script lang="ts">
  import { LayoutDashboard, GitPullRequest, GitPullRequestCreateArrow, Settings, Sparkles, Bug, ListChecks } from 'lucide-svelte'
  import type { AppView } from '../lib/types'

  interface Props {
    currentView: AppView
    onNavigate: (view: AppView) => void
    reviewRequestCount: number
    authoredPrCount: number
    creaturesEnabled: boolean
  }

  let { currentView, onNavigate, reviewRequestCount = 0, authoredPrCount = 0, creaturesEnabled = false }: Props = $props()

  const allNavItems: { view: AppView; Icon: typeof LayoutDashboard }[] = [
    { view: 'board', Icon: LayoutDashboard },
    { view: 'pr_review', Icon: GitPullRequest },
    { view: 'my_prs', Icon: GitPullRequestCreateArrow },
    { view: 'skills', Icon: Sparkles },
    { view: 'creatures', Icon: Bug },
    { view: 'workqueue', Icon: ListChecks },
    { view: 'settings', Icon: Settings },
  ]

  let navItems = $derived(
    creaturesEnabled
      ? allNavItems
      : allNavItems.filter(item => item.view !== 'creatures')
  )
</script>

<div class="w-16 h-full bg-neutral flex flex-col items-center py-4 gap-5">
  <div class="w-9 h-9 bg-primary flex items-center justify-center rounded">
    <span class="text-black font-bold font-mono text-sm">&gt;_</span>
  </div>

  <div class="w-9 h-px bg-neutral-content/20"></div>

  {#each navItems as { view, Icon }}
    <button
      class="relative cursor-pointer {currentView === view ? 'text-primary' : 'text-neutral-content/40'}"
      onclick={() => onNavigate(view)}
    >
      <Icon size={24} />
      {#if view === 'pr_review' && reviewRequestCount > 0}
        <span class="badge badge-error badge-xs absolute -top-2 -right-3 text-[0.6rem] font-bold min-w-4 h-4">{reviewRequestCount}</span>
      {/if}
      {#if view === 'my_prs' && authoredPrCount > 0}
        <span class="badge badge-warning badge-xs absolute -top-2 -right-3 text-[0.6rem] font-bold min-w-4 h-4">{authoredPrCount}</span>
      {/if}
    </button>
  {/each}
</div>
