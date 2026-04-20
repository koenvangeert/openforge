<script lang="ts">
  import { Blocks, AlertCircle } from 'lucide-svelte'
  import {
    installedPlugins,
    enabledPluginIds,
    enablePlugin,
    disablePlugin
  } from '../../lib/plugin/pluginStore'

  interface Props {
    projectId: string
    disabled?: boolean
  }

  let {
    projectId,
    disabled = false
  }: Props = $props()

  let pluginsList = $derived(Array.from($installedPlugins.values()))

  async function handleToggle(pluginId: string, isCurrentlyEnabled: boolean) {
    if (isCurrentlyEnabled) {
      await disablePlugin(projectId, pluginId)
    } else {
      await enablePlugin(projectId, pluginId)
    }
  }
</script>

<div id="section-plugins" class="rounded-lg border border-base-300 overflow-hidden {disabled ? 'opacity-50 pointer-events-none' : ''}" style="background-color: var(--project-bg, oklch(var(--b1)))">
  <div class="flex items-center gap-2 px-5 py-3 border-b border-base-300">
    <Blocks size={16} class="text-base-content" />
    <h3 class="text-sm font-semibold text-base-content m-0">Plugins</h3>
  </div>

  <div class="p-5 flex flex-col gap-6">
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
