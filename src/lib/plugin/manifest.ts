import contributionSchemaData from './manifestContributionSchema.json'
import type { PluginManifest } from './types'
import { MAX_SUPPORTED_API_VERSION } from './types'

export interface ValidationError {
  path: string
  message: string
}

type ContributionFieldKind = 'nonEmptyString' | 'icon' | 'number' | 'shortcut' | 'enum'

interface ContributionFieldSpec {
  kind: ContributionFieldKind
  required?: boolean
  values?: string[]
}

interface ContributionPointSpec {
  fields: Record<string, ContributionFieldSpec>
}

interface ManifestContributionSchema {
  allowedIconKeys: string[]
  shortcutPattern: string
  contributionPoints: Record<string, ContributionPointSpec>
}

const contributionSchema = contributionSchemaData as ManifestContributionSchema
const shortcutRegex = new RegExp(contributionSchema.shortcutPattern)

export const ALLOWED_ICON_KEYS: ReadonlySet<string> = new Set(contributionSchema.allowedIconKeys)

export function isValidShortcutFormat(shortcut: string): boolean {
  return shortcutRegex.test(shortcut)
}

export function normalizeShortcut(shortcut: string): string {
  let result = ''
  const parts = shortcut.split('+')
  const key = parts[parts.length - 1]
  const modifiers = parts.slice(0, -1)

  if (modifiers.includes('Cmd')) result += '⌘'
  if (modifiers.includes('Ctrl')) result += '⌃'
  if (modifiers.includes('Alt')) result += '⌥'
  if (modifiers.includes('Shift')) result += '⇧'

  result += key.toLowerCase()
  return result
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number'
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getRequiredStringError(path: string): ValidationError {
  return { path, message: 'Required string' }
}

function validateNonEmptyString(value: unknown, path: string, required: boolean): ValidationError[] {
  if (value === undefined) {
    return required ? [getRequiredStringError(path)] : []
  }

  if (!isString(value) || !value) {
    return [required ? getRequiredStringError(path) : { path, message: 'Must be a string' }]
  }

  return []
}

function validateIcon(value: unknown, path: string, required: boolean): ValidationError[] {
  const errors = validateNonEmptyString(value, path, required)
  if (errors.length > 0 || value === undefined) {
    return errors
  }

  if (!ALLOWED_ICON_KEYS.has(value as string)) {
    return [{ path, message: `Icon key "${value as string}" not allowed` }]
  }

  return []
}

function validateNumber(value: unknown, path: string, required: boolean): ValidationError[] {
  if (value === undefined) {
    return required ? [{ path, message: 'Required number' }] : []
  }

  if (!isNumber(value)) {
    return [{ path, message: 'Must be a number' }]
  }

  return []
}

function validateShortcut(value: unknown, path: string, required: boolean): ValidationError[] {
  if (value === undefined) {
    return required ? [getRequiredStringError(path)] : []
  }

  if (!isString(value)) {
    return [{ path, message: 'Must be a string' }]
  }

  if (!isValidShortcutFormat(value)) {
    return [{ path, message: 'Invalid shortcut format' }]
  }

  return []
}

function validateEnum(value: unknown, path: string, required: boolean, values: string[] | undefined): ValidationError[] {
  if (value === undefined) {
    return required ? [getRequiredStringError(path)] : []
  }

  if (!isString(value) || !values?.includes(value)) {
    return [{ path, message: values === undefined ? 'Invalid value' : `Must be ${values.map((option) => `"${option}"`).join(' or ')}` }]
  }

  return []
}

function validateContributionField(value: unknown, path: string, spec: ContributionFieldSpec): ValidationError[] {
  const required = spec.required === true

  switch (spec.kind) {
    case 'nonEmptyString':
      return validateNonEmptyString(value, path, required)
    case 'icon':
      return validateIcon(value, path, required)
    case 'number':
      return validateNumber(value, path, required)
    case 'shortcut':
      return validateShortcut(value, path, required)
    case 'enum':
      return validateEnum(value, path, required, spec.values)
  }
}

function validateContributionArray(value: unknown, path: string, spec: ContributionPointSpec): ValidationError[] {
  const errors: ValidationError[] = []

  if (!isArray(value)) {
    errors.push({ path, message: 'Must be an array' })
    return errors
  }

  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`
    if (!isObject(item)) {
      errors.push({ path: itemPath, message: 'Must be an object' })
      return
    }

    Object.entries(spec.fields).forEach(([fieldName, fieldSpec]) => {
      errors.push(...validateContributionField(item[fieldName], `${itemPath}.${fieldName}`, fieldSpec))
    })
  })

  return errors
}

function validateContributionPoints(contributes: unknown): ValidationError[] {
  const errors: ValidationError[] = []

  if (!isObject(contributes)) {
    errors.push({ path: 'contributes', message: 'Must be an object' })
    return errors
  }

  Object.entries(contributionSchema.contributionPoints).forEach(([contributionName, contributionSpec]) => {
    const value = contributes[contributionName]
    if (value !== undefined) {
      errors.push(...validateContributionArray(value, `contributes.${contributionName}`, contributionSpec))
    }
  })

  return errors
}

export function validatePluginManifest(data: unknown): ValidationError[] {
  const errors: ValidationError[] = []

  if (!isObject(data)) {
    errors.push({ path: '', message: 'Manifest must be an object' })
    return errors
  }

  if (!isString(data.id) || !data.id) {
    errors.push({ path: 'id', message: 'Required string' })
  }

  if (!isString(data.name) || !data.name) {
    errors.push({ path: 'name', message: 'Required string' })
  }

  if (!isString(data.version) || !data.version) {
    errors.push({ path: 'version', message: 'Required string' })
  }

  if (!isNumber(data.apiVersion)) {
    errors.push({ path: 'apiVersion', message: 'Required number' })
  } else if (data.apiVersion > MAX_SUPPORTED_API_VERSION) {
    errors.push({ path: 'apiVersion', message: `API version ${data.apiVersion} not supported (max: ${MAX_SUPPORTED_API_VERSION})` })
  }

  if (!isString(data.description) || !data.description) {
    errors.push({ path: 'description', message: 'Required string' })
  }

  if (data.permissions !== undefined && !isArray(data.permissions)) {
    errors.push({ path: 'permissions', message: 'Must be an array' })
  }

  if (data.contributes !== undefined) {
    errors.push(...validateContributionPoints(data.contributes))
  }

  if (data.frontend === undefined) {
    errors.push({ path: 'frontend', message: 'Required string or null' })
  } else if (data.frontend !== null && (!isString(data.frontend) || !data.frontend)) {
    errors.push({ path: 'frontend', message: 'Must be a non-empty string or null' })
  }

  if (data.backend !== undefined && data.backend !== null && !isString(data.backend)) {
    errors.push({ path: 'backend', message: 'Must be a string or null' })
  }

  return errors
}

export function isPluginManifest(data: unknown): data is PluginManifest {
  return validatePluginManifest(data).length === 0
}
