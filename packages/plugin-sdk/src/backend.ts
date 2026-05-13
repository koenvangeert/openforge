import type {
  BackendMethodRegistration,
  BackendMethodRegistry,
  BackendOpenForgeAPI,
  BackendPlugin,
  BackendPluginContext,
  BackgroundServiceRegistration,
  BackgroundServiceRegistry,
  Disposable,
  OpenForgeContextSnapshot,
} from './types'

export function defineBackendPlugin<const TPlugin extends BackendPlugin>(plugin: TPlugin): TPlugin {
  return plugin
}

export type {
  BackendMethodRegistration,
  BackendMethodRegistry,
  BackendOpenForgeAPI,
  BackendPlugin,
  BackendPluginContext,
  BackgroundServiceRegistration,
  BackgroundServiceRegistry,
  Disposable,
  OpenForgeContextSnapshot,
}
