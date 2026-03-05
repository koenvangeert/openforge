<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { listen } from '@tauri-apps/api/event'
  import type { UnlistenFn } from '@tauri-apps/api/event'
  import { spawnShellPty, killPty } from '../lib/ipc'
  import '@xterm/xterm/css/xterm.css'
  import { acquire, attach, detach, type PoolEntry } from '../lib/terminalPool'

  interface Props {
    taskId: string
    worktreePath: string
  }

  let { taskId, worktreePath }: Props = $props()

  let terminalEl: HTMLDivElement
  let unlisteners: UnlistenFn[] = []
  let poolEntry: PoolEntry | null = null
  let ptyActive = $state(false)
  let shellExited = $state(false)

  onMount(async () => {
    poolEntry = await acquire(taskId + '-shell')

    // Override terminal theme to dark for shell terminal
    poolEntry.terminal.options.theme = {
      background: '#1C1C1C',
      foreground: '#E0E0E0',
      cursor: '#E0E0E0',
      cursorAccent: '#1C1C1C',
      selectionBackground: '#404040',
      selectionForeground: '#E0E0E0',
      black: '#1C1C1C',
      red: '#ff6b6b',
      green: '#51cf66',
      yellow: '#ffd43b',
      blue: '#74c0fc',
      magenta: '#da77f2',
      cyan: '#66d9e8',
      white: '#E0E0E0',
      brightBlack: '#666666',
      brightRed: '#ff8787',
      brightGreen: '#69db7c',
      brightYellow: '#ffe066',
      brightBlue: '#91d5ff',
      brightMagenta: '#e599f7',
      brightCyan: '#99e9f2',
      brightWhite: '#ffffff',
    }

    attach(poolEntry, terminalEl)

    // Sync local ptyActive from pool entry
    ptyActive = poolEntry.ptyActive

    // If PTY is not yet active, spawn the shell
    if (!poolEntry.ptyActive) {
      await spawnShellPty(taskId + '-shell', worktreePath, poolEntry.terminal.cols, poolEntry.terminal.rows)
      ptyActive = true
    }

    // Listen for shell exit event
    unlisteners.push(await listen(`pty-exit-${taskId}-shell`, () => {
      shellExited = true
      ptyActive = false
    }))
  })

  onDestroy(() => {
    unlisteners.forEach(fn => fn())
    if (poolEntry) {
      detach(poolEntry)
    }
  })

  async function handleRestart() {
    if (!poolEntry || ptyActive) return
    try {
      await killPty(taskId + '-shell').catch(e => {
        console.error('[TaskTerminal] Failed to kill PTY on restart:', e)
      })
      await spawnShellPty(taskId + '-shell', worktreePath, poolEntry.terminal.cols, poolEntry.terminal.rows)
      poolEntry.needsClear = true
      shellExited = false
      ptyActive = true
    } catch (e) {
      console.error('[TaskTerminal] Failed to restart shell:', e)
    }
  }
</script>

<div class="flex flex-col h-full">
  <div class="flex-1 overflow-hidden min-h-0 relative">
    <div class="shell-terminal-wrapper" bind:this={terminalEl}></div>
    {#if shellExited}
      <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#1C1C1C]/90 z-[1]">
        <span class="text-sm font-mono text-base-content/60">Shell exited</span>
        <button class="btn btn-sm btn-ghost text-primary font-mono" onclick={handleRestart}>
          Restart
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .shell-terminal-wrapper {
    width: 100%;
    height: 100%;
    padding: 12px;
    background: #1C1C1C;
  }

  :global(.shell-terminal-wrapper .xterm-viewport::-webkit-scrollbar) {
    width: 6px;
  }

  :global(.shell-terminal-wrapper .xterm-viewport::-webkit-scrollbar-track) {
    background: #2a2a2a;
  }

  :global(.shell-terminal-wrapper .xterm-viewport::-webkit-scrollbar-thumb) {
    background: #444;
    border-radius: 3px;
  }

  :global(.shell-terminal-wrapper .xterm-viewport::-webkit-scrollbar-thumb:hover) {
    background: #666;
  }
</style>
