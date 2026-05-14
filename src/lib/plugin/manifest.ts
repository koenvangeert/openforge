import contributionSchemaData from './manifestContributionSchema.json'
import type { PluginManifest } from './types'
import { MAX_SUPPORTED_API_VERSION } from './types'

export interface ValidationError {
  path: string
  message: string
}

interface ManifestContributionSchema {
  allowedIconKeys: string[]
  shortcutPattern: string
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
    errors.push({ path: 'contributes', message: 'Manifest contribution arrays are not supported; register contributions at runtime' })
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
