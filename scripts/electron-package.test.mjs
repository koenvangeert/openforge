import { mkdir, readFile, readlink, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createElectronAppPackageJson,
  electronBundlePath,
  packageElectronApp,
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

  it('updates plist string values while preserving the rest of the document', () => {
    const plist = '<plist><dict><key>CFBundleExecutable</key><string>Electron</string><key>CFBundleName</key><string>Electron</string></dict></plist>'

    expect(updatePlistStringValue(updatePlistStringValue(plist, 'CFBundleExecutable', 'Open Forge'), 'CFBundleName', 'Open Forge')).toContain('<key>CFBundleExecutable</key><string>Open Forge</string>')
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
  })
})
