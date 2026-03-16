<script lang="ts">
  import { FolderOpen } from 'lucide-svelte'
  import { PROJECT_COLORS } from '../lib/projectColors'

  interface Props {
    projectName: string
    projectPath: string
    aiProvider: string
    useWorktrees: boolean
    projectColor: string
    disabled: boolean
    opencodeInstalled: boolean
    opencodeVersion: string | null
    claudeInstalled: boolean
    claudeVersion: string | null
    claudeAuthenticated: boolean
    onProjectNameChange: (value: string) => void
    onProjectPathChange: (value: string) => void
    onAiProviderChange: (value: string) => void
    onUseWorktreesChange: () => void
    onProjectColorChange: (value: string) => void
  }

  let {
    projectName,
    projectPath,
    aiProvider,
    useWorktrees,
    projectColor,
    disabled,
    opencodeInstalled,
    opencodeVersion,
    claudeInstalled,
    claudeVersion,
    claudeAuthenticated,
    onProjectNameChange,
    onProjectPathChange,
    onAiProviderChange,
    onUseWorktreesChange,
    onProjectColorChange,
  }: Props = $props()
</script>

<div id="section-general" class="rounded-lg border border-base-300 overflow-hidden" style="background-color: var(--project-bg, oklch(var(--b1)))">
  <div class="flex items-center gap-2 px-5 py-3 border-b border-base-300">
    <FolderOpen size={16} class="text-base-content" />
    <h3 class="text-sm font-semibold text-base-content m-0">General</h3>
  </div>

  <div class="p-5 flex flex-col gap-4 {disabled ? 'opacity-50 pointer-events-none' : ''}">
    <div class="grid grid-cols-2 gap-4">
      <label class="flex flex-col gap-1">
        <span class="text-[0.7rem] text-base-content/50 uppercase tracking-wider">Project Name</span>
        <input
          type="text"
          value={projectName}
          oninput={(e) => onProjectNameChange(e.currentTarget.value)}
          placeholder="My Project"
          class="input input-bordered input-sm w-full"
        />
      </label>

      <label class="flex flex-col gap-1">
        <span class="text-[0.7rem] text-base-content/50 uppercase tracking-wider">Project Path</span>
        <input
          type="text"
          value={projectPath}
          oninput={(e) => onProjectPathChange(e.currentTarget.value)}
          placeholder="/path/to/project"
          class="input input-bordered input-sm w-full"
        />
      </label>
    </div>

    <!-- AI Provider -->
    <div class="flex flex-col gap-2">
      <label class="flex flex-col gap-1">
        <span class="text-[0.7rem] text-base-content/50 uppercase tracking-wider">AI Provider</span>
        <select
          class="select select-bordered select-sm w-full max-w-xs"
          value={aiProvider}
          onchange={(e) => onAiProviderChange((e.currentTarget as HTMLSelectElement).value)}
        >
          <option value="claude-code">Claude Code</option>
          <option value="opencode">OpenCode</option>
        </select>
      </label>

      <div class="flex flex-col gap-1 text-xs">
        <div class="flex items-center gap-2">
          {#if opencodeInstalled}
            <span class="text-success">✓</span>
            <span>OpenCode {opencodeVersion || ''}</span>
          {:else}
            <span class="text-error">✗</span>
            <span class="text-base-content/50">OpenCode not installed</span>
          {/if}
        </div>
        <div class="flex items-center gap-2">
          {#if claudeInstalled}
            <span class="text-success">✓</span>
            <span>Claude Code {claudeVersion || ''}</span>
            {#if claudeAuthenticated}
              <span class="badge badge-xs badge-success">Authenticated</span>
            {:else}
              <span class="badge badge-xs badge-warning">Not authenticated</span>
            {/if}
          {:else}
            <span class="text-error">✗</span>
            <span class="text-base-content/50">Claude Code not installed</span>
          {/if}
        </div>
      </div>

      {#if (aiProvider === 'opencode' && !opencodeInstalled) || (aiProvider === 'claude-code' && !claudeInstalled)}
        <div class="alert alert-warning text-xs py-2">
          <span>Selected provider is not installed</span>
        </div>
      {/if}
    </div>

    <div class="border-b border-base-300"></div>

    <label class="flex items-center justify-between cursor-pointer">
      <div class="flex flex-col gap-0.5">
        <span class="text-sm text-base-content">Git Worktrees</span>
        <span class="text-[0.7rem] text-base-content/50">Run agents in isolated git worktrees. When disabled, agents work directly in the project directory.</span>
      </div>
      <input
        type="checkbox"
        class="toggle toggle-primary toggle-sm"
        checked={useWorktrees}
        onchange={onUseWorktreesChange}
        data-testid="use-worktrees-toggle"
      />
    </label>

    <div class="border-b border-base-300"></div>

    <div class="flex flex-col gap-2">
      <span class="text-[0.7rem] text-base-content/50 uppercase tracking-wider">Project Color</span>
      <div class="flex gap-2 flex-wrap">
        <button
          type="button"
          class="w-7 h-7 rounded-full border-2 transition-all duration-150 cursor-pointer hover:scale-110 {projectColor === '' ? 'border-primary ring-2 ring-primary/30 scale-110' : 'border-base-content/20'}"
          style="background-color: #9ca3af"
          title="Default Gray"
          onclick={() => onProjectColorChange('')}
        ></button>
        {#each PROJECT_COLORS as color (color.id)}
          <button
            type="button"
            class="w-7 h-7 rounded-full border-2 transition-all duration-150 cursor-pointer hover:scale-110 {projectColor === color.id ? 'border-primary ring-2 ring-primary/30 scale-110' : 'border-base-content/20'}"
            style="background-color: {color.swatch}"
            title={color.label}
            onclick={() => onProjectColorChange(color.id)}
          ></button>
        {/each}
      </div>
    </div>
  </div>
</div>
