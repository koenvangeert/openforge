<script lang="ts">
  import { Check, X, Clock } from 'lucide-svelte';
  import type { PrStatusChipSpec } from '../../../lib/prStatusPresentation';

  let { chip }: { chip: PrStatusChipSpec } = $props();

  const variantClasses: Record<PrStatusChipSpec['variant'], { bg: string, dot: string, text: string }> = {
    success: { bg: 'bg-[var(--chip-running-bg)]', dot: 'bg-[var(--chip-running-dot)]', text: 'text-[var(--chip-running-text)]' },
    error: { bg: 'bg-[var(--chip-error-bg)]', dot: 'bg-[var(--chip-error-dot)]', text: 'text-[var(--chip-error-text)]' },
    pending: { bg: 'bg-[var(--chip-paused-bg)]', dot: 'bg-[var(--chip-paused-dot)]', text: 'text-[var(--chip-paused-text)]' },
    muted: { bg: 'bg-[var(--chip-soft-bg)]', dot: '', text: 'text-[var(--chip-soft-text)]' },
    neutral: { bg: 'bg-[var(--chip-stopped-bg)]', dot: 'bg-[var(--chip-stopped-dot)]', text: 'text-[var(--chip-stopped-text)]' },
    done: { bg: 'bg-[var(--chip-done-bg)]', dot: 'bg-[var(--chip-done-dot)]', text: 'text-[var(--chip-done-text)]' },
    merged: { bg: 'bg-[var(--chip-soft-bg)]', dot: '', text: 'text-secondary' }
  };

  const detailClasses: Record<PrStatusChipSpec['variant'], string> = {
    success: 'bg-success/15 text-success',
    error: 'bg-error/15 text-error',
    pending: 'bg-warning/15 text-warning',
    muted: 'bg-base-content/15 text-base-content/50',
    neutral: 'bg-base-content/15 text-base-content/50',
    done: 'bg-primary/15 text-primary',
    merged: 'bg-secondary/15 text-secondary'
  };
</script>

{#if chip.surface === 'detail'}
  <!-- Detail surface -->
  <span class="text-[0.65rem] font-semibold px-1.5 py-0.5 rounded {detailClasses[chip.variant]} flex items-center gap-1 w-fit">
    {#if chip.icon === 'check'}<Check class="w-3 h-3" />
    {:else if chip.icon === 'cross'}<X class="w-3 h-3" />
    {:else if chip.icon === 'clock'}<Clock class="w-3 h-3" />
    {/if}
    {chip.label}
  </span>
{:else}
  <!-- Compact surface -->
  <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 {variantClasses[chip.variant].bg}">
    {#if chip.variant !== 'muted'}
      <span class="w-1.5 h-1.5 rounded-full {variantClasses[chip.variant].dot}"></span>
    {/if}
    <span class="text-[10px] font-medium {variantClasses[chip.variant].text}">{chip.label}</span>
  </span>
{/if}
