import { describe, expect, it, vi } from 'vitest'
import { RecordingFailureReporterAdapter } from './failureReporting'
import { ElectronShutdownAdapter, RustSidecarShutdownAdapter, ShutdownCoordinator } from './shutdown'
import type { ChildProcessLike } from './sidecar'
import type { ShutdownAdapter } from './shutdown'

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve()
  }
}

class FakeChild implements ChildProcessLike {
  killed = false
  killCalls: string[] = []

  private exitListener: (() => void) | null = null

  kill(signal?: NodeJS.Signals): boolean {
    this.killed = true
    this.killCalls.push(signal ?? 'SIGTERM')
    return true
  }

  once(_event: 'exit', listener: () => void): this {
    this.exitListener = listener
    return this
  }

  off(_event: 'exit', listener: () => void): this {
    if (this.exitListener === listener) this.exitListener = null
    return this
  }

  emitExit(): void {
    this.exitListener?.()
  }
}

describe('Shutdown Cleanup Module', () => {
  it('runs shutdown adapters in order and awaits each seam before continuing', async () => {
    const first = deferred()
    const second = deferred()
    const events: string[] = []
    const adapters: ShutdownAdapter[] = [
      {
        name: 'event-forwarder',
        shutdown: async () => {
          events.push('event-forwarder:start')
          await first.promise
          events.push('event-forwarder:done')
        },
      },
      {
        name: 'rust-sidecar',
        shutdown: async () => {
          events.push('rust-sidecar:start')
          await second.promise
          events.push('rust-sidecar:done')
        },
      },
    ]

    const shutdown = new ShutdownCoordinator({ adapters, logger: null })
    const result = shutdown.shutdown()

    await flushMicrotasks()
    expect(events).toEqual(['event-forwarder:start'])

    first.resolve()
    await flushMicrotasks()
    expect(events).toEqual(['event-forwarder:start', 'event-forwarder:done', 'rust-sidecar:start'])

    second.resolve()
    await expect(result).resolves.toMatchObject({ ok: true })
    expect(events).toEqual(['event-forwarder:start', 'event-forwarder:done', 'rust-sidecar:start', 'rust-sidecar:done'])
  })

  it('reports timeout and failure while still attempting later adapters', async () => {
    const events: string[] = []
    const shutdown = new ShutdownCoordinator({
      logger: null,
      sleep: async () => undefined,
      adapters: [
        {
          name: 'hung-adapter',
          deadlineMs: 10,
          shutdown: () => new Promise(() => undefined),
        },
        {
          name: 'failing-adapter',
          shutdown: async () => {
            throw new Error('boom')
          },
        },
        {
          name: 'last-adapter',
          shutdown: async () => {
            events.push('last-adapter:ran')
          },
        },
      ],
    })

    const report = await shutdown.shutdown()

    expect(report.ok).toBe(false)
    expect(report.adapters.map(adapter => adapter.name)).toEqual(['hung-adapter', 'failing-adapter', 'last-adapter'])
    expect(report.adapters[0]).toMatchObject({ status: 'timeout', deadlineMs: 10 })
    expect(report.adapters[1]).toMatchObject({ status: 'failed', error: 'boom' })
    expect(report.adapters[2]).toMatchObject({ status: 'ok' })
    expect(events).toEqual(['last-adapter:ran'])
  })

  it('promotes adapter-reported failures and timeouts into the observable shutdown report and failure seam', async () => {
    const failureReporter = new RecordingFailureReporterAdapter()
    const shutdown = new ShutdownCoordinator({
      logger: null,
      failureReporter,
      adapters: [
        { name: 'rust-sidecar-failed', shutdown: () => ({ status: 'kill-failed', error: 'failed to send SIGKILL' }) },
        { name: 'rust-sidecar-killed', shutdown: () => ({ status: 'killed', timedOut: true }) },
      ],
    })

    const report = await shutdown.shutdown()

    expect(report.ok).toBe(false)
    expect(report.adapters[0]).toMatchObject({ status: 'failed', error: 'failed to send SIGKILL' })
    expect(report.adapters[1]).toMatchObject({ status: 'timeout', error: 'adapter reported timeout' })
    expect(failureReporter.reports).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'shutdown:cleanup', severity: 'error', decision: 'quit' }),
      expect.objectContaining({ phase: 'shutdown:cleanup', severity: 'error', decision: 'quit' }),
    ]))
  })

  it('stops an in-flight Rust sidecar launch process when no ready handle exists yet', async () => {
    const child = new FakeChild()
    const sleep = vi.fn(async () => undefined)
    const adapter = new RustSidecarShutdownAdapter({
      sidecar: () => null,
      process: () => child,
      stopOptions: { graceMs: 7_000, sleep },
      deadlineMs: 8_000,
    })

    const stopping = adapter.shutdown()
    child.emitExit()

    await expect(stopping).resolves.toMatchObject({ status: 'terminated', signal: 'SIGTERM' })
    expect(child.killCalls).toEqual(['SIGTERM'])
    expect(sleep).toHaveBeenCalledWith(7_000)
  })

  it('is idempotent for concurrent and repeated shutdown calls', async () => {
    const release = deferred()
    let calls = 0
    const shutdown = new ShutdownCoordinator({
      logger: null,
      adapters: [{ name: 'only-adapter', shutdown: async () => { calls += 1; await release.promise } }],
    })

    const first = shutdown.shutdown()
    const second = shutdown.shutdown()
    expect(first).toBe(second)
    release.resolve()

    await expect(first).resolves.toMatchObject({ ok: true })
    await expect(shutdown.shutdown()).resolves.toMatchObject({ ok: true })
    expect(calls).toBe(1)
  })

  it('defers Electron before-quit until cleanup completes and exits only once', async () => {
    const release = deferred()
    const app = {
      on: vi.fn(),
      exit: vi.fn(),
    }
    const event = { preventDefault: vi.fn() }
    const shutdown = new ShutdownCoordinator({
      logger: null,
      adapters: [{ name: 'cleanup', shutdown: () => release.promise }],
    })
    const adapter = new ElectronShutdownAdapter({ app, shutdown })

    adapter.register()
    const handler = app.on.mock.calls.find(([eventName]) => eventName === 'before-quit')?.[1]
    expect(handler).toBeTypeOf('function')

    handler(event)
    handler(event)
    await flushMicrotasks()

    expect(event.preventDefault).toHaveBeenCalledTimes(2)
    expect(app.exit).not.toHaveBeenCalled()

    release.resolve()
    await flushMicrotasks()

    expect(app.exit).toHaveBeenCalledTimes(1)
    expect(app.exit).toHaveBeenCalledWith(0)
  })
})
