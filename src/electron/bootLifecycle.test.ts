import { describe, expect, it, vi } from 'vitest'
import { bootOpenForgeDesktop } from './bootLifecycle'
import type {
  BootBackendInvokeContext,
  BootLifecycleAdapter,
  BootLifecycleOptions,
} from './bootLifecycle'
import type { AppEventForwarder } from './eventForwarder'
import type { SidecarHandle, SidecarLaunchConfig } from './sidecar'

function sidecarConfig(): SidecarLaunchConfig {
  return {
    command: 'openforge-sidecar',
    args: ['--host', '127.0.0.1', '--port', '17642'],
    env: {},
    host: '127.0.0.1',
    port: 17642,
    token: 'launch-token',
    healthUrl: 'http://127.0.0.1:17642/app/health',
  }
}

class FakeSidecarHandle implements SidecarHandle {
  process = { killed: false, kill: vi.fn(), once: vi.fn() } as unknown as SidecarHandle['process']
  config = sidecarConfig()
  stop = vi.fn(async () => undefined)
}

class FakeEventForwarder implements AppEventForwarder {
  start = vi.fn(async () => undefined)
  ready = vi.fn(async () => undefined)
  stop = vi.fn()
  acceptChunk = vi.fn()
}

class FakeBootLifecycleAdapter implements BootLifecycleAdapter {
  operations: string[] = []
  sidecarPath: string | null = '/Applications/Open Forge.app/Contents/MacOS/openforge-sidecar'
  sidecar = new FakeSidecarHandle()
  eventForwarder = new FakeEventForwarder()
  backendContext: BootBackendInvokeContext | null = null
  windowAllClosedHandler: (() => void) | null = null
  beforeQuitHandler: (() => void) | null = null
  quit = vi.fn(() => {
    this.operations.push('quit')
  })
  startSidecarFailure: Error | null = null
  eventReadyFailure: Error | null = null
  mainWindowFailure: Error | null = null
  sidecarConfigsForProtocol: Array<SidecarLaunchConfig | null> = []
  sidecarConfigsForCsp: Array<SidecarLaunchConfig | null> = []

  registerPluginProtocolSchemeAsPrivileged(): void {
    this.operations.push('register-plugin-scheme')
  }

  registerBackendInvokeHandler(context: BootBackendInvokeContext): void {
    this.operations.push('register-backend-invoke')
    this.backendContext = context
  }

  configureUserDataPath(): string | null {
    this.operations.push('configure-user-data')
    return '/tmp/openforge-electron-user-data'
  }

  onWindowAllClosed(handler: () => void): void {
    this.operations.push('register-window-all-closed')
    this.windowAllClosedHandler = handler
  }

  onBeforeQuit(handler: () => void): void {
    this.operations.push('register-before-quit')
    this.beforeQuitHandler = handler
  }

  async waitForAppReady(): Promise<void> {
    this.operations.push('app-ready')
  }

  resolveSidecarPath(): string | null {
    this.operations.push('resolve-sidecar-path')
    return this.sidecarPath
  }

  createSidecarLaunchConfig(_sidecarPath: string): SidecarLaunchConfig {
    this.operations.push('create-sidecar-config')
    return this.sidecar.config
  }

  async startSidecar(_config: SidecarLaunchConfig): Promise<SidecarHandle> {
    this.operations.push('start-sidecar')
    if (this.startSidecarFailure) throw this.startSidecarFailure
    return this.sidecar
  }

  registerPluginProtocolHandler(sidecarConfig: SidecarLaunchConfig | null): void {
    this.operations.push(sidecarConfig ? 'register-plugin-protocol:sidecar' : 'register-plugin-protocol:null')
    this.sidecarConfigsForProtocol.push(sidecarConfig)
  }

  applyRendererCsp(sidecarConfig: SidecarLaunchConfig | null): void {
    this.operations.push(sidecarConfig ? 'apply-csp:sidecar' : 'apply-csp:null')
    this.sidecarConfigsForCsp.push(sidecarConfig)
  }

  createAppEventForwarder(_sidecarConfig: SidecarLaunchConfig): AppEventForwarder {
    this.operations.push('create-event-forwarder')
    if (this.eventReadyFailure) {
      this.eventForwarder.ready.mockRejectedValueOnce(this.eventReadyFailure)
    }
    return this.eventForwarder
  }

  async createMainWindow(): Promise<unknown> {
    this.operations.push('create-main-window')
    if (this.mainWindowFailure) throw this.mainWindowFailure
    return { id: 'main-window' }
  }
}

function bootOptions(options: Partial<BootLifecycleOptions> = {}): BootLifecycleOptions {
  return {
    platform: 'linux',
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...options,
  }
}

function expectBefore(operations: string[], first: string, second: string): void {
  expect(operations.indexOf(first), `${first} should happen before ${second}`).toBeLessThan(operations.indexOf(second))
}

describe('Electron Boot Lifecycle Module seam', () => {
  it('hides successful launch ordering behind one deep Interface', async () => {
    const adapter = new FakeBootLifecycleAdapter()

    const result = await bootOpenForgeDesktop(adapter, bootOptions())

    expect(result.sidecar).toBe(adapter.sidecar)
    expect(result.appEventForwarder).toBe(adapter.eventForwarder)
    expect(result.degradations).toEqual([])
    expect(adapter.backendContext?.getSidecarConfig()).toBe(adapter.sidecar.config)
    expect(adapter.operations).toEqual([
      'register-plugin-scheme',
      'register-backend-invoke',
      'configure-user-data',
      'register-window-all-closed',
      'register-before-quit',
      'app-ready',
      'resolve-sidecar-path',
      'create-sidecar-config',
      'start-sidecar',
      'register-plugin-protocol:sidecar',
      'apply-csp:sidecar',
      'create-event-forwarder',
      'create-main-window',
    ])
    expect(adapter.eventForwarder.start).toHaveBeenCalledTimes(1)
    expect(adapter.eventForwarder.ready).toHaveBeenCalledTimes(1)
    expectBefore(adapter.operations, 'start-sidecar', 'register-plugin-protocol:sidecar')
    expectBefore(adapter.operations, 'apply-csp:sidecar', 'create-event-forwarder')
    expectBefore(adapter.operations, 'create-event-forwarder', 'create-main-window')
  })

  it.each([
    {
      name: 'strict sidecar readiness policy rejects on health timeout',
      policy: undefined,
      rejects: true,
    },
    {
      name: 'degraded sidecar readiness policy reveals renderer without sidecar',
      policy: { sidecarFailure: 'continue' as const },
      rejects: false,
    },
  ])('$name', async ({ policy, rejects }) => {
    const adapter = new FakeBootLifecycleAdapter()
    adapter.startSidecarFailure = new Error('sidecar did not become ready: timed out')

    const boot = bootOpenForgeDesktop(adapter, bootOptions({ policy }))

    if (rejects) {
      await expect(boot).rejects.toThrow('sidecar did not become ready')
      expect(adapter.operations).not.toContain('create-main-window')
    } else {
      await expect(boot).resolves.toMatchObject({
        sidecar: null,
        degradations: [{ kind: 'sidecar-unavailable' }],
      })
      expect(adapter.operations).toContain('register-plugin-protocol:null')
      expect(adapter.operations).toContain('apply-csp:null')
      expect(adapter.operations).toContain('create-main-window')
    }
  })

  it('uses the default degraded policy when no sidecar path exists in skeleton dev mode', async () => {
    const adapter = new FakeBootLifecycleAdapter()
    adapter.sidecarPath = null

    const result = await bootOpenForgeDesktop(adapter, bootOptions())

    expect(result.sidecar).toBeNull()
    expect(result.degradations).toEqual([{ kind: 'missing-sidecar', reason: 'No Electron sidecar path resolved' }])
    expect(adapter.operations).toContain('register-plugin-protocol:null')
    expect(adapter.operations).toContain('apply-csp:null')
    expect(adapter.operations).toContain('create-main-window')
  })

  it.each([
    {
      name: 'default event stream degraded policy reveals the renderer',
      policy: undefined,
      rejects: false,
    },
    {
      name: 'strict event stream policy rejects and cleans up launch resources',
      policy: { eventStreamFailure: 'fail' as const },
      rejects: true,
    },
  ])('$name', async ({ policy, rejects }) => {
    const adapter = new FakeBootLifecycleAdapter()
    adapter.eventReadyFailure = new Error('SSE unavailable')

    const boot = bootOpenForgeDesktop(adapter, bootOptions({ policy }))

    if (rejects) {
      await expect(boot).rejects.toThrow('SSE unavailable')
      expect(adapter.eventForwarder.stop).toHaveBeenCalledTimes(1)
      expect(adapter.sidecar.stop).toHaveBeenCalledTimes(1)
      expect(adapter.operations).not.toContain('create-main-window')
    } else {
      await expect(boot).resolves.toMatchObject({
        degradations: [{ kind: 'event-stream-unavailable' }],
      })
      expect(adapter.operations).toContain('create-main-window')
      expect(adapter.eventForwarder.stop).not.toHaveBeenCalled()
      expect(adapter.sidecar.stop).not.toHaveBeenCalled()
    }
  })

  it('treats renderer load failure as strict and cleans up sidecar/event stream resources', async () => {
    const adapter = new FakeBootLifecycleAdapter()
    adapter.mainWindowFailure = new Error('renderer failed to load')

    await expect(bootOpenForgeDesktop(adapter, bootOptions())).rejects.toThrow('renderer failed to load')

    expect(adapter.eventForwarder.stop).toHaveBeenCalledTimes(1)
    expect(adapter.sidecar.stop).toHaveBeenCalledTimes(1)
  })

  it.each([
    { platform: 'linux', shouldQuit: true },
    { platform: 'darwin', shouldQuit: false },
  ])('registers shutdown handlers for $platform without exposing cleanup ordering to main.ts', async ({ platform, shouldQuit }) => {
    const adapter = new FakeBootLifecycleAdapter()

    await bootOpenForgeDesktop(adapter, bootOptions({ platform }))

    adapter.windowAllClosedHandler?.()
    expect(adapter.quit).toHaveBeenCalledTimes(shouldQuit ? 1 : 0)

    adapter.beforeQuitHandler?.()
    expect(adapter.eventForwarder.stop).toHaveBeenCalledTimes(1)
    expect(adapter.sidecar.stop).toHaveBeenCalledTimes(1)
    expect(adapter.eventForwarder.stop.mock.invocationCallOrder[0]).toBeLessThan(adapter.sidecar.stop.mock.invocationCallOrder[0])
  })
})
