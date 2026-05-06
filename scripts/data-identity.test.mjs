import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DATA_IDENTITY_MANIFEST_FILE,
  ELECTRON_APP_NAME,
  ELECTRON_APP_PACKAGE_NAME,
  ELECTRON_BUNDLE_IDENTIFIER,
  OPENFORGE_APP_DATA_IDENTIFIER,
  OPENFORGE_APP_DATA_DIR_ENV,
  OPENFORGE_DATA_IDENTITY,
  databaseFilenameForBuildMode,
  keychainServiceForBuildMode,
  readOpenForgeDataIdentity,
} from './data-identity.mjs'

const repoRoot = join(import.meta.dirname, '..')

describe('OpenForgeDataIdentity manifest', () => {
  it('is the shared source of truth for data, package, keychain, and legacy identity', async () => {
    const identity = readOpenForgeDataIdentity(repoRoot)
    const manifest = JSON.parse(await readFile(join(repoRoot, DATA_IDENTITY_MANIFEST_FILE), 'utf8'))

    expect(identity).toEqual(manifest)
    expect(identity.dataIdentity).toMatchObject({
      appDataIdentifier: 'com.opencode.openforge',
      appDataDirEnv: 'OPENFORGE_APP_DATA_DIR',
      databaseFilenames: {
        debug: 'openforge_dev.db',
        release: 'openforge.db',
      },
      keychain: {
        debugService: 'openforge-dev',
        releaseService: 'openforge',
        secretAccounts: ['github_token'],
      },
    })
    expect(identity.legacySources).toMatchObject({
      homeDirNames: { old: '.ai-command-center', current: '.openforge' },
      dataDirNames: { old: 'ai-command-center', current: 'openforge' },
      appIdentifiers: { old: 'com.opencode.ai-command-center' },
      databaseFilenames: {
        release: 'ai_command_center.db',
        debug: 'ai_command_center_dev.db',
      },
    })
  })

  it('makes the package/data identity split explicit', () => {
    expect(OPENFORGE_DATA_IDENTITY.dataIdentity.appDataIdentifier).toBe('com.opencode.openforge')
    expect(OPENFORGE_DATA_IDENTITY.packageIdentity).toMatchObject({
      appName: 'Open Forge',
      electronAppPackageName: 'openforge-electron-app',
      bundleIdentifier: 'com.openforge.app.electron',
      electronTemplateAppName: 'Electron.app',
    })
    expect(OPENFORGE_DATA_IDENTITY.packageIdentity.bundleIdentifier)
      .not.toBe(OPENFORGE_DATA_IDENTITY.dataIdentity.appDataIdentifier)
  })

  it('exports consumer helpers from the manifest values', () => {
    expect(OPENFORGE_APP_DATA_IDENTIFIER).toBe('com.opencode.openforge')
    expect(OPENFORGE_APP_DATA_DIR_ENV).toBe('OPENFORGE_APP_DATA_DIR')
    expect(ELECTRON_APP_NAME).toBe('Open Forge')
    expect(ELECTRON_APP_PACKAGE_NAME).toBe('openforge-electron-app')
    expect(ELECTRON_BUNDLE_IDENTIFIER).toBe('com.openforge.app.electron')
    expect(databaseFilenameForBuildMode('debug')).toBe('openforge_dev.db')
    expect(databaseFilenameForBuildMode('release')).toBe('openforge.db')
    expect(keychainServiceForBuildMode('debug')).toBe('openforge-dev')
    expect(keychainServiceForBuildMode('release')).toBe('openforge')
  })
})
