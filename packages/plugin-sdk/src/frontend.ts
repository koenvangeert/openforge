import type {
  Disposable,
  FrontendBackendBridge,
  FrontendOpenForgeAPI,
  FrontendPlugin,
  FrontendPluginContext,
  FrontendSettingsRegistry,
  FrontendTaskPaneRegistry,
  FrontendViewRegistry,
  OpenForgeContextSnapshot,
  PluginSettingsSectionProps,
  PluginSettingsSectionRegistration,
  PluginTaskPaneProps,
  PluginTaskPaneTabRegistration,
  PluginViewProps,
  PluginViewRegistration,
} from './types'

export function defineFrontendPlugin<const TPlugin extends FrontendPlugin>(plugin: TPlugin): TPlugin {
  return plugin
}

export type {
  Disposable,
  FrontendBackendBridge,
  FrontendOpenForgeAPI,
  FrontendPlugin,
  FrontendPluginContext,
  FrontendSettingsRegistry,
  FrontendTaskPaneRegistry,
  FrontendViewRegistry,
  OpenForgeContextSnapshot,
  PluginSettingsSectionProps,
  PluginSettingsSectionRegistration,
  PluginTaskPaneProps,
  PluginTaskPaneTabRegistration,
  PluginViewProps,
  PluginViewRegistration,
}
