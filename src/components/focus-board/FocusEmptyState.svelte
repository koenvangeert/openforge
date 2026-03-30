<script lang="ts">
  import type { BoardFilter } from '../../lib/boardFilters'

  interface Props {
    filter: BoardFilter
  }

  let { filter }: Props = $props()

  const messages: Record<BoardFilter, { title: string; subtitle: string }> = {
    'focus': { title: 'All clear', subtitle: 'Nothing needs your attention right now' },
    'in-progress': { title: 'Nothing in progress', subtitle: 'Start working on a task to see it here' },
    'backlog': { title: 'Backlog is empty', subtitle: 'Create a task with \u2318T to get started' },
  }

  let message = $derived(messages[filter])
</script>

<div class="flex flex-col items-center justify-center flex-1 gap-5 focus-empty-enter select-none">
  <svg
    viewBox="0 0 200 200"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    class="w-48 h-48 text-base-content"
    role="img"
    aria-label="Peaceful forge illustration"
  >
    <defs>
      <radialGradient id="focus-empty-glow" cx="50%" cy="82%" r="30%">
        <stop offset="0%" stop-color="var(--color-primary)" stop-opacity="0.18">
          <animate attributeName="stop-opacity" values="0.14;0.22;0.14" dur="4s" repeatCount="indefinite"/>
        </stop>
        <stop offset="100%" stop-color="var(--color-primary)" stop-opacity="0"/>
      </radialGradient>
    </defs>

    <ellipse cx="100" cy="160" rx="54" ry="16" fill="url(#focus-empty-glow)">
      <animate attributeName="rx" values="52;58;52" dur="4s" repeatCount="indefinite"/>
    </ellipse>

    <path
      d="M68 118 L44 124 L68 130"
      fill="currentColor" fill-opacity="0.03"
      stroke="currentColor" stroke-opacity="0.14"
      stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round"
    />
    <rect
      x="68" y="118" width="64" height="12" rx="1.5"
      fill="currentColor" fill-opacity="0.05"
      stroke="currentColor" stroke-opacity="0.16"
      stroke-width="1.2"
    />
    <path
      d="M78 130 L122 130 L120 140 L80 140 Z"
      fill="currentColor" fill-opacity="0.04"
      stroke="currentColor" stroke-opacity="0.10"
      stroke-width="1"
    />
    <path
      d="M62 140 L138 140 L143 158 L57 158 Z"
      fill="currentColor" fill-opacity="0.05"
      stroke="currentColor" stroke-opacity="0.13"
      stroke-width="1.2" stroke-linejoin="round"
    />

    <g opacity="0.85">
      <rect
        x="106" y="82" width="4.5" height="38" rx="2"
        fill="currentColor" fill-opacity="0.03"
        stroke="currentColor" stroke-opacity="0.10"
        stroke-width="1"
        transform="rotate(-28, 108, 101)"
      />
      <rect
        x="99" y="75" width="18" height="9" rx="2"
        fill="currentColor" fill-opacity="0.05"
        stroke="currentColor" stroke-opacity="0.13"
        stroke-width="1"
        transform="rotate(-28, 108, 79)"
      />
    </g>

    <circle r="2.5" fill="var(--color-primary)">
      <animate attributeName="cx" values="92;87;83" dur="4.2s" repeatCount="indefinite"/>
      <animate attributeName="cy" values="115;78;40" dur="4.2s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0;0.7;0.45;0" dur="4.2s" repeatCount="indefinite"/>
      <animate attributeName="r" values="2.5;1.8;0.4" dur="4.2s" repeatCount="indefinite"/>
    </circle>
    <circle r="2" fill="var(--color-primary)">
      <animate attributeName="cx" values="110;114;118" dur="3.6s" begin="0.9s" repeatCount="indefinite"/>
      <animate attributeName="cy" values="112;74;38" dur="3.6s" begin="0.9s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0;0.75;0.4;0" dur="3.6s" begin="0.9s" repeatCount="indefinite"/>
      <animate attributeName="r" values="2;1.4;0.3" dur="3.6s" begin="0.9s" repeatCount="indefinite"/>
    </circle>
    <circle r="1.6" fill="var(--color-primary)">
      <animate attributeName="cx" values="99;96;92" dur="3s" begin="1.6s" repeatCount="indefinite"/>
      <animate attributeName="cy" values="110;70;32" dur="3s" begin="1.6s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0;0.6;0.3;0" dur="3s" begin="1.6s" repeatCount="indefinite"/>
      <animate attributeName="r" values="1.6;1;0.2" dur="3s" begin="1.6s" repeatCount="indefinite"/>
    </circle>
    <circle r="1.8" fill="var(--color-primary)">
      <animate attributeName="cx" values="103;108;115" dur="4.8s" begin="2.4s" repeatCount="indefinite"/>
      <animate attributeName="cy" values="114;80;46" dur="4.8s" begin="2.4s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0;0.5;0.25;0" dur="4.8s" begin="2.4s" repeatCount="indefinite"/>
      <animate attributeName="r" values="1.8;1.1;0.2" dur="4.8s" begin="2.4s" repeatCount="indefinite"/>
    </circle>
    <circle r="1.3" fill="var(--color-primary)">
      <animate attributeName="cx" values="95;86;78" dur="5s" begin="0.4s" repeatCount="indefinite"/>
      <animate attributeName="cy" values="116;76;36" dur="5s" begin="0.4s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0;0.55;0.2;0" dur="5s" begin="0.4s" repeatCount="indefinite"/>
      <animate attributeName="r" values="1.3;0.8;0.1" dur="5s" begin="0.4s" repeatCount="indefinite"/>
    </circle>

    <g>
      <line x1="38" y1="48" x2="38" y2="58" stroke="currentColor" stroke-width="1" stroke-linecap="round">
        <animate attributeName="stroke-opacity" values="0;0.3;0" dur="3.2s" begin="0.5s" repeatCount="indefinite"/>
      </line>
      <line x1="33" y1="53" x2="43" y2="53" stroke="currentColor" stroke-width="1" stroke-linecap="round">
        <animate attributeName="stroke-opacity" values="0;0.3;0" dur="3.2s" begin="0.5s" repeatCount="indefinite"/>
      </line>
    </g>
    <g>
      <line x1="160" y1="36" x2="160" y2="44" stroke="currentColor" stroke-width="0.8" stroke-linecap="round">
        <animate attributeName="stroke-opacity" values="0;0.28;0" dur="4s" begin="1.8s" repeatCount="indefinite"/>
      </line>
      <line x1="156" y1="40" x2="164" y2="40" stroke="currentColor" stroke-width="0.8" stroke-linecap="round">
        <animate attributeName="stroke-opacity" values="0;0.28;0" dur="4s" begin="1.8s" repeatCount="indefinite"/>
      </line>
    </g>
    <g>
      <line x1="170" y1="82" x2="170" y2="88" stroke="currentColor" stroke-width="0.6" stroke-linecap="round">
        <animate attributeName="stroke-opacity" values="0;0.22;0" dur="3.6s" begin="3s" repeatCount="indefinite"/>
      </line>
      <line x1="167" y1="85" x2="173" y2="85" stroke="currentColor" stroke-width="0.6" stroke-linecap="round">
        <animate attributeName="stroke-opacity" values="0;0.22;0" dur="3.6s" begin="3s" repeatCount="indefinite"/>
      </line>
    </g>
    <g>
      <line x1="28" y1="98" x2="28" y2="103" stroke="currentColor" stroke-width="0.5" stroke-linecap="round">
        <animate attributeName="stroke-opacity" values="0;0.18;0" dur="4.5s" begin="2.2s" repeatCount="indefinite"/>
      </line>
      <line x1="25.5" y1="100.5" x2="30.5" y2="100.5" stroke="currentColor" stroke-width="0.5" stroke-linecap="round">
        <animate attributeName="stroke-opacity" values="0;0.18;0" dur="4.5s" begin="2.2s" repeatCount="indefinite"/>
      </line>
    </g>

    <circle cx="28" cy="68" r="1" fill="currentColor">
      <animate attributeName="opacity" values="0;0.18;0" dur="5s" begin="1s" repeatCount="indefinite"/>
    </circle>
    <circle cx="174" cy="56" r="0.8" fill="currentColor">
      <animate attributeName="opacity" values="0;0.16;0" dur="4.2s" begin="2.5s" repeatCount="indefinite"/>
    </circle>
    <circle cx="52" cy="32" r="0.6" fill="currentColor">
      <animate attributeName="opacity" values="0;0.14;0" dur="6s" begin="0.3s" repeatCount="indefinite"/>
    </circle>
    <circle cx="150" cy="100" r="0.7" fill="currentColor">
      <animate attributeName="opacity" values="0;0.14;0" dur="5.5s" begin="3.5s" repeatCount="indefinite"/>
    </circle>
    <circle cx="60" cy="78" r="0.5" fill="currentColor">
      <animate attributeName="opacity" values="0;0.12;0" dur="7s" begin="1.5s" repeatCount="indefinite"/>
    </circle>
  </svg>

  <div class="text-center">
    <p class="text-sm font-medium text-base-content/50">{message.title}</p>
    <p class="text-xs text-base-content/30 mt-1">{message.subtitle}</p>
  </div>
</div>
