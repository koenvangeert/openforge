import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPluginSdkRuntime } from './build-plugin-sdk-runtime.mjs'

const workspaceRoot = path.resolve(import.meta.dirname, '..')

async function write(root, relativePath, content) {
  const fullPath = path.join(root, relativePath)
  await mkdir(path.dirname(fullPath), { recursive: true })
  await writeFile(fullPath, content)
}

describe('plugin SDK runtime artifact', () => {
  it('defaults to the Electron host runtime output instead of src-tauri', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openforge-plugin-sdk-runtime-default-'))

    try {
      await write(root, 'packages/plugin-sdk/src/index.ts', 'export const defaultRuntime = true\n')

      const generatedPath = await buildPluginSdkRuntime({ workspaceRoot: root, logLevel: 'silent' })

      expect(path.relative(root, generatedPath)).toBe(path.join('dist-electron', 'plugin-host', 'plugin-sdk', 'index.js'))
      await expect(stat(path.join(root, 'src-tauri', 'plugin-host', 'plugin-sdk', 'index.js'))).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(readFile(generatedPath, 'utf8')).resolves.toContain('defaultRuntime')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('matches the checked-in runtime when an explicit output path is requested', async () => {
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
