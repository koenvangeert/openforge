<script lang="ts">
  import type { Component } from 'svelte'
  import { get } from 'svelte/store'
  import PluginErrorBoundary from './PluginErrorBoundary.svelte'
  import { enabledPluginIds, installedPlugins } from '../../lib/plugin/pluginStore'
  import { resolveContributions, resolveContributionsForSlot } from '../../lib/plugin/contributionResolver'
  import type { PluginManifest } from '../../lib/plugin/types'
  import { makePluginViewKey } from '../../lib/plugin/types'
  import { getRegisteredComponent } from '../../lib/plugin/componentRegistry'
  import { activatePlugin } from '../../lib/plugin/pluginRegistry'

  interface Props {
    slotType: 'views' | 'taskPaneTabs' | 'sidebarPanels' | 'commands' | 'settingsSections' | 'backgroundServices'
    slotId?: string
    projectName?: string
  }

  let { slotType, slotId = '', projectName = '' }: Props = $props()

  let renderedComponents = $state(new Map<string, Component<Record<string, unknown>>>())
  let renderErrors = $state(new Map<string, string>())
  let activationRunId = 0

  let enabledManifests = $derived(
    Array.from($enabledPluginIds)
      .map(id => $installedPlugins.get(id)?.manifest)
      .filter((m): m is PluginManifest => m !== undefined)
  )

  let allContributions = $derived(resolveContributions(enabledManifests))
  let slotContributions = $derived(resolveContributionsForSlot(allContributions, slotType, slotId))

  function normalizeErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  function setRenderError(viewKey: string, error: unknown): void {
    const next = new Map(renderErrors)
    next.set(viewKey, normalizeErrorMessage(error))
    renderErrors = next
  }

  $effect(() => {
    renderedComponents = new Map()
    renderErrors = new Map()

    if (slotType !== 'views' || slotContributions.length === 0) {
      return
    }

    const runId = ++activationRunId
    const contributions = [...slotContributions]

    void (async () => {
      const nextRenderedComponents = new Map<string, Component<Record<string, unknown>>>()
      const nextRenderErrors = new Map<string, string>()

      for (const contrib of contributions) {
        const viewKey = makePluginViewKey(contrib.pluginId, contrib.contributionId)

        let component = getRegisteredComponent(viewKey)
        if (!component) {
          await activatePlugin(contrib.pluginId)
          component = getRegisteredComponent(viewKey)
        }

        if (runId !== activationRunId) {
          return
        }

        if (component) {
          nextRenderedComponents.set(viewKey, component)
          continue
        }

        const pluginError = get(installedPlugins).get(contrib.pluginId)?.error
        if (pluginError) {
          nextRenderErrors.set(viewKey, pluginError)
        }
      }

      if (runId !== activationRunId) {
        return
      }

      renderedComponents = nextRenderedComponents
      renderErrors = nextRenderErrors
    })()

    return () => {
      activationRunId += 1
    }
  })
</script>

<div data-slot-type={slotType} data-slot-id={slotId}>
  {#each slotContributions as contrib (contrib.namespacedId)}
    {@const viewKey = makePluginViewKey(contrib.pluginId, contrib.contributionId)}
    {@const Component = renderedComponents.get(viewKey)}
    {@const errorMessage = renderErrors.get(viewKey) ?? $installedPlugins.get(contrib.pluginId)?.error ?? null}

    {#if errorMessage}
      <PluginErrorBoundary
        pluginId={contrib.pluginId}
        pluginName={contrib.title ?? contrib.pluginId}
        errorMessage={errorMessage}
      />
    {:else if Component}
      <svelte:boundary onerror={(error) => setRenderError(viewKey, error)}>
        {#snippet failed(error, _reset)}
          <PluginErrorBoundary
            pluginId={contrib.pluginId}
            pluginName={contrib.title ?? contrib.pluginId}
            errorMessage={normalizeErrorMessage(error)}
          />
        {/snippet}
        <Component projectName={projectName} />
      </svelte:boundary>
    {:else}
      <div data-contribution-id={contrib.contributionId}></div>
    {/if}
  {/each}
</div>
