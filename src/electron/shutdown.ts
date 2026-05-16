import { createFailureReport, reportFailure } from './failureReporting.js'
import type { AppEventForwarder } from './eventForwarder.js'
import { stopSidecar } from './sidecar.js'
import type { ElectronFailureReporter } from './failureReporting.js'
import type { ChildProcessLike, SidecarHandle, StopSidecarOptions } from './sidecar.js'

export type ShutdownStatus = 'ok' | 'timeout' | 'failed'

export interface ShutdownAdapterResult {
  readonly status?: ShutdownStatus | string
  readonly [key: string]: unknown
}

export interface ShutdownAdapter {
  readonly name: string
  readonly deadlineMs?: number
  shutdown(): Promise<ShutdownAdapterResult | void> | ShutdownAdapterResult | void
}

export interface ShutdownAdapterReport {
  name: string
  status: ShutdownStatus
  deadlineMs: number | null
  durationMs: number
  result: ShutdownAdapterResult | null
  error: string | null
}

export interface ShutdownReport {
  ok: boolean
  startedAt: string
  finishedAt: string
  durationMs: number
  adapters: ShutdownAdapterReport[]
}

export interface ShutdownLogSink {
  info?(message: string): void
  warn?(message: string): void
  error?(message: string): void
}

export type ShutdownSleep = (ms: number) => Promise<void>

export interface ShutdownCoordinatorOptions {
  adapters: readonly ShutdownAdapter[]
  logger?: ShutdownLogSink | null
  sleep?: ShutdownSleep
  now?: () => number
  dateNow?: () => Date
  failureReporter?: ElectronFailureReporter | null
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function statusFromAdapterResult(result: ShutdownAdapterResult | null): Pick<ShutdownAdapterReport, 'status' | 'error'> | null {
  if (!result) return null
  const status = typeof result.status === 'string' ? result.status : null
  const error = typeof result.error === 'string' ? result.error : null
  const timedOut = result.timedOut === true || status === 'timeout'

  if (timedOut) return { status: 'timeout', error: error ?? 'adapter reported timeout' }
  if (status === 'failed' || status === 'kill-failed' || error) {
    return { status: 'failed', error: error ?? `adapter reported ${status ?? 'failure'}` }
  }

  return null
}

async function runWithDeadline<T>(work: Promise<T>, deadlineMs: number, sleep: ShutdownSleep): Promise<{ status: 'ok'; value: T } | { status: 'timeout' }> {
  const timeout = sleep(deadlineMs).then(() => ({ status: 'timeout' as const }))
  return Promise.race([
    work.then(value => ({ status: 'ok' as const, value })),
    timeout,
  ])
}

export class ShutdownCoordinator {
  private readonly adapters: readonly ShutdownAdapter[]
  private readonly logger: ShutdownLogSink | null
  private readonly sleep: ShutdownSleep
  private readonly now: () => number
  private readonly dateNow: () => Date
  private readonly failureReporter: ElectronFailureReporter | null | undefined
  private shutdownPromise: Promise<ShutdownReport> | null = null
  private completedReport: ShutdownReport | null = null

  constructor(options: ShutdownCoordinatorOptions) {
    this.adapters = options.adapters
    this.logger = options.logger === undefined ? console : options.logger
    this.sleep = options.sleep ?? defaultSleep
    this.now = options.now ?? (() => Date.now())
    this.dateNow = options.dateNow ?? (() => new Date())
    this.failureReporter = options.failureReporter
  }

  shutdown(): Promise<ShutdownReport> {
    if (this.completedReport) return Promise.resolve(this.completedReport)
    if (this.shutdownPromise) return this.shutdownPromise

    this.shutdownPromise = this.runShutdown().then(report => {
      this.completedReport = report
      return report
    })
    return this.shutdownPromise
  }

  private async runShutdown(): Promise<ShutdownReport> {
    const startedAtMs = this.now()
    const startedAt = this.dateNow().toISOString()
    const adapters: ShutdownAdapterReport[] = []

    this.logger?.info?.('[electron] Shutdown cleanup started')

    for (const adapter of this.adapters) {
      const deadlineMs = adapter.deadlineMs ?? null
      const adapterStartedAt = this.now()
      this.logger?.info?.(`[electron] Shutdown adapter ${adapter.name} started`)

      try {
        const work = Promise.resolve().then(() => adapter.shutdown())
        const outcome = deadlineMs === null
          ? { status: 'ok' as const, value: await work }
          : await runWithDeadline(work, deadlineMs, this.sleep)
        const durationMs = this.now() - adapterStartedAt

        if (outcome.status === 'timeout') {
          adapters.push({
            name: adapter.name,
            status: 'timeout',
            deadlineMs,
            durationMs,
            result: null,
            error: `timed out after ${deadlineMs}ms`,
          })
          this.logger?.error?.(`[electron] Shutdown adapter ${adapter.name} timed out after ${deadlineMs}ms`)
          await this.reportShutdownFailure(adapter.name, `timed out after ${deadlineMs}ms`)
          continue
        }

        const result = outcome.value ?? null
        const adapterStatus = statusFromAdapterResult(result)
        adapters.push({
          name: adapter.name,
          status: adapterStatus?.status ?? 'ok',
          deadlineMs,
          durationMs,
          result,
          error: adapterStatus?.error ?? null,
        })
        if (adapterStatus) {
          this.logger?.error?.(`[electron] Shutdown adapter ${adapter.name} reported ${adapterStatus.status}: ${adapterStatus.error}`)
          await this.reportShutdownFailure(adapter.name, adapterStatus.error ?? `reported ${adapterStatus.status}`)
        } else {
          this.logger?.info?.(`[electron] Shutdown adapter ${adapter.name} completed`)
        }
      } catch (error) {
        const message = errorMessage(error)
        adapters.push({
          name: adapter.name,
          status: 'failed',
          deadlineMs,
          durationMs: this.now() - adapterStartedAt,
          result: null,
          error: message,
        })
        this.logger?.error?.(`[electron] Shutdown adapter ${adapter.name} failed: ${message}`)
        await this.reportShutdownFailure(adapter.name, message)
      }
    }

    const report = {
      ok: adapters.every(adapter => adapter.status === 'ok'),
      startedAt,
      finishedAt: this.dateNow().toISOString(),
      durationMs: this.now() - startedAtMs,
      adapters,
    }

    if (report.ok) {
      this.logger?.info?.('[electron] Shutdown cleanup completed')
    } else {
      this.logger?.error?.('[electron] Shutdown cleanup completed with errors')
    }

    return report
  }

  private async reportShutdownFailure(adapterName: string, cause: string): Promise<void> {
    await reportFailure(this.failureReporter, createFailureReport({
      phase: 'shutdown:cleanup',
      severity: 'error',
      cause,
      userMessage: `Shutdown cleanup failed for ${adapterName}.`,
      remediation: 'OpenForge will continue exiting; check logs for sidecar or process cleanup details.',
      decision: 'quit',
    }))
  }
}

export interface ElectronAppLike {
  on(event: 'before-quit', listener: (event: { preventDefault(): void }) => void): unknown
  exit(exitCode?: number): void
}

export interface ElectronShutdownAdapterOptions {
  app: ElectronAppLike
  shutdown: ShutdownCoordinator
  exitCode?: number
  logger?: ShutdownLogSink | null
}

export interface EventForwarderShutdownAdapterOptions {
  forwarder(): AppEventForwarder | null
  deadlineMs?: number
}

export class EventForwarderShutdownAdapter implements ShutdownAdapter {
  readonly name = 'event-forwarder'
  readonly deadlineMs?: number
  private readonly forwarder: () => AppEventForwarder | null

  constructor(options: EventForwarderShutdownAdapterOptions) {
    this.forwarder = options.forwarder
    this.deadlineMs = options.deadlineMs
  }

  shutdown(): ShutdownAdapterResult {
    const forwarder = this.forwarder()
    if (!forwarder) return { status: 'absent' }
    forwarder.stop()
    return { status: 'stopped' }
  }
}

export interface RustSidecarShutdownAdapterOptions {
  sidecar(): SidecarHandle | null
  process?: () => ChildProcessLike | null
  stopOptions?: Partial<StopSidecarOptions>
  deadlineMs?: number
}

export class RustSidecarShutdownAdapter implements ShutdownAdapter {
  readonly name = 'rust-sidecar'
  readonly deadlineMs?: number
  private readonly sidecar: () => SidecarHandle | null
  private readonly process: () => ChildProcessLike | null
  private readonly stopOptions?: Partial<StopSidecarOptions>

  constructor(options: RustSidecarShutdownAdapterOptions) {
    this.sidecar = options.sidecar
    this.process = options.process ?? (() => null)
    this.stopOptions = options.stopOptions
    this.deadlineMs = options.deadlineMs
  }

  async shutdown(): Promise<ShutdownAdapterResult> {
    const sidecar = this.sidecar()
    if (sidecar) return { ...await sidecar.stop(this.stopOptions) }

    const child = this.process()
    if (!child) return { status: 'absent' }
    return { ...await stopSidecar(child, {
      graceMs: this.stopOptions?.graceMs ?? 2_000,
      sleep: this.stopOptions?.sleep ?? ((ms) => new Promise(resolve => setTimeout(resolve, ms))),
    }) }
  }
}

export class ElectronShutdownAdapter {
  private readonly app: ElectronAppLike
  private readonly shutdown: ShutdownCoordinator
  private readonly exitCode: number
  private readonly logger: ShutdownLogSink | null
  private registered = false
  private exiting = false
  private exitPromise: Promise<void> | null = null

  constructor(options: ElectronShutdownAdapterOptions) {
    this.app = options.app
    this.shutdown = options.shutdown
    this.exitCode = options.exitCode ?? 0
    this.logger = options.logger === undefined ? console : options.logger
  }

  register(): void {
    if (this.registered) return
    this.registered = true
    this.app.on('before-quit', event => this.beforeQuit(event))
  }

  private beforeQuit(event: { preventDefault(): void }): void {
    event.preventDefault()
    if (this.exiting || this.exitPromise) return

    this.exitPromise = this.shutdown.shutdown()
      .then(report => {
        this.logger?.info?.(`[electron] Shutdown cleanup report: ${JSON.stringify(report)}`)
      })
      .catch(error => {
        this.logger?.error?.(`[electron] Shutdown cleanup failed before exit: ${errorMessage(error)}`)
      })
      .finally(() => {
        if (this.exiting) return
        this.exiting = true
        this.app.exit(this.exitCode)
      })
  }
}
