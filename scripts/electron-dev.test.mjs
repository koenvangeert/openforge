import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { DevScriptCleanupAdapter, ELECTRON_DEV_DISABLE_AUTO_SEED_ENV, ELECTRON_DEV_SEED_APP_DATA_DIR_ENV, ELECTRON_DEV_SEED_DB_PATH_ENV, ELECTRON_RENDERER_URL, assertBackendPortAvailable, assertElectronDebugPortAvailable, assertVitePortAvailable, buildElectronDebugArgs, buildElectronDevEnv, cleanupDevProcesses, electronSidecarPath, rendererUrlForPort, resolveElectronDevBackendEnv, resolveElectronDevRuntimeOptions, stopProcess, waitForVite } from './electron-dev.mjs'
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

function createRecordingFailureReporter() {
  const reports = []
  return {
    reports,
    async reportFailure(report) {
      reports.push(report)
      return report.decision
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

  it('passes configurable renderer URL and isolated runtime directories to Electron and the sidecar', () => {
    const env = buildElectronDevEnv(
      { PATH: '/usr/bin' },
      '/tmp/openforge-sidecar',
      {
        rendererUrl: 'http://127.0.0.1:1431',
        userDataDir: '/tmp/openforge-user-data',
        appDataDir: '/tmp/openforge-sidecar-data',
      },
    )

    expect(env.ELECTRON_RENDERER_URL).toBe('http://127.0.0.1:1431')
    expect(env.OPENFORGE_ELECTRON_USER_DATA_DIR).toBe('/tmp/openforge-user-data')
    expect(env.OPENFORGE_APP_DATA_DIR).toBe('/tmp/openforge-sidecar-data')
    expect(env.OPENFORGE_SIDECAR_PATH).toBe('/tmp/openforge-sidecar')
    expect(env.OPENFORGE_ELECTRON_SIDECAR).toBe('1')
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

  it('uses one canonical loopback URL for Electron and Vite readiness by default', () => {
    expect(ELECTRON_RENDERER_URL).toBe('http://127.0.0.1:1420')
    expect(rendererUrlForPort(1431)).toBe('http://127.0.0.1:1431')
  })

  it('resolves configurable renderer/debug ports and creates per-run isolation dirs', () => {
    let dirCounter = 0
    const options = resolveElectronDevRuntimeOptions(
      {
        OPENFORGE_ELECTRON_RENDERER_PORT: '1431',
        OPENFORGE_ELECTRON_DEBUG_PORT: '9333',
      },
      {
        repoRoot: () => '/repo/openforge',
        tmpdir: () => '/tmp',
        mkdtempSync: prefix => `${prefix}${++dirCounter}`,
        existsSync: () => false,
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn(),
      },
    )

    expect(options.rendererPort).toBe(1431)
    expect(options.rendererUrl).toBe('http://127.0.0.1:1431')
    expect(options.electronDebugPort).toBe(9333)
    expect(options.userDataDir).toBe('/tmp/openforge-electron-user-data-1')
    expect(options.appDataDir).toBe('/repo/openforge/.openforge-dev/sidecar-app-data')
    expect(options.tempRuntimeDirs).toEqual(['/tmp/openforge-electron-user-data-1'])
    expect(buildElectronDebugArgs(options)).toEqual(['--inspect=127.0.0.1:9333'])
  })

  it('preserves explicit isolation directories and allows disabling Electron debug', () => {
    const options = resolveElectronDevRuntimeOptions({
      OPENFORGE_ELECTRON_USER_DATA_DIR: '/custom/user-data',
      OPENFORGE_APP_DATA_DIR: '/custom/app-data',
    })

    expect(options.userDataDir).toBe('/custom/user-data')
    expect(options.appDataDir).toBe('/custom/app-data')
    expect(options.tempRuntimeDirs).toEqual([])
    expect(options.electronDebugPort).toBeNull()
    expect(buildElectronDebugArgs(options)).toEqual([])
  })

  it('stores and auto-seeds worktree-persistent dev app data from the default development database', () => {
    let dirCounter = 0
    const copyFileSync = vi.fn()
    const mkdirSync = vi.fn()
    const writeFileSync = vi.fn()
    const options = resolveElectronDevRuntimeOptions(
      {},
      {
        repoRoot: () => '/repo/openforge',
        tmpdir: () => '/tmp',
        homedir: () => '/Users/tester',
        platform: 'darwin',
        mkdtempSync: prefix => `${prefix}${++dirCounter}`,
        existsSync: path => path === '/Users/tester/Library/Application Support/com.opencode.openforge/openforge_dev.db',
        copyFileSync,
        mkdirSync,
        writeFileSync,
      },
    )

    expect(options.appDataDir).toBe('/repo/openforge/.openforge-dev/sidecar-app-data')
    expect(options.tempRuntimeDirs).toEqual(['/tmp/openforge-electron-user-data-1'])
    expect(options.seededAppData).toMatchObject({
      sourceDbPath: '/Users/tester/Library/Application Support/com.opencode.openforge/openforge_dev.db',
      sourceBuildMode: 'debug',
      sourceKind: 'auto-default-app-data',
      targetDbPath: '/repo/openforge/.openforge-dev/sidecar-app-data/openforge_dev.db',
    })
    expect(copyFileSync).toHaveBeenCalledWith('/Users/tester/Library/Application Support/com.opencode.openforge/openforge_dev.db', '/repo/openforge/.openforge-dev/sidecar-app-data/openforge_dev.db')
    expect(mkdirSync).toHaveBeenCalledWith('/repo/openforge/.openforge-dev', { recursive: true })
    expect(mkdirSync).toHaveBeenCalledWith('/repo/openforge/.openforge-dev/sidecar-app-data', { recursive: true })
    expect(writeFileSync).toHaveBeenCalledWith('/repo/openforge/.openforge-dev/electron-dev-runtime.json', expect.stringContaining('sidecar-app-data'))
  })

  it('reuses stored worktree app data without reseeding when it already has a dev database', () => {
    const copyFileSync = vi.fn()
    const options = resolveElectronDevRuntimeOptions(
      {},
      {
        repoRoot: () => '/repo/openforge',
        tmpdir: () => '/tmp',
        mkdtempSync: prefix => `${prefix}1`,
        existsSync: path => path === '/repo/openforge/.openforge-dev/electron-dev-runtime.json' || path === '/repo/openforge/.openforge-dev/sidecar-app-data/openforge_dev.db',
        readFileSync: () => JSON.stringify({ appDataDir: '/repo/openforge/.openforge-dev/sidecar-app-data' }),
        copyFileSync,
        mkdirSync: vi.fn(),
      },
    )

    expect(options.appDataDir).toBe('/repo/openforge/.openforge-dev/sidecar-app-data')
    expect(options.seededAppData).toBeNull()
    expect(copyFileSync).not.toHaveBeenCalled()
  })

  it('leaves persistent worktree dev app data empty when no default development database exists', () => {
    let dirCounter = 0
    const copyFileSync = vi.fn()
    const options = resolveElectronDevRuntimeOptions(
      {},
      {
        repoRoot: () => '/repo/openforge',
        tmpdir: () => '/tmp',
        homedir: () => '/Users/tester',
        platform: 'darwin',
        mkdtempSync: prefix => `${prefix}${++dirCounter}`,
        existsSync: () => false,
        copyFileSync,
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn(),
      },
    )

    expect(options.appDataDir).toBe('/repo/openforge/.openforge-dev/sidecar-app-data')
    expect(options.seededAppData).toBeNull()
    expect(copyFileSync).not.toHaveBeenCalled()
  })

  it('allows auto-seeding to be disabled for fresh empty dev runs', () => {
    let dirCounter = 0
    const copyFileSync = vi.fn()
    const options = resolveElectronDevRuntimeOptions(
      { [ELECTRON_DEV_DISABLE_AUTO_SEED_ENV]: '1' },
      {
        repoRoot: () => '/repo/openforge',
        tmpdir: () => '/tmp',
        homedir: () => '/Users/tester',
        platform: 'darwin',
        mkdtempSync: prefix => `${prefix}${++dirCounter}`,
        existsSync: () => true,
        copyFileSync,
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn(),
      },
    )

    expect(options.seededAppData).toBeNull()
    expect(copyFileSync).not.toHaveBeenCalled()
  })

  it('seeds worktree-persistent dev app data from an existing debug database when requested', () => {
    let dirCounter = 0
    const copyFileSync = vi.fn()
    const options = resolveElectronDevRuntimeOptions(
      { [ELECTRON_DEV_SEED_APP_DATA_DIR_ENV]: '/existing/openforge-data' },
      {
        repoRoot: () => '/repo/openforge',
        tmpdir: () => '/tmp',
        mkdtempSync: prefix => `${prefix}${++dirCounter}`,
        existsSync: path => path === '/existing/openforge-data/openforge_dev.db',
        copyFileSync,
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn(),
      },
    )

    expect(options.appDataDir).toBe('/repo/openforge/.openforge-dev/sidecar-app-data')
    expect(options.seededAppData).toEqual({
      sourceDbPath: '/existing/openforge-data/openforge_dev.db',
      sourceBuildMode: 'debug',
      sourceKind: 'explicit-app-data-dir',
      targetDbPath: '/repo/openforge/.openforge-dev/sidecar-app-data/openforge_dev.db',
      copiedCompanionFiles: [],
    })
    expect(copyFileSync).toHaveBeenCalledWith('/existing/openforge-data/openforge_dev.db', '/repo/openforge/.openforge-dev/sidecar-app-data/openforge_dev.db')
  })

  it('rejects app data seeding when only a production database exists', () => {
    const copyFileSync = vi.fn()

    expect(() => resolveElectronDevRuntimeOptions(
      { [ELECTRON_DEV_SEED_APP_DATA_DIR_ENV]: '/existing/openforge-data' },
      {
        repoRoot: () => '/repo/openforge',
        tmpdir: () => '/tmp',
        mkdtempSync: prefix => `${prefix}1`,
        existsSync: path => path === '/existing/openforge-data/openforge.db',
        copyFileSync,
        mkdirSync: vi.fn(),
        rmSync: vi.fn(),
        writeFileSync: vi.fn(),
      },
    )).toThrow('openforge_dev.db does not exist')
    expect(copyFileSync).not.toHaveBeenCalled()
  })

  it('seeds worktree-persistent dev app data from an explicit development database file path', () => {
    let dirCounter = 0
    const copyFileSync = vi.fn()
    const options = resolveElectronDevRuntimeOptions(
      { [ELECTRON_DEV_SEED_DB_PATH_ENV]: '/backups/openforge_dev.db' },
      {
        repoRoot: () => '/repo/openforge',
        tmpdir: () => '/tmp',
        mkdtempSync: prefix => `${prefix}${++dirCounter}`,
        existsSync: path => path === '/backups/openforge_dev.db',
        copyFileSync,
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn(),
      },
    )

    expect(options.seededAppData).toMatchObject({
      sourceDbPath: '/backups/openforge_dev.db',
      sourceBuildMode: 'debug',
      targetDbPath: '/repo/openforge/.openforge-dev/sidecar-app-data/openforge_dev.db',
    })
    expect(copyFileSync).toHaveBeenCalledWith('/backups/openforge_dev.db', '/repo/openforge/.openforge-dev/sidecar-app-data/openforge_dev.db')
  })

  it('rejects explicit production database seed paths', () => {
    const copyFileSync = vi.fn()

    expect(() => resolveElectronDevRuntimeOptions(
      { [ELECTRON_DEV_SEED_DB_PATH_ENV]: '/backups/openforge.db' },
      {
        repoRoot: () => '/repo/openforge',
        tmpdir: () => '/tmp',
        mkdtempSync: prefix => `${prefix}1`,
        existsSync: path => path === '/backups/openforge.db',
        copyFileSync,
        mkdirSync: vi.fn(),
        rmSync: vi.fn(),
        writeFileSync: vi.fn(),
      },
    )).toThrow('must point to openforge_dev.db')
    expect(copyFileSync).not.toHaveBeenCalled()
  })

  it('still rejects explicit production seed paths when the worktree dev database already exists', () => {
    const copyFileSync = vi.fn()

    expect(() => resolveElectronDevRuntimeOptions(
      { [ELECTRON_DEV_SEED_DB_PATH_ENV]: '/backups/openforge.db' },
      {
        repoRoot: () => '/repo/openforge',
        tmpdir: () => '/tmp',
        mkdtempSync: prefix => `${prefix}1`,
        existsSync: path => path === '/backups/openforge.db' || path === '/repo/openforge/.openforge-dev/sidecar-app-data/openforge_dev.db',
        copyFileSync,
        mkdirSync: vi.fn(),
        rmSync: vi.fn(),
        writeFileSync: vi.fn(),
      },
    )).toThrow('must point to openforge_dev.db')
    expect(copyFileSync).not.toHaveBeenCalled()
  })

  it('requires resetting worktree app data before applying an explicit seed to an existing dev database', () => {
    const copyFileSync = vi.fn()

    expect(() => resolveElectronDevRuntimeOptions(
      { [ELECTRON_DEV_SEED_DB_PATH_ENV]: '/backups/openforge_dev.db' },
      {
        repoRoot: () => '/repo/openforge',
        tmpdir: () => '/tmp',
        mkdtempSync: prefix => `${prefix}1`,
        existsSync: path => path === '/backups/openforge_dev.db' || path === '/repo/openforge/.openforge-dev/sidecar-app-data/openforge_dev.db',
        copyFileSync,
        mkdirSync: vi.fn(),
        rmSync: vi.fn(),
        writeFileSync: vi.fn(),
      },
    )).toThrow('delete .openforge-dev')
    expect(copyFileSync).not.toHaveBeenCalled()
  })

  it('does not seed or clean an explicit app data directory even when seed env is present', () => {
    const copyFileSync = vi.fn()
    const options = resolveElectronDevRuntimeOptions(
      {
        OPENFORGE_APP_DATA_DIR: '/custom/app-data',
        [ELECTRON_DEV_SEED_APP_DATA_DIR_ENV]: '/existing/openforge-data',
      },
      {
        tmpdir: () => '/tmp',
        mkdtempSync: prefix => `${prefix}unused`,
        existsSync: () => true,
        copyFileSync,
      },
    )

    expect(options.appDataDir).toBe('/custom/app-data')
    expect(options.tempRuntimeDirs).toEqual(['/tmp/openforge-electron-user-data-unused'])
    expect(options.tempRuntimeDirs).not.toContain('/custom/app-data')
    expect(options.seededAppData).toBeNull()
    expect(copyFileSync).not.toHaveBeenCalled()
  })

  it('cleans created temp runtime dirs when requested dev app data seeding cannot find a source database', () => {
    const rmSync = vi.fn()

    expect(() => resolveElectronDevRuntimeOptions(
      { [ELECTRON_DEV_SEED_APP_DATA_DIR_ENV]: '/missing/openforge-data' },
      {
        repoRoot: () => '/repo/openforge',
        tmpdir: () => '/tmp',
        mkdtempSync: prefix => `${prefix}1`,
        existsSync: () => false,
        copyFileSync: vi.fn(),
        mkdirSync: vi.fn(),
        rmSync,
        writeFileSync: vi.fn(),
      },
    )).toThrow('openforge_dev.db does not exist')

    expect(rmSync).toHaveBeenCalledWith('/tmp/openforge-electron-user-data-1', { recursive: true, force: true })
    expect(rmSync).not.toHaveBeenCalledWith('/repo/openforge/.openforge-dev/sidecar-app-data', expect.anything())
  })

  it('copies sqlite companion files when present during worktree dev app data seeding', () => {
    let dirCounter = 0
    const copyFileSync = vi.fn()
    const options = resolveElectronDevRuntimeOptions(
      { [ELECTRON_DEV_SEED_APP_DATA_DIR_ENV]: '/existing/openforge-data' },
      {
        repoRoot: () => '/repo/openforge',
        tmpdir: () => '/tmp',
        mkdtempSync: prefix => `${prefix}${++dirCounter}`,
        existsSync: path => [
          '/existing/openforge-data/openforge_dev.db',
          '/existing/openforge-data/openforge_dev.db-wal',
          '/existing/openforge-data/openforge_dev.db-shm',
        ].includes(path),
        copyFileSync,
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn(),
      },
    )

    expect(options.seededAppData.copiedCompanionFiles).toEqual([
      {
        sourcePath: '/existing/openforge-data/openforge_dev.db-wal',
        targetPath: '/repo/openforge/.openforge-dev/sidecar-app-data/openforge_dev.db-wal',
      },
      {
        sourcePath: '/existing/openforge-data/openforge_dev.db-shm',
        targetPath: '/repo/openforge/.openforge-dev/sidecar-app-data/openforge_dev.db-shm',
      },
    ])
    expect(copyFileSync).toHaveBeenCalledWith('/existing/openforge-data/openforge_dev.db-wal', '/repo/openforge/.openforge-dev/sidecar-app-data/openforge_dev.db-wal')
    expect(copyFileSync).toHaveBeenCalledWith('/existing/openforge-data/openforge_dev.db-shm', '/repo/openforge/.openforge-dev/sidecar-app-data/openforge_dev.db-shm')
  })

  it('rejects invalid configurable Electron dev ports', () => {
    expect(() => resolveElectronDevRuntimeOptions({ OPENFORGE_ELECTRON_RENDERER_PORT: '0' })).toThrow('OPENFORGE_ELECTRON_RENDERER_PORT')
    expect(() => resolveElectronDevRuntimeOptions({ OPENFORGE_ELECTRON_DEBUG_PORT: '70000' })).toThrow('OPENFORGE_ELECTRON_DEBUG_PORT')
  })

  it('fails before launch when the Vite port is already occupied', async () => {
    await expect(assertVitePortAvailable(1431, { isPortOpen: async () => true })).rejects.toThrow('Port 1431 is already in use')
  })

  it('fails before launch when the configured Electron debug port is already occupied', async () => {
    await expect(assertElectronDebugPortAvailable(9333, { isPortOpen: async () => true })).rejects.toThrow('Electron debug port 9333 is already in use')
    await expect(assertElectronDebugPortAvailable(null, { isPortOpen: async () => true })).resolves.toBeUndefined()
  })

  it('reports a structured port conflict before launch when a stale backend sidecar owns the port', async () => {
    const failureReporter = createRecordingFailureReporter()

    await expect(assertBackendPortAvailable(18000, {
      isPortOpen: async (_host, port) => port === 18000,
      failureReporter,
    })).rejects.toThrow('Port 18000 is already in use')

    expect(failureReporter.reports).toContainEqual(expect.objectContaining({
      phase: 'dev:port-check',
      severity: 'error',
      decision: 'quit',
    }))
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

  it('cleans up Vite, Electron, and auto-created runtime directories before resolving', async () => {
    const vite = createChildProcessMock()
    const electron = createChildProcessMock()
    const rm = vi.fn(async () => undefined)
    const cleanup = cleanupDevProcesses(
      { vite, electron },
      {
        graceMs: 100,
        runtimeOptions: {
          tempRuntimeDirs: ['/tmp/openforge-electron-user-data-1', '/tmp/openforge-sidecar-app-data-2'],
        },
        rm,
      },
    )

    expect(vite.killSignals).toEqual(['SIGTERM'])
    expect(electron.killSignals).toEqual(['SIGTERM'])

    vite.emitExit(0, null)
    electron.emitExit(0, null)

    await expect(cleanup).resolves.toEqual({
      processes: ['terminated', 'terminated'],
      runtimeDirs: ['removed', 'removed'],
    })
    expect(rm).toHaveBeenCalledWith('/tmp/openforge-electron-user-data-1', { recursive: true, force: true })
    expect(rm).toHaveBeenCalledWith('/tmp/openforge-sidecar-app-data-2', { recursive: true, force: true })
  })

  it('does not remove explicit runtime directories during cleanup', async () => {
    const rm = vi.fn(async () => undefined)

    await expect(cleanupDevProcesses(
      {},
      {
        runtimeOptions: { tempRuntimeDirs: [] },
        rm,
      },
    )).resolves.toEqual({ processes: [], runtimeDirs: [] })
    expect(rm).not.toHaveBeenCalled()
  })

  it('exposes dev cleanup as an idempotent Shutdown Cleanup Module adapter', async () => {
    const vite = createChildProcessMock()
    const electron = createChildProcessMock()
    const rm = vi.fn(async () => undefined)
    const adapter = new DevScriptCleanupAdapter(
      () => ({ vite, electron }),
      {
        graceMs: 100,
        runtimeOptions: { tempRuntimeDirs: ['/tmp/openforge-electron-user-data-1'] },
        rm,
      },
    )

    const first = adapter.shutdown()
    const second = adapter.shutdown()
    expect(second).toBe(first)
    expect(vite.killSignals).toEqual(['SIGTERM'])
    expect(electron.killSignals).toEqual(['SIGTERM'])

    vite.emitExit(0, null)
    electron.emitExit(0, null)

    await expect(first).resolves.toEqual({
      processes: ['terminated', 'terminated'],
      runtimeDirs: ['removed'],
    })
    await expect(adapter.shutdown()).resolves.toEqual({
      processes: ['terminated', 'terminated'],
      runtimeDirs: ['removed'],
    })
    expect(rm).toHaveBeenCalledTimes(1)
  })
})
