export const MAX_SUPPORTED_API_VERSION = 1;

export function makePluginViewKey(pluginId, viewId) {
  return `plugin:${pluginId}:${viewId}`;
}

export function isPluginViewKey(value) {
  return typeof value === 'string' && value.startsWith('plugin:') && /^plugin:[^:]+:[^:]+$/.test(value);
}

export function parsePluginViewKey(key) {
  const parts = key.split(':');
  return { pluginId: parts[1], viewId: parts[2] };
}

export const ALLOWED_ICON_KEYS = new Set([
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
]);

export function isValidShortcutFormat(shortcut) {
  return /^(?:(?:Cmd|Ctrl|Alt|Shift)\+)*(?:[a-zA-Z0-9]|F\d{1,2}|Space|Enter|Tab|Backspace|Escape)$/.test(shortcut);
}

export function normalizeShortcut(shortcut) {
  let result = '';
  const parts = shortcut.split('+');
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);

  if (modifiers.includes('Cmd')) result += '⌘';
  if (modifiers.includes('Ctrl')) result += '⌃';
  if (modifiers.includes('Alt')) result += '⌥';
  if (modifiers.includes('Shift')) result += '⇧';

  return result + key.toLowerCase();
}

function isString(value) {
  return typeof value === 'string';
}

function isNumber(value) {
  return typeof value === 'number';
}

function isArray(value) {
  return Array.isArray(value);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateViewContributions(views) {
  const errors = [];
  if (!isArray(views)) {
    errors.push({ path: 'contributes.views', message: 'Must be an array' });
    return errors;
  }

  views.forEach((view, index) => {
    if (!isObject(view)) {
      errors.push({ path: `contributes.views[${index}]`, message: 'Must be an object' });
      return;
    }
    if (!isString(view.id) || !view.id) {
      errors.push({ path: `contributes.views[${index}].id`, message: 'Required string' });
    }
    if (!isString(view.title) || !view.title) {
      errors.push({ path: `contributes.views[${index}].title`, message: 'Required string' });
    }
    if (!isString(view.icon) || !view.icon) {
      errors.push({ path: `contributes.views[${index}].icon`, message: 'Required string' });
    } else if (!ALLOWED_ICON_KEYS.has(view.icon)) {
      errors.push({ path: `contributes.views[${index}].icon`, message: `Icon key "${view.icon}" not allowed` });
    }
    if (view.shortcut !== undefined) {
      if (!isString(view.shortcut)) {
        errors.push({ path: `contributes.views[${index}].shortcut`, message: 'Must be a string' });
      } else if (!isValidShortcutFormat(view.shortcut)) {
        errors.push({ path: `contributes.views[${index}].shortcut`, message: 'Invalid shortcut format' });
      }
    }
  });

  return errors;
}

function validateTaskPaneTabContributions(taskPaneTabs) {
  const errors = [];
  if (!isArray(taskPaneTabs)) {
    errors.push({ path: 'contributes.taskPaneTabs', message: 'Must be an array' });
    return errors;
  }

  taskPaneTabs.forEach((tab, index) => {
    if (!isObject(tab)) {
      errors.push({ path: `contributes.taskPaneTabs[${index}]`, message: 'Must be an object' });
      return;
    }
    if (!isString(tab.id) || !tab.id) {
      errors.push({ path: `contributes.taskPaneTabs[${index}].id`, message: 'Required string' });
    }
    if (!isString(tab.title) || !tab.title) {
      errors.push({ path: `contributes.taskPaneTabs[${index}].title`, message: 'Required string' });
    }
    if (tab.icon !== undefined) {
      if (!isString(tab.icon) || !tab.icon) {
        errors.push({ path: `contributes.taskPaneTabs[${index}].icon`, message: 'Must be a string' });
      } else if (!ALLOWED_ICON_KEYS.has(tab.icon)) {
        errors.push({ path: `contributes.taskPaneTabs[${index}].icon`, message: `Icon key "${tab.icon}" not allowed` });
      }
    }
    if (tab.order !== undefined && !isNumber(tab.order)) {
      errors.push({ path: `contributes.taskPaneTabs[${index}].order`, message: 'Must be a number' });
    }
  });

  return errors;
}

function validateBackgroundServices(backgroundServices) {
  const errors = [];
  if (!isArray(backgroundServices)) {
    errors.push({ path: 'contributes.backgroundServices', message: 'Must be an array' });
    return errors;
  }

  backgroundServices.forEach((service, index) => {
    if (!isObject(service)) {
      errors.push({ path: `contributes.backgroundServices[${index}]`, message: 'Must be an object' });
      return;
    }
    if (!isString(service.id) || !service.id) {
      errors.push({ path: `contributes.backgroundServices[${index}].id`, message: 'Required string' });
    }
    if (!isString(service.name) || !service.name) {
      errors.push({ path: `contributes.backgroundServices[${index}].name`, message: 'Required string' });
    }
  });

  return errors;
}

function validateContributionPoints(contributes) {
  const errors = [];
  if (!isObject(contributes)) {
    errors.push({ path: 'contributes', message: 'Must be an object' });
    return errors;
  }
  if (contributes.views !== undefined) errors.push(...validateViewContributions(contributes.views));
  if (contributes.taskPaneTabs !== undefined) errors.push(...validateTaskPaneTabContributions(contributes.taskPaneTabs));
  if (contributes.backgroundServices !== undefined) errors.push(...validateBackgroundServices(contributes.backgroundServices));
  return errors;
}

export function validatePluginManifest(data) {
  const errors = [];
  if (!isObject(data)) {
    errors.push({ path: '', message: 'Manifest must be an object' });
    return errors;
  }
  if (!isString(data.id) || !data.id) errors.push({ path: 'id', message: 'Required string' });
  if (!isString(data.name) || !data.name) errors.push({ path: 'name', message: 'Required string' });
  if (!isString(data.version) || !data.version) errors.push({ path: 'version', message: 'Required string' });
  if (!isNumber(data.apiVersion)) {
    errors.push({ path: 'apiVersion', message: 'Required number' });
  } else if (data.apiVersion > MAX_SUPPORTED_API_VERSION) {
    errors.push({ path: 'apiVersion', message: `API version ${data.apiVersion} not supported (max: ${MAX_SUPPORTED_API_VERSION})` });
  }
  if (!isString(data.description) || !data.description) errors.push({ path: 'description', message: 'Required string' });
  if (data.permissions !== undefined && !isArray(data.permissions)) errors.push({ path: 'permissions', message: 'Must be an array' });
  if (data.contributes !== undefined) errors.push(...validateContributionPoints(data.contributes));
  if (data.frontend === undefined) {
    errors.push({ path: 'frontend', message: 'Required string or null' });
  } else if (data.frontend !== null && (!isString(data.frontend) || !data.frontend)) {
    errors.push({ path: 'frontend', message: 'Must be a non-empty string or null' });
  }
  if (data.backend !== undefined && data.backend !== null && !isString(data.backend)) {
    errors.push({ path: 'backend', message: 'Must be a string or null' });
  }
  return errors;
}

export function isPluginManifest(data) {
  return validatePluginManifest(data).length === 0;
}

export class PluginContextImpl {
  constructor(opts) {
    this.pluginId = opts.pluginId;
    this.invokeHostFn = opts.invokeHost;
    this.invokeBackendFn = opts.invokeBackend;
    this.onEventFn = opts.onEvent;
    this.storage = {
      get: (key) => opts.storageGet(key),
      set: (key, value) => opts.storageSet(key, value),
    };
  }

  async invokeHost(command, payload) {
    return this.invokeHostFn(command, payload);
  }

  async invokeBackend(method, payload) {
    return this.invokeBackendFn(method, payload);
  }

  onEvent(event, handler) {
    return this.onEventFn(event, handler);
  }
}

export function isPluginViewContribution(contribution) {
  return typeof contribution === 'object' && contribution !== null
    && 'id' in contribution && 'title' in contribution && 'icon' in contribution;
}

export function isPluginCommandContribution(contribution) {
  return typeof contribution === 'object' && contribution !== null
    && 'id' in contribution && 'title' in contribution;
}

export function getViewContributions(contributes) {
  return contributes?.views ?? [];
}

export function getCommandContributions(contributes) {
  return contributes?.commands ?? [];
}
