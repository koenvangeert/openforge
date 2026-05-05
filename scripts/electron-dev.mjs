#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect } from 'node:net'
import { DEFAULT_DEV_BACKEND_PORT, buildElectronSidecarDevEnv } from './cargo-target-env.mjs'
import { resolveRustSidecarLayout } from './rust-sidecar-layout.mjs'

export const ELECTRON_RENDERER_URL = 'http://127.0.0.1:1420'
const VITE_READY_TIMEOUT_MS = 30_000
const VITE_READY_INTERVAL_MS = 250
const VITE_HOST = '127.0.0.1'
const VITE_PORT = 1420
const BACKEND_PORT_PROBE_LIMIT = 50
export const ELECTRON_DEV_STOP_GRACE_MS = 2_000

function logStep(message) {
  console.log(`[electron-dev] ${message}`)
}

function repoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..')
}

export function isPortOpen(host = VITE_HOST, port = VITE_PORT, timeoutMs = 500) {
  return new Promise((resolvePromise) => {
    const socket = connect({ host, port })
    const finish = (open) => {
      socket.destroy()
      resolvePromise(open)
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

export async function assertVitePortAvailable(deps = { isPortOpen }) {
  if (await deps.isPortOpen()) {
    throw new Error('Port 1420 is already in use. Stop the existing dev server before running pnpm electron:dev so Electron does not attach to an untrusted renderer.')
  }
}

export async function assertBackendPortAvailable(port = Number(process.env.OPENFORGE_BACKEND_PORT ?? DEFAULT_DEV_BACKEND_PORT), deps = { isPortOpen }) {
  if (await deps.isPortOpen(VITE_HOST, port)) {
    throw new Error(`Port ${port} is already in use. Stop the existing OpenForge sidecar/Electron process before running pnpm electron:dev, or set OPENFORGE_BACKEND_PORT to a free port.`)
  }
}

async function findAvailableBackendPort(startPort, deps = { isPortOpen }) {
  for (let offset = 0; offset < BACKEND_PORT_PROBE_LIMIT; offset += 1) {
    const port = startPort + offset
    if (!await deps.isPortOpen(VITE_HOST, port)) return port
  }

  throw new Error(`No free OpenForge backend port found from ${startPort} through ${startPort + BACKEND_PORT_PROBE_LIMIT - 1}. Set OPENFORGE_BACKEND_PORT to a free port.`)
}

export async function resolveElectronDevBackendEnv(options = {}, deps = { isPortOpen }) {
  const baseEnv = options.env ?? process.env
  const result = buildElectronSidecarDevEnv({ ...options, env: baseEnv })
  const backendPort = Number(result.env.OPENFORGE_BACKEND_PORT)

  const defaultDevBackendPort = String(DEFAULT_DEV_BACKEND_PORT)
  const hasExplicitBackendPort = result.env.OPENFORGE_BACKEND_PORT !== defaultDevBackendPort
  if (hasExplicitBackendPort) {
    await assertBackendPortAvailable(backendPort, deps)
    return result
  }

  const selectedPort = await findAvailableBackendPort(backendPort, deps)
  if (selectedPort === backendPort) return result

  const selectedPortString = String(selectedPort)
  return {
    ...result,
    env: {
      ...result.env,
      OPENFORGE_BACKEND_PORT: selectedPortString,
      OPENFORGE_HTTP_PORT: baseEnv.OPENFORGE_HTTP_PORT && baseEnv.OPENFORGE_HTTP_PORT !== defaultDevBackendPort
        ? baseEnv.OPENFORGE_HTTP_PORT
        : selectedPortString,
    },
  }
}

export function electronSidecarPath(cargoTargetDir, rustSidecarLayout = resolveRustSidecarLayout({ repoRoot: repoRoot() })) {
  return rustSidecarLayout.debugSidecarBinaryPath({ cargoTargetDir })
}

export function buildElectronDevEnv(baseEnv = process.env, sidecarPath = baseEnv.OPENFORGE_SIDECAR_PATH) {
  const env = {
    ...baseEnv,
    ELECTRON_RENDERER_URL,
  }

  if (sidecarPath) {
    env.OPENFORGE_SIDECAR_PATH = sidecarPath
    env.OPENFORGE_ELECTRON_SIDECAR = '1'
    delete env.OPENFORGE_ELECTRON_DEV_DISABLE_SIDECAR
  } else {
    env.OPENFORGE_ELECTRON_DEV_DISABLE_SIDECAR = '1'
  }

  return env
}

function spawnCommand(command, args, options = {}) {
  return spawn(command, args, {
    cwd: repoRoot(),
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  })
}

function waitForExit(child, label) {
  return new Promise((resolvePromise, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      reject(new Error(`${label} exited with ${signal ?? `code ${code}`}`))
    })
  })
}

export async function waitForVite(url = ELECTRON_RENDERER_URL, viteProcess = null) {
  const startedAt = Date.now()
  let lastError = null
  let viteExit = null
  const onExit = (code, signal) => {
    viteExit = signal ?? `code ${code}`
  }
  viteProcess?.once('exit', onExit)

  try {
    while (Date.now() - startedAt < VITE_READY_TIMEOUT_MS) {
      if (viteExit !== null) {
        throw new Error(`Vite dev server exited before becoming ready (${viteExit})`)
      }

      try {
        const response = await fetch(url)
        if (response.ok) return
        lastError = new Error(`HTTP ${response.status}`)
      } catch (error) {
        lastError = error
      }

      await new Promise(resolvePromise => setTimeout(resolvePromise, VITE_READY_INTERVAL_MS))
    }
  } finally {
    viteProcess?.off?.('exit', onExit)
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError ?? 'timeout')
  throw new Error(`Vite dev server did not become ready at ${url}: ${message}`)
}

function hasExited(child) {
  return child.exitCode !== null && child.exitCode !== undefined
    || child.signalCode !== null && child.signalCode !== undefined
}

function waitForChildExit(child, graceMs, deps = {}) {
  if (hasExited(child)) return Promise.resolve('exited')

  const scheduleTimeout = deps.setTimeout ?? setTimeout
  const cancelTimeout = deps.clearTimeout ?? clearTimeout

  return new Promise((resolvePromise) => {
    let settled = false
    let timeout = null
    const settle = (result) => {
      if (settled) return
      settled = true
      child.off?.('exit', onExit)
      if (timeout !== null) cancelTimeout(timeout)
      resolvePromise(result)
    }
    const onExit = () => settle('exited')

    child.once('exit', onExit)
    timeout = scheduleTimeout(() => settle('timeout'), graceMs)
    timeout?.unref?.()
  })
}

export async function stopProcess(child, options = {}) {
  const graceMs = options.graceMs ?? ELECTRON_DEV_STOP_GRACE_MS

  if (!child) return 'absent'
  if (hasExited(child)) return 'already-exited'

  child.kill('SIGTERM')
  const result = await waitForChildExit(child, graceMs, options)
  if (result !== 'timeout') return 'terminated'

  child.kill('SIGKILL')
  child.unref?.()
  return 'killed'
}

export async function cleanupDevProcesses(children, options = {}) {
  const stopTasks = [children.vite, children.electron]
    .filter(Boolean)
    .map(child => stopProcess(child, options))

  return Promise.all(stopTasks)
}

async function main() {
  logStep('Starting Vite dev server on http://127.0.0.1:1420 ...')
  await assertVitePortAvailable()
  const devBackend = await resolveElectronDevBackendEnv()
  const vite = spawnCommand('pnpm', ['exec', 'vite', '--host', VITE_HOST])
  let electron = null
  let cleanupPromise = null
  const cleanup = () => {
    cleanupPromise ??= cleanupDevProcesses({ vite, electron })
    return cleanupPromise
  }
  const shutdown = (exitCode) => {
    void cleanup().finally(() => process.exit(exitCode))
  }
  process.once('SIGINT', () => shutdown(130))
  process.once('SIGTERM', () => shutdown(143))

  try {
    logStep('Waiting for Vite readiness ...')
    await waitForVite(ELECTRON_RENDERER_URL, vite)
    const { env: cargoEnv, cargoTargetDir, source } = devBackend
    const rustSidecarLayout = resolveRustSidecarLayout({ repoRoot: repoRoot() })
    const sidecarPath = cargoEnv.OPENFORGE_SIDECAR_PATH ?? electronSidecarPath(cargoTargetDir, rustSidecarLayout)
    logStep(`Vite is ready; building Rust sidecar (${source} target dir: ${cargoTargetDir}) ...`)
    await waitForExit(
      spawnCommand('cargo', ['build'], { cwd: rustSidecarLayout.backendCrateRootPath, env: cargoEnv }),
      'cargo build',
    )
    logStep('Building Electron main process ...')
    await waitForExit(spawnCommand('pnpm', ['electron:build']), 'electron:build')
    logStep('Launching Electron with Rust sidecar. Close the Electron window to stop this command.')
    electron = spawnCommand('pnpm', ['exec', 'electron', '.'], { env: buildElectronDevEnv(cargoEnv, sidecarPath) })
    await waitForExit(electron, 'electron')
    electron = null
    logStep('Electron exited; stopping Vite ...')
  } finally {
    await cleanup()
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
