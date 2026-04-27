import type { PluginManifest } from './types'
import { MAX_SUPPORTED_API_VERSION } from './types'

export interface ValidationError {
  path: string
  message: string
}

export const ALLOWED_ICON_KEYS: ReadonlySet<string> = new Set([
  'layout-dashboard',
  'folder-open',
  'git-pull-request',
  'sparkles',
  'settings',
  'terminal',
  'code',
  'file-text',
  'plug',
  'puzzle',
  'boxes',
  'wrench',
])

export function isValidShortcutFormat(shortcut: string): boolean {
  const pattern = /^(?:(?:Cmd|Ctrl|Alt|Shift)\+)*(?:[a-zA-Z0-9]|F\d{1,2}|Space|Enter|Tab|Backspace|Escape)$/
  return pattern.test(shortcut)
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

function validateViewContributions(views: unknown): ValidationError[] {
  const errors: ValidationError[] = []

  if (!isArray(views)) {
    errors.push({ path: 'contributes.views', message: 'Must be an array' })
    return errors
  }

  views.forEach((view, index) => {
    if (!isObject(view)) {
      errors.push({ path: `contributes.views[${index}]`, message: 'Must be an object' })
      return
    }

    if (!isString(view.id) || !view.id) {
      errors.push({ path: `contributes.views[${index}].id`, message: 'Required string' })
    }

    if (!isString(view.title) || !view.title) {
      errors.push({ path: `contributes.views[${index}].title`, message: 'Required string' })
    }

    if (!isString(view.icon) || !view.icon) {
      errors.push({ path: `contributes.views[${index}].icon`, message: 'Required string' })
    } else if (!ALLOWED_ICON_KEYS.has(view.icon)) {
      errors.push({ path: `contributes.views[${index}].icon`, message: `Icon key "${view.icon}" not allowed` })
    }

    if (view.shortcut !== undefined) {
      if (!isString(view.shortcut)) {
        errors.push({ path: `contributes.views[${index}].shortcut`, message: 'Must be a string' })
      } else if (!isValidShortcutFormat(view.shortcut)) {
        errors.push({ path: `contributes.views[${index}].shortcut`, message: 'Invalid shortcut format' })
      }
    }
  })

  return errors
}

function validateTaskPaneTabContributions(taskPaneTabs: unknown): ValidationError[] {
  const errors: ValidationError[] = []

  if (!isArray(taskPaneTabs)) {
    errors.push({ path: 'contributes.taskPaneTabs', message: 'Must be an array' })
    return errors
  }

  taskPaneTabs.forEach((tab, index) => {
    if (!isObject(tab)) {
      errors.push({ path: `contributes.taskPaneTabs[${index}]`, message: 'Must be an object' })
      return
    }

    if (!isString(tab.id) || !tab.id) {
      errors.push({ path: `contributes.taskPaneTabs[${index}].id`, message: 'Required string' })
    }

    if (!isString(tab.title) || !tab.title) {
      errors.push({ path: `contributes.taskPaneTabs[${index}].title`, message: 'Required string' })
    }

    if (tab.icon !== undefined) {
      if (!isString(tab.icon) || !tab.icon) {
        errors.push({ path: `contributes.taskPaneTabs[${index}].icon`, message: 'Must be a string' })
      } else if (!ALLOWED_ICON_KEYS.has(tab.icon)) {
        errors.push({ path: `contributes.taskPaneTabs[${index}].icon`, message: `Icon key "${tab.icon}" not allowed` })
      }
    }

    if (tab.order !== undefined && !isNumber(tab.order)) {
      errors.push({ path: `contributes.taskPaneTabs[${index}].order`, message: 'Must be a number' })
    }
  })

  return errors
}

function validateBackgroundServices(backgroundServices: unknown): ValidationError[] {
  const errors: ValidationError[] = []

  if (!isArray(backgroundServices)) {
    errors.push({ path: 'contributes.backgroundServices', message: 'Must be an array' })
    return errors
  }

  backgroundServices.forEach((service, index) => {
    if (!isObject(service)) {
      errors.push({ path: `contributes.backgroundServices[${index}]`, message: 'Must be an object' })
      return
    }

    if (!isString(service.id) || !service.id) {
      errors.push({ path: `contributes.backgroundServices[${index}].id`, message: 'Required string' })
    }

    if (!isString(service.name) || !service.name) {
      errors.push({ path: `contributes.backgroundServices[${index}].name`, message: 'Required string' })
    }
  })

  return errors
}

function validateSidebarPanelContributions(sidebarPanels: unknown): ValidationError[] {
  const errors: ValidationError[] = []

  if (!isArray(sidebarPanels)) {
    errors.push({ path: 'contributes.sidebarPanels', message: 'Must be an array' })
    return errors
  }

  sidebarPanels.forEach((panel, index) => {
    if (!isObject(panel)) {
      errors.push({ path: `contributes.sidebarPanels[${index}]`, message: 'Must be an object' })
      return
    }

    if (!isString(panel.id) || !panel.id) {
      errors.push({ path: `contributes.sidebarPanels[${index}].id`, message: 'Required string' })
    }

    if (!isString(panel.title) || !panel.title) {
      errors.push({ path: `contributes.sidebarPanels[${index}].title`, message: 'Required string' })
    }

    if (panel.side !== 'left' && panel.side !== 'right') {
      errors.push({ path: `contributes.sidebarPanels[${index}].side`, message: 'Must be "left" or "right"' })
    }

    if (panel.order !== undefined && !isNumber(panel.order)) {
      errors.push({ path: `contributes.sidebarPanels[${index}].order`, message: 'Must be a number' })
    }
  })

  return errors
}

function validateCommandContributions(commands: unknown): ValidationError[] {
  const errors: ValidationError[] = []

  if (!isArray(commands)) {
    errors.push({ path: 'contributes.commands', message: 'Must be an array' })
    return errors
  }

  commands.forEach((command, index) => {
    if (!isObject(command)) {
      errors.push({ path: `contributes.commands[${index}]`, message: 'Must be an object' })
      return
    }

    if (!isString(command.id) || !command.id) {
      errors.push({ path: `contributes.commands[${index}].id`, message: 'Required string' })
    }

    if (!isString(command.title) || !command.title) {
      errors.push({ path: `contributes.commands[${index}].title`, message: 'Required string' })
    }

    if (command.shortcut !== undefined) {
      if (!isString(command.shortcut)) {
        errors.push({ path: `contributes.commands[${index}].shortcut`, message: 'Must be a string' })
      } else if (!isValidShortcutFormat(command.shortcut)) {
        errors.push({ path: `contributes.commands[${index}].shortcut`, message: 'Invalid shortcut format' })
      }
    }
  })

  return errors
}

function validateSettingsSectionContributions(settingsSections: unknown): ValidationError[] {
  const errors: ValidationError[] = []

  if (!isArray(settingsSections)) {
    errors.push({ path: 'contributes.settingsSections', message: 'Must be an array' })
    return errors
  }

  settingsSections.forEach((section, index) => {
    if (!isObject(section)) {
      errors.push({ path: `contributes.settingsSections[${index}]`, message: 'Must be an object' })
      return
    }

    if (!isString(section.id) || !section.id) {
      errors.push({ path: `contributes.settingsSections[${index}].id`, message: 'Required string' })
    }

    if (!isString(section.title) || !section.title) {
      errors.push({ path: `contributes.settingsSections[${index}].title`, message: 'Required string' })
    }
  })

  return errors
}

function validateContributionPoints(contributes: unknown): ValidationError[] {
  const errors: ValidationError[] = []

  if (!isObject(contributes)) {
    errors.push({ path: 'contributes', message: 'Must be an object' })
    return errors
  }

  if (contributes.views !== undefined) {
    errors.push(...validateViewContributions(contributes.views))
  }

  if (contributes.taskPaneTabs !== undefined) {
    errors.push(...validateTaskPaneTabContributions(contributes.taskPaneTabs))
  }

  if (contributes.sidebarPanels !== undefined) {
    errors.push(...validateSidebarPanelContributions(contributes.sidebarPanels))
  }

  if (contributes.commands !== undefined) {
    errors.push(...validateCommandContributions(contributes.commands))
  }

  if (contributes.settingsSections !== undefined) {
    errors.push(...validateSettingsSectionContributions(contributes.settingsSections))
  }

  if (contributes.backgroundServices !== undefined) {
    errors.push(...validateBackgroundServices(contributes.backgroundServices))
  }

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
