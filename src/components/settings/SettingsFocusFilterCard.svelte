<script lang="ts">
	import { ListFilter } from 'lucide-svelte';
	import { ALL_TASK_STATES, type TaskState } from '../../lib/taskState';
	import { TASK_STATE_LABELS } from '../../lib/taskStatePresentation';
	import { DEFAULT_FOCUS_STATES } from '../../lib/boardFilters';

	interface Props {
		focusStates: TaskState[];
		onFocusStatesChange: (states: TaskState[]) => void;
		disabled: boolean;
	}

	const { focusStates, onFocusStatesChange, disabled }: Props = $props();

	function toggleState(state: TaskState, checked: boolean) {
		const updated = checked
			? [...focusStates, state]
			: focusStates.filter((s) => s !== state);
		onFocusStatesChange(updated);
	}
</script>

<div id="section-focus-filter" class="rounded-lg border border-base-300 overflow-hidden" style="background-color: var(--project-bg, oklch(var(--b1)))">
	<div class="flex items-center justify-between px-5 py-3 border-b border-base-300">
		<div class="flex items-center gap-2">
			<ListFilter size={16} class="text-base-content" />
			<h3 class="text-xs font-semibold text-base-content uppercase tracking-wider">Focus Filter States</h3>
		</div>
	</div>

	<div class="p-5 flex flex-col gap-3 {disabled ? 'opacity-50 pointer-events-none' : ''}">
		<p class="text-xs text-base-content/50">Choose which task states appear in the "Focus now" filter chip on the board.</p>

		<div class="flex flex-col gap-1">
			{#each ALL_TASK_STATES as state}
				<label class="flex items-center gap-2 cursor-pointer">
					<input
						type="checkbox"
						checked={focusStates.includes(state)}
						onchange={(e) => toggleState(state, e.currentTarget.checked)}
						class="checkbox checkbox-sm"
					/>
					<span class="text-sm text-base-content">{TASK_STATE_LABELS[state]}</span>
				</label>
			{/each}
		</div>

		<button
			class="btn btn-ghost btn-sm border border-base-300 text-base-content/50 hover:border-base-content hover:text-base-content"
			onclick={() => onFocusStatesChange(DEFAULT_FOCUS_STATES)}
		>
			Reset to Default
		</button>
	</div>
</div>
