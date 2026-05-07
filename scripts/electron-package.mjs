#!/usr/bin/env node
import { access, chmod, cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveRustSidecarLayout } from './rust-sidecar-layout.mjs'
import {
  ELECTRON_APP_NAME as MANIFEST_APP_NAME,
  ELECTRON_APP_PACKAGE_NAME,
  ELECTRON_BUNDLE_IDENTIFIER,
  ELECTRON_TEMPLATE_APP_NAME,
  electronPackageIdentityForRepoRoot,
} from './data-identity.mjs'

export const APP_NAME = MANIFEST_APP_NAME
export { ELECTRON_APP_PACKAGE_NAME, ELECTRON_BUNDLE_IDENTIFIER }
export const ELECTRON_APP_NAME = ELECTRON_TEMPLATE_APP_NAME

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

function captureCommand(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', chunk => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', chunk => {
      stderr += chunk.toString()
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise(stdout.trim())
        return
      }
      reject(new Error(`${command} ${args.join(' ')} exited with ${signal ?? `code ${code}`}: ${stderr.trim()}`))
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
  const packageIdentity = electronPackageIdentityForRepoRoot(repoRoot)
  return resolveRustSidecarLayout({ repoRoot, appName: packageIdentity.appName }).electronAppPath
}

export function sidecarBinaryPathForTarget(repoRoot = repoRootFromScript(), cargoBuildTarget = '') {
  return resolveRustSidecarLayout({ repoRoot }).releaseSidecarBinaryPath({ cargoBuildTarget })
}

export function createElectronAppPackageJson({ version = '0.0.1', packageName = ELECTRON_APP_PACKAGE_NAME } = {}) {
  return {
    name: packageName,
    version,
    type: 'module',
    main: 'dist-electron/main.js',
    private: true,
  }
}

export function expectedDarwinArchForTarget(cargoBuildTarget = '') {
  if (!cargoBuildTarget) return null
  if (cargoBuildTarget.startsWith('aarch64-apple-darwin')) return 'arm64'
  if (cargoBuildTarget.startsWith('x86_64-apple-darwin')) return 'x86_64'
  return null
}

function normalizeArchitectures(output) {
  return output
    .replace(/^.*are:\s*/i, '')
    .replace(/^.*is architecture:\s*/i, '')
    .split(/\s+/)
    .map(arch => arch.trim())
    .filter(Boolean)
}

export async function readDarwinExecutableArchitectures(binaryPath) {
  if (process.platform !== 'darwin') return []
  try {
    return normalizeArchitectures(await captureCommand('lipo', ['-archs', binaryPath]))
  } catch {
    return normalizeArchitectures(await captureCommand('file', [binaryPath]))
  }
}

export async function assertPackageArchitectureCompatibility({
  cargoBuildTarget = '',
  appExecutablePath,
  sidecarPath,
  readExecutableArchitectures = readDarwinExecutableArchitectures,
} = {}) {
  const expectedArch = expectedDarwinArchForTarget(cargoBuildTarget)
  if (!expectedArch) return null

  const [appArchitectures, sidecarArchitectures] = await Promise.all([
    readExecutableArchitectures(appExecutablePath),
    readExecutableArchitectures(sidecarPath),
  ])

  if (!appArchitectures.includes(expectedArch)) {
    throw new Error(`Electron runtime architecture must include ${expectedArch} for ${cargoBuildTarget}; found ${appArchitectures.join(', ') || 'unknown'}`)
  }
  if (!sidecarArchitectures.includes(expectedArch)) {
    throw new Error(`Rust sidecar architecture must include ${expectedArch} for ${cargoBuildTarget}; found ${sidecarArchitectures.join(', ') || 'unknown'}`)
  }

  return { expectedArch, appArchitectures, sidecarArchitectures }
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

export function updatePlistBooleanValue(plist, key, value) {
  const boolTag = value ? 'true' : 'false'
  const pattern = new RegExp(`(<key>${escapeRegExp(key)}</key>\\s*)<(true|false)\\s*/>`)
  if (!pattern.test(plist)) {
    return plist.replace('</dict>', `\n\t<key>${key}</key>\n\t<${boolTag}/>\n</dict>`)
  }
  return plist.replace(pattern, `$1<${boolTag}/>`)
}

async function copyIcon(rustSidecarLayout, resourcesDir) {
  if (!(await pathExists(rustSidecarLayout.iconPath))) return
  await cp(rustSidecarLayout.iconPath, join(resourcesDir, 'electron.icns'))
}

async function updateInfoPlist(appPath, { appName = APP_NAME, bundleIdentifier = ELECTRON_BUNDLE_IDENTIFIER } = {}) {
  const plistPath = join(appPath, 'Contents', 'Info.plist')
  let plist = await readFile(plistPath, 'utf8')
  plist = updatePlistStringValue(plist, 'CFBundleExecutable', appName)
  plist = updatePlistStringValue(plist, 'CFBundleName', appName)
  plist = updatePlistStringValue(plist, 'CFBundleDisplayName', appName)
  plist = updatePlistStringValue(plist, 'CFBundleIdentifier', bundleIdentifier)
  plist = updatePlistBooleanValue(plist, 'ApplePressAndHoldEnabled', false)
  await writeFile(plistPath, plist)
}

export async function packageElectronApp({
  repoRoot = repoRootFromScript(),
  packageIdentity = electronPackageIdentityForRepoRoot(repoRoot),
  rustSidecarLayout = resolveRustSidecarLayout({ repoRoot, appName: packageIdentity.appName }),
  outputAppPath = rustSidecarLayout.electronAppPath,
  electronTemplatePath = join(repoRoot, 'node_modules', 'electron', 'dist', packageIdentity.electronTemplateAppName),
  cargoBuildTarget = process.env.CARGO_BUILD_TARGET ?? '',
  sidecarBinaryPath = rustSidecarLayout.releaseSidecarBinaryPath({ cargoBuildTarget }),
  readExecutableArchitectures = readDarwinExecutableArchitectures,
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
  const appExecutablePath = join(macosDir, packageIdentity.appName)
  if (await pathExists(electronExecutablePath)) {
    await rename(electronExecutablePath, appExecutablePath)
  }
  await chmod(appExecutablePath, 0o755)

  const sidecarTargetPath = join(macosDir, 'openforge-sidecar')
  await cp(sidecarBinaryPath, sidecarTargetPath)
  await chmod(sidecarTargetPath, 0o755)

  await assertPackageArchitectureCompatibility({
    cargoBuildTarget,
    appExecutablePath,
    sidecarPath: sidecarTargetPath,
    readExecutableArchitectures,
  })

  const appResourcesPath = join(resourcesDir, 'app')
  await rm(appResourcesPath, { recursive: true, force: true })
  await mkdir(appResourcesPath, { recursive: true })
  await cp(rendererDist, join(appResourcesPath, 'dist'), { recursive: true })
  await cp(electronDist, join(appResourcesPath, 'dist-electron'), { recursive: true })

  const rootPackage = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8').catch(() => '{"version":"0.0.1"}'))
  await writeFile(join(appResourcesPath, 'package.json'), `${JSON.stringify(createElectronAppPackageJson({
    version: rootPackage.version ?? '0.0.1',
    packageName: packageIdentity.electronAppPackageName,
  }), null, 2)}\n`)

  await updateInfoPlist(outputAppPath, {
    appName: packageIdentity.appName,
    bundleIdentifier: packageIdentity.bundleIdentifier,
  })
  await copyIcon(rustSidecarLayout, resourcesDir)

  return { appPath: outputAppPath, sidecarPath: sidecarTargetPath }
}

async function runBuildCommand(command, args, options) {
  await waitForExit(spawnCommand(command, args, options), `${command} ${args.join(' ')}`)
}

export async function buildAndPackageElectronApp(options = {}) {
  const {
    repoRoot = repoRootFromScript(),
    cargoBuildTarget = process.env.CARGO_BUILD_TARGET ?? '',
    runCommand = runBuildCommand,
    packageApp = packageElectronApp,
  } = options
  const packageIdentity = options.packageIdentity
    ?? (!options.rustSidecarLayout || packageApp === packageElectronApp ? electronPackageIdentityForRepoRoot(repoRoot) : null)
  const rustSidecarLayout = options.rustSidecarLayout
    ?? resolveRustSidecarLayout({ repoRoot, appName: packageIdentity.appName })

  await runCommand('pnpm', ['build:plugins'], { cwd: repoRoot })
  await runCommand('pnpm', ['build'], { cwd: repoRoot })
  await runCommand('pnpm', ['electron:build'], { cwd: repoRoot })
  const cargoArgs = cargoBuildTarget
    ? ['build', '--release', '--target', cargoBuildTarget]
    : ['build', '--release']
  await runCommand('cargo', cargoArgs, { cwd: rustSidecarLayout.backendCrateRootPath })
  return packageApp({
    repoRoot,
    rustSidecarLayout,
    ...(packageIdentity ? { packageIdentity } : {}),
    sidecarBinaryPath: rustSidecarLayout.releaseSidecarBinaryPath({ cargoBuildTarget }),
    cargoBuildTarget,
  })
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
