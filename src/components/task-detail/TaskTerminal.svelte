<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { listen } from '@tauri-apps/api/event'
  import type { UnlistenFn } from '@tauri-apps/api/event'
  import { spawnShellPty, killPty } from '../../lib/ipc'
  import '@xterm/xterm/css/xterm.css'
  import { acquire, attach, detach, recoverActiveTerminal, markPtySpawnPending, clearPtySpawnPending, shouldSpawnPty, setCurrentPtyInstance, getShellLifecycleState, updateShellLifecycleState, type PoolEntry } from '../../lib/terminalPool'

  interface Props {
    taskId: string
    workspacePath: string
    terminalKey: string
    terminalIndex: number
    isActive: boolean
    onExit?: () => void
  }

  let { taskId, workspacePath, terminalKey, terminalIndex, isActive, onExit }: Props = $props()

  let terminalEl: HTMLDivElement
  let unlisteners: UnlistenFn[] = []
  let poolEntry: PoolEntry | null = null
  let mounted = false
  let lifecycle = $state({ ptyActive: false, shellExited: false, currentPtyInstance: null as number | null })
  let previousIsActive: boolean | null = null

  function syncLifecycleState() {
    lifecycle = getShellLifecycleState(terminalKey)
  }

  async function activateTerminal(entry: PoolEntry) {
    const wasAttached = entry.attached
    await attach(entry, terminalEl)
    if (!mounted || poolEntry !== entry) return
    if (wasAttached) {
      await recoverActiveTerminal(entry)
      if (!mounted || poolEntry !== entry) return
    }
    await ensureShellStarted(entry)
  }

  async function ensureShellStarted(entry: PoolEntry) {
    if (!shouldSpawnPty(entry)) return

    markPtySpawnPending(entry)
    try {
      const instanceId = await spawnShellPty(taskId, workspacePath, entry.terminal.cols, entry.terminal.rows, terminalIndex)
      setCurrentPtyInstance(entry, instanceId)
      updateShellLifecycleState(terminalKey, {
        ptyActive: true,
        shellExited: false,
        currentPtyInstance: instanceId,
      })
      syncLifecycleState()
    } finally {
      clearPtySpawnPending(entry)
    }
  }

  onMount(async () => {
    mounted = true
    poolEntry = await acquire(terminalKey)
    if (!mounted || !poolEntry) return

    syncLifecycleState()

    if (isActive) {
      await activateTerminal(poolEntry)
      if (!mounted) return
    }

    previousIsActive = isActive

    // Listen for shell exit event
    unlisteners.push(await listen(`pty-exit-${terminalKey}`, (event) => {
      if (!poolEntry) return
      const exitInstance = (event.payload as { instance_id?: number } | null)?.instance_id
      if (exitInstance != null && lifecycle.currentPtyInstance != null && exitInstance !== lifecycle.currentPtyInstance) {
        return
      }
      updateShellLifecycleState(terminalKey, {
        ptyActive: false,
        shellExited: true,
        currentPtyInstance: lifecycle.currentPtyInstance,
      })
      syncLifecycleState()
      onExit?.()
    }))
  })

  $effect(() => {
    const entry = poolEntry
    if (!mounted || !entry) return

    syncLifecycleState()

    if (previousIsActive === null) return

    if (!previousIsActive && isActive) {
      void activateTerminal(entry)
    }

    previousIsActive = isActive
  })

  onDestroy(() => {
    mounted = false
    unlisteners.forEach((fn) => {
      fn()
    })
    if (poolEntry) {
      detach(poolEntry)
    }
  })

  async function handleRestart() {
    if (!poolEntry || lifecycle.ptyActive) return
    try {
      await killPty(terminalKey).catch(e => {
        console.error('[TaskTerminal] Failed to kill PTY on restart:', e)
      })
      markPtySpawnPending(poolEntry)
      const instanceId = await spawnShellPty(taskId, workspacePath, poolEntry.terminal.cols, poolEntry.terminal.rows, terminalIndex)
      setCurrentPtyInstance(poolEntry, instanceId)
      updateShellLifecycleState(terminalKey, {
        ptyActive: true,
        shellExited: false,
        currentPtyInstance: instanceId,
      })
      syncLifecycleState()
    } catch (e) {
      console.error('[TaskTerminal] Failed to restart shell:', e)
    } finally {
      if (poolEntry) clearPtySpawnPending(poolEntry)
    }
  }
</script>

<div class="flex flex-col h-full">
  <div class="flex-1 overflow-hidden min-h-0 relative">
    <div class="shell-terminal-wrapper w-full h-full p-3 bg-base-100" bind:this={terminalEl}></div>
    {#if lifecycle.shellExited}
      <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-base-100/90 z-[1]">
        <span class="text-sm font-mono text-base-content/70">Shell exited</span>
        <button class="btn btn-sm btn-ghost text-primary font-mono" onclick={handleRestart}>
          Restart
        </button>
      </div>
    {/if}
  </div>
</div>
