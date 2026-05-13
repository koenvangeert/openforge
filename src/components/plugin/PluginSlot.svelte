<script lang="ts">
  import { onDestroy, type Component } from 'svelte'
  import { get } from 'svelte/store'
  import PluginErrorBoundary from './PluginErrorBoundary.svelte'
  import { enabledPluginIds, installedPlugins } from '../../lib/plugin/pluginStore'
  import { resolveContributions, resolveContributionsForSlot } from '../../lib/plugin/contributionResolver'
  import type { PluginManifest } from '../../lib/plugin/types'
  import { makePluginViewKey } from '../../lib/plugin/types'
  import { getRegisteredComponent, getRegisteredRenderableComponent, resolvePluginComponent } from '../../lib/plugin/componentRegistry'
  import type { PluginComponentSource } from '../../lib/plugin/componentRegistry'
  import { activatePlugin, getPluginRenderProps } from '../../lib/plugin/pluginRegistry'

  interface Props {
    slotType: 'views' | 'taskPaneTabs' | 'sidebarPanels' | 'commands' | 'settingsSections' | 'backgroundServices'
    slotId?: string
    taskId?: string
    projectId?: string | null
    projectName?: string
    projectPath?: string
    panelSide?: 'left' | 'right'
  }

  let { slotType, slotId = '', taskId = '', projectId = null, projectName = '', projectPath = '', panelSide }: Props = $props()

  let renderedComponents = $state(new Map<string, Component<Record<string, unknown>>>())
  let renderErrors = $state(new Map<string, string>())
  let activationRunId = 0

  let slotLayout = $derived(slotType === 'views' || slotType === 'taskPaneTabs' ? 'fill' : null)
  let slotHostClass = $derived(slotLayout === 'fill' ? 'flex flex-col flex-1 min-h-0 overflow-hidden' : '')

  let enabledManifests = $derived(
    Array.from($enabledPluginIds)
      .map(id => $installedPlugins.get(id)?.manifest)
      .filter((m): m is PluginManifest => m !== undefined)
  )

  let allContributions = $derived(resolveContributions(enabledManifests))
  let slotContributions = $derived.by(() => {
    const baseContributions = slotId
      ? resolveContributionsForSlot(allContributions, slotType, slotId)
      : allContributions[slotType]

    if (slotType === 'sidebarPanels' && panelSide) {
      return baseContributions.filter((contribution) => contribution.side === panelSide)
    }

    return baseContributions
  })

  function getContributionComponent(contrib: (typeof slotContributions)[number]): PluginComponentSource<Record<string, unknown>> | undefined {
    if (slotType === 'views') {
      return getRegisteredComponent(makePluginViewKey(contrib.pluginId, contrib.contributionId))
    }

    if (slotType === 'taskPaneTabs' || slotType === 'sidebarPanels' || slotType === 'settingsSections') {
      return getRegisteredRenderableComponent(slotType, contrib.namespacedId)
    }

    return undefined
  }

  function normalizeErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  function setRenderError(viewKey: string, error: unknown): void {
    const next = new Map(renderErrors)
    next.set(viewKey, normalizeErrorMessage(error))
    renderErrors = next
  }

  onDestroy(() => {
    activationRunId += 1
  })

  $effect(() => {
    renderedComponents = new Map()
    renderErrors = new Map()

    if ((slotType !== 'views' && slotType !== 'taskPaneTabs' && slotType !== 'sidebarPanels' && slotType !== 'settingsSections') || slotContributions.length === 0) {
      return
    }

    const runId = ++activationRunId
    const contributions = [...slotContributions]

    void (async () => {
      const nextRenderedComponents = new Map<string, Component<Record<string, unknown>>>()
      const nextRenderErrors = new Map<string, string>()

      for (const contrib of contributions) {
        const viewKey = makePluginViewKey(contrib.pluginId, contrib.contributionId)

        let componentSource = getContributionComponent(contrib)
        if (!componentSource) {
          await activatePlugin(contrib.pluginId)
          componentSource = getContributionComponent(contrib)
        }

        if (runId !== activationRunId) {
          return
        }

        if (componentSource) {
          try {
            nextRenderedComponents.set(viewKey, await resolvePluginComponent(componentSource))
          } catch (error) {
            nextRenderErrors.set(viewKey, normalizeErrorMessage(error))
          }
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

  })
</script>

<div data-slot-type={slotType} data-slot-id={slotId} data-slot-layout={slotLayout} class={slotHostClass}>
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
        {@const renderProps = getPluginRenderProps(contrib.pluginId, { projectId, taskId })}
        <Component {...renderProps} {taskId} {projectId} {projectName} {projectPath} />
      </svelte:boundary>
    {:else}
      <div data-contribution-id={contrib.contributionId}></div>
    {/if}
  {/each}
</div>
