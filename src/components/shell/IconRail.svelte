<script lang="ts">
  import { Boxes, Code, FileText, FolderOpen, GitPullRequest, LayoutDashboard, Plug, Puzzle, Settings, Sparkles, Terminal, Wrench } from 'lucide-svelte'
  import type { AppView } from '../../lib/types'
  import { commandHeld } from '../../lib/stores'

  interface PluginNavItem {
    viewKey: AppView
    icon: string
    title: string
    shortcut: string | null
  }

  type IconComponent = typeof LayoutDashboard

  interface Props {
    currentView: AppView
    onNavigate: (view: AppView) => void
    reviewRequestCount: number
    authoredPrCount: number
    pluginNavItems?: PluginNavItem[]
    modalsOpen?: boolean
    railBg?: string
  }

  let { currentView, onNavigate, reviewRequestCount = 0, authoredPrCount = 0, pluginNavItems = [], modalsOpen = false, railBg = 'oklch(var(--b2))' }: Props = $props()

  const iconRegistry: Record<string, IconComponent> = {
    'layout-dashboard': LayoutDashboard,
    'folder-open': FolderOpen,
    'git-pull-request': GitPullRequest,
    sparkles: Sparkles,
    settings: Settings,
    terminal: Terminal,
    code: Code,
    'file-text': FileText,
    plug: Plug,
    puzzle: Puzzle,
    boxes: Boxes,
    wrench: Wrench,
  }

  const staticNavItems: { view: AppView; Icon: IconComponent; shortcut: string; label: string }[] = [
    { view: 'board', Icon: LayoutDashboard, shortcut: 'H', label: 'Board' },
    { view: 'files', Icon: FolderOpen, shortcut: 'O', label: 'Files' },
    { view: 'pr_review', Icon: GitPullRequest, shortcut: 'G', label: 'Pull Requests' },
    { view: 'skills', Icon: Sparkles, shortcut: 'L', label: 'Skills' },
    { view: 'settings', Icon: Settings, shortcut: ',', label: 'Settings' },
  ]

  let navItems = $derived([
    ...staticNavItems,
    ...pluginNavItems.map((item) => ({
      view: item.viewKey,
      Icon: iconRegistry[item.icon] ?? Plug,
      shortcut: item.shortcut ? item.shortcut.replace(/^[⌘⌃⌥⇧]+/, '').toUpperCase() : '',
      label: item.title,
    })),
  ])
</script>

<div class="w-16 h-full border-r border-base-300/50 flex flex-col items-center py-4 gap-5" style="background-color: {railBg}">
  {#each navItems as { view, Icon, shortcut, label }}
    <button
       class="relative cursor-pointer {currentView === view ? 'text-primary' : 'text-base-content/35'}"
      title={label}
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
        <kbd class="kbd kbd-xs absolute -bottom-2 -left-3 bg-base-content/10 text-base-content/40 border-base-content/20 text-[0.55rem] min-w-4 h-4 flex items-center justify-center pointer-events-none">{shortcut}</kbd>
      {/if}
    </button>
  {/each}

</div>
