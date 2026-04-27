import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const currentDir = dirname(fileURLToPath(import.meta.url))
const packageJsonPath = join(currentDir, '../../package.json')

type RootPackageJson = {
  scripts?: Record<string, string>
}

describe('plugin build orchestration', () => {
  it('builds any plugin package that still defines a build script without requiring host-bundled built-ins to build', () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as RootPackageJson

    expect(packageJson.scripts?.['build:plugins']).toBeDefined()
    expect(packageJson.scripts?.['build:plugins']).toContain("--filter './plugins/*'")
    expect(packageJson.scripts?.['build:plugins']).toContain('--if-present')
  })
})
