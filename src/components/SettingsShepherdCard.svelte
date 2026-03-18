<script lang="ts">
	import { onMount } from 'svelte'
	import { FlaskConical } from 'lucide-svelte'
	import { activeProjectId } from '../lib/stores'
	import { listShepherdAgents, listOpenCodeModels, getProjectConfig, setProjectConfig } from '../lib/ipc'
	import type { AutocompleteAgentInfo, ProviderModelInfo } from '../lib/types'

	interface Props {
		shepherdEnabled: boolean
		onShepherdToggle: () => void
	}

	const { shepherdEnabled, onShepherdToggle }: Props = $props()

	let agents = $state<AutocompleteAgentInfo[]>([])
	let models = $state<ProviderModelInfo[]>([])
	let selectedAgent = $state('')
	let selectedModel = $state('')
	let initialPrompt = $state('')
	let loadingAgents = $state(false)
	let loadingModels = $state(false)
	let promptSaveTimer: ReturnType<typeof setTimeout> | null = null

	async function loadConfig() {
		if (!$activeProjectId) return
		loadingAgents = true
		loadingModels = true
		try {
			const [agentList, modelList, savedAgent, savedModel, savedPrompt] = await Promise.all([
				listShepherdAgents($activeProjectId),
				listOpenCodeModels($activeProjectId),
				getProjectConfig($activeProjectId, 'shepherd_agent'),
				getProjectConfig($activeProjectId, 'shepherd_model'),
				getProjectConfig($activeProjectId, 'shepherd_initial_prompt'),
			])
			agents = agentList
			models = modelList
			selectedAgent = savedAgent ?? ''
			selectedModel = savedModel ?? ''
			initialPrompt = savedPrompt ?? ''
		} catch {
			agents = []
			models = []
		} finally {
			loadingAgents = false
			loadingModels = false
		}
	}

	async function handleAgentChange(e: Event) {
		const value = (e.target as HTMLSelectElement).value
		selectedAgent = value
		if ($activeProjectId) {
			await setProjectConfig($activeProjectId, 'shepherd_agent', value)
		}
	}

	async function handleModelChange(e: Event) {
		const value = (e.target as HTMLSelectElement).value
		selectedModel = value
		if ($activeProjectId) {
			await setProjectConfig($activeProjectId, 'shepherd_model', value)
		}
	}

	function handlePromptInput(e: Event) {
		const value = (e.target as HTMLTextAreaElement).value
		initialPrompt = value
		if (promptSaveTimer) clearTimeout(promptSaveTimer)
		promptSaveTimer = setTimeout(() => {
			if ($activeProjectId) {
				setProjectConfig($activeProjectId, 'shepherd_initial_prompt', value)
			}
		}, 500)
	}

	onMount(() => {
		loadConfig()
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
					<span class="text-[0.7rem] text-base-content/50">Which OpenCode agent the shepherd uses.</span>
				</label>

				<label class="flex flex-col gap-1.5">
					<span class="text-sm text-base-content">Model</span>
					<select
						class="select select-bordered select-sm w-full"
						value={selectedModel}
						onchange={handleModelChange}
						disabled={loadingModels}
						data-testid="shepherd-model-select"
					>
						<option value="">Default</option>
						{#each models as model}
							<option value={`${model.provider_id}/${model.model_id}`}>{model.name}</option>
						{/each}
					</select>
					<span class="text-[0.7rem] text-base-content/50">Which model the shepherd uses. Fetched from OpenCode providers.</span>
				</label>

				<label class="flex flex-col gap-1.5">
					<span class="text-sm text-base-content">Initial Prompt</span>
					<textarea
						class="textarea textarea-bordered w-full text-xs leading-relaxed"
						rows={6}
						value={initialPrompt}
						oninput={handlePromptInput}
						placeholder="Leave empty to use the default system prompt"
						data-testid="shepherd-initial-prompt"
					></textarea>
					<span class="text-[0.7rem] text-base-content/50">Custom system prompt. Leave empty to use the built-in default.</span>
				</label>
			{/if}
		</div>
	</div>
</div>
