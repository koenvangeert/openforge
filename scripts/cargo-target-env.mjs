import { execFileSync as defaultExecFileSync } from 'node:child_process'
import path from 'node:path'
import { resolveRustSidecarLayout } from './rust-sidecar-layout.mjs'

const SHARED_TARGET_DIR_NAME = '.cargo-target'
const NON_STANDARD_COMMON_DIR_TARGET_NAME = 'openforge-cargo-target'
const DEFAULT_PRODUCTION_BACKEND_PORT = '17422'
export const DEFAULT_DEV_BACKEND_PORT = 17642

export function resolveGitCommonDir(cwd, gitCommonDir) {
  return path.normalize(path.isAbsolute(gitCommonDir) ? gitCommonDir : path.resolve(cwd, gitCommonDir))
}

export function sharedCargoTargetDirFromGitCommonDir(gitCommonDir) {
  const normalizedGitCommonDir = path.normalize(gitCommonDir)

  if (path.basename(normalizedGitCommonDir) === '.git') {
    return path.join(path.dirname(normalizedGitCommonDir), SHARED_TARGET_DIR_NAME)
  }

  return path.join(normalizedGitCommonDir, NON_STANDARD_COMMON_DIR_TARGET_NAME)
}

export function computeCargoTargetDir({
  cwd = process.cwd(),
  env = process.env,
  execFileSync = defaultExecFileSync,
  rustSidecarLayout = null,
} = {}) {
  if (env.CARGO_TARGET_DIR) {
    return { cargoTargetDir: env.CARGO_TARGET_DIR, source: 'env' }
  }

  try {
    const gitCommonDir = resolveGitCommonDir(
      cwd,
      String(
        execFileSync('git', ['rev-parse', '--git-common-dir'], {
          cwd,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }),
      ).trim(),
    )

    return {
      cargoTargetDir: sharedCargoTargetDirFromGitCommonDir(gitCommonDir),
      source: 'git-common-dir',
    }
  } catch {
    const layout = rustSidecarLayout ?? resolveRustSidecarLayout({ repoRoot: cwd })
    return {
      cargoTargetDir: layout.defaultCargoTargetDir,
      source: 'fallback',
    }
  }
}

export function buildElectronSidecarDevEnv(options = {}) {
  const env = options.env ?? process.env
  const result = computeCargoTargetDir({ ...options, env })
  const legacyBackendPort = env.AI_COMMAND_CENTER_PORT === DEFAULT_PRODUCTION_BACKEND_PORT
    ? undefined
    : env.AI_COMMAND_CENTER_PORT
  const backendPort = env.OPENFORGE_BACKEND_PORT ?? legacyBackendPort ?? String(DEFAULT_DEV_BACKEND_PORT)

  return {
    ...result,
    env: {
      ...env,
      CARGO_TARGET_DIR: result.cargoTargetDir,
      OPENFORGE_BACKEND_PORT: backendPort,
      OPENFORGE_HTTP_PORT: env.OPENFORGE_HTTP_PORT ?? backendPort,
    },
  }
}
