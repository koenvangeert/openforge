<script lang="ts">
  import { FolderOpen } from 'lucide-svelte'

  interface Props {
    projectName: string
    projectPath: string
    aiProvider: string
    disabled: boolean
    opencodeInstalled: boolean
    opencodeVersion: string | null
    claudeInstalled: boolean
    claudeVersion: string | null
    claudeAuthenticated: boolean
    onProjectNameChange: (value: string) => void
    onProjectPathChange: (value: string) => void
    onAiProviderChange: (value: string) => void
  }

  let {
    projectName,
    projectPath,
    aiProvider,
    disabled,
    opencodeInstalled,
    opencodeVersion,
    claudeInstalled,
    claudeVersion,
    claudeAuthenticated,
    onProjectNameChange,
    onProjectPathChange,
    onAiProviderChange,
  }: Props = $props()
</script>

<div id="section-general" class="bg-base-100 rounded-lg border border-base-300 overflow-hidden">
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
  </div>
</div>
