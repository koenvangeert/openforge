<script lang="ts">
  import { LayoutDashboard, GitPullRequest, Settings, Sparkles, ListChecks } from 'lucide-svelte'
  import type { AppView } from '../lib/types'
  import { commandHeld } from '../lib/stores'

  interface Props {
    currentView: AppView
    onNavigate: (view: AppView) => void
    reviewRequestCount: number
    authoredPrCount: number
    modalsOpen?: boolean
  }

  let { currentView, onNavigate, reviewRequestCount = 0, authoredPrCount = 0, modalsOpen = false }: Props = $props()

  const navItems: { view: AppView; Icon: typeof LayoutDashboard; shortcut: string }[] = [
    { view: 'board', Icon: LayoutDashboard, shortcut: 'H' },
    { view: 'pr_review', Icon: GitPullRequest, shortcut: 'G' },
    { view: 'skills', Icon: Sparkles, shortcut: 'L' },
    { view: 'workqueue', Icon: ListChecks, shortcut: 'R' },
    { view: 'settings', Icon: Settings, shortcut: ',' },
  ]
</script>

<div class="w-16 h-full bg-neutral flex flex-col items-center py-4 gap-5">
  <div class="w-9 h-9 bg-primary flex items-center justify-center rounded">
    <span class="text-black font-bold font-mono text-sm">&gt;_</span>
  </div>

  <div class="w-9 h-px bg-neutral-content/20"></div>

  {#each navItems as { view, Icon, shortcut }}
    <button
      class="relative cursor-pointer {currentView === view ? 'text-primary' : 'text-neutral-content/40'}"
      onclick={() => onNavigate(view)}
    >
      <Icon size={24} />
      {#if view === 'pr_review' && reviewRequestCount > 0}
        <span class="badge badge-error badge-xs absolute -top-2 -right-3 text-[0.6rem] font-bold min-w-4 h-4">{reviewRequestCount}</span>
      {/if}
      {#if view === 'pr_review' && authoredPrCount > 0}
        <span class="badge badge-warning badge-xs absolute -bottom-2 -right-3 text-[0.6rem] font-bold min-w-4 h-4">{authoredPrCount}</span>
      {/if}
      {#if $commandHeld && !modalsOpen}
        <kbd class="kbd kbd-xs absolute -bottom-2 -left-3 bg-neutral-content/10 text-neutral-content/60 border-neutral-content/20 text-[0.55rem] min-w-4 h-4 flex items-center justify-center pointer-events-none">{shortcut}</kbd>
      {/if}
    </button>
  {/each}
</div>
