import { randomBytes } from 'node:crypto'
import type { ChildProcess, SpawnOptions } from 'node:child_process'

export interface SidecarOutputStreamLike {
  on(event: 'data', listener: (chunk: unknown) => void): unknown
}

export interface ChildProcessLike {
  readonly killed: boolean
  readonly stdout?: SidecarOutputStreamLike | null
  readonly stderr?: SidecarOutputStreamLike | null
  readonly pid?: number
  kill(signal?: NodeJS.Signals): boolean
  once(event: 'exit', listener: (code?: number | null, signal?: NodeJS.Signals | null) => void): this
  off?(event: 'exit', listener: (code?: number | null, signal?: NodeJS.Signals | null) => void): this
}

export interface SidecarLogSink {
  info(message: string): void
  error(message: string): void
}

export interface SidecarLaunchConfigOptions {
  executablePath?: string
  host?: string
  port?: number
  token?: string
  healthPath?: string
  processEnv?: NodeJS.ProcessEnv
}

export interface SidecarLaunchConfig {
  command: string
  args: readonly string[]
  env: NodeJS.ProcessEnv
  host: string
  port: number
  token: string
  healthUrl: string
  readinessUrl: string
  eventUrl: string
  baseUrl: string
}

export interface SidecarHealth {
  status: 'ok'
  version?: string | null
}

export type SidecarStartupResumePhase = 'pending' | 'running' | 'complete' | 'degraded'
export type SidecarProcessState = 'starting' | 'running' | 'exited' | 'stopping' | 'stopped'
export type SidecarDegradedArea = 'http' | 'events' | 'startupResume' | 'process'

export interface SidecarDegradedState {
  area: SidecarDegradedArea
  message: string
  since: string
}

export interface SidecarReadinessIdentity {
  command: string
  args: readonly string[]
  host: string
  port: number
  baseUrl: string
  healthUrl: string
  readinessUrl: string
  eventUrl: string
  pid?: number
  rustVersion?: string | null
}

export interface SidecarHttpReadiness {
  available: boolean
  authenticated: boolean
  checkedAt?: string
}

export interface SidecarEventReadiness {
  available: boolean
  connectedAt?: string
  lastEventId?: string | null
  reconnectAttempt?: number
}

export interface SidecarStartupResumeReadiness {
  phase: SidecarStartupResumePhase
  targetCount?: number | null
  resumedCount?: number | null
  failedCount?: number | null
  completedAt?: string | null
}

export interface SidecarProcessReadiness {
  state: SidecarProcessState
  exitCode?: number | null
  signal?: NodeJS.Signals | null
  exitedAt?: string
}

export interface SidecarReadinessSnapshot {
  identity: SidecarReadinessIdentity
  http: SidecarHttpReadiness
  events: SidecarEventReadiness
  startupResume: SidecarStartupResumeReadiness
  degraded: SidecarDegradedState[]
  process: SidecarProcessReadiness
}

export interface SidecarReadinessResponse {
  status: 'ok'
  version?: string | null
  events?: { available?: boolean }
  startupResume?: Partial<SidecarStartupResumeReadiness>
  degraded?: SidecarDegradedState[]
}

export interface SidecarEventEnvelopeLike {
  id?: string
  eventName: string
  payload: unknown
}

export interface SidecarEventStreamAdapter {
  start(): Promise<void>
  ready(): Promise<void>
  stop(): void
  onEvent?(listener: (envelope: SidecarEventEnvelopeLike) => void): void
  snapshot?(): Partial<SidecarEventReadiness>
}

export interface StartSidecarReadinessDeps extends StartSidecarDeps {
  createEventStream(config: SidecarLaunchConfig): SidecarEventStreamAdapter
}

export interface SidecarReadinessHandle extends SidecarHandle {
  ready(): Promise<SidecarReadinessSnapshot>
  snapshot(): SidecarReadinessSnapshot
  eventStream: SidecarEventStreamAdapter
}

export interface HealthResponseLike {
  ok: boolean
  status?: number
  json(): Promise<unknown>
  text?(): Promise<string>
}

export type HealthFetch = (url: string, init: { headers: Record<string, string> }) => Promise<HealthResponseLike>
export type Sleep = (ms: number) => Promise<void>

export interface WaitForSidecarHealthOptions {
  healthUrl: string
  token: string
  fetch: HealthFetch
  sleep: Sleep
  timeoutMs: number
  intervalMs: number
}

export interface WaitForSidecarReadinessOptions {
  readinessUrl: string
  token: string
  fetch: HealthFetch
  sleep: Sleep
  timeoutMs: number
  intervalMs: number
}

export interface StartSidecarDeps {
  spawn(command: string, args: readonly string[], options: SpawnOptions): ChildProcessLike
  fetch: HealthFetch
  sleep: Sleep
  healthTimeoutMs?: number
  healthIntervalMs?: number
  logSidecarOutput?: boolean
  logger?: SidecarLogSink
}

export interface StopSidecarOptions {
  graceMs: number
  sleep: Sleep
}

export interface SidecarHandle {
  process: ChildProcessLike
  config: SidecarLaunchConfig
  stop(options?: Partial<StopSidecarOptions>): Promise<void>
}

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 17642
const DEFAULT_HEALTH_PATH = '/app/health'
const DEFAULT_SIDECAR_COMMAND = 'openforge-sidecar'
const DEFAULT_HEALTH_TIMEOUT_MS = 10_000
const DEFAULT_HEALTH_INTERVAL_MS = 100
const DEFAULT_STOP_GRACE_MS = 2_000

export function generateBackendToken(): string {
  return randomBytes(32).toString('hex')
}

function normalizeHealthPath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`
}

export function createSidecarLaunchConfig(options: SidecarLaunchConfigOptions = {}): SidecarLaunchConfig {
  const host = options.host ?? DEFAULT_HOST
  if (host !== DEFAULT_HOST) {
    throw new Error('Electron sidecar must bind to 127.0.0.1 during the migration skeleton')
  }

  const port = options.port ?? DEFAULT_PORT
  const token = options.token ?? generateBackendToken()
  const healthPath = normalizeHealthPath(options.healthPath ?? DEFAULT_HEALTH_PATH)
  const command = options.executablePath ?? options.processEnv?.OPENFORGE_SIDECAR_PATH ?? DEFAULT_SIDECAR_COMMAND
  const env = {
    ...(options.processEnv ?? process.env),
    OPENFORGE_BACKEND_HOST: host,
    OPENFORGE_BACKEND_PORT: String(port),
    OPENFORGE_BACKEND_TOKEN: token,
    OPENFORGE_ELECTRON_SIDECAR: '1',
  }

  const baseUrl = `http://${host}:${port}`

  return {
    command,
    args: ['--host', host, '--port', String(port)],
    env,
    host,
    port,
    token,
    baseUrl,
    healthUrl: `${baseUrl}${healthPath}`,
    readinessUrl: `${baseUrl}/app/readiness`,
    eventUrl: `${baseUrl}/app/events`,
  }
}

function parseHealth(value: unknown): SidecarHealth | null {
  if (typeof value !== 'object' || value === null) return null
  const status = (value as { status?: unknown }).status
  if (status !== 'ok') return null
  const version = (value as { version?: unknown }).version
  return typeof version === 'string'
    ? { status, version }
    : { status }
}

function parseStartupResume(value: unknown): SidecarStartupResumeReadiness {
  if (typeof value !== 'object' || value === null) return { phase: 'pending' }
  const candidate = value as Partial<SidecarStartupResumeReadiness>
  const phases: SidecarStartupResumePhase[] = ['pending', 'running', 'complete', 'degraded']
  return {
    phase: phases.includes(candidate.phase as SidecarStartupResumePhase) ? candidate.phase as SidecarStartupResumePhase : 'pending',
    targetCount: typeof candidate.targetCount === 'number' ? candidate.targetCount : null,
    resumedCount: typeof candidate.resumedCount === 'number' ? candidate.resumedCount : null,
    failedCount: typeof candidate.failedCount === 'number' ? candidate.failedCount : null,
    completedAt: typeof candidate.completedAt === 'string' ? candidate.completedAt : null,
  }
}

function parseDegraded(value: unknown): SidecarDegradedState[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is SidecarDegradedState => {
    if (typeof item !== 'object' || item === null) return false
    const candidate = item as SidecarDegradedState
    return typeof candidate.area === 'string'
      && typeof candidate.message === 'string'
      && typeof candidate.since === 'string'
  })
}

function parseReadiness(value: unknown): SidecarReadinessResponse | null {
  if (typeof value !== 'object' || value === null) return null
  const status = (value as { status?: unknown }).status
  if (status !== 'ok') return null
  const version = (value as { version?: unknown }).version
  const events = (value as { events?: unknown }).events
  return {
    status,
    version: typeof version === 'string' ? version : null,
    events: typeof events === 'object' && events !== null
      ? { available: (events as { available?: unknown }).available === true }
      : { available: false },
    startupResume: parseStartupResume((value as { startupResume?: unknown }).startupResume),
    degraded: parseDegraded((value as { degraded?: unknown }).degraded),
  }
}

export async function waitForSidecarHealth(options: WaitForSidecarHealthOptions): Promise<SidecarHealth> {
  const startedAt = Date.now()
  let lastError: unknown = null

  while (Date.now() - startedAt <= options.timeoutMs) {
    try {
      const response = await options.fetch(options.healthUrl, {
        headers: { Authorization: `Bearer ${options.token}` },
      })
      if (response.ok) {
        const health = parseHealth(await response.json())
        if (health) return health
        lastError = new Error('sidecar health response did not include status=ok')
      } else {
        const detail = response.text ? await response.text() : `HTTP ${response.status ?? 'error'}`
        lastError = new Error(`sidecar health check failed: ${detail}`)
      }
    } catch (error) {
      lastError = error
    }

    await options.sleep(options.intervalMs)
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError ?? 'timed out')
  throw new Error(`sidecar did not become ready: ${message}`)
}

export async function waitForSidecarReadiness(options: WaitForSidecarReadinessOptions): Promise<SidecarReadinessResponse> {
  const startedAt = Date.now()
  let lastError: unknown = null

  while (Date.now() - startedAt <= options.timeoutMs) {
    try {
      const response = await options.fetch(options.readinessUrl, {
        headers: { Authorization: `Bearer ${options.token}` },
      })
      if (response.ok) {
        const readiness = parseReadiness(await response.json())
        if (readiness) return readiness
        lastError = new Error('sidecar readiness response did not include status=ok')
      } else {
        const detail = response.text ? await response.text() : `HTTP ${response.status ?? 'error'}`
        lastError = new Error(`sidecar readiness check failed: ${detail}`)
      }
    } catch (error) {
      lastError = error
    }

    await options.sleep(options.intervalMs)
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError ?? 'timed out')
  throw new Error(`sidecar did not become ready: ${message}`)
}

function logChunk(chunk: unknown, prefix: string, write: (message: string) => void): void {
  const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().length > 0) write(`${prefix} ${line}`)
  }
}

export function forwardSidecarOutput(
  child: ChildProcessLike,
  logger: SidecarLogSink = console,
): void {
  child.stdout?.on('data', chunk => logChunk(chunk, '[sidecar]', message => logger.info(message)))
  child.stderr?.on('data', chunk => logChunk(chunk, '[sidecar:error]', message => logger.error(message)))
}

function waitForExit(child: ChildProcessLike, sleep: Sleep, graceMs: number): Promise<'exited' | 'timeout'> {
  return new Promise((resolve) => {
    let settled = false
    const onExit = (): void => {
      if (settled) return
      settled = true
      resolve('exited')
    }

    child.once('exit', onExit)
    sleep(graceMs).then(() => {
      if (settled) return
      settled = true
      child.off?.('exit', onExit)
      resolve('timeout')
    }).catch(() => {
      if (settled) return
      settled = true
      child.off?.('exit', onExit)
      resolve('timeout')
    })
  })
}

export async function stopSidecar(
  child: ChildProcessLike,
  options: StopSidecarOptions = { graceMs: DEFAULT_STOP_GRACE_MS, sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)) },
): Promise<void> {
  if (child.killed) return

  child.kill('SIGTERM')
  const result = await waitForExit(child, options.sleep, options.graceMs)
  if (result === 'timeout') {
    child.kill('SIGKILL')
  }
}

export async function startSidecar(config: SidecarLaunchConfig, deps: StartSidecarDeps): Promise<SidecarHandle> {
  const child = deps.spawn(config.command, config.args, {
    env: config.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (deps.logSidecarOutput) {
    forwardSidecarOutput(child, deps.logger ?? console)
  }

  try {
    await waitForSidecarHealth({
      healthUrl: config.healthUrl,
      token: config.token,
      fetch: deps.fetch,
      sleep: deps.sleep,
      timeoutMs: deps.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS,
      intervalMs: deps.healthIntervalMs ?? DEFAULT_HEALTH_INTERVAL_MS,
    })
  } catch (error) {
    await stopSidecar(child, { graceMs: DEFAULT_STOP_GRACE_MS, sleep: deps.sleep })
    throw error
  }

  return {
    process: child,
    config,
    stop(options: Partial<StopSidecarOptions> = {}): Promise<void> {
      return stopSidecar(child, {
        graceMs: options.graceMs ?? DEFAULT_STOP_GRACE_MS,
        sleep: options.sleep ?? ((ms) => new Promise(resolve => setTimeout(resolve, ms))),
      })
    },
  }
}

function createInitialSnapshot(
  config: SidecarLaunchConfig,
  child: ChildProcessLike,
  readiness: SidecarReadinessResponse,
): SidecarReadinessSnapshot {
  const now = new Date().toISOString()
  return {
    identity: {
      command: config.command,
      args: config.args,
      host: config.host,
      port: config.port,
      baseUrl: config.baseUrl,
      healthUrl: config.healthUrl,
      readinessUrl: config.readinessUrl,
      eventUrl: config.eventUrl,
      pid: child.pid,
      rustVersion: readiness.version ?? null,
    },
    http: { available: true, authenticated: true, checkedAt: now },
    events: { available: readiness.events?.available === true },
    startupResume: parseStartupResume(readiness.startupResume),
    degraded: readiness.degraded ?? [],
    process: { state: 'running' },
  }
}

function applyReadinessEvent(snapshot: SidecarReadinessSnapshot, envelope: SidecarEventEnvelopeLike): void {
  if (typeof envelope.id === 'string' && envelope.id.length > 0) {
    snapshot.events.lastEventId = envelope.id
  }

  if (envelope.eventName === 'startup-resume-complete') {
    snapshot.startupResume = {
      ...snapshot.startupResume,
      phase: snapshot.startupResume.phase === 'degraded' ? 'degraded' : 'complete',
      completedAt: new Date().toISOString(),
    }
  }
}

function markDegraded(snapshot: SidecarReadinessSnapshot, area: SidecarDegradedArea, message: string): void {
  snapshot.degraded.push({ area, message, since: new Date().toISOString() })
}

export async function startSidecarReadiness(
  config: SidecarLaunchConfig,
  deps: StartSidecarReadinessDeps,
): Promise<SidecarReadinessHandle> {
  const child = deps.spawn(config.command, config.args, {
    env: config.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (deps.logSidecarOutput) {
    forwardSidecarOutput(child, deps.logger ?? console)
  }

  let eventStream: SidecarEventStreamAdapter | null = null
  let snapshot: SidecarReadinessSnapshot | null = null

  try {
    const readiness = await waitForSidecarReadiness({
      readinessUrl: config.readinessUrl,
      token: config.token,
      fetch: deps.fetch,
      sleep: deps.sleep,
      timeoutMs: deps.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS,
      intervalMs: deps.healthIntervalMs ?? DEFAULT_HEALTH_INTERVAL_MS,
    })
    snapshot = createInitialSnapshot(config, child, readiness)

    eventStream = deps.createEventStream(config)
    eventStream.onEvent?.((envelope) => {
      if (snapshot) applyReadinessEvent(snapshot, envelope)
    })
    const eventRun = eventStream.start()
    await eventStream.ready()
    snapshot.events = {
      ...snapshot.events,
      ...eventStream.snapshot?.(),
      available: true,
      connectedAt: snapshot.events.connectedAt ?? new Date().toISOString(),
    }
    void eventRun.catch(error => {
      if (snapshot) markDegraded(snapshot, 'events', error instanceof Error ? error.message : String(error))
    })
  } catch (error) {
    eventStream?.stop()
    await stopSidecar(child, { graceMs: DEFAULT_STOP_GRACE_MS, sleep: deps.sleep })
    throw error
  }

  const resolvedSnapshot = snapshot
  const resolvedEventStream = eventStream
  let intentionalStop = false
  if (!resolvedSnapshot || !resolvedEventStream) {
    await stopSidecar(child, { graceMs: DEFAULT_STOP_GRACE_MS, sleep: deps.sleep })
    throw new Error('sidecar readiness did not produce a snapshot')
  }

  child.once('exit', (code, signal) => {
    resolvedSnapshot.process = {
      state: intentionalStop ? 'stopped' : 'exited',
      exitCode: code ?? null,
      signal: signal ?? null,
      exitedAt: new Date().toISOString(),
    }
    if (!intentionalStop) {
      markDegraded(resolvedSnapshot, 'process', `sidecar process exited${typeof code === 'number' ? ` with code ${code}` : ''}`)
    }
  })

  return {
    process: child,
    config,
    eventStream: resolvedEventStream,
    ready: async () => resolvedSnapshot,
    snapshot: () => resolvedSnapshot,
    async stop(options: Partial<StopSidecarOptions> = {}): Promise<void> {
      intentionalStop = true
      resolvedSnapshot.process = { ...resolvedSnapshot.process, state: 'stopping' }
      resolvedEventStream.stop()
      await stopSidecar(child, {
        graceMs: options.graceMs ?? DEFAULT_STOP_GRACE_MS,
        sleep: options.sleep ?? ((ms) => new Promise(resolve => setTimeout(resolve, ms))),
      })
      if (resolvedSnapshot.process.state !== 'exited') {
        resolvedSnapshot.process = { state: 'stopped' }
      }
    },
  }
}

export function asChildProcessLike(child: ChildProcess): ChildProcessLike {
  return child
}
