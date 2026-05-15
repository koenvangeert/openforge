import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { copyHostRuntimeAssets } from './electron-build.mjs'

async function writeMinimalHostRuntimeInputs(repoRoot) {
  await mkdir(join(repoRoot, 'packages', 'plugin-sdk', 'src'), { recursive: true })
  await mkdir(join(repoRoot, 'packages', 'plugin-runtime', 'src'), { recursive: true })
  await mkdir(join(repoRoot, 'src-tauri', 'plugin-host'), { recursive: true })
  await mkdir(join(repoRoot, 'node_modules', 'svelte', 'src', 'internal'), { recursive: true })
  await mkdir(join(repoRoot, 'node_modules', 'svelte', 'src', 'store'), { recursive: true })
  await writeFile(join(repoRoot, 'packages', 'plugin-sdk', 'src', 'index.ts'), 'export const pluginSdk = true;')
  await writeFile(join(repoRoot, 'packages', 'plugin-runtime', 'src', 'commandValidation.ts'), 'export function validateSchemaValue() { return { valid: true, bundledRuntimeMarker: true }; }')
  await writeFile(join(repoRoot, 'src-tauri', 'plugin-host', 'index.ts'), "import { validateSchemaValue } from '@openforge/plugin-runtime/commandValidation'\nconsole.log(validateSchemaValue())\n")
  await writeFile(join(repoRoot, 'node_modules', 'svelte', 'src', 'index-client.js'), 'export const svelte = true;')
  await writeFile(join(repoRoot, 'node_modules', 'svelte', 'src', 'internal', 'index.js'), 'export const internal = true;')
  await writeFile(join(repoRoot, 'node_modules', 'svelte', 'src', 'store', 'index-client.js'), 'export const store = true;')
}

describe('Electron build host-runtime assets', () => {
  it('generates plugin SDK, bundles backend plugin-host runtime dependencies, and copies Svelte host-runtime assets into dist-electron resources', async () => {
    const repoRoot = join(tmpdir(), `openforge-electron-build-${process.pid}-${Date.now()}`)
    const outDir = join(repoRoot, 'dist-electron')
    await writeMinimalHostRuntimeInputs(repoRoot)

    await copyHostRuntimeAssets(repoRoot, outDir)

    await expect(stat(join(outDir, 'plugin-host', 'index.js'))).resolves.toBeTruthy()
    await expect(stat(join(outDir, 'plugin-host', 'plugin-sdk', 'index.js'))).resolves.toBeTruthy()
    await expect(stat(join(outDir, 'plugin-host', 'svelte', 'index.js'))).resolves.toBeTruthy()
    await expect(stat(join(outDir, 'plugin-host', 'svelte', 'internal.js'))).resolves.toBeTruthy()
    await expect(stat(join(outDir, 'plugin-host', 'svelte', 'store.js'))).resolves.toBeTruthy()
    const backendHost = await readFile(join(outDir, 'plugin-host', 'index.js'), 'utf8')
    expect(backendHost).toContain('bundledRuntimeMarker')
    expect(backendHost).not.toContain('@openforge/plugin-runtime')
    await expect(readFile(join(outDir, 'plugin-host', 'plugin-sdk', 'index.js'), 'utf8')).resolves.toContain('pluginSdk')
    await expect(readFile(join(outDir, 'plugin-host', 'svelte', 'index.js'), 'utf8')).resolves.toContain('./index-client.js')
    await expect(readFile(join(outDir, 'plugin-host', 'svelte', 'internal.js'), 'utf8')).resolves.toContain('./internal/index.js')
    await expect(readFile(join(outDir, 'plugin-host', 'svelte', 'store.js'), 'utf8')).resolves.toContain('./store/index-client.js')
  })
})
