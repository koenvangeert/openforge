<script lang="ts">
	import { KeyRound, Ticket, Github } from 'lucide-svelte';

	interface Props {
		jiraBaseUrl: string;
		jiraUsername: string;
		jiraApiToken: string;
		githubToken: string;
		onJiraBaseUrlChange: (value: string) => void;
		onJiraUsernameChange: (value: string) => void;
		onJiraApiTokenChange: (value: string) => void;
		onGithubTokenChange: (value: string) => void;
	}

	const {
		jiraBaseUrl,
		jiraUsername,
		jiraApiToken,
		githubToken,
		onJiraBaseUrlChange,
		onJiraUsernameChange,
		onJiraApiTokenChange,
		onGithubTokenChange
	}: Props = $props();
</script>

<div id="section-credentials" class="rounded-lg border border-base-300 overflow-hidden" style="background-color: var(--project-bg, oklch(var(--b1)))">
	<div class="flex items-center gap-2 px-5 py-3 border-b border-base-300">
		<KeyRound size={16} />
		<h3 class="text-sm font-semibold text-base-content m-0">Credentials</h3>
	</div>

	<div class="p-5">
		<div class="grid grid-cols-2 gap-6">
			<!-- JIRA Column -->
			<div class="flex flex-col gap-4">
				<div class="flex items-center gap-2">
					<Ticket size={14} class="text-info" />
					<span class="text-xs font-semibold text-info uppercase tracking-wider">JIRA</span>
				</div>

				<label class="flex flex-col gap-1">
					<span class="text-[0.7rem] text-base-content/50">Base URL</span>
					<input
						type="text"
						value={jiraBaseUrl}
						oninput={(e) => onJiraBaseUrlChange(e.currentTarget.value)}
						placeholder="https://your-domain.atlassian.net"
						class="input input-bordered input-sm w-full"
					/>
				</label>

				<label class="flex flex-col gap-1">
					<span class="text-[0.7rem] text-base-content/50">Email / Username</span>
					<input
						type="text"
						value={jiraUsername}
						oninput={(e) => onJiraUsernameChange(e.currentTarget.value)}
						placeholder="your@email.com"
						class="input input-bordered input-sm w-full"
					/>
				</label>

				<label class="flex flex-col gap-1">
					<span class="text-[0.7rem] text-base-content/50">API Token</span>
					<input
						type="password"
						value={jiraApiToken}
						oninput={(e) => onJiraApiTokenChange(e.currentTarget.value)}
						placeholder="Your JIRA API token"
						class="input input-bordered input-sm w-full"
					/>
				</label>
			</div>

			<!-- GitHub Column -->
			<div class="flex flex-col gap-4">
				<div class="flex items-center gap-2">
					<Github size={14} />
					<span class="text-xs font-semibold text-base-content uppercase tracking-wider">GitHub</span>
				</div>

				<label class="flex flex-col gap-1">
					<span class="text-[0.7rem] text-base-content/50">Personal Access Token</span>
					<input
						type="password"
						value={githubToken}
						oninput={(e) => onGithubTokenChange(e.currentTarget.value)}
						placeholder="ghp_..."
						class="input input-bordered input-sm w-full"
					/>
				</label>
			</div>
		</div>
	</div>
</div>
