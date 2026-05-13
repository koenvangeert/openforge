import type { Component } from 'svelte'

export const OPENFORGE_PLUGIN_API_VERSION = 1
export const MIN_SUPPORTED_API_VERSION = 1
export const MAX_SUPPORTED_API_VERSION = 1
export const SUPPORTED_OPENFORGE_API_VERSIONS = [OPENFORGE_PLUGIN_API_VERSION] as const

export type SupportedOpenForgeApiVersion = typeof SUPPORTED_OPENFORGE_API_VERSIONS[number]

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export interface JsonObject {
  [key: string]: JsonValue
}

export type JsonSchema = Record<string, unknown>
export type MaybePromise<T> = T | Promise<T>

export interface ValidationError {
  path: string
  message: string
}

export type OpenForgePluginCapability =
  | 'commands'
  | 'events'
  | 'views'
  | 'taskPane'
  | 'settings'
  | 'background'
  | 'backend'
  | 'storage'
  | 'context'
  | 'tasks'
  | 'projects'
  | 'fs'
  | 'shell'
  | 'notifications'
  | 'attention'
  | 'system.openUrl'
  | 'config'
  | 'projectConfig'

export interface OpenForgePackageMetadata {
  id: string
  apiVersion: SupportedOpenForgeApiVersion
  displayName: string
  description: string
  icon?: string
  frontend?: string
  backend?: string
  requires?: OpenForgePluginCapability[]
}

export interface OpenForgePluginPackageJson {
  name: string
  version: string
  peerDependencies?: Record<string, string>
  openforge: OpenForgePackageMetadata
}

export type PluginState = 'installed' | 'active' | 'error' | 'disabled'

export interface PluginEntry {
  metadata: OpenForgePackageMetadata
  state: PluginState
  error: string | null
  installPath?: string
  isBuiltin?: boolean
}

export interface Disposable {
  dispose(): void | Promise<void>
}

export interface SubscriptionSink {
  add(subscription: Disposable | (() => void)): void
}

export interface OpenForgeContextSnapshot {
  pluginId: string
  projectId: string | null
  taskId?: string | null
}

export interface OpenForgePluginContext {
  pluginId: string
  apiVersion: SupportedOpenForgeApiVersion
  packageMetadata: OpenForgePackageMetadata
  subscriptions: SubscriptionSink
}

export type FrontendPluginContext = OpenForgePluginContext
export type BackendPluginContext = OpenForgePluginContext

export interface PluginStorageScope {
  get<T extends JsonValue = JsonValue>(key: string): Promise<T | null>
  set<T extends JsonValue = JsonValue>(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
}

export interface PluginStorage {
  readonly global: PluginStorageScope
  project(projectId: string): PluginStorageScope
  task(taskId: string): PluginStorageScope
}

export interface CommandRegistration<TInput = unknown, TOutput = unknown> {
  id: string
  title: string
  icon?: string
  shortcut?: string
  input?: JsonSchema
  output?: JsonSchema
  handler(input: TInput): MaybePromise<TOutput>
}

export interface CommandRegistry {
  register<TInput = unknown, TOutput = unknown>(registration: CommandRegistration<TInput, TOutput>): Disposable
  invoke<TOutput = unknown>(id: string, payload?: unknown): Promise<TOutput>
  invokeGlobal<TOutput = unknown>(qualifiedId: string, payload?: unknown): Promise<TOutput>
}

export type EventHandler<TPayload = unknown> = (payload: TPayload) => void

export interface EventRegistry {
  on<TPayload = unknown>(event: string, handler: EventHandler<TPayload>): Disposable
  onGlobal<TPayload = unknown>(qualifiedEvent: string, handler: EventHandler<TPayload>): Disposable
  emit<TPayload = unknown>(event: string, payload: TPayload): Promise<void>
  emitGlobal<TPayload = unknown>(qualifiedEvent: string, payload: TPayload): Promise<void>
}

export type PluginComponent<Props extends Record<string, unknown> = Record<string, unknown>> = Component<Props>
export type PluginComponentModule<Props extends Record<string, unknown> = Record<string, unknown>> = { default: PluginComponent<Props> }
export type PluginComponentLoader<Props extends Record<string, unknown> = Record<string, unknown>> = () => MaybePromise<PluginComponent<Props> | PluginComponentModule<Props>>

export interface PluginViewProps extends Record<string, unknown> {
  api: FrontendOpenForgeAPI
  context: OpenForgeContextSnapshot
}

export interface PluginTaskPaneProps extends Record<string, unknown> {
  api: FrontendOpenForgeAPI
  context: OpenForgeContextSnapshot
  taskId: string
  projectId: string | null
}

export interface PluginSettingsSectionProps extends Record<string, unknown> {
  api: FrontendOpenForgeAPI
  context: OpenForgeContextSnapshot
}

export interface PluginViewRegistration {
  id: string
  title: string
  icon: string
  placement: 'rail'
  order?: number
  component: PluginComponentLoader<PluginViewProps> | PluginComponent<PluginViewProps>
}

export interface PluginTaskPaneTabRegistration {
  id: string
  title: string
  icon?: string
  order?: number
  component: PluginComponentLoader<PluginTaskPaneProps> | PluginComponent<PluginTaskPaneProps>
}

export interface PluginSettingsSectionRegistration {
  id: string
  title: string
  order?: number
  component: PluginComponentLoader<PluginSettingsSectionProps> | PluginComponent<PluginSettingsSectionProps>
}

export interface FrontendViewRegistry {
  register(registration: PluginViewRegistration): Disposable
}

export interface FrontendTaskPaneRegistry {
  registerTab(registration: PluginTaskPaneTabRegistration): Disposable
}

export interface FrontendSettingsRegistry {
  registerSection(registration: PluginSettingsSectionRegistration): Disposable
}

export type BackendReadyState = 'missing' | 'starting' | 'ready' | 'error'

export interface FrontendBackendBridge {
  readonly state: BackendReadyState
  whenReady(): Promise<void>
  onReady(handler: () => void): Disposable
  invoke<TOutput = unknown>(method: string, payload?: unknown): Promise<TOutput>
}

export interface BackendMethodRegistration<TInput = unknown, TOutput = unknown> {
  input?: JsonSchema
  output?: JsonSchema
  handler(input: TInput): MaybePromise<TOutput>
}

export interface BackendMethodRegistry {
  registerMethod<TInput = unknown, TOutput = unknown>(method: string, registration: BackendMethodRegistration<TInput, TOutput>): Disposable
}

export interface BackgroundServiceRegistration {
  id: string
  scope: 'global' | 'project' | 'task'
  start(): MaybePromise<void>
  stop?(): MaybePromise<void>
}

export interface BackgroundServiceRegistry {
  register(registration: BackgroundServiceRegistration): Disposable
}

export interface ProjectScopedFileRequest {
  projectId: string
  path: string
}

export interface FileSystemAPI {
  readFile(request: ProjectScopedFileRequest): Promise<string>
  writeFile(request: ProjectScopedFileRequest & { content: string }): Promise<void>
}

export interface SystemAPI {
  openUrl(url: string): Promise<void>
}

export interface KeyValueConfigAPI {
  get<T extends JsonValue = JsonValue>(key: string): Promise<T | null>
  set<T extends JsonValue = JsonValue>(key: string, value: T): Promise<void>
}

export interface OpenForgeCommonAPI {
  commands: CommandRegistry
  events: EventRegistry
  storage: PluginStorage
  context: {
    getSnapshot(): OpenForgeContextSnapshot
  }
  tasks: Record<string, unknown>
  projects: Record<string, unknown>
  fs: FileSystemAPI
  shell: Record<string, unknown>
  notifications: Record<string, unknown>
  attention: Record<string, unknown>
  system: SystemAPI
  config: KeyValueConfigAPI
  projectConfig: KeyValueConfigAPI
}

export interface FrontendOpenForgeAPI extends OpenForgeCommonAPI {
  views: FrontendViewRegistry
  taskPane: FrontendTaskPaneRegistry
  settings: FrontendSettingsRegistry
  backend: FrontendBackendBridge
}

export interface BackendOpenForgeAPI extends OpenForgeCommonAPI {
  backend: BackendMethodRegistry
  background: BackgroundServiceRegistry
}

export interface FrontendPlugin {
  activate(openforge: FrontendOpenForgeAPI, context: FrontendPluginContext): MaybePromise<void>
}

export interface BackendPlugin {
  activate(openforge: BackendOpenForgeAPI, context: BackendPluginContext): MaybePromise<void>
}

export type PluginViewKey = `plugin:${string}:${string}`

export function makePluginViewKey(pluginId: string, viewId: string): PluginViewKey {
  return `plugin:${pluginId}:${viewId}`
}

export function isPluginViewKey(value: string): value is PluginViewKey {
  return value.startsWith('plugin:') && value.match(/^plugin:[^:]+:[^:]+$/) !== null
}

export function parsePluginViewKey(key: PluginViewKey): { pluginId: string; viewId: string } {
  const parts = key.split(':')
  return { pluginId: parts[1], viewId: parts[2] }
}
