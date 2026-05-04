#!/usr/bin/env node
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function repoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..')
}

export const HOST_RUNTIME_RESOURCE_DIR = 'plugin-host'

export async function copyHostRuntimeAssets(root = repoRoot(), electronDist = resolve(root, 'dist-electron')) {
  const hostRuntimeDir = resolve(electronDist, HOST_RUNTIME_RESOURCE_DIR)
  await rm(hostRuntimeDir, { recursive: true, force: true })
  await mkdir(hostRuntimeDir, { recursive: true })
  await cp(resolve(root, 'src-tauri', 'plugin-host', 'plugin-sdk'), resolve(hostRuntimeDir, 'plugin-sdk'), { recursive: true })

  const svelteRuntimeDir = resolve(hostRuntimeDir, 'svelte')
  await cp(resolve(root, 'node_modules', 'svelte', 'src'), svelteRuntimeDir, { recursive: true })
  await writeSvelteHostRuntimeAliases(svelteRuntimeDir)
}

async function writeSvelteHostRuntimeAliases(svelteRuntimeDir) {
  await mkdir(svelteRuntimeDir, { recursive: true })
  await Promise.all([
    writeFile(resolve(svelteRuntimeDir, 'index.js'), "export * from './index-client.js';\n"),
    writeFile(resolve(svelteRuntimeDir, 'internal.js'), "export * from './internal/index.js';\n"),
    writeFile(resolve(svelteRuntimeDir, 'store.js'), "export * from './store/index-client.js';\n"),
  ])
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

async function main() {
  await rm(resolve(repoRoot(), 'dist-electron'), { recursive: true, force: true })
  const root = repoRoot()
  await waitForExit(spawn('tsc', ['-p', 'tsconfig.electron.json'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  }), 'tsc -p tsconfig.electron.json')
  await copyHostRuntimeAssets(root)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
