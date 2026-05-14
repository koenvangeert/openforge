#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

export const RELEASE_IMAGE_VOLUME_NAME = 'Open Forge'

export function releaseImageArchForTarget(target) {
  if (target === 'aarch64-apple-darwin') return 'aarch64'
  if (target === 'x86_64-apple-darwin') return 'x64'
  throw new Error(`Unsupported release image target: ${target}`)
}

export function normalizeReleaseVersion(version) {
  const normalized = String(version ?? '').replace(/^v/, '')
  if (!normalized) throw new Error('Release image version is required')
  return normalized
}

export function releaseImageFilename(version, target) {
  return `Open.Forge_${normalizeReleaseVersion(version)}_${releaseImageArchForTarget(target)}.dmg`
}

export function releaseDmgArgs({ sourceFolder, outputPath, volumeName = RELEASE_IMAGE_VOLUME_NAME }) {
  return ['create', '-volname', volumeName, '-srcfolder', sourceFolder, '-ov', '-format', 'UDZO', outputPath]
}

function runCommand(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', chunk => { stdout += chunk.toString() })
    child.stderr?.on('data', chunk => { stderr += chunk.toString() })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr })
        return
      }
      reject(new Error(`${command} ${args.join(' ')} exited with ${signal ?? `code ${code}`}: ${(stderr || stdout).trim()}`))
    })
  })
}

export async function createReleaseDmg({
  appPath,
  version,
  target,
  outputDir = process.cwd(),
  createTempDir = () => mkdtemp(join(tmpdir(), 'openforge-release-image-')),
  removeDir = path => rm(path, { recursive: true, force: true }),
  run = runCommand,
} = {}) {
  if (!appPath) throw new Error('Release image appPath is required')
  const outputPath = resolve(outputDir, releaseImageFilename(version, target))
  const stagingDir = await createTempDir()
  await mkdir(stagingDir, { recursive: true })

  try {
    await run('ditto', [appPath, join(stagingDir, basename(appPath))])
    await run('hdiutil', releaseDmgArgs({ sourceFolder: stagingDir, outputPath }))
    return outputPath
  } finally {
    await removeDir(stagingDir)
  }
}

function usage() {
  return `Usage:
  node scripts/release-image.mjs arch-for-target <target>
  node scripts/release-image.mjs filename <version> <target>
  node scripts/release-image.mjs create <app-path> <version> <target> [output-dir]
`
}

async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv

  if (command === 'arch-for-target') {
    console.log(releaseImageArchForTarget(args[0]))
    return
  }

  if (command === 'filename') {
    console.log(releaseImageFilename(args[0], args[1]))
    return
  }

  if (command === 'create') {
    const [appPath, version, target, outputDir = process.cwd()] = args
    console.log(await createReleaseDmg({ appPath, version, target, outputDir }))
    return
  }

  throw new Error(usage())
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
