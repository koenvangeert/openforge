import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { ELECTRON_RENDERER_URL, assertBackendPortAvailable, assertVitePortAvailable, buildElectronDevEnv, cleanupDevProcesses, electronSidecarPath, resolveElectronDevBackendEnv, stopProcess, waitForVite } from './electron-dev.mjs'
import { resolveRustSidecarLayout } from './rust-sidecar-layout.mjs'

const defaultTestLayout = resolveRustSidecarLayout({
  repoRoot: '/repo/openforge',
  config: {
    backendCrateRoot: 'src-tauri',
    manifestPath: 'src-tauri/Cargo.toml',
    binaryName: 'openforge',
    iconPath: 'src-tauri/icons/icon.icns',
    electronBundleRoot: 'src-tauri/target/release/bundle/electron/macos',
  },
})

function createChildProcessMock() {
  const events = new EventEmitter()
  return {
    killed: false,
    killSignals: [],
    unrefCalls: 0,
    kill(signal = 'SIGTERM') {
      this.killed = true
      this.killSignals.push(signal)
      return true
    },
    once(event, handler) {
      events.once(event, handler)
      return this
    },
    off(event, handler) {
      events.off(event, handler)
      return this
    },
    emitExit(code = 0, signal = null) {
      events.emit('exit', code, signal)
    },
    unref() {
      this.unrefCalls += 1
    },
  }
}

function createCleanupTimerDeps() {
  const timer = { unref: vi.fn() }
  let timeoutCallback = null
  return {
    timer,
    setTimeout: vi.fn((callback) => {
      timeoutCallback = callback
      return timer
    }),
    clearTimeout: vi.fn(),
    fireTimeout() {
      timeoutCallback?.()
    },
  }
}

describe('electron dev script environment', () => {
  it('starts Electron against the Vite dev server and disables sidecar warning when no sidecar path is configured', () => {
    const env = buildElectronDevEnv({ PATH: '/usr/bin' })

    expect(env.ELECTRON_RENDERER_URL).toBe('http://127.0.0.1:1420')
    expect(env.OPENFORGE_ELECTRON_DEV_DISABLE_SIDECAR).toBe('1')
    expect(env.PATH).toBe('/usr/bin')
  })

  it('enables sidecar mode when the dev launcher supplies a built Rust sidecar path', () => {
    const env = buildElectronDevEnv({ PATH: '/usr/bin' }, '/tmp/openforge-sidecar')

    expect(env.OPENFORGE_SIDECAR_PATH).toBe('/tmp/openforge-sidecar')
    expect(env.OPENFORGE_ELECTRON_SIDECAR).toBe('1')
    expect(env.OPENFORGE_ELECTRON_DEV_DISABLE_SIDECAR).toBeUndefined()
  })

  it('preserves an explicit sidecar path instead of disabling the sidecar', () => {
    const env = buildElectronDevEnv({
      OPENFORGE_SIDECAR_PATH: '/tmp/openforge-sidecar',
      OPENFORGE_BACKEND_PORT: '18000',
    })

    expect(env.OPENFORGE_SIDECAR_PATH).toBe('/tmp/openforge-sidecar')
    expect(env.OPENFORGE_BACKEND_PORT).toBe('18000')
    expect(env.OPENFORGE_ELECTRON_SIDECAR).toBe('1')
    expect(env.OPENFORGE_ELECTRON_DEV_DISABLE_SIDECAR).toBeUndefined()
  })

  it('derives the Electron sidecar executable from the shared Cargo target dir and layout Module binary name', () => {
    const rustSidecarLayout = resolveRustSidecarLayout({
      repoRoot: '/repo/openforge',
      config: {
        backendCrateRoot: 'crates/openforge-backend',
        manifestPath: 'crates/openforge-backend/Cargo.toml',
        binaryName: 'openforge-backend',
        iconPath: 'assets/icon.icns',
        electronBundleRoot: 'target/electron/macos',
      },
    })

    expect(electronSidecarPath('/tmp/openforge-target', rustSidecarLayout)).toBe('/tmp/openforge-target/debug/openforge-backend')
  })

  it('uses one canonical loopback URL for Electron and Vite readiness', () => {
    expect(ELECTRON_RENDERER_URL).toBe('http://127.0.0.1:1420')
  })

  it('fails before launch when the Vite port is already occupied', async () => {
    await expect(assertVitePortAvailable({ isPortOpen: async () => true })).rejects.toThrow('Port 1420 is already in use')
  })

  it('fails before launch when a stale backend sidecar already owns an explicit backend port', async () => {
    await expect(assertBackendPortAvailable(18000, { isPortOpen: async (_host, port) => port === 18000 })).rejects.toThrow('Port 18000 is already in use')
  })

  it('selects the next free backend port when the default dev backend port is occupied', async () => {
    const result = await resolveElectronDevBackendEnv(
      {
        cwd: '/repo/openforge',
        env: { PATH: '/usr/bin' },
        rustSidecarLayout: defaultTestLayout,
        execFileSync: () => {
          throw new Error('not a git checkout')
        },
      },
      { isPortOpen: async (_host, port) => port === 17642 },
    )

    expect(result.env.OPENFORGE_BACKEND_PORT).toBe('17643')
    expect(result.env.OPENFORGE_HTTP_PORT).toBe('17643')

    const electronEnv = buildElectronDevEnv(result.env)
    expect(electronEnv.OPENFORGE_BACKEND_PORT).toBe('17643')
    expect(electronEnv.OPENFORGE_HTTP_PORT).toBe('17643')
  })

  it('selects the next free dev port when an inherited legacy production port is present', async () => {
    const result = await resolveElectronDevBackendEnv(
      {
        cwd: '/repo/openforge',
        env: { AI_COMMAND_CENTER_PORT: '17422' },
        rustSidecarLayout: defaultTestLayout,
        execFileSync: () => {
          throw new Error('not a git checkout')
        },
      },
      { isPortOpen: async (_host, port) => port === 17642 },
    )

    expect(result.env.OPENFORGE_BACKEND_PORT).toBe('17643')
    expect(result.env.OPENFORGE_HTTP_PORT).toBe('17643')
  })

  it('selects a free port when inherited OpenForge env uses the occupied default dev port', async () => {
    const result = await resolveElectronDevBackendEnv(
      {
        cwd: '/repo/openforge',
        env: {
          OPENFORGE_BACKEND_PORT: '17642',
          OPENFORGE_HTTP_PORT: '17642',
        },
        rustSidecarLayout: defaultTestLayout,
        execFileSync: () => {
          throw new Error('not a git checkout')
        },
      },
      { isPortOpen: async (_host, port) => port === 17642 },
    )

    expect(result.env.OPENFORGE_BACKEND_PORT).toBe('17643')
    expect(result.env.OPENFORGE_HTTP_PORT).toBe('17643')
  })

  it('preserves explicit hook client ports when selecting a free backend port', async () => {
    const result = await resolveElectronDevBackendEnv(
      {
        cwd: '/repo/openforge',
        env: { OPENFORGE_HTTP_PORT: '19000' },
        rustSidecarLayout: defaultTestLayout,
        execFileSync: () => {
          throw new Error('not a git checkout')
        },
      },
      { isPortOpen: async (_host, port) => port === 17642 },
    )

    expect(result.env.OPENFORGE_BACKEND_PORT).toBe('17643')
    expect(result.env.OPENFORGE_HTTP_PORT).toBe('19000')
  })

  it('fails fast instead of reassigning an occupied explicit backend port', async () => {
    await expect(resolveElectronDevBackendEnv(
      {
        cwd: '/repo/openforge',
        env: { OPENFORGE_BACKEND_PORT: '18000' },
        rustSidecarLayout: defaultTestLayout,
        execFileSync: () => {
          throw new Error('not a git checkout')
        },
      },
      { isPortOpen: async (_host, port) => port === 18000 },
    )).rejects.toThrow('Port 18000 is already in use')
  })

  it('fails fast instead of reassigning an occupied custom legacy backend port', async () => {
    await expect(resolveElectronDevBackendEnv(
      {
        cwd: '/repo/openforge',
        env: { AI_COMMAND_CENTER_PORT: '19000' },
        rustSidecarLayout: defaultTestLayout,
        execFileSync: () => {
          throw new Error('not a git checkout')
        },
      },
      { isPortOpen: async (_host, port) => port === 19000 },
    )).rejects.toThrow('Port 19000 is already in use')
  })

  it('fails fast if the spawned Vite process exits before readiness', async () => {
    const exitedProcess = {
      once: (_event, handler) => {
        handler(1, null)
        return exitedProcess
      },
      off: () => exitedProcess,
    }

    await expect(waitForVite(ELECTRON_RENDERER_URL, exitedProcess)).rejects.toThrow('Vite dev server exited before becoming ready')
  })

  it('waits for a stopped dev child to exit and cancels the cleanup timer before resolving', async () => {
    const child = createChildProcessMock()
    const timerDeps = createCleanupTimerDeps()
    const stop = stopProcess(child, { graceMs: 100, ...timerDeps })

    expect(child.killSignals).toEqual(['SIGTERM'])
    expect(timerDeps.setTimeout).toHaveBeenCalledWith(expect.any(Function), 100)
    expect(timerDeps.timer.unref).toHaveBeenCalled()

    child.emitExit(0, null)

    await expect(stop).resolves.toBe('terminated')
    expect(timerDeps.clearTimeout).toHaveBeenCalledWith(timerDeps.timer)
  })

  it('force-kills and unreferences a stubborn dev child after the cleanup grace period', async () => {
    const child = createChildProcessMock()
    const timerDeps = createCleanupTimerDeps()
    const stop = stopProcess(child, { graceMs: 100, ...timerDeps })

    timerDeps.fireTimeout()

    await expect(stop).resolves.toBe('killed')

    expect(child.killSignals).toEqual(['SIGTERM', 'SIGKILL'])
    expect(child.unrefCalls).toBe(1)
  })

  it('cleans up Vite and Electron child processes before resolving', async () => {
    const vite = createChildProcessMock()
    const electron = createChildProcessMock()
    const cleanup = cleanupDevProcesses({ vite, electron }, { graceMs: 100 })

    expect(vite.killSignals).toEqual(['SIGTERM'])
    expect(electron.killSignals).toEqual(['SIGTERM'])

    vite.emitExit(0, null)
    electron.emitExit(0, null)

    await expect(cleanup).resolves.toEqual(['terminated', 'terminated'])
  })
})
