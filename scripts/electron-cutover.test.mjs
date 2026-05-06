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

  it('removes Tauri shell configuration, generated schemas, build hooks, and release packaging from the Electron sidecar crate', () => {
    expect(existsSync(join(repoRoot, 'src-tauri', 'tauri.conf.json'))).toBe(false)
    expect(existsSync(join(repoRoot, 'src-tauri/capabilities/default.json'))).toBe(false)
    expect(existsSync(join(repoRoot, 'src-tauri/gen/schemas'))).toBe(false)
    expect(existsSync(join(repoRoot, 'src-tauri/gen/schemas/desktop-schema.json'))).toBe(false)
    expect(readText('src-tauri/build.rs')).not.toContain('tauri' + '_build::build')

    const releaseWorkflow = readText('.github/workflows/release.yml')
    expect(releaseWorkflow).not.toContain('tauri' + '-action')
    expect(releaseWorkflow).not.toContain('tauri' + '.conf.json')
    expect(releaseWorkflow).toContain('pnpm electron:package')
    expect(releaseWorkflow).toContain('npm_config_arch: ${{ matrix.electron_arch }}')
  })

  it('uses Electron-only renderer IPC/window boundaries with no Tauri package fallback imports', () => {
    expect(readText('src/lib/desktopIpc.ts')).not.toContain('@tauri-apps/api')
    expect(readText('src/lib/desktopWindow.ts')).not.toContain('@tauri-apps/api')
  })

  it('documents Electron-only commands plus rollback and data backup guidance', () => {
    const readme = readText('README.md')
    const rollback = readText('docs/electron-cutover-rollback.md')
    const identity = readJson('openforge-data-identity.json')

    expect(readme).toContain('pnpm electron:dev')
    expect(readme).toContain('pnpm electron:install')
    expect(readme).not.toMatch(/pnpm tauri:/)
    expect(rollback).toMatch(/backup/i)
    expect(rollback).toMatch(/rollback/i)
    expect(rollback).toContain('openforge.db')
    expect(rollback).toContain('openforge_dev.db')
    expect(rollback).toContain('openforge-data-identity.json')
    expect(identity.dataIdentity.appDataIdentifier).toBe('com.opencode.openforge')
    expect(identity.packageIdentity.bundleIdentifier).toBe('com.openforge.app.electron')
    expect(identity.packageIdentity.bundleIdentifier).not.toBe(identity.dataIdentity.appDataIdentifier)
  })

  it('keeps agent guidance and project profiles aligned with Electron shell plus Rust sidecar architecture', () => {
    const guidanceFiles = [
      ['AGENTS.md', readText('AGENTS.md')],
      ['.a5c/project-profile.md', readText('.a5c/project-profile.md')],
    ]

    for (const [path, content] of guidanceFiles) {
      expect(content, path).toContain('Electron')
      expect(content, path).toContain('Rust sidecar')
      expect(content, path).toContain('src/lib/ipc.ts')
      expect(content, path).toContain('pnpm electron:dev')
      expect(content, path).toContain('pnpm electron:package')
      expect(content, path).toContain('pnpm electron:install')
      expect(content, path).not.toMatch(/Tauri v2 desktop app/)
      expect(content, path).not.toMatch(/pnpm tauri:/)
      expect(content, path).not.toMatch(/Tauri webview/)
      expect(content, path).not.toMatch(/Tauri CLI|tauri-action|Tauri\/Rust desktop|tauri-project-setup/)
    }

    const profile = readJson('.a5c/project-profile.json')
    expect(profile.description).toContain('Electron')
    expect(profile.description).toContain('Rust sidecar')
    expect(profile.techStack.frameworks.map(framework => framework.name)).toContain('Electron')
    expect(profile.techStack.frameworks.map(framework => framework.name)).not.toContain('Tauri')
    expect(profile.techStack.buildTools).toEqual(expect.arrayContaining(['pnpm', 'Vite', 'Electron', 'Cargo']))
    expect(profile.techStack.buildTools).not.toContain('Tauri CLI')
    expect(profile.techStack.buildTools).not.toContain('tauri-action')
    expect(profile.architecture.dataFlow).toContain('src/lib/ipc.ts')
    expect(profile.architecture.dataFlow).toContain('Electron preload')
    expect(profile.architecture.dataFlow).toContain('Rust sidecar')
    expect(profile.workflows.find(workflow => workflow.name === 'development')?.steps).toEqual(expect.arrayContaining([
      'pnpm electron:dev for the full Electron app with Rust sidecar',
      'pnpm dev for frontend-only Vite',
    ]))
    expect(profile.workflows.map(workflow => workflow.name)).toContain('electron-shell-verification')
    expect(profile.workflows.find(workflow => workflow.name === 'electron-shell-verification')?.steps.join('\n')).toContain('pnpm test -- src/electron')
    expect(profile.workflows.find(workflow => workflow.name === 'release')?.steps.join('\n')).toContain('pnpm electron:package')
    expect(profile.bottlenecks.map(bottleneck => bottleneck.location).join('\n')).toContain('src/electron/main.ts')
    expect(readText('.a5c/project-profile.md')).toContain('### electron-shell-verification')
    expect(JSON.stringify(profile)).not.toMatch(/pnpm tauri:|Tauri CLI|tauri-action|Tauri v2 desktop app|Tauri webview|tauri-project-setup/)
  })
})
