<script lang="ts">
  import { LayoutDashboard, GitPullRequest, Settings, Sparkles } from 'lucide-svelte'
  import type { AppView } from '../lib/types'

  interface Props {
    currentView: AppView
    onNavigate: (view: AppView) => void
  }

  let { currentView, onNavigate }: Props = $props()

  const navItems: { view: AppView; Icon: typeof LayoutDashboard }[] = [
    { view: 'board', Icon: LayoutDashboard },
    { view: 'pr_review', Icon: GitPullRequest },
    { view: 'skills', Icon: Sparkles },
    { view: 'settings', Icon: Settings },
  ]
</script>

<div class="w-14 h-full bg-neutral flex flex-col items-center py-4 gap-5">
  <div class="w-8 h-8 bg-primary flex items-center justify-center rounded">
    <span class="text-black font-bold font-mono text-xs">&gt;_</span>
  </div>

  <div class="w-8 h-px bg-[#333333]"></div>

  {#each navItems as { view, Icon }}
    <button
      class="cursor-pointer {currentView === view ? 'text-primary' : 'text-[#666666]'}"
      onclick={() => onNavigate(view)}
    >
      <Icon size={20} />
    </button>
  {/each}
</div>
