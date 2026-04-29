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
  it('uses incremental plugin artifact builds for dev and full plugin builds for production', () => {
    const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, 'utf8')) as TauriConfig

    expect(tauriConfig.build?.beforeDevCommand).toBe('pnpm dev:plugin-artifacts && pnpm dev')
    expect(tauriConfig.build?.beforeBuildCommand).toContain('pnpm build:plugins &&')
  })
})
