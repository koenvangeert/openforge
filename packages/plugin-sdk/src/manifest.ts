import packageMetadataSchemaData from './openforgePackageMetadataSchema.json'
import type { OpenForgePackageMetadata, OpenForgePluginCapability, ValidationError } from './types'
import { SUPPORTED_OPENFORGE_API_VERSIONS } from './types'

export const OPENFORGE_PACKAGE_METADATA_SCHEMA = packageMetadataSchemaData

export const OPENFORGE_PLUGIN_CAPABILITIES = packageMetadataSchemaData.properties.requires.items.enum as readonly OpenForgePluginCapability[]

const CAPABILITIES = new Set<string>(OPENFORGE_PLUGIN_CAPABILITIES)

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.length > 0
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validateRequiredString(value: unknown, path: string): ValidationError[] {
  if (!isNonEmptyString(value)) {
    return [{ path, message: 'Required string' }]
  }
  return []
}

function validateOptionalString(value: unknown, path: string): ValidationError[] {
  if (value === undefined) {
    return []
  }
  if (!isNonEmptyString(value)) {
    return [{ path, message: 'Must be a non-empty string' }]
  }
  return []
}

export function isSupportedOpenForgeApiVersion(apiVersion: unknown): apiVersion is (typeof SUPPORTED_OPENFORGE_API_VERSIONS)[number] {
  return typeof apiVersion === 'number'
    && Number.isInteger(apiVersion)
    && (SUPPORTED_OPENFORGE_API_VERSIONS as readonly number[]).includes(apiVersion)
}

function validateApiVersion(value: unknown): ValidationError[] {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return [{ path: 'apiVersion', message: 'Required integer' }]
  }

  if (!isSupportedOpenForgeApiVersion(value)) {
    return [{ path: 'apiVersion', message: `API version ${value} not supported (supported: ${SUPPORTED_OPENFORGE_API_VERSIONS.join(', ')})` }]
  }

  return []
}

function validateRequires(value: unknown): ValidationError[] {
  const errors: ValidationError[] = []

  if (value === undefined) {
    return errors
  }

  if (!Array.isArray(value)) {
    return [{ path: 'requires', message: 'Must be an array' }]
  }

  value.forEach((item, index) => {
    const path = `requires[${index}]`
    if (!isString(item)) {
      errors.push({ path, message: 'Must be a string' })
      return
    }

    if (!CAPABILITIES.has(item)) {
      errors.push({ path, message: `Unknown OpenForge capability "${item}"` })
    }
  })

  return errors
}

export function validateOpenForgePackageMetadata(data: unknown): ValidationError[] {
  const errors: ValidationError[] = []

  if (!isObject(data)) {
    return [{ path: '', message: 'OpenForge package metadata must be an object' }]
  }

  errors.push(...validateRequiredString(data.id, 'id'))
  errors.push(...validateApiVersion(data.apiVersion))
  errors.push(...validateRequiredString(data.displayName, 'displayName'))
  errors.push(...validateRequiredString(data.description, 'description'))
  errors.push(...validateOptionalString(data.icon, 'icon'))
  errors.push(...validateOptionalString(data.frontend, 'frontend'))
  errors.push(...validateOptionalString(data.backend, 'backend'))
  errors.push(...validateRequires(data.requires))

  if (data.contributes !== undefined) {
    errors.push({ path: 'contributes', message: 'Manifest contribution arrays are not supported; register contributions at runtime' })
  }

  for (const key of Object.keys(data)) {
    if (!Object.prototype.hasOwnProperty.call(OPENFORGE_PACKAGE_METADATA_SCHEMA.properties, key)) {
      if (key !== 'contributes') {
        errors.push({ path: key, message: 'Unknown OpenForge package metadata field' })
      }
    }
  }

  return errors
}

export const validatePluginPackageMetadata = validateOpenForgePackageMetadata

export function isOpenForgePackageMetadata(data: unknown): data is OpenForgePackageMetadata {
  return validateOpenForgePackageMetadata(data).length === 0
}

export const isPluginPackageMetadata = isOpenForgePackageMetadata
