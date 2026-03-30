<script lang="ts">
	import { FlaskConical } from 'lucide-svelte'

	interface Props {
		codeCleanupTasksEnabled: boolean
		onCodeCleanupTasksToggle: () => void
	}

	const { codeCleanupTasksEnabled, onCodeCleanupTasksToggle }: Props = $props()
</script>

<div id="section-experimental" class="rounded-lg border border-base-300 overflow-hidden" style="background-color: var(--project-bg, oklch(var(--b1)))">
	<div class="flex items-center gap-2 px-5 py-3 border-b border-base-300">
		<FlaskConical size={16} />
		<h3 class="text-sm font-semibold text-base-content m-0">Experimental</h3>
	</div>

	<div class="p-5">
		<div class="flex flex-col gap-4">
			<label class="flex items-center justify-between cursor-pointer">
				<div class="flex flex-col gap-0.5">
					<span class="text-sm text-base-content">Code Cleanup Tasks</span>
					<span class="text-[0.7rem] text-base-content/50">Agents create tasks for code that needs cleanup or splitting</span>
				</div>
				<input
					type="checkbox"
					class="toggle toggle-primary toggle-sm"
					checked={codeCleanupTasksEnabled}
					onchange={onCodeCleanupTasksToggle}
					data-testid="code-cleanup-tasks-toggle"
				/>
			</label>
		</div>
	</div>
</div>
