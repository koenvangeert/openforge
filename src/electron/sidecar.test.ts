import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createSidecarLaunchConfig, startSidecar, stopSidecar, waitForSidecarHealth } from './sidecar'
import type { ChildProcessLike } from './sidecar'

class FakeChild extends EventEmitter implements ChildProcessLike {
  killed = false
  killCalls: string[] = []
  stdout = new EventEmitter()
  stderr = new EventEmitter()

  kill(signal?: NodeJS.Signals): boolean {
    this.killCalls.push(signal ?? 'SIGTERM')
    this.killed = true
    return true
  }
}

describe('Electron Rust sidecar supervision', () => {
  it('builds a loopback-only sidecar command with a per-launch token in env', () => {
    const config = createSidecarLaunchConfig({
      executablePath: '/Applications/Open Forge.app/Contents/MacOS/openforge-sidecar',
      port: 17642,
      token: 'token-123',
      processEnv: { PATH: '/usr/bin', OPENFORGE_BACKEND_TOKEN: 'stale' },
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
    await stopping
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

    await stopSidecar(child, { graceMs: 1, sleep })

    expect(child.killCalls).toEqual(['SIGTERM', 'SIGKILL'])
  })
})
