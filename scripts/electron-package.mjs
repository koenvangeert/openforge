#!/usr/bin/env node
import { access, chmod, cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const APP_NAME = 'Open Forge'
export const ELECTRON_APP_NAME = 'Electron.app'

function repoRootFromScript() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..')
}

function waitForExit(child, label) {
  return new Promise((resolvePromise, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      reject(new Error(`${label} exited with ${signal ?? `code ${code}`}`))
    })
  })
}

function spawnCommand(command, args, options = {}) {
  return spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  })
}

async function pathExists(path) {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function assertExists(path, label) {
  try {
    await stat(path)
  } catch {
    throw new Error(`${label} not found at ${path}`)
  }
}

export function electronBundlePath(repoRoot = repoRootFromScript()) {
  return join(repoRoot, 'src-tauri', 'target', 'release', 'bundle', 'electron', 'macos', `${APP_NAME}.app`)
}

export function createElectronAppPackageJson({ version = '0.0.1' } = {}) {
  return {
    name: 'openforge-electron-app',
    version,
    type: 'module',
    main: 'dist-electron/main.js',
    private: true,
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function updatePlistStringValue(plist, key, value) {
  const pattern = new RegExp(`(<key>${escapeRegExp(key)}</key>\\s*<string>)([^<]*)(</string>)`)
  if (!pattern.test(plist)) {
    return plist.replace('</dict>', `\n\t<key>${key}</key>\n\t<string>${value}</string>\n</dict>`)
  }
  return plist.replace(pattern, `$1${value}$3`)
}

async function copyIcon(repoRoot, resourcesDir) {
  const iconPath = join(repoRoot, 'src-tauri', 'icons', 'icon.icns')
  if (!(await pathExists(iconPath))) return
  await cp(iconPath, join(resourcesDir, 'electron.icns'))
}

async function updateInfoPlist(appPath) {
  const plistPath = join(appPath, 'Contents', 'Info.plist')
  let plist = await readFile(plistPath, 'utf8')
  plist = updatePlistStringValue(plist, 'CFBundleExecutable', APP_NAME)
  plist = updatePlistStringValue(plist, 'CFBundleName', APP_NAME)
  plist = updatePlistStringValue(plist, 'CFBundleDisplayName', APP_NAME)
  plist = updatePlistStringValue(plist, 'CFBundleIdentifier', 'com.openforge.app.electron')
  await writeFile(plistPath, plist)
}

export async function packageElectronApp({
  repoRoot = repoRootFromScript(),
  outputAppPath = electronBundlePath(repoRoot),
  electronTemplatePath = join(repoRoot, 'node_modules', 'electron', 'dist', ELECTRON_APP_NAME),
  sidecarBinaryPath = join(repoRoot, 'src-tauri', 'target', 'release', process.platform === 'win32' ? 'openforge.exe' : 'openforge'),
} = {}) {
  const rendererDist = join(repoRoot, 'dist')
  const electronDist = join(repoRoot, 'dist-electron')

  await assertExists(electronTemplatePath, 'Electron app template')
  await assertExists(rendererDist, 'Renderer build')
  await assertExists(electronDist, 'Electron main build')
  await assertExists(sidecarBinaryPath, 'Rust sidecar binary')

  await rm(outputAppPath, { recursive: true, force: true })
  await mkdir(dirname(outputAppPath), { recursive: true })
  await cp(electronTemplatePath, outputAppPath, { recursive: true, verbatimSymlinks: true })

  const macosDir = join(outputAppPath, 'Contents', 'MacOS')
  const resourcesDir = join(outputAppPath, 'Contents', 'Resources')
  const electronExecutablePath = join(macosDir, 'Electron')
  const openForgeExecutablePath = join(macosDir, APP_NAME)
  if (await pathExists(electronExecutablePath)) {
    await rename(electronExecutablePath, openForgeExecutablePath)
  }
  await chmod(openForgeExecutablePath, 0o755)

  const sidecarTargetPath = join(macosDir, 'openforge-sidecar')
  await cp(sidecarBinaryPath, sidecarTargetPath)
  await chmod(sidecarTargetPath, 0o755)

  const appResourcesPath = join(resourcesDir, 'app')
  await rm(appResourcesPath, { recursive: true, force: true })
  await mkdir(appResourcesPath, { recursive: true })
  await cp(rendererDist, join(appResourcesPath, 'dist'), { recursive: true })
  await cp(electronDist, join(appResourcesPath, 'dist-electron'), { recursive: true })

  const rootPackage = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8').catch(() => '{"version":"0.0.1"}'))
  await writeFile(join(appResourcesPath, 'package.json'), `${JSON.stringify(createElectronAppPackageJson({ version: rootPackage.version ?? '0.0.1' }), null, 2)}\n`)

  await updateInfoPlist(outputAppPath)
  await copyIcon(repoRoot, resourcesDir)

  return { appPath: outputAppPath, sidecarPath: sidecarTargetPath }
}

async function runBuildCommand(command, args, options) {
  await waitForExit(spawnCommand(command, args, options), `${command} ${args.join(' ')}`)
}

export async function buildAndPackageElectronApp({
  repoRoot = repoRootFromScript(),
  runCommand = runBuildCommand,
  packageApp = packageElectronApp,
} = {}) {
  await runCommand('pnpm', ['build:plugins'], { cwd: repoRoot })
  await runCommand('pnpm', ['build'], { cwd: repoRoot })
  await runCommand('pnpm', ['electron:build'], { cwd: repoRoot })
  await runCommand('cargo', ['build', '--release'], { cwd: join(repoRoot, 'src-tauri') })
  return packageApp({ repoRoot })
}

async function main() {
  const skipBuild = process.argv.includes('--skip-build')
  const result = skipBuild
    ? await packageElectronApp({ repoRoot: repoRootFromScript() })
    : await buildAndPackageElectronApp({ repoRoot: repoRootFromScript() })
  console.log(`Packaged Electron app at ${result.appPath}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
