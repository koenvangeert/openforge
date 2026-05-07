<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { spawnShellPty, killPty } from '../../lib/ipc'
  import '@xterm/xterm/css/xterm.css'
  import { acquire, attach, detach, recoverActiveTerminal, markPtySpawnPending, clearPtySpawnPending, shouldSpawnPty, markShellPtyStarted, getShellLifecycleState, subscribeShellLifecycle, type PoolEntry, type ShellLifecycleState } from '../../lib/terminalPool'

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
  let unsubscribeShellLifecycle: (() => void) | null = null
  let poolEntry = $state.raw<PoolEntry | null>(null)
  let mounted = $state(false)
  let lifecycle = $state({ ptyActive: false, shellExited: false, currentPtyInstance: null as number | null })
  let previousIsActive: boolean | null = null
  let activatingEntry: PoolEntry | null = null
  let boundTerminalKey = $state<string | null>(null)
  let boundContextSignature = $state<string | null>(null)
  let bindRun = 0

  interface TerminalBindingContext {
    taskId: string
    workspacePath: string
    terminalKey: string
    terminalIndex: number
  }

  function currentBindingContext(): TerminalBindingContext {
    return { taskId, workspacePath, terminalKey, terminalIndex }
  }

  function bindingContextSignature(context: TerminalBindingContext): string {
    return `${context.taskId}\u0000${context.workspacePath}\u0000${context.terminalKey}\u0000${context.terminalIndex}`
  }

  function isCurrentBindingContext(context: TerminalBindingContext): boolean {
    return mounted
      && boundTerminalKey === context.terminalKey
      && terminalKey === context.terminalKey
      && taskId === context.taskId
      && workspacePath === context.workspacePath
      && terminalIndex === context.terminalIndex
  }

  function syncLifecycleState(key: string = boundTerminalKey ?? terminalKey) {
    lifecycle = getShellLifecycleState(key)
  }

  async function activateTerminal(entry: PoolEntry, context: TerminalBindingContext = currentBindingContext()) {
    if (activatingEntry === entry) return
    activatingEntry = entry
    try {
      const wasAttached = entry.attached
      await attach(entry, terminalEl)
      if (poolEntry !== entry || !isCurrentBindingContext(context)) return
      if (wasAttached) {
        await recoverActiveTerminal(entry)
        if (poolEntry !== entry || !isCurrentBindingContext(context)) return
      }
      await ensureShellStarted(entry, context)
    } finally {
      if (activatingEntry === entry) activatingEntry = null
    }
  }

  async function ensureShellStarted(entry: PoolEntry, context: TerminalBindingContext) {
    if (!isCurrentBindingContext(context) || !shouldSpawnPty(entry)) return

    markPtySpawnPending(entry)
    try {
      if (!isCurrentBindingContext(context)) return
      const instanceId = await spawnShellPty(context.taskId, context.workspacePath, entry.terminal.cols, entry.terminal.rows, context.terminalIndex)
      markShellPtyStarted(entry, instanceId)
      if (isCurrentBindingContext(context)) syncLifecycleState(context.terminalKey)
    } finally {
      clearPtySpawnPending(entry)
    }
  }

  function clearComponentTerminalResources() {
    unsubscribeShellLifecycle?.()
    unsubscribeShellLifecycle = null
    if (poolEntry) {
      detach(poolEntry)
      poolEntry = null
    }
    previousIsActive = null
    activatingEntry = null
  }

  async function bindToTerminalKey(nextTerminalKey: string) {
    const currentRun = bindRun + 1
    bindRun = currentRun
    clearComponentTerminalResources()
    const context = currentBindingContext()
    boundTerminalKey = nextTerminalKey
    boundContextSignature = bindingContextSignature(context)

    const entry = await acquire(nextTerminalKey)
    if (bindRun !== currentRun || !isCurrentBindingContext(context)) return

    poolEntry = entry
    syncLifecycleState(nextTerminalKey)

    unsubscribeShellLifecycle = subscribeShellLifecycle(nextTerminalKey, (state: ShellLifecycleState) => {
      if (!poolEntry || boundTerminalKey !== nextTerminalKey) return
      const wasExited = lifecycle.shellExited
      lifecycle = state
      if (!wasExited && state.shellExited) onExit?.()
    })

    if (isActive) {
      await activateTerminal(entry, context)
      if (bindRun !== currentRun || !isCurrentBindingContext(context)) return
    }

    previousIsActive = isActive

    if (!mounted || bindRun !== currentRun || boundTerminalKey !== nextTerminalKey) {
      unsubscribeShellLifecycle?.()
      unsubscribeShellLifecycle = null
    }
  }

  onMount(() => {
    mounted = true
  })

  $effect(() => {
    if (!mounted) return

    const context = currentBindingContext()
    if (boundContextSignature !== bindingContextSignature(context)) {
      void bindToTerminalKey(terminalKey)
      return
    }

    const entry = poolEntry
    if (!entry) return

    syncLifecycleState(boundTerminalKey)

    const needsActiveHostRestore = isActive && entry.hostDiv.parentNode !== terminalEl
    if (previousIsActive === null) {
      if (needsActiveHostRestore) void activateTerminal(entry, context)
      previousIsActive = isActive
      return
    }

    if ((!previousIsActive && isActive) || needsActiveHostRestore) {
      void activateTerminal(entry, context)
    }

    previousIsActive = isActive
  })

  onDestroy(() => {
    mounted = false
    bindRun += 1
    clearComponentTerminalResources()
    boundTerminalKey = null
    boundContextSignature = null
  })

  async function handleRestart() {
    const entry = poolEntry
    const context = currentBindingContext()
    if (!entry || lifecycle.ptyActive) return
    try {
      await killPty(context.terminalKey).catch(e => {
        console.error('[TaskTerminal] Failed to kill PTY on restart:', e)
      })
      markPtySpawnPending(entry)
      const instanceId = await spawnShellPty(context.taskId, context.workspacePath, entry.terminal.cols, entry.terminal.rows, context.terminalIndex)
      markShellPtyStarted(entry, instanceId)
      if (isCurrentBindingContext(context)) syncLifecycleState(context.terminalKey)
    } catch (e) {
      console.error('[TaskTerminal] Failed to restart shell:', e)
    } finally {
      clearPtySpawnPending(entry)
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
