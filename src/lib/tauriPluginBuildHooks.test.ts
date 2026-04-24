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
  it('builds builtin plugin bundles before Tauri dev and production builds', () => {
    const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, 'utf8')) as TauriConfig

    expect(tauriConfig.build?.beforeDevCommand).toContain('pnpm build:plugins &&')
    expect(tauriConfig.build?.beforeBuildCommand).toContain('pnpm build:plugins &&')
  })
})
