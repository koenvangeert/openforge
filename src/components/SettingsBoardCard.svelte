<script lang="ts">
	import { LayoutGrid } from 'lucide-svelte';
	import type { BoardColumnConfig } from '../lib/types';
	import type { TaskState } from '../lib/taskState';
	import {
		ALL_TASK_STATES,
		TASK_STATE_LABELS,
		DEFAULT_BOARD_COLUMNS,
		validateBoardColumns,
	} from '../lib/boardColumns';

	interface Props {
		columns: BoardColumnConfig[];
		onColumnsChange: (columns: BoardColumnConfig[]) => void;
		disabled: boolean;
	}

	const { columns, onColumnsChange, disabled }: Props = $props();

	const validation = $derived(validateBoardColumns(columns));

	function addColumn() {
		const newColumn: BoardColumnConfig = {
			id: crypto.randomUUID(),
			name: '',
			statuses: [],
			underlyingStatus: 'doing',
		};
		onColumnsChange([...columns, newColumn]);
	}

	function removeColumn(id: string) {
		onColumnsChange(columns.filter((c) => c.id !== id));
	}

	function updateName(id: string, name: string) {
		onColumnsChange(columns.map((c) => (c.id === id ? { ...c, name } : c)));
	}

	function toggleState(id: string, state: TaskState, checked: boolean) {
		onColumnsChange(
			columns.map((c) => {
				if (c.id !== id) return c;
				const statuses = checked
					? [...c.statuses, state]
					: c.statuses.filter((s) => s !== state);
				return { ...c, statuses };
			})
		);
	}
</script>

<div id="section-board" class="rounded-lg border border-base-300 overflow-hidden" style="background-color: var(--project-bg, oklch(var(--b1)))">
	<div class="flex items-center justify-between px-5 py-3 border-b border-base-300">
		<div class="flex items-center gap-2">
			<LayoutGrid size={16} class="text-base-content" />
			<h3 class="text-xs font-semibold text-base-content uppercase tracking-wider">Board Columns</h3>
		</div>
		<button class="btn btn-sm bg-neutral text-neutral-content" onclick={addColumn}>
			Add Column
		</button>
	</div>

	<div class="p-5 flex flex-col gap-3 {disabled ? 'opacity-50 pointer-events-none' : ''}">
		{#each columns as column (column.id)}
			<div class="bg-base-200 border border-base-300 rounded-md p-3 flex flex-col gap-2">
				<div class="flex items-center justify-between">
					<span class="text-[0.7rem] text-base-content/50 font-semibold uppercase tracking-wider">Column</span>
					{#if columns.length > 1}
						<button
							class="btn btn-ghost btn-xs text-base-content/50 hover:bg-error hover:text-error-content"
							onclick={() => removeColumn(column.id)}
							title="Remove column"
						>
							&times;
						</button>
					{/if}
				</div>

			<label class="flex flex-col gap-1">
				<span class="text-[0.7rem] text-base-content/50">Name</span>
				<input
					type="text"
					value={column.name}
					oninput={(e) => updateName(column.id, e.currentTarget.value)}
					placeholder="Column name"
					class="input input-bordered input-sm w-full"
				/>
			</label>

		<div class="collapse collapse-arrow border border-base-300 rounded-md" style="background-color: var(--project-bg, oklch(var(--b1)))">
					<input type="checkbox" />
					<div class="collapse-title text-sm font-medium py-2 min-h-0">
						Task States
						<span class="badge badge-sm ml-2">{column.statuses.length}</span>
					</div>
					<div class="collapse-content flex flex-col gap-1 pb-2">
						{#each ALL_TASK_STATES as state}
							<label class="flex items-center gap-2 cursor-pointer">
								<input
									type="checkbox"
									checked={column.statuses.includes(state)}
									onchange={(e) => toggleState(column.id, state, e.currentTarget.checked)}
									class="checkbox checkbox-sm"
								/>
								<span class="text-sm text-base-content">{TASK_STATE_LABELS[state]}</span>
							</label>
						{/each}
					</div>
				</div>
			</div>
		{/each}

		{#if !validation.valid && validation.errors.length > 0}
			<div class="alert alert-warning">
				<ul class="list-disc list-inside text-sm">
					{#each validation.errors as error}
						<li>{error}</li>
					{/each}
				</ul>
			</div>
		{/if}

		<button
			class="btn btn-ghost btn-sm border border-base-300 text-base-content/50 hover:border-base-content hover:text-base-content"
			onclick={() => onColumnsChange(DEFAULT_BOARD_COLUMNS)}
		>
			Reset to Default
		</button>
	</div>
</div>
