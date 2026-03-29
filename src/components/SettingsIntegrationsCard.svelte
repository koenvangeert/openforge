<script lang="ts">
  import { Plug, Github } from 'lucide-svelte'

  interface Props {
    githubDefaultRepo: string
    disabled: boolean
    onGithubDefaultRepoChange: (value: string) => void
  }

  let { githubDefaultRepo, disabled, onGithubDefaultRepoChange }: Props = $props()
</script>

<div id="section-integrations" class="rounded-lg border border-base-300 overflow-hidden" style="background-color: var(--project-bg, oklch(var(--b1)))">
  <div class="flex items-center gap-2 px-5 py-3 border-b border-base-300">
    <Plug size={16} class="text-base-content" />
    <h3 class="text-sm font-semibold text-base-content m-0">Integrations</h3>
  </div>

  <div class="p-5 {disabled ? 'opacity-50 pointer-events-none' : ''}">
    <div class="grid grid-cols-1 gap-6">
      <!-- GitHub Column -->
      <div>
        <div class="flex items-center gap-1.5 mb-3">
          <Github size={14} class="text-base-content" />
          <span class="text-xs font-semibold text-base-content uppercase tracking-wider">GitHub</span>
        </div>
        <label class="flex flex-col gap-1">
          <span class="text-[0.7rem] text-base-content/50">Default Repo</span>
          <input
            type="text"
            value={githubDefaultRepo}
            oninput={(e) => onGithubDefaultRepoChange(e.currentTarget.value)}
            placeholder="owner/repo"
            class="input input-bordered input-sm w-full"
          />
        </label>
      </div>
    </div>
  </div>
</div>
