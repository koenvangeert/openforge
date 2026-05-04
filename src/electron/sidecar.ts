import { randomBytes } from 'node:crypto'
import type { ChildProcess, SpawnOptions } from 'node:child_process'

export interface SidecarOutputStreamLike {
  on(event: 'data', listener: (chunk: unknown) => void): unknown
}

export interface ChildProcessLike {
  readonly killed: boolean
  readonly stdout?: SidecarOutputStreamLike | null
  readonly stderr?: SidecarOutputStreamLike | null
  kill(signal?: NodeJS.Signals): boolean
  once(event: 'exit', listener: () => void): this
  off?(event: 'exit', listener: () => void): this
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
}

export interface SidecarHealth {
  status: 'ok'
  version?: string | null
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

  return {
    command,
    args: ['--host', host, '--port', String(port)],
    env,
    host,
    port,
    token,
    healthUrl: `http://${host}:${port}${healthPath}`,
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

export function asChildProcessLike(child: ChildProcess): ChildProcessLike {
  return child
}
