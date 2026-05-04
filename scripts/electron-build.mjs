#!/usr/bin/env node
import { rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function repoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..')
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
  await waitForExit(spawn('tsc', ['-p', 'tsconfig.electron.json'], {
    cwd: repoRoot(),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  }), 'tsc -p tsconfig.electron.json')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
