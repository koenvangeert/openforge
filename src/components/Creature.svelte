<script lang="ts">
  import type { Task } from '../lib/types'
  import type { CreatureState, CreatureRoom } from '../lib/creatureState'

  interface Props {
    task: Task
    state: CreatureState
    room: CreatureRoom
    questionText: string | null
    onClick: (taskId: string) => void
    onHover: (taskId: string, rect: DOMRect) => void
    onHoverEnd: () => void
    onStart?: (taskId: string) => void
  }

  let { task, state, room, questionText, onClick, onHover, onHoverEnd, onStart }: Props = $props()

  let buttonEl: HTMLButtonElement

  let statusLabel = $derived(
    state === 'active' ? 'RUNNING' :
    state === 'needs-input' ? 'BLOCKED' :
    state === 'resting' ? 'PAUSED' :
    state === 'sad' ? 'FAILED' :
    state === 'frozen' ? 'INTERRUPTED' :
    state === 'celebrating' ? 'DONE' :
    state === 'idle' ? 'IDLE' :
    state === 'pr-draft' ? 'DRAFT PR' :
    state === 'pr-open' ? 'PR OPEN' :
    state === 'ci-failed' ? 'CI FAILED' :
    state === 'changes-requested' ? 'CHANGES REQ' :
    state === 'ready-to-merge' ? 'READY' :
    state === 'pr-merged' ? 'MERGED' :
    ''
  )

  let roomColor = $derived(
    state === 'ci-failed' || state === 'changes-requested' ? 'text-error' :
    state === 'celebrating' || state === 'pr-merged' ? 'text-info' :
    state === 'ready-to-merge' ? 'text-accent' :
    room === 'forge' ? 'text-success' :
    room === 'warRoom' ? 'text-warning' :
    'text-base-content/40'
  )

  let animClass = $derived(
    room === 'nursery' ? 'creature-sleep' :
    state === 'active' ? 'creature-work' :
    state === 'needs-input' || state === 'sad' || state === 'frozen' ? 'creature-alert' :
    state === 'ci-failed' || state === 'changes-requested' ? 'creature-alert' :
    state === 'celebrating' || state === 'pr-merged' ? 'creature-celebrate' :
    state === 'resting' ? 'creature-sleep' :
    ''
  )

  let thoughtBorderClass = $derived(
    state === 'ci-failed' || state === 'changes-requested' ? 'border-error/50' :
    state === 'celebrating' || state === 'pr-merged' ? 'border-info/50' :
    room === 'forge' ? 'border-success/50' :
    room === 'warRoom' ? 'border-warning/50' :
    'border-base-content/20'
  )

  let thoughtTextClass = $derived(
    room === 'nursery' ? 'text-base-content/40 italic' : 'text-base-content/80'
  )

  let truncatedTitle = $derived(
    task.title.length > 45 ? task.title.slice(0, 45) + '...' : task.title
  )

  // Hash task ID to a hue rotation for subtle color variation per creature
  // Constrained to ±25° so creatures stay within their color family (green/blue)
  let hueRotation = $derived(() => {
    let hash = 0
    for (let i = 0; i < task.id.length; i++) {
      hash = ((hash << 5) - hash + task.id.charCodeAt(i)) | 0
    }
    return (Math.abs(hash) % 50) - 25
  })
</script>

<button
  bind:this={buttonEl}
  class="flex items-center gap-4 cursor-pointer py-2 px-3 rounded-lg hover:bg-base-content/5 transition-colors w-full"
  title={questionText ?? undefined}
  onclick={() => onClick(task.id)}
  onmouseenter={() => onHover(task.id, buttonEl.getBoundingClientRect())}
  onmouseleave={() => onHoverEnd()}
>
  {#if room !== 'nursery'}
    <svg
      viewBox="0 0 160 130"
      class="w-32 h-24 shrink-0 {roomColor} {animClass}"
      style={room === 'forge' ? `filter: hue-rotate(${hueRotation()}deg)` : ''}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="creature"
    >
      <g data-testid="pixel-char">
        {#if state === 'celebrating'}
          <!-- Sitting on chair: legs bent, body lower -->
          <rect data-testid="head" x="50" y="24" width="40" height="40" rx="4" fill="currentColor" stroke="black" stroke-opacity="0.35" stroke-width="3" />
          <rect x="58" y="36" width="6" height="6" rx="1" fill="white" />
          <rect x="76" y="36" width="6" height="6" rx="1" fill="white" />
          <rect x="60" y="39" width="3" height="3" fill="black" opacity="0.85" />
          <rect x="78" y="39" width="3" height="3" fill="black" opacity="0.85" />
          <!-- Happy wide smile -->
          <path d="M62 54 Q70 60 78 54" stroke="black" stroke-width="2" fill="none" opacity="0.4" />
          <rect data-testid="mouth" x="64" y="54" width="12" height="2" rx="1" fill="black" opacity="0" />
          <rect data-testid="body" x="45" y="66" width="50" height="32" rx="2" fill="currentColor" opacity="0.85" stroke="black" stroke-opacity="0.35" stroke-width="2" />
          <!-- Legs bent on chair -->
          <rect data-testid="leg-l" x="52" y="98" width="12" height="10" rx="1" fill="currentColor" opacity="0.7" transform="rotate(-20 58 98)" />
          <rect data-testid="leg-r" x="76" y="98" width="12" height="10" rx="1" fill="currentColor" opacity="0.7" transform="rotate(20 82 98)" />
        {:else if state === 'resting'}
          <!-- Sleeping creature: slumped with closed eyes -->
          <rect data-testid="head" x="50" y="14" width="40" height="40" rx="4" fill="currentColor" stroke="black" stroke-opacity="0.35" stroke-width="3" />
          <!-- Closed eyes (horizontal lines) -->
          <line x1="57" y1="30" x2="65" y2="30" stroke="black" stroke-width="2" opacity="0.5" />
          <line x1="75" y1="30" x2="83" y2="30" stroke="black" stroke-width="2" opacity="0.5" />
          <rect data-testid="mouth" x="64" y="44" width="12" height="4" rx="1" fill="black" opacity="0.3" />
          <rect data-testid="body" x="45" y="56" width="50" height="32" rx="2" fill="currentColor" opacity="0.85" stroke="black" stroke-opacity="0.35" stroke-width="2" />
          <rect data-testid="leg-l" x="52" y="90" width="12" height="16" rx="1" fill="currentColor" opacity="0.7" />
          <rect data-testid="leg-r" x="76" y="90" width="12" height="16" rx="1" fill="currentColor" opacity="0.7" />
          <!-- Fake eye rects for tests (hidden) -->
          <rect x="58" y="26" width="6" height="6" rx="1" fill="white" opacity="0" />
          <rect x="76" y="26" width="6" height="6" rx="1" fill="white" opacity="0" />
        {:else}
          <!-- Default standing pose -->
          <rect data-testid="head" x="50" y="4" width="40" height="40" rx="4" fill="currentColor" stroke="black" stroke-opacity="0.35" stroke-width="3" />
          <rect x="58" y="16" width="6" height="6" rx="1" fill="white" />
          <rect x="76" y="16" width="6" height="6" rx="1" fill="white" />
          <rect x="60" y="19" width="3" height="3" fill="black" opacity="0.85" />
          <rect x="78" y="19" width="3" height="3" fill="black" opacity="0.85" />
          {#if room === 'warRoom'}
            <rect data-testid="brow-l" x="56" y="10" width="10" height="3" fill="black" opacity="0.4" transform="rotate(-10 61 11.5)" />
            <rect data-testid="brow-r" x="74" y="10" width="10" height="3" fill="black" opacity="0.4" transform="rotate(10 79 11.5)" />
            <rect data-testid="frown" x="62" y="34" width="16" height="3" rx="1" fill="black" opacity="0.4" />
          {:else}
            <rect data-testid="mouth" x="64" y="34" width="12" height="4" rx="1" fill="black" opacity="0.3" />
          {/if}
          <rect data-testid="body" x="45" y="46" width="50" height="32" rx="2" fill="currentColor" opacity="0.85" stroke="black" stroke-opacity="0.35" stroke-width="2" />
          <rect data-testid="leg-l" x="52" y="80" width="12" height="16" rx="1" fill="currentColor" opacity="0.7" />
          <rect data-testid="leg-r" x="76" y="80" width="12" height="16" rx="1" fill="currentColor" opacity="0.7" />
        {/if}
      </g>

      <!-- Scene props per state -->
      {#if state === 'celebrating'}
        <!-- Chair: seat and back -->
        <g data-testid="chair">
          <rect x="38" y="96" width="64" height="6" rx="2" fill="currentColor" opacity="0.3" />
          <rect x="38" y="60" width="6" height="42" rx="2" fill="currentColor" opacity="0.25" />
          <rect x="96" y="96" width="6" height="18" rx="1" fill="currentColor" opacity="0.25" />
          <rect x="38" y="96" width="6" height="18" rx="1" fill="currentColor" opacity="0.25" />
        </g>
      {:else if state === 'active'}
        <!-- Anvil with sparks -->
        <g data-testid="anvil">
          <rect x="100" y="80" width="40" height="8" rx="2" fill="currentColor" opacity="0.5" />
          <rect x="108" y="88" width="24" height="20" rx="1" fill="currentColor" opacity="0.35" />
          <rect x="104" y="108" width="32" height="6" rx="2" fill="currentColor" opacity="0.45" />
        </g>
        <!-- Sparks -->
        <g class="creature-sparks">
          <circle cx="115" cy="74" r="2" fill="currentColor" opacity="0.6" />
          <circle cx="125" cy="70" r="1.5" fill="currentColor" opacity="0.5" />
          <circle cx="108" cy="72" r="1.5" fill="currentColor" opacity="0.4" />
          <circle cx="120" cy="66" r="1" fill="currentColor" opacity="0.3" />
        </g>
      {:else if state === 'needs-input'}
        <!-- Question mark bubble -->
        <g data-testid="question-bubble">
          <circle cx="108" cy="16" r="14" fill="currentColor" opacity="0.15" stroke="currentColor" stroke-width="1.5" stroke-opacity="0.3" />
          <text x="108" y="22" text-anchor="middle" fill="currentColor" font-size="18" font-weight="bold" opacity="0.7">?</text>
        </g>
      {:else if state === 'sad'}
        <!-- Rain cloud above head -->
        <g data-testid="rain-cloud">
          <ellipse cx="70" cy="0" rx="24" ry="10" fill="currentColor" opacity="0.2" />
          <ellipse cx="58" cy="2" rx="14" ry="8" fill="currentColor" opacity="0.15" />
          <ellipse cx="82" cy="2" rx="14" ry="8" fill="currentColor" opacity="0.15" />
          <!-- Rain drops -->
          <line x1="58" y1="10" x2="56" y2="18" stroke="currentColor" stroke-width="1.5" opacity="0.3" />
          <line x1="70" y1="10" x2="68" y2="18" stroke="currentColor" stroke-width="1.5" opacity="0.3" />
          <line x1="82" y1="10" x2="80" y2="18" stroke="currentColor" stroke-width="1.5" opacity="0.3" />
        </g>
      {:else if state === 'frozen'}
        <!-- Ice block encasing the creature -->
        <g data-testid="ice-block">
          <rect x="38" y="0" width="64" height="100" rx="4" fill="currentColor" opacity="0.08" stroke="currentColor" stroke-width="1.5" stroke-opacity="0.2" stroke-dasharray="4 2" />
          <!-- Frost crystals -->
          <text x="42" y="20" fill="currentColor" font-size="10" opacity="0.3">*</text>
          <text x="90" y="40" fill="currentColor" font-size="8" opacity="0.25">*</text>
          <text x="44" y="80" fill="currentColor" font-size="9" opacity="0.2">*</text>
        </g>
      {:else if state === 'resting'}
        <!-- Sleep bubbles -->
        <g data-testid="sleep-bubble" class="creature-zzz">
          <text x="96" y="14" fill="currentColor" font-size="14" font-weight="bold" opacity="0.4">z</text>
          <text x="106" y="6" fill="currentColor" font-size="11" font-weight="bold" opacity="0.3">z</text>
          <text x="114" y="0" fill="currentColor" font-size="8" font-weight="bold" opacity="0.2">z</text>
        </g>
      {:else if state === 'ci-failed'}
        <!-- Broken gear with fire -->
        <g data-testid="ci-failed-prop">
          <circle cx="120" cy="60" r="14" fill="none" stroke="currentColor" stroke-width="2" opacity="0.4" />
          <circle cx="120" cy="60" r="5" fill="currentColor" opacity="0.3" />
          <line x1="112" y1="52" x2="128" y2="68" stroke="currentColor" stroke-width="2" opacity="0.5" />
          <!-- Fire flickers -->
          <ellipse cx="118" cy="42" rx="4" ry="8" fill="currentColor" opacity="0.3" />
          <ellipse cx="124" cy="44" rx="3" ry="6" fill="currentColor" opacity="0.2" />
        </g>
      {:else if state === 'changes-requested'}
        <!-- Red X mark -->
        <g data-testid="changes-req-prop">
          <circle cx="114" cy="16" r="12" fill="currentColor" opacity="0.12" stroke="currentColor" stroke-width="1.5" stroke-opacity="0.3" />
          <line x1="108" y1="10" x2="120" y2="22" stroke="currentColor" stroke-width="2.5" opacity="0.6" />
          <line x1="120" y1="10" x2="108" y2="22" stroke="currentColor" stroke-width="2.5" opacity="0.6" />
        </g>
      {:else if state === 'ready-to-merge'}
        <!-- Checkmark trophy -->
        <g data-testid="ready-prop">
          <circle cx="114" cy="16" r="12" fill="currentColor" opacity="0.12" stroke="currentColor" stroke-width="1.5" stroke-opacity="0.3" />
          <polyline points="106,16 112,22 122,10" fill="none" stroke="currentColor" stroke-width="2.5" opacity="0.6" />
        </g>
      {:else if state === 'pr-draft'}
        <!-- Pencil/scroll -->
        <g data-testid="draft-prop">
          <rect x="108" y="50" width="8" height="30" rx="1" fill="currentColor" opacity="0.3" transform="rotate(-15 112 65)" />
          <rect x="106" y="48" width="12" height="4" rx="1" fill="currentColor" opacity="0.4" transform="rotate(-15 112 50)" />
        </g>
      {:else if state === 'pr-open'}
        <!-- Flag -->
        <g data-testid="pr-open-prop">
          <line x1="118" y1="40" x2="118" y2="100" stroke="currentColor" stroke-width="2" opacity="0.3" />
          <polygon points="120,42 140,50 120,58" fill="currentColor" opacity="0.3" />
        </g>
      {:else if state === 'pr-merged'}
        <!-- Reuse celebrating chair scene -->
        <g data-testid="chair">
          <rect x="38" y="96" width="64" height="6" rx="2" fill="currentColor" opacity="0.3" />
          <rect x="38" y="60" width="6" height="42" rx="2" fill="currentColor" opacity="0.25" />
          <rect x="96" y="96" width="6" height="18" rx="1" fill="currentColor" opacity="0.25" />
          <rect x="38" y="96" width="6" height="18" rx="1" fill="currentColor" opacity="0.25" />
        </g>
      {/if}

      {#if room === 'warRoom'}
        <g data-testid="alert-badge">
          <rect x="118" y="0" width="20" height="20" rx="3" class="fill-error" />
          <text x="128" y="15" text-anchor="middle" fill="white" font-size="12" font-weight="bold">!</text>
        </g>
      {/if}
    </svg>

    <!-- Info column -->
    <div class="flex flex-col items-start gap-0.5 min-w-0 flex-1">
      <div class="bg-base-200 border {thoughtBorderClass} rounded-lg px-2 py-1 text-xs max-w-full text-left">
        <span class={thoughtTextClass}>{truncatedTitle}</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="font-mono text-[9px] {roomColor}">{task.id}</span>
        {#if statusLabel}
          <div class="flex items-center gap-1">
            <span class="text-[9px] {roomColor}">●</span>
            <span class="font-mono text-[9px] {roomColor}">{statusLabel}</span>
          </div>
        {/if}
      </div>
      {#if task.jira_assignee}
        <span class="font-mono text-[8px] text-base-content/40 truncate max-w-[200px]">{task.jira_assignee}</span>
      {/if}
    </div>

  {:else}
    <!-- Nursery: egg in nest -->
    <svg
      viewBox="0 0 120 100"
      class="w-24 h-16 shrink-0 {roomColor} {animClass}"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="nest"
    >
      <rect data-testid="bed" x="10" y="62" width="100" height="32" rx="8" fill="currentColor" opacity="0.2" stroke="currentColor" stroke-width="1.5" stroke-opacity="0.3" />
      <rect x="20" y="57" width="80" height="14" rx="4" fill="currentColor" opacity="0.25" />
      <g data-testid="egg">
        <rect x="40" y="18" width="40" height="44" rx="20" fill="currentColor" opacity="0.35" stroke="currentColor" stroke-width="1.5" stroke-opacity="0.4" />
        <line x1="42" y1="42" x2="78" y2="42" stroke="currentColor" stroke-width="2" stroke-opacity="0.25" />
      </g>
    </svg>

    <div class="flex flex-col items-start gap-0.5 min-w-0 flex-1">
      <div class="bg-base-200 border {thoughtBorderClass} rounded-lg px-2 py-1 text-xs max-w-full text-left">
        <span class={thoughtTextClass}>{truncatedTitle}</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="font-mono text-[9px] {roomColor}">{task.id}</span>
        <span class="font-mono text-xs {roomColor}">zzz</span>
      </div>
      {#if task.jira_assignee}
        <span class="font-mono text-[8px] text-base-content/40 truncate max-w-[200px]">{task.jira_assignee}</span>
      {/if}
    </div>

    {#if onStart}
      <button
        type="button"
        class="btn btn-ghost btn-xs btn-square shrink-0 text-success hover:bg-success/20"
        title="Start task"
        onclick={(e: MouseEvent) => { e.stopPropagation(); onStart(task.id) }}
      >
        <svg viewBox="0 0 16 16" class="w-4 h-4" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 2.5v11l9-5.5z" />
        </svg>
      </button>
    {/if}
  {/if}
</button>
