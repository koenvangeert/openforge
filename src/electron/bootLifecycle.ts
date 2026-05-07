import type { SidecarLaunchConfig, SidecarReadinessHandle } from './sidecar.js'

export type BootFailurePolicy = 'fail' | 'continue'

export interface BootLifecyclePolicy {
  /** Missing sidecar path is the explicit skeleton-dev degraded path. */
  missingSidecar: BootFailurePolicy
  /** Sidecar launch/readiness failures stay strict unless explicitly degraded. */
  sidecarFailure: BootFailurePolicy
  /** Initial event stream readiness is owned by the Sidecar Readiness Module. */
  eventStreamFailure: BootFailurePolicy
}

export interface BootDegradation {
  kind: 'missing-sidecar' | 'sidecar-unavailable' | 'event-stream-unavailable'
  reason: string
}

export interface BootLifecycleLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string, error?: unknown): void
}

export interface BootBackendInvokeContext {
  getSidecarConfig(): SidecarLaunchConfig | null
}

/**
 * Boot Lifecycle Adapter seam.
 *
 * The Boot Lifecycle Module Interface keeps Electron-specific wiring behind an
 * Adapter so the Implementation owns launch ordering while tests can use a fake
 * Adapter. This gives main.ts Leverage from one call and keeps boot Locality in
 * this Module.
 */
export interface BootLifecycleAdapter {
  registerPluginProtocolSchemeAsPrivileged(): void
  registerBackendInvokeHandler(context: BootBackendInvokeContext): void
  configureUserDataPath(): string | null
  onWindowAllClosed(handler: () => void): void
  onBeforeQuit(handler: () => void): void
  waitForAppReady(): Promise<void>
  resolveSidecarPath(): string | null
  createSidecarLaunchConfig(sidecarPath: string): SidecarLaunchConfig
  startSidecar(config: SidecarLaunchConfig): Promise<SidecarReadinessHandle>
  registerPluginProtocolHandler(sidecarConfig: SidecarLaunchConfig | null): void
  applyRendererCsp(sidecarConfig: SidecarLaunchConfig | null): void
  createMainWindow(): Promise<unknown>
  quit(): void
}

export interface BootLifecycleOptions {
  platform?: NodeJS.Platform | string
  policy?: Partial<BootLifecyclePolicy>
  logger?: BootLifecycleLogger
  warnOnMissingSidecar?: boolean
}

export interface BootResult {
  sidecar: SidecarReadinessHandle | null
  mainWindow: unknown | null
  degradations: BootDegradation[]
}

export const DEFAULT_BOOT_LIFECYCLE_POLICY: BootLifecyclePolicy = {
  missingSidecar: 'continue',
  sidecarFailure: 'fail',
  eventStreamFailure: 'continue',
}

const DEFAULT_LOGGER: BootLifecycleLogger = console

function reasonFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function mergedPolicy(policy: Partial<BootLifecyclePolicy> | undefined): BootLifecyclePolicy {
  return { ...DEFAULT_BOOT_LIFECYCLE_POLICY, ...(policy ?? {}) }
}

export async function bootOpenForgeDesktop(
  adapter: BootLifecycleAdapter,
  options: BootLifecycleOptions = {},
): Promise<BootResult> {
  const policy = mergedPolicy(options.policy)
  const logger = options.logger ?? DEFAULT_LOGGER
  const platform = options.platform ?? process.platform
  const degradations: BootDegradation[] = []
  let sidecar: SidecarReadinessHandle | null = null
  let mainWindow: unknown | null = null

  const cleanupStartedResources = async (): Promise<void> => {
    await sidecar?.stop()
  }

  adapter.registerPluginProtocolSchemeAsPrivileged()
  adapter.registerBackendInvokeHandler({
    getSidecarConfig: () => sidecar?.config ?? null,
  })

  const isolatedUserDataDir = adapter.configureUserDataPath()
  if (isolatedUserDataDir) {
    logger.info(`[electron] Using isolated user data directory ${isolatedUserDataDir}`)
  }

  adapter.onWindowAllClosed(() => {
    if (platform !== 'darwin') adapter.quit()
  })

  adapter.onBeforeQuit(() => {
    void sidecar?.stop()
  })

  try {
    await adapter.waitForAppReady()

    const sidecarPath = adapter.resolveSidecarPath()
    if (!sidecarPath) {
      const degradation = { kind: 'missing-sidecar' as const, reason: 'No Electron sidecar path resolved' }
      if (policy.missingSidecar === 'fail') throw new Error(degradation.reason)
      degradations.push(degradation)
      if (options.warnOnMissingSidecar ?? true) {
        logger.warn('[electron] no bundled sidecar found and OPENFORGE_SIDECAR_PATH is not set; skipping sidecar launch for skeleton dev mode')
      }
    } else {
      const config = adapter.createSidecarLaunchConfig(sidecarPath)
      try {
        sidecar = await adapter.startSidecar(config)
      } catch (error) {
        if (policy.sidecarFailure === 'fail') throw error
        degradations.push({ kind: 'sidecar-unavailable', reason: reasonFromError(error) })
        logger.error('[electron] Rust sidecar failed; continuing in degraded mode:', error)
      }
    }

    adapter.registerPluginProtocolHandler(sidecar?.config ?? null)
    adapter.applyRendererCsp(sidecar?.config ?? null)

    mainWindow = await adapter.createMainWindow()
    return { sidecar, mainWindow, degradations }
  } catch (error) {
    await cleanupStartedResources()
    throw error
  }
}
