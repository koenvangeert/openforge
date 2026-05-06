#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DATA_IDENTITY_MANIFEST_FILE = 'openforge-data-identity.json'

function repoRootFromScript() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..')
}

function requireObject(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`OpenForgeDataIdentity manifest must include object ${label}`)
  }
  return value
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`OpenForgeDataIdentity manifest must include non-empty string ${label}`)
  }
  return value
}

function requireStringArray(value, label) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.trim() === '')) {
    throw new Error(`OpenForgeDataIdentity manifest must include string array ${label}`)
  }
  return value
}

export function validateOpenForgeDataIdentity(identity) {
  const root = requireObject(identity, 'root')
  const dataIdentity = requireObject(root.dataIdentity, 'dataIdentity')
  const databaseFilenames = requireObject(dataIdentity.databaseFilenames, 'dataIdentity.databaseFilenames')
  const keychain = requireObject(dataIdentity.keychain, 'dataIdentity.keychain')
  const packageIdentity = requireObject(root.packageIdentity, 'packageIdentity')
  const legacySources = requireObject(root.legacySources, 'legacySources')
  const homeDirNames = requireObject(legacySources.homeDirNames, 'legacySources.homeDirNames')
  const dataDirNames = requireObject(legacySources.dataDirNames, 'legacySources.dataDirNames')
  const appIdentifiers = requireObject(legacySources.appIdentifiers, 'legacySources.appIdentifiers')
  const legacyDatabaseFilenames = requireObject(legacySources.databaseFilenames, 'legacySources.databaseFilenames')

  requireString(dataIdentity.appDataIdentifier, 'dataIdentity.appDataIdentifier')
  requireString(dataIdentity.appDataDirEnv, 'dataIdentity.appDataDirEnv')
  requireString(databaseFilenames.debug, 'dataIdentity.databaseFilenames.debug')
  requireString(databaseFilenames.release, 'dataIdentity.databaseFilenames.release')
  requireString(keychain.debugService, 'dataIdentity.keychain.debugService')
  requireString(keychain.releaseService, 'dataIdentity.keychain.releaseService')
  requireStringArray(keychain.secretAccounts, 'dataIdentity.keychain.secretAccounts')
  requireString(packageIdentity.appName, 'packageIdentity.appName')
  requireString(packageIdentity.electronAppPackageName, 'packageIdentity.electronAppPackageName')
  requireString(packageIdentity.bundleIdentifier, 'packageIdentity.bundleIdentifier')
  requireString(packageIdentity.electronTemplateAppName, 'packageIdentity.electronTemplateAppName')
  requireString(homeDirNames.old, 'legacySources.homeDirNames.old')
  requireString(homeDirNames.current, 'legacySources.homeDirNames.current')
  requireString(dataDirNames.old, 'legacySources.dataDirNames.old')
  requireString(dataDirNames.current, 'legacySources.dataDirNames.current')
  requireString(appIdentifiers.old, 'legacySources.appIdentifiers.old')
  requireString(legacyDatabaseFilenames.debug, 'legacySources.databaseFilenames.debug')
  requireString(legacyDatabaseFilenames.release, 'legacySources.databaseFilenames.release')

  return root
}

export function readOpenForgeDataIdentity(repoRoot = repoRootFromScript()) {
  const manifestPath = join(repoRoot, DATA_IDENTITY_MANIFEST_FILE)
  return validateOpenForgeDataIdentity(JSON.parse(readFileSync(manifestPath, 'utf8')))
}

export const OPENFORGE_DATA_IDENTITY = readOpenForgeDataIdentity()
export const OPENFORGE_APP_DATA_IDENTIFIER = OPENFORGE_DATA_IDENTITY.dataIdentity.appDataIdentifier
export const OPENFORGE_APP_DATA_DIR_ENV = OPENFORGE_DATA_IDENTITY.dataIdentity.appDataDirEnv
export const ELECTRON_APP_NAME = OPENFORGE_DATA_IDENTITY.packageIdentity.appName
export const ELECTRON_APP_PACKAGE_NAME = OPENFORGE_DATA_IDENTITY.packageIdentity.electronAppPackageName
export const ELECTRON_BUNDLE_IDENTIFIER = OPENFORGE_DATA_IDENTITY.packageIdentity.bundleIdentifier
export const ELECTRON_TEMPLATE_APP_NAME = OPENFORGE_DATA_IDENTITY.packageIdentity.electronTemplateAppName

export function databaseFilenameForBuildMode(mode) {
  if (mode !== 'debug' && mode !== 'release') {
    throw new Error(`Unknown OpenForge database build mode ${mode}`)
  }
  return OPENFORGE_DATA_IDENTITY.dataIdentity.databaseFilenames[mode]
}

export function keychainServiceForBuildMode(mode) {
  if (mode !== 'debug' && mode !== 'release') {
    throw new Error(`Unknown OpenForge keychain build mode ${mode}`)
  }
  return mode === 'debug'
    ? OPENFORGE_DATA_IDENTITY.dataIdentity.keychain.debugService
    : OPENFORGE_DATA_IDENTITY.dataIdentity.keychain.releaseService
}
