import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  MAX_SUPPORTED_API_VERSION,
  MIN_SUPPORTED_API_VERSION,
  OPENFORGE_PACKAGE_METADATA_SCHEMA,
  OPENFORGE_PLUGIN_API_VERSION,
  OPENFORGE_PLUGIN_CAPABILITIES,
  SUPPORTED_OPENFORGE_API_VERSIONS,
  isOpenForgePackageMetadata,
  isSupportedOpenForgeApiVersion,
  validateOpenForgePackageMetadata,
} from './index'

function validMetadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'github',
    apiVersion: OPENFORGE_PLUGIN_API_VERSION,
    displayName: 'GitHub',
    description: 'GitHub PR review and sync',
    icon: 'github',
    frontend: './dist/frontend.js',
    backend: './dist/backend.js',
    requires: ['projects', 'tasks', 'commands', 'storage'],
    ...overrides,
  }
}

describe('package.json#openforge metadata contract', () => {
  afterEach(() => {
    vi.doUnmock('./openforgePackageMetadataSchema.json')
    vi.resetModules()
  })

  it('validates ADR package metadata without manifest contributions', () => {
    expect(validateOpenForgePackageMetadata(validMetadata())).toEqual([])
    expect(isOpenForgePackageMetadata(validMetadata())).toBe(true)
  })

  it('rejects legacy manifest contribution arrays', () => {
    const errors = validateOpenForgePackageMetadata(validMetadata({
      contributes: {
        views: [{ id: 'prs', title: 'Pull Requests', icon: 'git-pull-request' }],
      },
    }))

    expect(errors).toContainEqual({
      path: 'contributes',
      message: 'Manifest contribution arrays are not supported; register contributions at runtime',
    })
  })

  it('rejects missing and malformed required metadata', () => {
    const errors = validateOpenForgePackageMetadata({
      id: '',
      apiVersion: '1',
      displayName: '',
      description: '',
      frontend: '',
      backend: 123,
      requires: ['tasks', 'unknown-capability', 42],
    })

    expect(errors).toContainEqual({ path: 'id', message: 'Required string' })
    expect(errors).toContainEqual({ path: 'apiVersion', message: 'Required integer' })
    expect(errors).toContainEqual({ path: 'displayName', message: 'Required string' })
    expect(errors).toContainEqual({ path: 'description', message: 'Required string' })
    expect(errors).toContainEqual({ path: 'frontend', message: 'Must be a non-empty string' })
    expect(errors).toContainEqual({ path: 'backend', message: 'Must be a non-empty string' })
    expect(errors).toContainEqual({ path: 'requires[1]', message: 'Unknown OpenForge capability "unknown-capability"' })
    expect(errors).toContainEqual({ path: 'requires[2]', message: 'Must be a string' })
  })

  it('uses apiVersion as a hard compatibility gate', () => {
    expect(OPENFORGE_PLUGIN_API_VERSION).toBe(1)
    expect(MIN_SUPPORTED_API_VERSION).toBe(1)
    expect(MAX_SUPPORTED_API_VERSION).toBe(1)
    expect(SUPPORTED_OPENFORGE_API_VERSIONS).toEqual([1])
    expect(isSupportedOpenForgeApiVersion(1)).toBe(true)
    expect(isSupportedOpenForgeApiVersion(0)).toBe(false)
    expect(isSupportedOpenForgeApiVersion(2)).toBe(false)

    expect(validateOpenForgePackageMetadata(validMetadata({ apiVersion: 2 }))).toContainEqual({
      path: 'apiVersion',
      message: 'API version 2 not supported (supported: 1)',
    })
  })

  it('ships a shared JSON Schema for package.json#openforge with no contribution arrays', () => {
    expect(OPENFORGE_PACKAGE_METADATA_SCHEMA).toMatchObject({
      type: 'object',
      required: ['id', 'apiVersion', 'displayName', 'description'],
    })
    expect(OPENFORGE_PACKAGE_METADATA_SCHEMA.properties).not.toHaveProperty('contributes')
    expect(OPENFORGE_PACKAGE_METADATA_SCHEMA.additionalProperties).toBe(false)
    expect(OPENFORGE_PACKAGE_METADATA_SCHEMA.properties.apiVersion).toEqual({ enum: [1] })
  })

  it('derives TypeScript validator constants from schema enum values', async () => {
    expect(OPENFORGE_PLUGIN_CAPABILITIES).toEqual(OPENFORGE_PACKAGE_METADATA_SCHEMA.properties.requires.items.enum)
    expect(SUPPORTED_OPENFORGE_API_VERSIONS).toEqual(OPENFORGE_PACKAGE_METADATA_SCHEMA.properties.apiVersion.enum)

    const schemaWithNewEnums = structuredClone(OPENFORGE_PACKAGE_METADATA_SCHEMA)
    schemaWithNewEnums.properties.apiVersion = { enum: [1, 2] }
    schemaWithNewEnums.properties.requires.items.enum = [
      ...OPENFORGE_PACKAGE_METADATA_SCHEMA.properties.requires.items.enum,
      'schemaOnlyCapability',
    ]

    vi.resetModules()
    vi.doMock('./openforgePackageMetadataSchema.json', () => ({ default: schemaWithNewEnums }))

    const manifest = await import('./manifest')

    expect(manifest.OPENFORGE_PLUGIN_CAPABILITIES).toEqual(schemaWithNewEnums.properties.requires.items.enum)
    expect(manifest.isSupportedOpenForgeApiVersion(2)).toBe(true)
    expect(manifest.validateOpenForgePackageMetadata(validMetadata({
      apiVersion: 2,
      requires: ['schemaOnlyCapability'],
    }))).toEqual([])
  })
})
