import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const readText = path => readFileSync(join(repoRoot, path), 'utf8')
const readJson = path => JSON.parse(readText(path))

describe('Electron-only desktop cutover', () => {
  it('removes Tauri shell package entrypoints and frontend dependencies while keeping Electron commands', () => {
    const pkg = readJson('package.json')

    expect(Object.keys(pkg.scripts).filter(script => script.includes('tauri'))).toEqual([])
    expect(pkg.scripts).toMatchObject({
      'electron:dev': expect.any(String),
      'electron:build': expect.any(String),
      'electron:package': expect.any(String),
      'electron:install': expect.any(String),
    })
    expect(pkg.dependencies).not.toHaveProperty('@tauri-apps/api')
    expect(pkg.devDependencies).not.toHaveProperty('@tauri-apps/cli')
  })

  it('removes Tauri shell configuration and build hooks from the Electron sidecar crate', () => {
    expect(existsSync(join(repoRoot, 'src-tauri/tauri.conf.json'))).toBe(false)
    expect(existsSync(join(repoRoot, 'src-tauri/capabilities/default.json'))).toBe(false)
    expect(readText('src-tauri/build.rs')).not.toContain('tauri_build::build')
  })

  it('uses Electron-only renderer IPC/window boundaries with no Tauri package fallback imports', () => {
    expect(readText('src/lib/desktopIpc.ts')).not.toContain('@tauri-apps/api')
    expect(readText('src/lib/desktopWindow.ts')).not.toContain('@tauri-apps/api')
  })

  it('documents Electron-only commands plus rollback and data backup guidance', () => {
    const readme = readText('README.md')
    const rollback = readText('docs/electron-cutover-rollback.md')

    expect(readme).toContain('pnpm electron:dev')
    expect(readme).toContain('pnpm electron:install')
    expect(readme).not.toMatch(/pnpm tauri:/)
    expect(rollback).toMatch(/backup/i)
    expect(rollback).toMatch(/rollback/i)
    expect(rollback).toContain('openforge.db')
    expect(rollback).toContain('openforge_dev.db')
  })
})
