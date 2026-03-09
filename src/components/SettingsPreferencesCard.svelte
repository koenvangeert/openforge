<script lang="ts">
	import { Settings2 } from 'lucide-svelte'

	interface Props {
		taskIdPrefix: string
		onTaskIdPrefixChange: (value: string) => void
		isDarkMode: boolean
		onThemeToggle: () => void
		creaturesEnabled: boolean
		onCreaturesToggle: () => void
	}

	const { taskIdPrefix, onTaskIdPrefixChange, isDarkMode, onThemeToggle, creaturesEnabled, onCreaturesToggle }: Props = $props()

	// Sanitize input: strip non-alphanumeric, uppercase, max 5 chars
	function handleInput(e: Event) {
		const raw = (e.currentTarget as HTMLInputElement).value
		const sanitized = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 5)
		onTaskIdPrefixChange(sanitized)
	}

	const isValid = $derived(
		taskIdPrefix.length >= 1 && taskIdPrefix.length <= 5 && /^[A-Z0-9]+$/.test(taskIdPrefix)
	)
	const nextTaskNumber = $derived(1)
	const previewTaskId = $derived(isValid ? `${taskIdPrefix}-${nextTaskNumber}` : '')
</script>

<div id="section-preferences" class="bg-base-100 rounded-lg border border-base-300 overflow-hidden">
	<div class="flex items-center gap-2 px-5 py-3 border-b border-base-300">
		<Settings2 size={16} />
		<h3 class="text-sm font-semibold text-base-content m-0">Preferences</h3>
	</div>

	<div class="p-5">
		<div class="flex flex-col gap-4">
			<label class="flex items-center justify-between cursor-pointer">
				<div class="flex flex-col gap-0.5">
					<span class="text-sm text-base-content">Dark Mode</span>
					<span class="text-[0.7rem] text-base-content/50">Switch between light and dark theme</span>
				</div>
				<input
					type="checkbox"
					class="toggle toggle-primary toggle-sm"
					checked={isDarkMode}
					onchange={onThemeToggle}
					data-testid="theme-toggle"
				/>
			</label>

			<div class="border-b border-base-300"></div>

			<label class="flex items-center justify-between cursor-pointer">
				<div class="flex flex-col gap-0.5">
					<span class="text-sm text-base-content">Creatures Experiment</span>
					<span class="text-[0.7rem] text-base-content/50">Show the Creatures view in the sidebar</span>
				</div>
				<input
					type="checkbox"
					class="toggle toggle-primary toggle-sm"
					checked={creaturesEnabled}
					onchange={onCreaturesToggle}
					data-testid="creatures-toggle"
				/>
			</label>

			<div class="border-b border-base-300"></div>

			<label class="flex flex-col gap-1">
				<span class="text-[0.7rem] text-base-content/50">Task ID Prefix</span>
				<input
					type="text"
					value={taskIdPrefix}
					oninput={handleInput}
					placeholder="e.g. ABC"
					maxlength="5"
					class="input input-bordered input-sm w-full {!isValid && taskIdPrefix.length > 0
						? 'input-error'
						: ''}"
				/>
			</label>

			{#if !isValid && taskIdPrefix.length > 0}
				<p class="text-xs text-error">Task ID prefix must be 1-5 alphanumeric characters</p>
			{/if}

			{#if isValid}
				<div class="bg-base-200 rounded px-3 py-2">
					<p class="text-xs text-base-content/70">
						New tasks will be created as <span class="font-semibold">{previewTaskId}</span>,
						<span class="font-semibold">{taskIdPrefix}-2</span>, etc.
					</p>
				</div>
			{/if}
		</div>
	</div>
</div>
