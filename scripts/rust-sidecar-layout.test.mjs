import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'

import { BACKEND_LAYOUT_CONFIG_FILE, resolveRustSidecarLayout } from './rust-sidecar-layout.mjs'

const currentLayoutConfig = {
  backendCrateRoot: 'src-tauri',
  manifestPath: 'src-tauri/Cargo.toml',
  binaryName: 'openforge',
  iconPath: 'src-tauri/icons/icon.icns',
  electronBundleRoot: 'src-tauri/target/release/bundle/electron/macos',
}

describe('Rust sidecar backend layout Module', () => {
  it('derives current src-tauri sidecar paths from the shared layout facts', () => {
    const layout = resolveRustSidecarLayout({ repoRoot: '/repo/openforge', config: currentLayoutConfig })

    expect(layout.backendCrateRootPath).toBe('/repo/openforge/src-tauri')
    expect(layout.manifestPath).toBe('/repo/openforge/src-tauri/Cargo.toml')
    expect(layout.iconPath).toBe('/repo/openforge/src-tauri/icons/icon.icns')
    expect(layout.releaseSidecarBinaryPath()).toBe('/repo/openforge/src-tauri/target/release/openforge')
    expect(layout.releaseSidecarBinaryPath({ cargoBuildTarget: 'aarch64-apple-darwin' })).toBe('/repo/openforge/src-tauri/target/aarch64-apple-darwin/release/openforge')
    expect(layout.debugSidecarBinaryPath({ cargoTargetDir: '/tmp/openforge-target' })).toBe('/tmp/openforge-target/debug/openforge')
    expect(layout.electronAppPath).toBe('/repo/openforge/src-tauri/target/release/bundle/electron/macos/Open Forge.app')
    expect(layout.packagedSidecarPath).toBe('/repo/openforge/src-tauri/target/release/bundle/electron/macos/Open Forge.app/Contents/MacOS/openforge-sidecar')
  })

  it('loads layout facts from the provided repository root by default', async () => {
    const repoRoot = join(tmpdir(), `openforge-layout-${process.pid}-${Date.now()}`)
    await mkdir(repoRoot, { recursive: true })
    await writeFile(join(repoRoot, BACKEND_LAYOUT_CONFIG_FILE), JSON.stringify({
      backendCrateRoot: 'backend',
      manifestPath: 'backend/Cargo.toml',
      binaryName: 'openforge-backend',
      iconPath: 'assets/icon.icns',
      electronBundleRoot: 'target/electron/macos',
    }))

    const layout = resolveRustSidecarLayout({ repoRoot })

    expect(layout.backendCrateRootPath).toBe(join(repoRoot, 'backend'))
    expect(layout.releaseSidecarBinaryPath()).toBe(join(repoRoot, 'backend/target/release/openforge-backend'))
  })

  it('can derive equivalent artifacts for a future backend crate config without changing callers', () => {
    const layout = resolveRustSidecarLayout({
      repoRoot: '/repo/openforge',
      config: {
        backendCrateRoot: 'crates/openforge-backend',
        manifestPath: 'crates/openforge-backend/Cargo.toml',
        binaryName: 'openforge-backend',
        iconPath: 'assets/icon.icns',
        electronBundleRoot: 'target/electron/macos',
      },
      appName: 'Open Forge Preview',
    })

    expect(layout.backendCrateRootPath).toBe('/repo/openforge/crates/openforge-backend')
    expect(layout.manifestPath).toBe('/repo/openforge/crates/openforge-backend/Cargo.toml')
    expect(layout.releaseSidecarBinaryPath({ cargoBuildTarget: 'x86_64-apple-darwin' })).toBe('/repo/openforge/crates/openforge-backend/target/x86_64-apple-darwin/release/openforge-backend')
    expect(layout.electronAppPath).toBe('/repo/openforge/target/electron/macos/Open Forge Preview.app')
    expect(layout.packagedSidecarPath).toBe('/repo/openforge/target/electron/macos/Open Forge Preview.app/Contents/MacOS/openforge-sidecar')
  })
})
