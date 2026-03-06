<script lang="ts">
  import { Folder, Plug, FileText, Zap, Brain, KeyRound, Settings2 } from 'lucide-svelte'

  interface Props {
    activeSection: string
    onNavigate: (sectionId: string) => void
    hasProject: boolean
  }

  let { activeSection, onNavigate, hasProject }: Props = $props()

  const projectItems: { id: string; label: string; Icon: typeof Folder }[] = [
    { id: 'general', label: 'General', Icon: Folder },
    { id: 'integrations', label: 'Integrations', Icon: Plug },
    { id: 'instructions', label: 'Instructions', Icon: FileText },
    { id: 'actions', label: 'Actions', Icon: Zap },
  ]

  const globalItems: { id: string; label: string; Icon: typeof Folder }[] = [
    { id: 'preferences', label: 'Preferences', Icon: Settings2 },
    { id: 'ai', label: 'AI & Voice', Icon: Brain },
    { id: 'credentials', label: 'Credentials', Icon: KeyRound },
  ]

  function handleNavigate(sectionId: string) {
    onNavigate(sectionId)
  }
</script>

<div class="w-[220px] bg-base-100 border-r border-base-300 flex flex-col py-6 px-4 shrink-0">
  <div class="text-xs font-semibold text-base-content/50 uppercase tracking-wider mb-6">
    Settings
  </div>

  <nav class="flex flex-col gap-1">
    <div class="text-[0.65rem] font-semibold text-base-content/40 uppercase tracking-wider px-3 mb-1">Project</div>
    {#each projectItems as { id, label, Icon }}
      {@const isActive = activeSection === id}
      {@const isDimmed = !hasProject}
      <a
        href="#section-{id}"
        role="link"
        class="flex items-center gap-3 px-3 py-2 rounded transition-colors {isActive
          ? 'border-l-[3px] border-l-primary bg-primary/5 text-primary'
          : 'text-base-content/50'} {isDimmed ? 'opacity-50 pointer-events-none' : ''}"
        onclick={(e) => {
          e.preventDefault()
          handleNavigate(id)
        }}
      >
        <Icon size={20} class="shrink-0" />
        <span class="text-sm font-medium">{label}</span>
      </a>
    {/each}

    <div class="border-b border-base-300 my-2"></div>

    <div class="text-[0.65rem] font-semibold text-base-content/40 uppercase tracking-wider px-3 mb-1">Global</div>
    {#each globalItems as { id, label, Icon }}
      {@const isActive = activeSection === id}
      <a
        href="#section-{id}"
        role="link"
        class="flex items-center gap-3 px-3 py-2 rounded transition-colors {isActive
          ? 'border-l-[3px] border-l-primary bg-primary/5 text-primary'
          : 'text-base-content/50'}"
        onclick={(e) => {
          e.preventDefault()
          handleNavigate(id)
        }}
      >
        <Icon size={20} class="shrink-0" />
        <span class="text-sm font-medium">{label}</span>
      </a>
    {/each}
  </nav>
</div>
