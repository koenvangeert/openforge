<script lang="ts">
  import { FileText } from 'lucide-svelte'

  interface Props {
    agentInstructions: string
    disabled: boolean
    onInstructionsChange: (value: string) => void
  }

  let { agentInstructions, disabled, onInstructionsChange }: Props = $props()
</script>

<div id="section-instructions" class="rounded-lg border border-base-300 overflow-hidden" style="background-color: var(--project-bg, oklch(var(--b1)))">
  <!-- Header -->
  <div class="px-5 py-4 border-b border-base-300 flex items-center gap-3">
    <FileText size={16} class="text-primary" />
    <h2 class="text-sm font-semibold">AI Instructions</h2>
  </div>

  <!-- Body -->
  <div class="p-5 flex flex-col gap-4">
    <p class="text-[0.7rem] text-base-content/50">
      Custom instructions prepended to the first prompt when starting a new task with an AI agent.
    </p>
    <label class="flex flex-col gap-1">
      <span class="text-[0.7rem] text-base-content/50">Instructions</span>
      <textarea
        value={agentInstructions}
        oninput={(e) => {
          if (!(e.currentTarget instanceof HTMLTextAreaElement)) return
          onInstructionsChange(e.currentTarget.value)
        }}
        placeholder="Optional instructions prepended to the first prompt when starting a new task..."
        rows="4"
        class="textarea textarea-bordered w-full text-sm resize-y {disabled ? 'opacity-50 pointer-events-none' : ''}"
      ></textarea>
    </label>
  </div>
</div>
