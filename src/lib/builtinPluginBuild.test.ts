import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const currentDir = dirname(fileURLToPath(import.meta.url))
const packageJsonPath = join(currentDir, '../../package.json')
const tauriConfigPath = join(currentDir, '../../src-tauri/tauri.conf.json')
const rootDir = join(currentDir, '../..')
const builtinPluginDirs = ['file-viewer', 'skills-viewer', 'github-sync', 'terminal']

function listPluginSourceFiles(pluginDir: string): string[] {
  const root = join(rootDir, 'plugins', pluginDir, 'src')
  const files: string[] = []
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        visit(fullPath)
      } else if (/\.(ts|svelte)$/.test(entry.name) && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.d.ts')) {
        files.push(fullPath)
      }
    }
  }
  visit(root)
  return files
}

type RootPackageJson = {
  scripts?: Record<string, string>
}

type TauriConfig = {
  build?: {
    beforeDevCommand?: string
  }
}

describe('plugin build orchestration', () => {
  it('builds any plugin package that still defines a build script without requiring host-bundled built-ins to build', () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as RootPackageJson

    expect(packageJson.scripts?.['build:plugins']).toBeDefined()
    expect(packageJson.scripts?.['build:plugins']).toContain("--filter './plugins/*'")
    expect(packageJson.scripts?.['build:plugins']).toContain('--if-present')
  })

  it('uses the incremental plugin artifact builder during Tauri dev startup', () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as RootPackageJson
    const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, 'utf8')) as TauriConfig

    expect(packageJson.scripts?.['dev:plugin-artifacts']).toBe('node scripts/build-dev-plugin-artifacts.mjs')
    expect(tauriConfig.build?.beforeDevCommand).toBe('pnpm dev:plugin-artifacts && pnpm dev')
  })

  it('keeps builtin plugin feature code inside plugin packages instead of importing src internals', () => {
    for (const pluginDir of builtinPluginDirs) {
      const sourceFiles = listPluginSourceFiles(pluginDir)
      expect(sourceFiles.length, `${pluginDir} should own source files`).toBeGreaterThan(1)

      for (const sourceFile of sourceFiles) {
        const source = readFileSync(sourceFile, 'utf8')
        expect(source, sourceFile).not.toMatch(/from ['\"](?:\.\.\/)+src\//)
        expect(source, sourceFile).not.toMatch(/import\(['\"](?:\.\.\/)+src\//)
      }
    }
  })

})
