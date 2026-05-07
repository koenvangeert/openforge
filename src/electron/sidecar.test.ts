import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createSidecarLaunchConfig, startSidecar, startSidecarReadiness, stopSidecar, waitForSidecarHealth } from './sidecar'
import type { ChildProcessLike, SidecarEventEnvelopeLike, SidecarEventStreamAdapter } from './sidecar'

class FakeChild extends EventEmitter implements ChildProcessLike {
  killed = false
  killCalls: string[] = []
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  pid = 4242

  kill(signal?: NodeJS.Signals): boolean {
    this.killCalls.push(signal ?? 'SIGTERM')
    this.killed = true
    return true
  }
}

class ScriptedEventStream implements SidecarEventStreamAdapter {
  private listener: ((envelope: SidecarEventEnvelopeLike) => void) | null = null
  start = vi.fn(async () => undefined)
  ready = vi.fn(async () => undefined)
  stop = vi.fn()

  onEvent(listener: (envelope: SidecarEventEnvelopeLike) => void): void {
    this.listener = listener
  }

  emit(envelope: SidecarEventEnvelopeLike): void {
    this.listener?.(envelope)
  }
}

describe('Electron Rust sidecar supervision', () => {
  it('builds a loopback-only sidecar command with a per-launch token and app-data isolation in env', () => {
    const config = createSidecarLaunchConfig({
      executablePath: '/Applications/Open Forge.app/Contents/MacOS/openforge-sidecar',
      port: 17642,
      token: 'token-123',
      processEnv: { PATH: '/usr/bin', OPENFORGE_BACKEND_TOKEN: 'stale', OPENFORGE_APP_DATA_DIR: '/tmp/openforge-sidecar-data' },
    })

    expect(config.command).toBe('/Applications/Open Forge.app/Contents/MacOS/openforge-sidecar')
    expect(config.args).toEqual(['--host', '127.0.0.1', '--port', '17642'])
    expect(config.healthUrl).toBe('http://127.0.0.1:17642/app/health')
    expect(config.env).toMatchObject({
      PATH: '/usr/bin',
      OPENFORGE_BACKEND_HOST: '127.0.0.1',
      OPENFORGE_BACKEND_PORT: '17642',
      OPENFORGE_BACKEND_TOKEN: 'token-123',
      OPENFORGE_ELECTRON_SIDECAR: '1',
      OPENFORGE_APP_DATA_DIR: '/tmp/openforge-sidecar-data',
    })
  })

  it('polls the authenticated health endpoint until the sidecar is ready', async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error('not listening yet'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ok' }) })
    const sleep = vi.fn(async () => undefined)

    await expect(waitForSidecarHealth({
      healthUrl: 'http://127.0.0.1:17642/health',
      token: 'token-123',
      fetch,
      sleep,
      timeoutMs: 1000,
      intervalMs: 5,
    })).resolves.toEqual({ status: 'ok' })

    expect(fetch).toHaveBeenLastCalledWith('http://127.0.0.1:17642/health', {
      headers: { Authorization: 'Bearer token-123' },
    })
    expect(sleep).toHaveBeenCalledWith(5)
  })

  it('cleans up a spawned sidecar when health readiness fails', async () => {
    const child = new FakeChild()
    const spawn = vi.fn(() => child)
    const fetch = vi.fn().mockRejectedValue(new Error('not ready'))
    const sleep = vi.fn(async () => undefined)

    await expect(startSidecar(createSidecarLaunchConfig({ token: 'token-123', port: 17642 }), {
      spawn,
      fetch,
      sleep,
      healthTimeoutMs: 1,
      healthIntervalMs: 1,
    })).rejects.toThrow('sidecar did not become ready')

    expect(child.killCalls).toContain('SIGTERM')
  })

  it('exposes the spawned child before health readiness so shutdown can clean up in-flight launches', async () => {
    const child = new FakeChild()
    const spawn = vi.fn(() => child)
    const onSpawned = vi.fn()
    const health = new Promise<never>(() => undefined)
    const fetch = vi.fn(() => health)
    const sleep = vi.fn(async () => undefined)

    void startSidecar(createSidecarLaunchConfig({ token: 'token-123', port: 17642 }), {
      spawn,
      fetch,
      sleep,
      onSpawned,
    }).catch(() => undefined)

    await Promise.resolve()

    expect(onSpawned).toHaveBeenCalledWith(child)
  })

  it('spawns the sidecar, waits for readiness, and exposes a stop handle', async () => {
    const child = new FakeChild()
    const spawn = vi.fn(() => child)
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) })
    const sleep = vi.fn(async () => undefined)

    const handle = await startSidecar(createSidecarLaunchConfig({ token: 'token-123', port: 17642 }), {
      spawn,
      fetch,
      sleep,
    })

    expect(spawn).toHaveBeenCalledWith('openforge-sidecar', ['--host', '127.0.0.1', '--port', '17642'], expect.objectContaining({
      env: expect.objectContaining({
        OPENFORGE_BACKEND_TOKEN: 'token-123',
        OPENFORGE_ELECTRON_SIDECAR: '1',
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    }))

    const stopping = handle.stop({ graceMs: 1, sleep })
    child.emit('exit')
    await expect(stopping).resolves.toMatchObject({ status: 'terminated' })
    expect(child.killCalls).toEqual(['SIGTERM'])
  })

  it('streams sidecar stdout and stderr to the configured logger when enabled', async () => {
    const child = new FakeChild()
    const logger = { info: vi.fn(), error: vi.fn() }
    const spawn = vi.fn(() => child)
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) })
    const sleep = vi.fn(async () => undefined)

    await startSidecar(createSidecarLaunchConfig({ token: 'token-123', port: 17642 }), {
      spawn,
      fetch,
      sleep,
      logSidecarOutput: true,
      logger,
    })

    child.stdout.emit('data', Buffer.from('[electron-sidecar] using database /tmp/openforge_dev.db\n'))
    child.stderr.emit('data', 'warning from backend\n')

    expect(logger.info).toHaveBeenCalledWith('[sidecar] [electron-sidecar] using database /tmp/openforge_dev.db')
    expect(logger.error).toHaveBeenCalledWith('[sidecar:error] warning from backend')
  })

  it('force-kills a sidecar that does not exit during graceful shutdown', async () => {
    const child = new FakeChild()
    const sleep = vi.fn(async () => undefined)

    await expect(stopSidecar(child, { graceMs: 1, sleep })).resolves.toMatchObject({
      status: 'killed',
      timedOut: true,
    })

    expect(child.killCalls).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it('deepens readiness by waiting for authenticated readiness and the app event stream', async () => {
    const child = new FakeChild()
    const eventStream = new ScriptedEventStream()
    const spawn = vi.fn(() => child)
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'ok',
        version: '0.1.0',
        events: { available: true },
        startupResume: { phase: 'running', targetCount: 2, resumedCount: 1, failedCount: 0 },
        degraded: [],
      }),
    })
    const sleep = vi.fn(async () => undefined)

    const handle = await startSidecarReadiness(createSidecarLaunchConfig({ token: 'token-123', port: 17642 }), {
      spawn,
      fetch,
      sleep,
      createEventStream: vi.fn(() => eventStream),
    })

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:17642/app/readiness', {
      headers: { Authorization: 'Bearer token-123' },
    })
    expect(eventStream.start).toHaveBeenCalled()
    expect(eventStream.ready).toHaveBeenCalled()
    expect(handle.snapshot()).toMatchObject({
      identity: {
        readinessUrl: 'http://127.0.0.1:17642/app/readiness',
        eventUrl: 'http://127.0.0.1:17642/app/events',
        pid: 4242,
        rustVersion: '0.1.0',
      },
      http: { available: true, authenticated: true },
      events: { available: true },
      startupResume: { phase: 'running', targetCount: 2, resumedCount: 1, failedCount: 0 },
      process: { state: 'running' },
    })
  })

  it('tracks startup-resume completion and post-ready process degradation behind the readiness seam', async () => {
    const child = new FakeChild()
    const eventStream = new ScriptedEventStream()
    const spawn = vi.fn(() => child)
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', events: { available: true }, startupResume: { phase: 'pending' } }),
    })
    const sleep = vi.fn(async () => undefined)

    const handle = await startSidecarReadiness(createSidecarLaunchConfig({ token: 'token-123', port: 17642 }), {
      spawn,
      fetch,
      sleep,
      createEventStream: vi.fn(() => eventStream),
    })

    eventStream.emit({ id: 'lifecycle:startup-resume-complete', eventName: 'startup-resume-complete', payload: {} })
    expect(handle.snapshot().startupResume.phase).toBe('complete')
    expect(handle.snapshot().events.lastEventId).toBe('lifecycle:startup-resume-complete')

    child.emit('exit', 7, null)
    expect(handle.snapshot().process).toMatchObject({ state: 'exited', exitCode: 7, signal: null })
    expect(handle.snapshot().degraded).toEqual(expect.arrayContaining([
      expect.objectContaining({ area: 'process', message: 'sidecar process exited with code 7' }),
    ]))
  })

  it('preserves degraded startup-resume readiness when the completion event arrives later', async () => {
    const child = new FakeChild()
    const eventStream = new ScriptedEventStream()
    const spawn = vi.fn(() => child)
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'ok',
        events: { available: true },
        startupResume: { phase: 'degraded', targetCount: 2, resumedCount: 1, failedCount: 1 },
        degraded: [{ area: 'startupResume', message: 'failed to resume task', since: '2026-05-07T00:00:00.000Z' }],
      }),
    })
    const sleep = vi.fn(async () => undefined)

    const handle = await startSidecarReadiness(createSidecarLaunchConfig({ token: 'token-123', port: 17642 }), {
      spawn,
      fetch,
      sleep,
      createEventStream: vi.fn(() => eventStream),
    })

    eventStream.emit({ id: 'lifecycle:startup-resume-complete', eventName: 'startup-resume-complete', payload: {} })

    expect(handle.snapshot().startupResume).toMatchObject({
      phase: 'degraded',
      targetCount: 2,
      resumedCount: 1,
      failedCount: 1,
      completedAt: expect.any(String),
    })
    expect(handle.snapshot().events.lastEventId).toBe('lifecycle:startup-resume-complete')
  })

  it('cleans up the process when authenticated readiness fails', async () => {
    const child = new FakeChild()
    const spawn = vi.fn(() => child)
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'missing backend token' })
    const sleep = vi.fn(async () => undefined)

    await expect(startSidecarReadiness(createSidecarLaunchConfig({ token: 'token-123', port: 17642 }), {
      spawn,
      fetch,
      sleep,
      healthTimeoutMs: 1,
      healthIntervalMs: 1,
      createEventStream: vi.fn(() => new ScriptedEventStream()),
    })).rejects.toThrow('sidecar did not become ready: sidecar readiness check failed: missing backend token')

    expect(child.killCalls).toContain('SIGTERM')
  })

  it('makes a sidecar handle stop idempotent and reports the original stop result', async () => {
    const child = new FakeChild()
    const spawn = vi.fn(() => child)
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) })
    const sleep = vi.fn(async () => undefined)
    const handle = await startSidecar(createSidecarLaunchConfig({ token: 'token-123', port: 17642 }), {
      spawn,
      fetch,
      sleep,
    })

    const first = handle.stop({ graceMs: 1, sleep })
    const second = handle.stop({ graceMs: 1, sleep })
    expect(second).toBe(first)
    child.emit('exit')

    await expect(first).resolves.toMatchObject({ status: 'terminated' })
    await expect(handle.stop({ graceMs: 1, sleep })).resolves.toMatchObject({ status: 'terminated' })
    expect(child.killCalls).toEqual(['SIGTERM'])
  })
})
