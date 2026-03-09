<script lang="ts">
	import { Zap } from 'lucide-svelte';
	import type { Action } from '../lib/types';

	interface Props {
		actions: Action[];
		disabled: boolean;
		onAddAction: () => void;
		onDeleteAction: (actionId: string) => void;
		onToggleAction: (actionId: string) => void;
		onUpdateAction: (actionId: string, field: string, value: string) => void;
		onResetActions: () => void;
	}

	const {
		actions,
		disabled,
		onAddAction,
		onDeleteAction,
		onToggleAction,
		onUpdateAction,
		onResetActions
	} = $props();

	function handleDelete(action: Action) {
		if (action.builtin) {
			if (!confirm('Delete built-in action "' + action.name + '"? You can restore it with Reset to Defaults.')) {
				return;
			}
		}
		onDeleteAction(action.id);
	}

	function handleReset() {
		if (!confirm('Reset all actions to defaults? This will remove any custom actions.')) {
			return;
		}
		onResetActions();
	}
</script>

<div id="section-actions" class="bg-base-100 rounded-lg border border-base-300 overflow-hidden">
	<div class="flex items-center justify-between px-5 py-3 border-b border-base-300">
		<div class="flex items-center gap-2">
			<Zap size={16} class="text-base-content" />
			<h3 class="text-xs font-semibold text-base-content uppercase tracking-wider">Actions</h3>
		</div>
		<button
			class="btn btn-sm bg-neutral text-neutral-content"
			onclick={onAddAction}
		>
			Add Action
		</button>
	</div>

	<div class="p-5 flex flex-col gap-3 {disabled ? 'opacity-50 pointer-events-none' : ''}">
		<p class="text-[0.7rem] text-base-content/50 mb-2 leading-snug">
			Configure reusable prompt templates for tasks.
		</p>

		{#each actions as action (action.id)}
			<div class="bg-base-200 border border-base-300 rounded-md p-3 flex flex-col gap-2">
				<div class="flex items-center justify-between">
					<label class="flex items-center gap-2 cursor-pointer">
						<input
							type="checkbox"
							checked={action.enabled}
							onchange={() => onToggleAction(action.id)}
							class="checkbox checkbox-primary checkbox-sm"
						/>
						<span class="text-sm font-semibold text-base-content">{action.name}</span>
					</label>
					<button
						class="btn btn-ghost btn-xs text-base-content/50 hover:bg-error hover:text-error-content"
						onclick={() => handleDelete(action)}
						title="Delete action"
					>
						&times;
					</button>
				</div>

				<label class="flex flex-col gap-1">
					<span class="text-[0.7rem] text-base-content/50">Name</span>
					<input
						type="text"
						value={action.name}
						oninput={(e) => onUpdateAction(action.id, 'name', e.currentTarget.value)}
						placeholder="Action name"
						class="input input-bordered input-sm w-full"
					/>
				</label>

			<label class="flex flex-col gap-1">
				<span class="text-[0.7rem] text-base-content/50">Prompt</span>
				<textarea
					value={action.prompt}
					oninput={(e) => onUpdateAction(action.id, 'prompt', e.currentTarget.value)}
					placeholder="Instruction for the AI provider..."
					rows="3"
					class="textarea textarea-bordered w-full text-sm resize-y"
				></textarea>
			</label>
			</div>
		{/each}

		<button
			class="btn btn-ghost btn-sm border border-base-300 text-base-content/50 hover:border-base-content hover:text-base-content"
			onclick={handleReset}
		>
			Reset to Defaults
		</button>
	</div>
</div>
