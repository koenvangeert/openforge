<script lang="ts">
	import { onMount } from 'svelte'
	import { FlaskConical } from 'lucide-svelte'
	import { activeProjectId } from '../lib/stores'
	import { listOpenCodeAgents, getProjectConfig, setProjectConfig } from '../lib/ipc'
	import type { AutocompleteAgentInfo } from '../lib/types'

	interface Props {
		shepherdEnabled: boolean
		onShepherdToggle: () => void
	}

	const { shepherdEnabled, onShepherdToggle }: Props = $props()

	let agents = $state<AutocompleteAgentInfo[]>([])
	let selectedAgent = $state('')
	let loadingAgents = $state(false)

	async function loadAgents() {
		if (!$activeProjectId) return
		loadingAgents = true
		try {
			agents = await listOpenCodeAgents($activeProjectId)
			const saved = await getProjectConfig($activeProjectId, 'shepherd_agent')
			selectedAgent = saved ?? ''
		} catch {
			agents = []
		} finally {
			loadingAgents = false
		}
	}

	async function handleAgentChange(e: Event) {
		const value = (e.target as HTMLSelectElement).value
		selectedAgent = value
		if ($activeProjectId) {
			await setProjectConfig($activeProjectId, 'shepherd_agent', value)
		}
	}

	onMount(() => {
		loadAgents()
	})
</script>

<div id="section-shepherd" class="bg-base-100 rounded-lg border border-base-300 overflow-hidden">
	<div class="flex items-center gap-2 px-5 py-3 border-b border-base-300">
		<FlaskConical size={16} />
		<h3 class="text-sm font-semibold text-base-content m-0">Task Shepherd</h3>
		<span class="badge badge-warning badge-sm">Experimental</span>
	</div>

	<div class="p-5">
		<div class="flex flex-col gap-4">
			<label class="flex items-center justify-between cursor-pointer">
				<div class="flex flex-col gap-0.5">
					<span class="text-sm text-base-content">Enable Task Shepherd</span>
					<span class="text-[0.7rem] text-base-content/50">An AI agent will monitor task events and advise you on what to focus on.</span>
				</div>
				<input
					type="checkbox"
					class="toggle toggle-primary toggle-sm"
					checked={shepherdEnabled}
					onchange={onShepherdToggle}
					data-testid="shepherd-toggle"
				/>
			</label>

			{#if shepherdEnabled}
				<label class="flex flex-col gap-1.5">
					<span class="text-sm text-base-content">Agent</span>
					<select
						class="select select-bordered select-sm w-full"
						value={selectedAgent}
						onchange={handleAgentChange}
						disabled={loadingAgents}
						data-testid="shepherd-agent-select"
					>
						<option value="">Default</option>
						{#each agents.filter(a => !a.hidden) as agent}
							<option value={agent.name}>{agent.name}</option>
						{/each}
					</select>
					<span class="text-[0.7rem] text-base-content/50">Which OpenCode agent the shepherd uses. Configure the agent's model in your OpenCode settings.</span>
				</label>
			{/if}
		</div>
	</div>
</div>
