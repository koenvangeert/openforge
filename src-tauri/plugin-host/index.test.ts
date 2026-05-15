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

  it('routes backend commands and explicit global event listeners through public integration primitives', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.commands.register({
            id: 'sync',
            title: 'Backend Sync',
            input: { type: 'object', required: ['projectId'], properties: { projectId: { type: 'string' } } },
            output: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
            async handler(input) {
              await openforge.events.emit('sync.finished', { pluginId: context.pluginId, projectId: input.projectId })
              return { ok: true }
            }
          }))
          context.subscriptions.add(openforge.commands.register({
            id: 'batch',
            title: 'Backend Batch',
            input: { type: 'array', items: { type: 'integer' } },
            output: { type: 'array', items: { type: 'string' } },
            async handler(input) {
              return input.map(String)
            }
          }))
          const events = []
          context.subscriptions.add(openforge.events.onGlobal('backend.sync.finished', event => events.push(event)))
          context.subscriptions.add(openforge.backend.registerMethod('events', { handler() { return events } }))
        }
      }
    `)
    const runtime = createPluginHostRuntime()

    await runtime.activateBackend({ pluginId: 'backend', backendPath })
    await expect(runtime.invokeCommand({ pluginId: 'backend', command: 'sync', payload: { projectId: 'P-1' } })).resolves.toEqual({ ok: true })
    await expect(runtime.invokeCommand({ pluginId: 'backend', command: 'sync', payload: {} })).rejects.toThrow(/backend\.sync input.*projectId/i)
    await expect(runtime.invokeCommand({ pluginId: 'backend', command: 'batch', payload: [1, 2] })).resolves.toEqual(['1', '2'])
    await expect(runtime.invokeCommand({ pluginId: 'backend', command: 'batch', payload: [1, '2'] })).rejects.toThrow(/backend\.batch input\[1\].*integer/i)
    await expect(runtime.listCommands()).resolves.toMatchObject([
      { id: 'sync', qualifiedId: 'backend.sync', pluginId: 'backend', title: 'Backend Sync' },
      { id: 'batch', qualifiedId: 'backend.batch', pluginId: 'backend', title: 'Backend Batch' },
    ])
    expect(await runtime.invokeBackend({ pluginId: 'backend', command: 'events' })).toEqual([{ pluginId: 'backend', projectId: 'P-1' }])
  })

  it('exposes scoped JSON storage to backend plugins with plugin/project/task isolation', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          await openforge.storage.global.set('settings', { enabled: true, pluginId: context.pluginId })
          await openforge.storage.project('P-1').set('repo', { owner: 'acme', name: context.pluginId })
          await openforge.storage.project('P-2').set('repo', { owner: 'acme', name: 'other' })
          await openforge.storage.task('T-1').set('reviewState', { viewedFiles: ['README.md'] })
          context.subscriptions.add(openforge.backend.registerMethod('readStorage', {
            async handler() {
              return {
                global: await openforge.storage.global.get('settings'),
                projectOne: await openforge.storage.project('P-1').get('repo'),
                projectTwo: await openforge.storage.project('P-2').get('repo'),
                taskOne: await openforge.storage.task('T-1').get('reviewState'),
                taskTwo: await openforge.storage.task('T-2').get('reviewState')
              }
            }
          }))
        }
      }
    `)
    const runtime = createPluginHostRuntime()

    await runtime.activateBackend({ pluginId: 'alpha', backendPath })
    await runtime.activateBackend({ pluginId: 'beta', backendPath })

    await expect(runtime.invokeBackend({ pluginId: 'alpha', command: 'readStorage' })).resolves.toEqual({
      global: { enabled: true, pluginId: 'alpha' },
      projectOne: { owner: 'acme', name: 'alpha' },
      projectTwo: { owner: 'acme', name: 'other' },
      taskOne: { viewedFiles: ['README.md'] },
      taskTwo: null,
    })
    await expect(runtime.invokeBackend({ pluginId: 'beta', command: 'readStorage' })).resolves.toMatchObject({
      global: { enabled: true, pluginId: 'beta' },
      projectOne: { owner: 'acme', name: 'beta' },
    })
  })

  it('persists backend plugin storage through host callbacks instead of runtime memory', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('write', {
            async handler() {
              await openforge.storage.global.set('settings', { enabled: true })
              await openforge.storage.project('P-1').set('repo', { owner: 'acme' })
              await openforge.storage.task('T-1').set('reviewState', { viewedFiles: ['README.md'] })
              return 'written'
            }
          }))
          context.subscriptions.add(openforge.backend.registerMethod('read', {
            async handler() {
              return {
                global: await openforge.storage.global.get('settings'),
                project: await openforge.storage.project('P-1').get('repo'),
                task: await openforge.storage.task('T-1').get('reviewState'),
                otherPlugin: await openforge.storage.project('P-2').get('repo')
              }
            }
          }))
          context.subscriptions.add(openforge.backend.registerMethod('deleteProject', {
            async handler() {
              await openforge.storage.project('P-1').delete('repo')
              return await openforge.storage.project('P-1').get('repo')
            }
          }))
        }
      }
    `)
    const calls: Array<{ method: string; params: Record<string, unknown> }> = []
    const durableStorage = new Map<string, unknown>()
    const hostCallbacks = async (request: { method: string; params: Record<string, unknown> }) => {
      calls.push(request)
      const { pluginId, scope, scopeId, key, value } = request.params
      const storageKey = JSON.stringify([pluginId, scope, scopeId ?? null, key])
      if (request.method === 'openforge.storage.get') return durableStorage.has(storageKey) ? durableStorage.get(storageKey) : null
      if (request.method === 'openforge.storage.set') {
        durableStorage.set(storageKey, value)
        return null
      }
      if (request.method === 'openforge.storage.delete') {
        durableStorage.delete(storageKey)
        return null
      }
      throw new Error(`unexpected host callback: ${request.method}`)
    }

    await expect(createPluginHostRuntime({ hostCallbacks }).invokeBackend({ pluginId: 'durable', backendPath, command: 'write' })).resolves.toBe('written')
    await expect(createPluginHostRuntime({ hostCallbacks }).invokeBackend({ pluginId: 'durable', backendPath, command: 'read' })).resolves.toEqual({
      global: { enabled: true },
      project: { owner: 'acme' },
      task: { viewedFiles: ['README.md'] },
      otherPlugin: null,
    })
    await expect(createPluginHostRuntime({ hostCallbacks }).invokeBackend({ pluginId: 'other', backendPath, command: 'read' })).resolves.toEqual({
      global: null,
      project: null,
      task: null,
      otherPlugin: null,
    })
    await expect(createPluginHostRuntime({ hostCallbacks }).invokeBackend({ pluginId: 'durable', backendPath, command: 'deleteProject' })).resolves.toBeNull()

    expect(calls).toContainEqual({ method: 'openforge.storage.set', params: { pluginId: 'durable', scope: 'global', scopeId: null, key: 'settings', value: { enabled: true } } })
    expect(calls).toContainEqual({ method: 'openforge.storage.set', params: { pluginId: 'durable', scope: 'project', scopeId: 'P-1', key: 'repo', value: { owner: 'acme' } } })
    expect(calls).toContainEqual({ method: 'openforge.storage.set', params: { pluginId: 'durable', scope: 'task', scopeId: 'T-1', key: 'reviewState', value: { viewedFiles: ['README.md'] } } })
    expect(calls).toContainEqual({ method: 'openforge.storage.delete', params: { pluginId: 'durable', scope: 'project', scopeId: 'P-1', key: 'repo' } })
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
    expect(await runtime.handleJsonRpcRequest({ jsonrpc: '2.0', id: 3, method: 'ready.backend.state', params: { pluginId: 'ready' } })).toMatchObject({ jsonrpc: '2.0', id: 3, result: { state: 'ready', ready: true } })
    expect(await runtime.handleJsonRpcRequest({ jsonrpc: '2.0', id: 4, method: 'ready.backend.whenReady', params: { pluginId: 'ready', backendPath } })).toMatchObject({ jsonrpc: '2.0', id: 4, result: { state: 'ready', ready: true } })
    expect(await runtime.handleJsonRpcRequest({ jsonrpc: '2.0', id: 5, method: 'ready.ping', params: { pluginId: 'ready', backendPath, command: 'ping' } })).toMatchObject({ jsonrpc: '2.0', id: 5, result: 'pong' })
  })
})
