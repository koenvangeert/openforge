import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { copyHostRuntimeAssets } from './electron-build.mjs'

describe('Electron build host-runtime assets', () => {
  it('copies plugin SDK and Svelte host-runtime assets into dist-electron resources', async () => {
    const repoRoot = join(tmpdir(), `openforge-electron-build-${process.pid}-${Date.now()}`)
    const outDir = join(repoRoot, 'dist-electron')
    await mkdir(join(repoRoot, 'src-tauri', 'plugin-host', 'plugin-sdk'), { recursive: true })
    await mkdir(join(repoRoot, 'node_modules', 'svelte', 'src', 'internal'), { recursive: true })
    await mkdir(join(repoRoot, 'node_modules', 'svelte', 'src', 'store'), { recursive: true })
    await writeFile(join(repoRoot, 'src-tauri', 'plugin-host', 'plugin-sdk', 'index.js'), 'export const pluginSdk = true;')
    await writeFile(join(repoRoot, 'node_modules', 'svelte', 'src', 'index-client.js'), 'export const svelte = true;')
    await writeFile(join(repoRoot, 'node_modules', 'svelte', 'src', 'internal', 'index.js'), 'export const internal = true;')
    await writeFile(join(repoRoot, 'node_modules', 'svelte', 'src', 'store', 'index-client.js'), 'export const store = true;')

    await copyHostRuntimeAssets(repoRoot, outDir)

    await expect(stat(join(outDir, 'plugin-host', 'plugin-sdk', 'index.js'))).resolves.toBeTruthy()
    await expect(stat(join(outDir, 'plugin-host', 'svelte', 'index.js'))).resolves.toBeTruthy()
    await expect(stat(join(outDir, 'plugin-host', 'svelte', 'internal.js'))).resolves.toBeTruthy()
    await expect(stat(join(outDir, 'plugin-host', 'svelte', 'store.js'))).resolves.toBeTruthy()
    await expect(readFile(join(outDir, 'plugin-host', 'plugin-sdk', 'index.js'), 'utf8')).resolves.toContain('pluginSdk')
    await expect(readFile(join(outDir, 'plugin-host', 'svelte', 'index.js'), 'utf8')).resolves.toContain('./index-client.js')
    await expect(readFile(join(outDir, 'plugin-host', 'svelte', 'internal.js'), 'utf8')).resolves.toContain('./internal/index.js')
    await expect(readFile(join(outDir, 'plugin-host', 'svelte', 'store.js'), 'utf8')).resolves.toContain('./store/index-client.js')
  })
})
