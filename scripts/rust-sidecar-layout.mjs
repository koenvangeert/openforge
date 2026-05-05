#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BACKEND_LAYOUT_CONFIG_FILE = 'openforge-backend-layout.json'
export const DEFAULT_APP_NAME = 'Open Forge'
export const DEFAULT_PACKAGED_SIDECAR_NAME = 'openforge-sidecar'

function repoRootFromScript() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..')
}

function loadDefaultLayoutConfig(repoRoot = repoRootFromScript()) {
  return readRustSidecarLayoutConfig(repoRoot)
}

export function readRustSidecarLayoutConfig(repoRoot = repoRootFromScript()) {
  const configPath = join(repoRoot, BACKEND_LAYOUT_CONFIG_FILE)
  return JSON.parse(readFileSync(configPath, 'utf8'))
}

function requireString(config, key) {
  const value = config[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Rust sidecar layout config must include a non-empty ${key}`)
  }
  return value
}

export function platformBinaryName(binaryName, platform = process.platform) {
  return platform === 'win32' && !binaryName.endsWith('.exe') ? `${binaryName}.exe` : binaryName
}

function pathFromRepoRoot(repoRoot, relativePath) {
  return resolve(repoRoot, relativePath)
}

export function resolveRustSidecarLayout({
  repoRoot = repoRootFromScript(),
  config = null,
  platform = process.platform,
  appName = DEFAULT_APP_NAME,
  packagedSidecarName = DEFAULT_PACKAGED_SIDECAR_NAME,
} = {}) {
  const normalizedRepoRoot = resolve(repoRoot)
  const layoutConfig = config ?? loadDefaultLayoutConfig(normalizedRepoRoot)
  const backendCrateRoot = requireString(layoutConfig, 'backendCrateRoot')
  const manifestPath = requireString(layoutConfig, 'manifestPath')
  const binaryName = requireString(layoutConfig, 'binaryName')
  const iconPath = requireString(layoutConfig, 'iconPath')
  const electronBundleRoot = requireString(layoutConfig, 'electronBundleRoot')
  const platformSidecarBinaryName = platformBinaryName(binaryName, platform)

  const backendCrateRootPath = pathFromRepoRoot(normalizedRepoRoot, backendCrateRoot)
  const defaultCargoTargetDir = join(backendCrateRootPath, 'target')
  const electronBundleRootPath = pathFromRepoRoot(normalizedRepoRoot, electronBundleRoot)
  const electronAppPath = join(electronBundleRootPath, `${appName}.app`)

  const sidecarBinaryPath = ({ profile = 'release', cargoBuildTarget = '', cargoTargetDir = defaultCargoTargetDir } = {}) => (
    cargoBuildTarget
      ? join(cargoTargetDir, cargoBuildTarget, profile, platformSidecarBinaryName)
      : join(cargoTargetDir, profile, platformSidecarBinaryName)
  )

  return {
    repoRoot: normalizedRepoRoot,
    config: {
      backendCrateRoot,
      manifestPath,
      binaryName,
      iconPath,
      electronBundleRoot,
    },
    backendCrateRoot,
    backendCrateRootPath,
    manifestPath: pathFromRepoRoot(normalizedRepoRoot, manifestPath),
    iconPath: pathFromRepoRoot(normalizedRepoRoot, iconPath),
    binaryName,
    platformSidecarBinaryName,
    defaultCargoTargetDir,
    electronBundleRoot,
    electronBundleRootPath,
    electronAppPath,
    packagedSidecarPath: join(electronAppPath, 'Contents', 'MacOS', packagedSidecarName),
    sidecarBinaryPath,
    debugSidecarBinaryPath: options => sidecarBinaryPath({ ...options, profile: 'debug' }),
    releaseSidecarBinaryPath: options => sidecarBinaryPath({ ...options, profile: 'release' }),
  }
}

function printCliValue(field) {
  const layout = resolveRustSidecarLayout()
  const values = {
    'backend-crate-root': layout.backendCrateRoot,
    'backend-crate-root-path': layout.backendCrateRootPath,
    'manifest-path': layout.manifestPath,
    'icon-path': layout.iconPath,
    'electron-bundle-root': layout.electronBundleRootPath,
    'electron-app-path': layout.electronAppPath,
    'packaged-sidecar-path': layout.packagedSidecarPath,
    'release-sidecar-binary-path': layout.releaseSidecarBinaryPath(),
    'debug-sidecar-binary-path': layout.debugSidecarBinaryPath(),
  }

  if (!(field in values)) {
    throw new Error(`Unknown rust-sidecar-layout field ${field}. Expected one of: ${Object.keys(values).join(', ')}`)
  }

  console.log(values[field])
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    printCliValue(process.argv[2] ?? 'electron-app-path')
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
