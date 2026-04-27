import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const currentDir = dirname(fileURLToPath(import.meta.url))
const tauriConfigPath = join(currentDir, '../../src-tauri/tauri.conf.json')

type TauriConfig = {
  build?: {
    beforeDevCommand?: string
    beforeBuildCommand?: string
  }
}

describe('Tauri plugin build hooks', () => {
  it('does not build unused built-in plugin frontend bundles before Tauri dev and production builds', () => {
    const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, 'utf8')) as TauriConfig

    expect(tauriConfig.build?.beforeDevCommand).not.toContain('pnpm build:plugins')
    expect(tauriConfig.build?.beforeBuildCommand).not.toContain('pnpm build:plugins')
  })
})
