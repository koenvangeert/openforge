import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createPluginHostRuntime } from './index'

async function writeBackendModule(source: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'openforge-plugin-host-'))
  const file = join(dir, `backend-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`)
  await writeFile(file, source)
  return file
}

describe('plugin-host backend runtime', () => {
  it('activates backend entries and invokes registered plugin-local RPC methods when ready', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          globalThis.__rpcActivation = (globalThis.__rpcActivation ?? 0) + 1
          context.subscriptions.add(openforge.backend.registerMethod('syncProject', {
            async handler(input) {
              return { pluginId: context.pluginId, projectId: input.projectId, activated: globalThis.__rpcActivation }
            }
          }))
        }
      }
    `)
    const runtime = createPluginHostRuntime()

    expect(await runtime.getBackendState('github')).toMatchObject({ state: 'missing' })
    await expect(runtime.invokeBackend({ pluginId: 'github', command: 'syncProject', payload: { projectId: 'P-1' } })).rejects.toThrow(/not ready/i)

    const result = await runtime.invokeBackend({ pluginId: 'github', backendPath, command: 'syncProject', payload: { projectId: 'P-1' } })

    expect(result).toEqual({ pluginId: 'github', projectId: 'P-1', activated: 1 })
    expect(await runtime.getBackendState('github')).toMatchObject({ state: 'ready', ready: true })
  })

  it('starts backend background services after activation and stops them during deactivation', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.background.register({
            id: 'sync',
            scope: 'project',
            start() { globalThis.__serviceEvents = [...(globalThis.__serviceEvents ?? []), 'start:' + context.pluginId] },
            stop() { globalThis.__serviceEvents = [...(globalThis.__serviceEvents ?? []), 'stop:' + context.pluginId] }
          }))
          context.subscriptions.add(openforge.backend.registerMethod('events', {
            handler() { return globalThis.__serviceEvents }
          }))
        }
      }
    `)
    const runtime = createPluginHostRuntime()

    expect(await runtime.invokeBackend({ pluginId: 'worker', backendPath, command: 'events' })).toEqual(['start:worker'])
    await runtime.deactivateBackend('worker')

    expect((globalThis as typeof globalThis & { __serviceEvents?: string[] }).__serviceEvents).toEqual(['start:worker', 'stop:worker'])
    expect(await runtime.getBackendState('worker')).toMatchObject({ state: 'missing' })
  })

  it('tags plugin activation and handler logs/errors with plugin id', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          console.log('activating')
          context.subscriptions.add(openforge.backend.registerMethod('fail', {
            handler() {
              console.error('handler failed')
              throw new Error('boom')
            }
          }))
        }
      }
    `)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const runtime = createPluginHostRuntime()

    await expect(runtime.invokeBackend({ pluginId: 'logger', backendPath, command: 'fail' })).rejects.toThrow(/boom/)

    const written = stderr.mock.calls.map(call => String(call[0])).join('')
    expect(written).toContain('[plugin:logger] activating')
    expect(written).toContain('[plugin:logger] handler failed')
    expect(written).toContain('[plugin:logger] handler error in logger.fail: boom')
    stderr.mockRestore()
  })

  it('keeps plugin log attribution isolated for overlapping JSON-RPC backend calls', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('run', {
            async handler(input) {
              console.log(context.pluginId + ':start')
              await new Promise(resolve => setTimeout(resolve, input.delayMs))
              console.log(context.pluginId + ':end')
              return context.pluginId
            }
          }))
        }
      }
    `)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const runtime = createPluginHostRuntime()

    await Promise.all([
      runtime.handleJsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'plugin.backend.invoke', params: { pluginId: 'alpha', backendPath, command: 'run', payload: { delayMs: 0 } } }),
      runtime.handleJsonRpcRequest({ jsonrpc: '2.0', id: 2, method: 'plugin.backend.invoke', params: { pluginId: 'beta', backendPath, command: 'run', payload: { delayMs: 20 } } }),
    ])

    const written = stderr.mock.calls.map(call => String(call[0])).join('')
    expect(written).toContain('[plugin:alpha] alpha:start')
    expect(written).toContain('[plugin:alpha] alpha:end')
    expect(written).toContain('[plugin:beta] beta:start')
    expect(written).toContain('[plugin:beta] beta:end')
    expect(written).not.toContain('[plugin:beta] alpha:end')
    expect(written.split('\n').filter(Boolean).every(line => line.startsWith('[plugin:'))).toBe(true)
    stderr.mockRestore()
  })

  it('continues deactivation cleanup when a subscription disposable throws', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(() => { globalThis.__disposeEvents = [...(globalThis.__disposeEvents ?? []), 'after'] })
          context.subscriptions.add(() => { throw new Error('dispose boom') })
          context.subscriptions.add(() => { globalThis.__disposeEvents = [...(globalThis.__disposeEvents ?? []), 'before'] })
          context.subscriptions.add(openforge.backend.registerMethod('ok', { handler() { return true } }))
        }
      }
    `)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const runtime = createPluginHostRuntime()

    expect(await runtime.invokeBackend({ pluginId: 'cleanup', backendPath, command: 'ok' })).toBe(true)
    await expect(runtime.deactivateBackend('cleanup')).resolves.toMatchObject({ state: 'missing' })

    expect((globalThis as typeof globalThis & { __disposeEvents?: string[] }).__disposeEvents).toEqual(['before', 'after'])
    expect(await runtime.getBackendState('cleanup')).toMatchObject({ state: 'missing', ready: false })
    expect(stderr.mock.calls.map(call => String(call[0])).join('')).toContain('[plugin:cleanup] subscription dispose error: dispose boom')
    stderr.mockRestore()
  })

  it('accounts activation crashes when cleanup disposables throw during rollback', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(() => { throw new Error('dispose rollback boom') })
          context.subscriptions.add(openforge.background.register({
            id: 'crasher',
            scope: 'global',
            start() { throw new Error('service crash') }
          }))
        }
      }
    `)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const runtime = createPluginHostRuntime({ crashLoopLimit: 2 })

    await expect(runtime.activateBackend({ pluginId: 'rollback', backendPath })).rejects.toThrow(/service crash/)
    await expect(runtime.activateBackend({ pluginId: 'rollback', backendPath })).rejects.toThrow(/service crash/)
    await expect(runtime.activateBackend({ pluginId: 'rollback', backendPath })).rejects.toThrow(/crash-loop guard/i)
    expect(await runtime.getBackendState('rollback')).toMatchObject({ state: 'error', crashLoopGuardTripped: true })
    expect(stderr.mock.calls.map(call => String(call[0])).join('')).toContain('[plugin:rollback] subscription dispose error: dispose rollback boom')
    stderr.mockRestore()
  })

  it('reactivates enabled backend plugins after host restart', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          globalThis.__restartActivation = (globalThis.__restartActivation ?? 0) + 1
          context.subscriptions.add(openforge.backend.registerMethod('count', {
            handler() { return { count: globalThis.__restartActivation } }
          }))
        }
      }
    `)

    expect(await createPluginHostRuntime().invokeBackend({ pluginId: 'reactive', backendPath, command: 'count' })).toEqual({ count: 1 })
    expect(await createPluginHostRuntime().invokeBackend({ pluginId: 'reactive', backendPath, command: 'count' })).toEqual({ count: 2 })
  })

  it('guards against repeated activation/service crash loops', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          globalThis.__crashAttempts = (globalThis.__crashAttempts ?? 0) + 1
          context.subscriptions.add(openforge.background.register({
            id: 'crasher',
            scope: 'global',
            start() { throw new Error('service crash ' + globalThis.__crashAttempts) }
          }))
        }
      }
    `)
    const runtime = createPluginHostRuntime({ crashLoopLimit: 2 })

    await expect(runtime.activateBackend({ pluginId: 'crashy', backendPath })).rejects.toThrow(/service crash 1/)
    await expect(runtime.activateBackend({ pluginId: 'crashy', backendPath })).rejects.toThrow(/service crash 2/)
    await expect(runtime.activateBackend({ pluginId: 'crashy', backendPath })).rejects.toThrow(/crash-loop guard/i)
    expect(await runtime.getBackendState('crashy')).toMatchObject({ state: 'error', crashLoopGuardTripped: true })
  })

  it('exposes backend readiness through JSON-RPC state and whenReady methods', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('ping', { handler() { return 'pong' } }))
        }
      }
    `)
    const runtime = createPluginHostRuntime()

    expect(await runtime.handleJsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'plugin.backend.state', params: { pluginId: 'ready' } })).toMatchObject({ jsonrpc: '2.0', id: 1, result: { state: 'missing', ready: false } })
    expect(await runtime.handleJsonRpcRequest({ jsonrpc: '2.0', id: 2, method: 'plugin.backend.whenReady', params: { pluginId: 'ready', backendPath } })).toMatchObject({ jsonrpc: '2.0', id: 2, result: { state: 'ready', ready: true } })
    expect(await runtime.handleJsonRpcRequest({ jsonrpc: '2.0', id: 3, method: 'ready.ping', params: { pluginId: 'ready', backendPath, command: 'ping' } })).toMatchObject({ jsonrpc: '2.0', id: 3, result: 'pong' })
  })
})
