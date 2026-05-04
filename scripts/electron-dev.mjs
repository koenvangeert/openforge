#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect } from 'node:net'
import { buildTauriDevEnv } from './tauri-dev-env.mjs'

export const ELECTRON_RENDERER_URL = 'http://127.0.0.1:1420'
const VITE_READY_TIMEOUT_MS = 30_000
const VITE_READY_INTERVAL_MS = 250
const VITE_HOST = '127.0.0.1'
const VITE_PORT = 1420
const DEFAULT_BACKEND_PORT = 17642

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

export async function assertBackendPortAvailable(port = Number(process.env.OPENFORGE_BACKEND_PORT ?? DEFAULT_BACKEND_PORT), deps = { isPortOpen }) {
  if (await deps.isPortOpen(VITE_HOST, port)) {
    throw new Error(`Port ${port} is already in use. Stop the existing OpenForge sidecar/Electron process before running pnpm electron:dev, or set OPENFORGE_BACKEND_PORT to a free port.`)
  }
}

export function electronSidecarPath(cargoTargetDir) {
  return join(cargoTargetDir, 'debug', process.platform === 'win32' ? 'openforge.exe' : 'openforge')
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

function stopProcess(child) {
  if (child.killed) return
  child.kill('SIGTERM')
}

async function main() {
  logStep('Starting Vite dev server on http://127.0.0.1:1420 ...')
  await assertVitePortAvailable()
  await assertBackendPortAvailable()
  const vite = spawnCommand('pnpm', ['exec', 'vite', '--host', VITE_HOST])
  let electron = null
  const cleanup = () => {
    stopProcess(vite)
    if (electron) stopProcess(electron)
  }
  process.once('SIGINT', () => {
    cleanup()
    process.exit(130)
  })
  process.once('SIGTERM', () => {
    cleanup()
    process.exit(143)
  })

  try {
    logStep('Waiting for Vite readiness ...')
    await waitForVite(ELECTRON_RENDERER_URL, vite)
    const { env: cargoEnv, cargoTargetDir, source } = buildTauriDevEnv()
    const sidecarPath = process.env.OPENFORGE_SIDECAR_PATH ?? electronSidecarPath(cargoTargetDir)
    logStep(`Vite is ready; building Rust sidecar (${source} target dir: ${cargoTargetDir}) ...`)
    await waitForExit(
      spawnCommand('cargo', ['build'], { cwd: join(repoRoot(), 'src-tauri'), env: cargoEnv }),
      'cargo build',
    )
    logStep('Building Electron main process ...')
    await waitForExit(spawnCommand('pnpm', ['electron:build']), 'electron:build')
    logStep('Launching Electron with Rust sidecar. Close the Electron window to stop this command.')
    electron = spawnCommand('pnpm', ['exec', 'electron', '.'], { env: buildElectronDevEnv(process.env, sidecarPath) })
    await waitForExit(electron, 'electron')
    logStep('Electron exited; stopping Vite ...')
  } finally {
    cleanup()
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
