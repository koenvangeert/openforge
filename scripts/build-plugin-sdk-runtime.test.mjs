import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPluginSdkRuntime } from './build-plugin-sdk-runtime.mjs'

const workspaceRoot = path.resolve(import.meta.dirname, '..')

describe('plugin SDK runtime artifact', () => {
  it('matches the runtime generated from the workspace plugin SDK source', async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), 'openforge-plugin-sdk-runtime-'))

    try {
      const generatedPath = await buildPluginSdkRuntime({ outDir, logLevel: 'silent' })
      const checkedInPath = path.join(workspaceRoot, 'src-tauri/plugin-host/plugin-sdk/index.js')

      const [generated, checkedIn] = await Promise.all([
        readFile(generatedPath, 'utf8'),
        readFile(checkedInPath, 'utf8'),
      ])

      expect(generated).toEqual(checkedIn)
    } finally {
      await rm(outDir, { recursive: true, force: true })
    }
  })
})
