import { mkdir, readFile, readlink, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertPackageArchitectureCompatibility,
  buildAndPackageElectronApp,
  createElectronAppPackageJson,
  electronBundlePath,
  expectedDarwinArchForTarget,
  packageElectronApp,
  updatePlistBooleanValue,
  updatePlistStringValue,
} from './electron-package.mjs'

async function writeExecutable(path, content = '#!/bin/sh\n') {
  await writeFile(path, content, { mode: 0o755 })
}

describe('Electron macOS packaging helpers', () => {
  it('places the Electron install bundle in the existing release bundle tree', () => {
    expect(electronBundlePath('/repo')).toBe('/repo/src-tauri/target/release/bundle/electron/macos/Open Forge.app')
  })

  it('creates an app package manifest pointing Electron at the compiled main process', () => {
    expect(createElectronAppPackageJson()).toEqual({
      name: 'openforge-electron-app',
      version: '0.0.1',
      type: 'module',
      main: 'dist-electron/main.js',
      private: true,
    })
  })

  it('updates plist string and boolean values while preserving the rest of the document', () => {
    const plist = '<plist><dict><key>CFBundleExecutable</key><string>Electron</string><key>CFBundleName</key><string>Electron</string></dict></plist>'
    const updated = updatePlistBooleanValue(
      updatePlistStringValue(updatePlistStringValue(plist, 'CFBundleExecutable', 'Open Forge'), 'CFBundleName', 'Open Forge'),
      'ApplePressAndHoldEnabled',
      false,
    )

    expect(updated).toContain('<key>CFBundleExecutable</key><string>Open Forge</string>')
    expect(updated).toContain('<key>ApplePressAndHoldEnabled</key>')
    expect(updated).toContain('<false/>')
  })

  it('builds plugin frontend artifacts before renderer and Electron packaging builds', async () => {
    const commands = []

    await buildAndPackageElectronApp({
      repoRoot: '/repo',
      runCommand: async (command, args, options) => {
        commands.push({ command, args, cwd: options.cwd })
      },
      packageApp: async ({ repoRoot }) => {
        commands.push({ command: 'packageElectronApp', args: [], cwd: repoRoot })
        return { appPath: `${repoRoot}/app`, sidecarPath: `${repoRoot}/sidecar` }
      },
    })

    expect(commands).toEqual([
      { command: 'pnpm', args: ['build:plugins'], cwd: '/repo' },
      { command: 'pnpm', args: ['build'], cwd: '/repo' },
      { command: 'pnpm', args: ['electron:build'], cwd: '/repo' },
      { command: 'cargo', args: ['build', '--release'], cwd: '/repo/src-tauri' },
      { command: 'packageElectronApp', args: [], cwd: '/repo' },
    ])
  })

  it('maps Rust target triples to Mach-O architecture names used by Electron packaging', () => {
    expect(expectedDarwinArchForTarget('aarch64-apple-darwin')).toBe('arm64')
    expect(expectedDarwinArchForTarget('x86_64-apple-darwin')).toBe('x86_64')
    expect(expectedDarwinArchForTarget('')).toBe(null)
  })

  it('rejects target packages whose Electron runtime architecture does not match the Rust sidecar', async () => {
    await expect(assertPackageArchitectureCompatibility({
      cargoBuildTarget: 'x86_64-apple-darwin',
      appExecutablePath: '/app/Contents/MacOS/Open Forge',
      sidecarPath: '/app/Contents/MacOS/openforge-sidecar',
      readExecutableArchitectures: async path => (path.includes('Open Forge') ? ['arm64'] : ['x86_64']),
    })).rejects.toThrow(/Electron runtime architecture.*x86_64/)
  })

  it('accepts packages when Electron runtime and Rust sidecar both include the target architecture', async () => {
    await expect(assertPackageArchitectureCompatibility({
      cargoBuildTarget: 'aarch64-apple-darwin',
      appExecutablePath: '/app/Contents/MacOS/Open Forge',
      sidecarPath: '/app/Contents/MacOS/openforge-sidecar',
      readExecutableArchitectures: async () => ['arm64', 'x86_64'],
    })).resolves.toEqual({ expectedArch: 'arm64', appArchitectures: ['arm64', 'x86_64'], sidecarArchitectures: ['arm64', 'x86_64'] })
  })

  it('builds and packages a configured Rust target sidecar without shell-specific packaging tools', async () => {
    const commands = []

    await buildAndPackageElectronApp({
      repoRoot: '/repo',
      cargoBuildTarget: 'aarch64-apple-darwin',
      runCommand: async (command, args, options) => {
        commands.push({ command, args, cwd: options.cwd })
      },
      packageApp: async ({ repoRoot, sidecarBinaryPath, cargoBuildTarget }) => {
        commands.push({ command: 'packageElectronApp', args: [sidecarBinaryPath, cargoBuildTarget], cwd: repoRoot })
        return { appPath: `${repoRoot}/app`, sidecarPath: sidecarBinaryPath }
      },
    })

    expect(commands).toContainEqual({
      command: 'cargo',
      args: ['build', '--release', '--target', 'aarch64-apple-darwin'],
      cwd: '/repo/src-tauri',
    })
    expect(commands).toContainEqual({
      command: 'packageElectronApp',
      args: ['/repo/src-tauri/target/aarch64-apple-darwin/release/openforge', 'aarch64-apple-darwin'],
      cwd: '/repo',
    })
  })

  it('packages the compiled renderer, Electron main process, and Rust sidecar into a macOS .app bundle', async () => {
    const root = await import('node:os').then(os => os.tmpdir()).then(tmp => join(tmp, `openforge-electron-package-${process.pid}-${Date.now()}`))
    const template = join(root, 'node_modules/electron/dist/Electron.app')
    const output = electronBundlePath(root)

    await mkdir(join(template, 'Contents/MacOS'), { recursive: true })
    await mkdir(join(template, 'Contents/Resources'), { recursive: true })
    await mkdir(join(template, 'Contents/Frameworks/Electron Framework.framework/Versions/A/Resources'), { recursive: true })
    await symlink('A', join(template, 'Contents/Frameworks/Electron Framework.framework/Versions/Current'))
    await symlink('Versions/Current/Resources', join(template, 'Contents/Frameworks/Electron Framework.framework/Resources'))
    await writeFile(join(template, 'Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/icudtl.dat'), 'icu')
    await writeExecutable(join(template, 'Contents/MacOS/Electron'))
    await writeFile(join(template, 'Contents/Info.plist'), '<plist><dict><key>CFBundleExecutable</key><string>Electron</string><key>CFBundleName</key><string>Electron</string><key>CFBundleDisplayName</key><string>Electron</string></dict></plist>')
    await mkdir(join(root, 'dist'), { recursive: true })
    await writeFile(join(root, 'dist/index.html'), '<!doctype html>')
    await mkdir(join(root, 'dist-electron'), { recursive: true })
    await writeFile(join(root, 'dist-electron/main.js'), 'console.log("main")')
    await mkdir(join(root, 'src-tauri/target/release'), { recursive: true })
    await writeExecutable(join(root, 'src-tauri/target/release/openforge'), '#!/bin/sh\necho sidecar\n')

    await packageElectronApp({ repoRoot: root })

    await expect(stat(join(output, 'Contents/MacOS/Open Forge'))).resolves.toBeTruthy()
    await expect(stat(join(output, 'Contents/MacOS/openforge-sidecar'))).resolves.toBeTruthy()
    await expect(stat(join(output, 'Contents/Resources/app/dist/index.html'))).resolves.toBeTruthy()
    await expect(stat(join(output, 'Contents/Resources/app/dist-electron/main.js'))).resolves.toBeTruthy()
    await expect(readlink(join(output, 'Contents/Frameworks/Electron Framework.framework/Versions/Current'))).resolves.toBe('A')
    await expect(readlink(join(output, 'Contents/Frameworks/Electron Framework.framework/Resources'))).resolves.toBe('Versions/Current/Resources')
    await expect(readFile(join(output, 'Contents/Resources/app/package.json'), 'utf8').then(JSON.parse)).resolves.toMatchObject({ main: 'dist-electron/main.js' })
    await expect(readFile(join(output, 'Contents/Info.plist'), 'utf8')).resolves.toContain('<key>CFBundleExecutable</key><string>Open Forge</string>')
    await expect(readFile(join(output, 'Contents/Info.plist'), 'utf8')).resolves.toMatch(/<key>ApplePressAndHoldEnabled<\/key>\s*<false\/>/)
  })
})
