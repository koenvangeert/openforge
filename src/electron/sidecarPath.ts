import { existsSync } from 'node:fs'
import { join } from 'node:path'

export type PathExists = (path: string) => boolean

export function resolveElectronSidecarPath(
  env: NodeJS.ProcessEnv = process.env,
  electronMainDir: string,
  platform: NodeJS.Platform = process.platform,
  pathExists: PathExists = existsSync,
): string | null {
  if (env.OPENFORGE_SIDECAR_PATH) return env.OPENFORGE_SIDECAR_PATH

  const sidecarName = platform === 'win32' ? 'openforge-sidecar.exe' : 'openforge-sidecar'
  const packagedSidecarPath = join(electronMainDir, '..', '..', '..', 'MacOS', sidecarName)

  return pathExists(packagedSidecarPath) ? packagedSidecarPath : null
}
