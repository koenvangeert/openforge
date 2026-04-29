#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const defaultWorkspaceRoot = path.resolve(import.meta.dirname, '..')
const STATE_PATH = path.join('.a5c', 'cache', 'dev-plugin-artifacts.json')
const SDK_RUNTIME_OUTPUT = path.join('src-tauri', 'plugin-host', 'plugin-sdk', 'index.js')
const IGNORED_DIRS = new Set(['node_modules', 'dist', '.svelte-kit', 'coverage', '.turbo'])
const PLUGIN_INPUT_EXTENSIONS = new Set(['.ts', '.svelte', '.json', '.js', '.mjs', '.cjs'])

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/')
}

async function pathExists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch (error) {
    if (error && error.code === 'ENOENT') return false
    throw error
  }
}

async function listFiles(root, { includeExtensions = null } = {}) {
  if (!(await pathExists(root))) return []

  const files = []

  async function visit(dir) {
    const entries = await readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          await visit(fullPath)
        }
        continue
      }

      if (!entry.isFile()) continue
      if (includeExtensions && !includeExtensions.has(path.extname(entry.name))) continue

      files.push(fullPath)
    }
  }

  await visit(root)
  return files
}

async function existingFiles(paths) {
  const files = []

  for (const filePath of paths) {
    if ((await pathExists(filePath)) && (await stat(filePath)).isFile()) {
      files.push(filePath)
    }
  }

  return files
}

async function hashFiles(workspaceRoot, absolutePaths) {
  const relativePaths = absolutePaths
    .map((filePath) => toPosixPath(path.relative(workspaceRoot, filePath)))
    .sort()
  const hash = createHash('sha256')

  for (const relativePath of relativePaths) {
    hash.update(relativePath)
    hash.update('\0')
    hash.update(await readFile(path.join(workspaceRoot, relativePath)))
    hash.update('\0')
  }

  return {
    hash: hash.digest('hex'),
    inputPaths: relativePaths,
  }
}

async function collectPluginSdkPackageInputs(workspaceRoot) {
  return [
    ...(await listFiles(path.join(workspaceRoot, 'packages', 'plugin-sdk', 'src'), {
      includeExtensions: PLUGIN_INPUT_EXTENSIONS,
    })),
    ...(await existingFiles([
      path.join(workspaceRoot, 'packages', 'plugin-sdk', 'package.json'),
      path.join(workspaceRoot, 'packages', 'plugin-sdk', 'tsconfig.json'),
    ])),
  ]
}

async function collectSdkRuntimeInputs(workspaceRoot) {
  return [
    ...(await collectPluginSdkPackageInputs(workspaceRoot)),
    ...(await existingFiles([
      path.join(workspaceRoot, 'scripts', 'build-plugin-sdk-runtime.mjs'),
    ])),
  ]
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch (error) {
    if (error && error.code === 'ENOENT') return fallback
    throw error
  }
}

async function collectBuildScriptPluginDirs(workspaceRoot) {
  const pluginsRoot = path.join(workspaceRoot, 'plugins')
  if (!(await pathExists(pluginsRoot))) return []

  const entries = await readdir(pluginsRoot, { withFileTypes: true })
  const dirs = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const pluginDir = path.join(pluginsRoot, entry.name)
    const packageJson = await readJson(path.join(pluginDir, 'package.json'), null)

    if (packageJson?.scripts?.build) {
      dirs.push(pluginDir)
    }
  }

  return dirs.sort()
}

async function collectBundledPluginInputs(workspaceRoot) {
  const pluginDirs = await collectBuildScriptPluginDirs(workspaceRoot)
  const files = [
    ...(await collectPluginSdkPackageInputs(workspaceRoot)),
  ]

  for (const pluginDir of pluginDirs) {
    files.push(
      ...(await listFiles(path.join(pluginDir, 'src'), {
        includeExtensions: PLUGIN_INPUT_EXTENSIONS,
      })),
      ...(await existingFiles([
        path.join(pluginDir, 'manifest.json'),
        path.join(pluginDir, 'package.json'),
        path.join(pluginDir, 'tsconfig.json'),
        path.join(pluginDir, 'vite.config.ts'),
        path.join(pluginDir, 'vite.config.js'),
        path.join(pluginDir, 'vite.config.mjs'),
      ])),
    )
  }

  return files
}

async function buildScriptPluginOutputs(workspaceRoot) {
  const pluginDirs = await collectBuildScriptPluginDirs(workspaceRoot)
  return pluginDirs.map((pluginDir) => path.join(pluginDir, 'dist', 'index.js'))
}

async function anyMissing(paths) {
  for (const filePath of paths) {
    if (!(await pathExists(filePath))) return true
  }

  return false
}

async function defaultRunCommand(command, args, options) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })

    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${command} ${args.join(' ')} exited via signal ${signal}`))
        return
      }

      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 1}`))
      }
    })

    child.on('error', reject)
  })
}

function evaluateBuild({ previousState, nextInputs, outputsMissing }) {
  if (!previousState?.hash) {
    return { rebuilt: true, reason: 'no-state' }
  }

  if (outputsMissing) {
    return { rebuilt: true, reason: 'missing-output' }
  }

  if (previousState.hash !== nextInputs.hash) {
    return { rebuilt: true, reason: 'inputs-changed' }
  }

  return { rebuilt: false, reason: 'up-to-date' }
}

export async function ensureDevPluginArtifacts(options = {}) {
  const workspaceRoot = options.workspaceRoot ? path.resolve(options.workspaceRoot) : defaultWorkspaceRoot
  const log = options.log ?? console.log
  const runCommand = options.runCommand ?? defaultRunCommand
  const statePath = path.join(workspaceRoot, STATE_PATH)
  const state = await readJson(statePath, {})

  const sdkRuntimeInputs = await hashFiles(workspaceRoot, await collectSdkRuntimeInputs(workspaceRoot))
  const bundledPluginInputs = await hashFiles(workspaceRoot, await collectBundledPluginInputs(workspaceRoot))

  const sdkRuntime = evaluateBuild({
    previousState: state.sdkRuntime,
    nextInputs: sdkRuntimeInputs,
    outputsMissing: !(await pathExists(path.join(workspaceRoot, SDK_RUNTIME_OUTPUT))),
  })

  const pluginOutputs = await buildScriptPluginOutputs(workspaceRoot)
  const bundledPlugins = evaluateBuild({
    previousState: state.bundledPlugins,
    nextInputs: bundledPluginInputs,
    outputsMissing: pluginOutputs.length > 0 && (await anyMissing(pluginOutputs)),
  })

  if (sdkRuntime.rebuilt) {
    log(`[dev-plugin-artifacts] rebuilding plugin SDK runtime (${sdkRuntime.reason})`)
    await runCommand('pnpm', ['build:plugin-sdk-runtime'], { cwd: workspaceRoot, env: options.env ?? process.env })
  } else {
    log('[dev-plugin-artifacts] plugin SDK runtime is current')
  }

  if (bundledPlugins.rebuilt) {
    log(`[dev-plugin-artifacts] rebuilding bundled plugins (${bundledPlugins.reason})`)
    await runCommand('pnpm', ['build:plugins'], { cwd: workspaceRoot, env: options.env ?? process.env })
  } else {
    log('[dev-plugin-artifacts] bundled plugin builds are current')
  }

  const nextState = {
    version: 1,
    sdkRuntime: {
      hash: sdkRuntimeInputs.hash,
      inputPaths: sdkRuntimeInputs.inputPaths,
      updatedAt: sdkRuntime.rebuilt ? new Date().toISOString() : state.sdkRuntime?.updatedAt ?? null,
    },
    bundledPlugins: {
      hash: bundledPluginInputs.hash,
      inputPaths: bundledPluginInputs.inputPaths,
      updatedAt: bundledPlugins.rebuilt ? new Date().toISOString() : state.bundledPlugins?.updatedAt ?? null,
    },
  }

  await mkdir(path.dirname(statePath), { recursive: true })
  await writeFile(statePath, `${JSON.stringify(nextState, null, 2)}\n`)

  return { sdkRuntime, bundledPlugins, statePath }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await ensureDevPluginArtifacts()
}
