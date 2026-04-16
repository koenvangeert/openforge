<script lang="ts">
  import { Blocks, Plus, Trash2, AlertCircle } from 'lucide-svelte'
  import {
    installedPlugins,
    enabledPluginIds,
    enablePlugin,
    disablePlugin
  } from '../../lib/plugin/pluginStore'
  import {
    installFromLocal,
    uninstallPlugin
  } from '../../lib/plugin/pluginRegistry'

  interface Props {
    projectId: string
    disabled?: boolean
  }

  let {
    projectId,
    disabled = false
  }: Props = $props()

  let installPath = $state('')
  let isInstalling = $state(false)
  let installError = $state<string | null>(null)

  let pluginsList = $derived(Array.from($installedPlugins.values()))

  async function handleInstall() {
    if (!installPath.trim()) return
    isInstalling = true
    installError = null
    try {
      await installFromLocal(installPath.trim(), projectId)
      installPath = ''
    } catch (e) {
      installError = e instanceof Error ? e.message : String(e)
    } finally {
      isInstalling = false
    }
  }

  async function handleToggle(pluginId: string, isCurrentlyEnabled: boolean) {
    if (isCurrentlyEnabled) {
      await disablePlugin(projectId, pluginId)
    } else {
      await enablePlugin(projectId, pluginId)
    }
  }

  async function handleUninstall(pluginId: string) {
    if (confirm('Are you sure you want to uninstall this plugin?')) {
      await uninstallPlugin(pluginId)
    }
  }
</script>

<div id="section-plugins" class="rounded-lg border border-base-300 overflow-hidden {disabled ? 'opacity-50 pointer-events-none' : ''}" style="background-color: var(--project-bg, oklch(var(--b1)))">
  <div class="flex items-center gap-2 px-5 py-3 border-b border-base-300">
    <Blocks size={16} class="text-base-content" />
    <h3 class="text-sm font-semibold text-base-content m-0">Plugins</h3>
  </div>

  <div class="p-5 flex flex-col gap-6">
    <!-- Install Section -->
    <div class="flex flex-col gap-2">
      <span class="text-[0.7rem] text-base-content/50 uppercase tracking-wider">Install Local Plugin</span>
      <div class="flex gap-2">
        <input
          type="text"
          bind:value={installPath}
          placeholder="Enter absolute path to plugin directory..."
          class="input input-bordered input-sm flex-1"
        />
        <button
          class="btn btn-primary btn-sm"
          onclick={handleInstall}
          disabled={isInstalling || !installPath.trim()}
        >
          <Plus size={14} />
          Install
        </button>
      </div>
      {#if installError}
        <div class="text-xs text-error flex items-center gap-1 mt-1">
          <AlertCircle size={12} />
          {installError}
        </div>
      {/if}
    </div>

    <!-- Installed Plugins List -->
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
                <div class="flex flex-col gap-1">
                  <div class="flex items-center gap-2">
                    <span class="font-medium text-sm text-base-content">{plugin.manifest.name}</span>
                    <span class="text-xs text-base-content/50 font-mono">v{plugin.manifest.version}</span>
                    {#if plugin.state === 'active'}
                      <span class="badge badge-success badge-xs">Active</span>
                    {:else if plugin.state === 'error'}
                      <span class="badge badge-error badge-xs">Error</span>
                    {:else if isEnabled}
                      <span class="badge badge-info badge-xs">Enabled</span>
                    {:else}
                      <span class="badge badge-ghost badge-xs">Disabled</span>
                    {/if}
                  </div>
                  <div class="text-xs text-base-content/70">{plugin.manifest.description}</div>
                  <div class="text-[10px] text-base-content/40 font-mono mt-1">{plugin.manifest.id}</div>
                  
                  <!-- Permissions -->
                  {#if plugin.manifest.permissions && plugin.manifest.permissions.length > 0}
                    <div class="flex items-center gap-2 mt-1">
                      <span class="text-[0.65rem] text-base-content/50 uppercase">Permissions:</span>
                      <div class="flex flex-wrap gap-1">
                        {#each plugin.manifest.permissions as permission}
                          <span class="badge badge-neutral badge-xs opacity-70">{permission}</span>
                        {/each}
                      </div>
                    </div>
                  {/if}
                </div>

                <div class="flex flex-col items-end gap-3 shrink-0">
                  <label class="flex items-center gap-2 cursor-pointer">
                    <span class="text-xs text-base-content/70">{isEnabled ? 'Enabled' : 'Disabled'}</span>
                    <input
                      type="checkbox"
                      class="toggle toggle-primary toggle-sm"
                      checked={isEnabled}
                      onchange={() => handleToggle(plugin.manifest.id, isEnabled)}
                    />
                  </label>

                  <button
                    class="btn btn-ghost btn-xs text-error hover:bg-error/10"
                    onclick={() => handleUninstall(plugin.manifest.id)}
                    title="Uninstall Plugin"
                  >
                    <Trash2 size={14} />
                    Uninstall
                  </button>
                </div>
              </div>

              <!-- Error State -->
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
