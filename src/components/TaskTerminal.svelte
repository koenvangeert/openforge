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

    attach(poolEntry, terminalEl)

    // Sync local ptyActive from pool entry
    ptyActive = poolEntry.ptyActive

    // If PTY is not yet active, spawn the shell
    if (!poolEntry.ptyActive) {
      await spawnShellPty(taskId, worktreePath, poolEntry.terminal.cols, poolEntry.terminal.rows)
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
      await spawnShellPty(taskId, worktreePath, poolEntry.terminal.cols, poolEntry.terminal.rows)
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
    <div class="shell-terminal-wrapper w-full h-full p-3 bg-base-100" bind:this={terminalEl}></div>
    {#if shellExited}
      <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral/90 z-[1]">
        <span class="text-sm font-mono text-base-content/60">Shell exited</span>
        <button class="btn btn-sm btn-ghost text-primary font-mono" onclick={handleRestart}>
          Restart
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  :global(.shell-terminal-wrapper .xterm-viewport::-webkit-scrollbar) {
    width: 6px;
  }

  :global(.shell-terminal-wrapper .xterm-viewport::-webkit-scrollbar-track) {
    background: var(--color-base-200);
  }

  :global(.shell-terminal-wrapper .xterm-viewport::-webkit-scrollbar-thumb) {
    background: var(--color-base-300);
    border-radius: 3px;
  }

  :global(.shell-terminal-wrapper .xterm-viewport::-webkit-scrollbar-thumb:hover) {
    background: color-mix(in oklch, var(--color-base-content) 40%, transparent);
  }
</style>
