<script lang="ts">
  import type { TaskDependencySummary, TaskDependentSummary } from '../../../lib/taskDependencies'
  import { getDependentReadinessLabel } from '../../../lib/taskDependencies'
  import { getDependencyStatusPresentation } from '../../../lib/dependencyStatusPresentation'

  type RelationshipKind = 'dependencies' | 'dependents'
  type SectionDensity = 'full' | 'compact'
  type RelationshipSummary = TaskDependencySummary | TaskDependentSummary

  interface Props {
    kind: RelationshipKind
    items: RelationshipSummary[]
    waitingDependencyCount?: number
    density?: SectionDensity
  }

  let { kind, items, waitingDependencyCount = 0, density = 'full' }: Props = $props()

  let isFull = $derived(density === 'full')
  let isDependencies = $derived(kind === 'dependencies')
  let sectionLabel = $derived(isDependencies ? 'Dependencies' : 'Dependent tasks')
  let sectionHeading = $derived(isDependencies ? '// DEPENDS_ON' : '// DEPENDENTS')
  let sectionElementClass = $derived(isFull ? 'flex flex-col gap-2.5' : 'flex flex-col gap-2')
  let headingElementClass = $derived(isFull
    ? 'text-[10px] font-bold text-primary font-mono tracking-[1.2px] m-0'
    : 'font-mono text-[10px] font-bold text-primary'
  )
  let itemListClass = $derived(isFull ? 'flex flex-wrap gap-2' : 'flex flex-wrap gap-1.5')
  let badgeClass = $derived(isFull
    ? 'badge badge-sm gap-1.5 border border-base-300 max-w-full min-w-0'
    : 'badge badge-xs gap-1 border border-base-300'
  )
  let footerClass = $derived(isFull ? 'text-[11px] text-base-content/50' : 'text-xs text-base-content/40')
  let titleSpanClass = $derived(isFull ? 'truncate min-w-0' : 'hidden')
  let idSpanClass = $derived(isFull ? 'font-mono shrink-0' : 'font-mono')
  let statusSpanClass = $derived(isFull ? 'opacity-80 shrink-0' : 'opacity-80')
  let readinessSpanClass = $derived(isFull ? 'opacity-80 shrink-0' : 'opacity-80')
  let dependencyLabel = $derived(isFull ? 'dependency' : 'dep')
  let dependencyPluralLabel = $derived(isFull ? 'dependencies' : 'deps')
  let dependencyWaitingText = $derived(waitingDependencyCount === 0
    ? 'All dependencies done'
    : `Waiting on ${waitingDependencyCount} ${waitingDependencyCount === 1 ? dependencyLabel : dependencyPluralLabel}`
  )
  let dependentSummaryText = $derived(`${items.length} ${items.length === 1 ? 'task depends' : 'tasks depend'} on this one`)

  function hasDisplayTitle(item: RelationshipSummary): boolean {
    return isFull && item.displayTitle !== null
  }

  function getReadinessLabel(item: RelationshipSummary): string {
    return getDependentReadinessLabel(item as TaskDependentSummary, isFull)
  }
</script>

{#if items.length > 0}
  <section class={sectionElementClass} aria-label={sectionLabel} aria-live="polite">
    {#if isFull}
      <h3 class={headingElementClass}>{sectionHeading}</h3>
    {:else}
      <span class={headingElementClass}>{sectionHeading}</span>
    {/if}
    <div class={itemListClass}>
      {#each items as item (item.id)}
        {@const statusPresentation = getDependencyStatusPresentation(item.status)}
        <span class="{badgeClass} {statusPresentation.badgeClass}" title={item.tooltipTitle}>
          <span class={idSpanClass}>{item.id}</span>
          <span class={statusSpanClass}>{statusPresentation.label}</span>
          {#if hasDisplayTitle(item)}
            <span class={titleSpanClass}>{item.displayTitle}</span>
          {/if}
          {#if !isDependencies}
            <span class={readinessSpanClass}>· {getReadinessLabel(item)}</span>
          {/if}
        </span>
      {/each}
    </div>
    {#if isFull}
      <div class={footerClass}>
        {#if isDependencies}
          {dependencyWaitingText}
        {:else}
          {dependentSummaryText}
        {/if}
      </div>
    {:else}
      <p class={footerClass}>
        {#if isDependencies}
          {dependencyWaitingText}
        {:else}
          {dependentSummaryText}
        {/if}
      </p>
    {/if}
  </section>
{/if}
