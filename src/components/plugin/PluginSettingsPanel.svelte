<script lang="ts">
  import { Blocks, AlertCircle } from 'lucide-svelte'
  import {
    installedPlugins,
    enabledPluginIds,
    error as pluginLoadError,
  } from '../../lib/plugin/pluginStore'
  import {
    disablePluginForProject,
    enablePluginForProject,
    installFromLocal,
    installPluginFromGit,
    installPluginFromNpm,
    reloadPluginForProject,
  } from '../../lib/plugin/pluginRegistry'
  import type { PluginEntry } from '../../lib/plugin/types'

  interface Props {
    projectId: string
    disabled?: boolean
  }

  type SourceType = 'npm' | 'git' | 'local'

  let {
    projectId,
    disabled = false
  }: Props = $props()

  let sourceType = $state<SourceType>('npm')
  let sourceInput = $state('')
  let installError = $state<string | null>(null)
  let installMessage = $state<string | null>(null)
  let isInstalling = $state(false)
  let actionError = $state<string | null>(null)

  let pluginsList = $derived(Array.from($installedPlugins.values()))
  let sourcePlaceholder = $derived(sourceType === 'npm'
    ? '@acme/openforge-github@1.2.0'
    : sourceType === 'git'
      ? 'github.com/acme/openforge-tools@main'
      : '/path/to/local/plugin')

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  function sourceWithoutPrefix(source: string, prefix: string): string {
    return source.startsWith(prefix) ? source.slice(prefix.length) : source
  }

  async function handleInstall(event: SubmitEvent) {
    event.preventDefault()

    const source = sourceInput.trim()
    installError = null
    installMessage = null
    actionError = null

    if (!source) {
      installError = 'Enter a plugin package source to install.'
      return
    }

    isInstalling = true
    try {
      if (sourceType === 'npm') {
        await installPluginFromNpm(sourceWithoutPrefix(source, 'npm:'))
      } else if (sourceType === 'git') {
        await installPluginFromGit(sourceWithoutPrefix(source, 'git:'))
      } else {
        await installFromLocal(sourceWithoutPrefix(source, 'local:'), projectId)
      }

      installMessage = 'Installed app-wide. Enable it explicitly for this project when ready.'
      sourceInput = ''
    } catch (error) {
      installError = errorMessage(error)
    } finally {
      isInstalling = false
    }
  }

  async function handleEnable(pluginId: string) {
    actionError = null
    try {
      await enablePluginForProject(projectId, pluginId)
    } catch (error) {
      actionError = errorMessage(error)
    }
  }

  async function handleDisable(pluginId: string) {
    actionError = null
    try {
      await disablePluginForProject(projectId, pluginId)
    } catch (error) {
      actionError = errorMessage(error)
    }
  }

  async function handleReload(pluginId: string) {
    actionError = null
    try {
      await reloadPluginForProject(projectId, pluginId)
    } catch (error) {
      actionError = errorMessage(error)
    }
  }

  function sourceLabel(plugin: PluginEntry): string {
    if (plugin.sourceSpec) return plugin.sourceSpec
    if (plugin.isBuiltin) return 'Built-in plugin'
    return plugin.installPath ?? 'Unknown source'
  }

  function diagnosticsFor(plugin: PluginEntry, isEnabled: boolean): string {
    return JSON.stringify({
      pluginId: plugin.manifest.id,
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      apiVersion: plugin.manifest.apiVersion,
      state: plugin.state,
      enabledForProject: isEnabled,
      projectId,
      sourceKind: plugin.sourceKind ?? (plugin.isBuiltin ? 'builtin' : 'unknown'),
      sourceSpec: plugin.sourceSpec ?? null,
      installPath: plugin.installPath ?? null,
      frontend: plugin.manifest.frontend,
      backend: plugin.manifest.backend,
      error: plugin.error,
      loadError: $pluginLoadError,
    }, null, 2)
  }

  async function copyDiagnostics(plugin: PluginEntry, isEnabled: boolean) {
    actionError = null
    try {
      await navigator.clipboard.writeText(diagnosticsFor(plugin, isEnabled))
    } catch (error) {
      actionError = `Failed to copy diagnostics: ${errorMessage(error)}`
    }
  }
</script>

<div id="section-plugins" class="rounded-lg border border-base-300 overflow-hidden {disabled ? 'opacity-50 pointer-events-none' : ''}" style="background-color: var(--project-bg, oklch(var(--b1)))">
  <div class="flex items-center gap-2 px-5 py-3 border-b border-base-300">
    <Blocks size={16} class="text-base-content" />
    <h3 class="text-sm font-semibold text-base-content m-0">Plugins</h3>
  </div>

  <div class="p-5 flex flex-col gap-6">
    <form class="flex flex-col gap-3 p-4 border border-base-300 rounded-lg bg-base-200/30" onsubmit={handleInstall}>
      <div class="flex flex-col gap-1">
        <span class="text-[0.7rem] text-base-content/50 uppercase tracking-wider">Install package</span>
        <p class="text-xs text-base-content/60 m-0">Install state is app-wide. Installing never enables a plugin for this project automatically.</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-[10rem_1fr_auto] gap-3 items-end">
        <label class="form-control flex flex-col gap-1">
          <span class="label-text text-xs">Source type</span>
          <select class="select select-bordered select-sm" bind:value={sourceType} disabled={isInstalling}>
            <option value="npm">npm</option>
            <option value="git">git</option>
            <option value="local">local path</option>
          </select>
        </label>

        <label class="form-control flex flex-col gap-1">
          <span class="label-text text-xs">Package source</span>
          <input
            class="input input-bordered input-sm font-mono"
            bind:value={sourceInput}
            placeholder={sourcePlaceholder}
            disabled={isInstalling}
          />
        </label>

        <button class="btn btn-primary btn-sm" type="submit" disabled={isInstalling}>
          {isInstalling ? 'Installing…' : 'Install package'}
        </button>
      </div>

      {#if installMessage}
        <div class="text-xs text-success bg-success/10 p-2 rounded">{installMessage}</div>
      {/if}

      {#if installError}
        <div class="text-xs text-error bg-error/10 p-2 rounded flex items-start gap-2">
          <AlertCircle size={14} class="shrink-0 mt-0.5" />
          <span class="break-words">{installError}</span>
        </div>
      {/if}
    </form>

    {#if $pluginLoadError}
      <div class="text-xs text-error bg-error/10 p-3 rounded flex items-start gap-2">
        <AlertCircle size={14} class="shrink-0 mt-0.5" />
        <span class="break-words">{$pluginLoadError}</span>
      </div>
    {/if}

    {#if actionError}
      <div class="text-xs text-error bg-error/10 p-3 rounded flex items-start gap-2">
        <AlertCircle size={14} class="shrink-0 mt-0.5" />
        <span class="break-words">{actionError}</span>
      </div>
    {/if}

    <div class="flex flex-col gap-4">
      <span class="text-[0.7rem] text-base-content/50 uppercase tracking-wider">Installed Plugins</span>

      {#if pluginsList.length === 0}
        <div class="text-sm text-base-content/50 text-center py-4 border border-dashed border-base-300 rounded-lg">
          No plugins installed
        </div>
      {:else}
        <div class="flex flex-col gap-3">
          {#each pluginsList as plugin (plugin.manifest.id)}
            {@const isEnabled = $enabledPluginIds.has(plugin.manifest.id)}
            <div class="flex flex-col gap-3 p-4 border border-base-300 rounded-lg bg-base-200/30">
              <div class="flex items-start justify-between gap-4">
                <div class="flex flex-col gap-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-medium text-sm text-base-content">{plugin.manifest.name}</span>
                    <span class="text-xs text-base-content/50 font-mono">v{plugin.manifest.version}</span>
                    <span class="badge badge-neutral badge-xs">Installed app-wide</span>
                    {#if plugin.state === 'active'}
                      <span class="badge badge-success badge-xs">Active</span>
                    {:else if plugin.state === 'error'}
                      <span class="badge badge-error badge-xs">Error</span>
                    {:else if isEnabled}
                      <span class="badge badge-info badge-xs">Enabled for this project</span>
                    {:else}
                      <span class="badge badge-ghost badge-xs">Not enabled for this project</span>
                    {/if}
                  </div>
                  <div class="text-xs text-base-content/70">{plugin.manifest.description}</div>
                  <div class="text-[10px] text-base-content/40 font-mono mt-1 break-all">{plugin.manifest.id}</div>
                  <div class="text-[10px] text-base-content/50 font-mono break-all">{sourceLabel(plugin)}</div>

                  {#if plugin.manifest.permissions && plugin.manifest.permissions.length > 0}
                    <div class="flex items-center gap-2 mt-1 flex-wrap">
                      <span class="text-[0.65rem] text-base-content/50 uppercase">Permissions:</span>
                      <div class="flex flex-wrap gap-1">
                        {#each plugin.manifest.permissions as permission}
                          <span class="badge badge-neutral badge-xs opacity-70">{permission}</span>
                        {/each}
                      </div>
                    </div>
                  {/if}
                </div>

                <div class="flex flex-col items-end gap-2 shrink-0">
                  {#if isEnabled}
                    <button class="btn btn-outline btn-xs" type="button" onclick={() => handleDisable(plugin.manifest.id)}>Disable for this project</button>
                  {:else}
                    <button class="btn btn-primary btn-xs" type="button" onclick={() => handleEnable(plugin.manifest.id)}>Enable for this project</button>
                  {/if}
                  <button class="btn btn-ghost btn-xs" type="button" onclick={() => handleReload(plugin.manifest.id)}>Reload plugin</button>
                  <button class="btn btn-ghost btn-xs" type="button" onclick={() => copyDiagnostics(plugin, isEnabled)}>Copy diagnostics</button>
                </div>
              </div>

              {#if plugin.error}
                <div class="mt-2 text-xs text-error bg-error/10 p-2 rounded flex items-start gap-2">
                  <AlertCircle size={14} class="shrink-0 mt-0.5" />
                  <span class="break-words">{plugin.error}</span>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>
