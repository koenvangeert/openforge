<script lang="ts">
  import type { Task } from '../lib/types'
  import type { CreatureState } from '../lib/creatureState'

  interface Props {
    task: Task
    state: CreatureState
    questionText: string | null
    onClick: (taskId: string) => void
  }

  let { task, state, questionText, onClick }: Props = $props()

  let colorClass = $derived(
    state === 'egg' ? 'text-base-content/30' :
    state === 'idle' ? 'text-base-content/50' :
    state === 'active' ? 'text-success' :
    state === 'needs-input' ? 'text-warning' :
    state === 'resting' ? 'text-info/50' :
    state === 'celebrating' ? 'text-info' :
    state === 'sad' ? 'text-error' :
    'text-base-content/20'
  )

  let animClass = $derived(
    state === 'egg' ? 'creature-sleep' :
    state === 'active' ? 'creature-bounce' :
    state === 'resting' ? 'creature-sleep' :
    state === 'celebrating' ? 'creature-celebrate' :
    state === 'sad' ? 'creature-wobble' :
    ''
  )

  let sizeClass = $derived(state === 'egg' ? 'w-12 h-12' : 'w-16 h-16')

  let titleAttr = $derived(state === 'needs-input' ? questionText : null)
</script>

<button
  class="flex flex-col items-center gap-1 cursor-pointer relative {state === 'frozen' ? 'opacity-50' : ''}"
  onclick={() => onClick(task.id)}
  title={titleAttr}
>
  {#if state === 'needs-input'}
    <span class="creature-exclaim text-warning text-lg leading-none select-none">❗</span>
  {/if}

  <svg
    viewBox="0 0 64 64"
    class="{sizeClass} {colorClass} {animClass}"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="creature"
  >
    <ellipse cx="32" cy="40" rx="27" ry="20" fill="currentColor" />
    <ellipse cx="32" cy="24" rx="21" ry="19" fill="currentColor" />

    <circle cx="25" cy="22" r="5" fill="white" opacity="0.85" />
    <circle cx="39" cy="22" r="5" fill="white" opacity="0.85" />

    {#if state === 'egg'}
      <line x1="21" y1="22" x2="29" y2="22" stroke="black" stroke-width="2.5" stroke-linecap="round" opacity="0.5" />
      <line x1="35" y1="22" x2="43" y2="22" stroke="black" stroke-width="2.5" stroke-linecap="round" opacity="0.5" />
    {:else}
      <circle cx="26" cy="23" r="2.5" fill="black" opacity="0.7" />
      <circle cx="40" cy="23" r="2.5" fill="black" opacity="0.7" />
    {/if}

    {#if state === 'celebrating'}
      <path d="M 22 34 Q 32 44 42 34" stroke="white" stroke-width="2.5" fill="none" stroke-linecap="round" opacity="0.8" />
    {:else if state === 'sad'}
      <path d="M 22 40 Q 32 33 42 40" stroke="white" stroke-width="2.5" fill="none" stroke-linecap="round" opacity="0.8" />
    {:else if state !== 'egg'}
      <line x1="25" y1="36" x2="39" y2="36" stroke="white" stroke-width="2" stroke-linecap="round" opacity="0.6" />
    {/if}
  </svg>

  {#if state === 'egg'}
    <span class="text-base-content/30 text-xs font-mono">zzz</span>
  {/if}

  <span class="font-mono text-[10px] text-base-content/40">{task.id}</span>
</button>
