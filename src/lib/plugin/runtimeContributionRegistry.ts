import type {
  Disposable,
  FrontendOpenForgeAPI,
  FrontendPlugin,
  FrontendPluginContext,
  PluginSettingsSectionRegistration,
  PluginTaskPaneTabRegistration,
  PluginViewRegistration,
} from '@openforge/plugin-sdk/frontend'
import type {
  BackendMethodRegistration,
  BackendOpenForgeAPI,
  BackendPlugin,
  BackendPluginContext,
  BackgroundServiceRegistration,
} from '@openforge/plugin-sdk/backend'
import type {
  OpenForgeContextSnapshot,
  OpenForgePackageMetadata,
  PluginStorage,
  SubscriptionSink,
} from '@openforge/plugin-sdk'

type MaybePromise<T> = T | Promise<T>
type RuntimeKind = 'commands' | 'events' | 'views' | 'taskPane' | 'settings' | 'background' | 'backend'
type RuntimeScope = 'global' | 'project' | 'task'
type RuntimeHandler = (payload?: unknown) => MaybePromise<unknown>
type RuntimeEventHandler = (payload: unknown) => void

type RuntimeOptions = {
  pluginId: string
  projectId: string | null
  packageMetadata?: OpenForgePackageMetadata
}

type RuntimeContributionBase = {
  id: string
  qualifiedId: string
  pluginId: string
  projectId: string | null
}

export type RuntimeCommandContribution = RuntimeContributionBase & {
  title: string
  icon?: string
  shortcut?: string
  handler: RuntimeHandler
}

export type RuntimeEventListenerContribution = RuntimeContributionBase & {
  handler: RuntimeEventHandler
  global: boolean
}

export type RuntimeViewContribution = RuntimeContributionBase & PluginViewRegistration
export type RuntimeTaskPaneTabContribution = RuntimeContributionBase & PluginTaskPaneTabRegistration
export type RuntimeSettingsSectionContribution = RuntimeContributionBase & PluginSettingsSectionRegistration

export type RuntimeBackgroundServiceContribution = RuntimeContributionBase & BackgroundServiceRegistration & {
  started: boolean
}

export type RuntimeBackendMethodContribution = RuntimeContributionBase & {
  registration: BackendMethodRegistration
}

export type RuntimeContributionSnapshot = {
  pluginId: string
  projectId: string | null
  views: RuntimeViewContribution[]
  taskPaneTabs: RuntimeTaskPaneTabContribution[]
  settingsSections: RuntimeSettingsSectionContribution[]
  commands: RuntimeCommandContribution[]
  eventListeners: RuntimeEventListenerContribution[]
  backendMethods: RuntimeBackendMethodContribution[]
  backgroundServices: RuntimeBackgroundServiceContribution[]
}

class RuntimeValidationError extends Error {
  constructor(kind: RuntimeKind, message: string) {
    super(`${kind} registration ${message}`)
    this.name = 'RuntimeValidationError'
  }
}

class RuntimeSubscriptionSink implements SubscriptionSink {
  readonly subscriptions: Disposable[] = []

  add(subscription: Disposable | (() => void)): void {
    if (typeof subscription === 'function') {
      this.subscriptions.push({ dispose: subscription })
      return
    }

    if (!subscription || typeof subscription.dispose !== 'function') {
      throw new Error('context.subscriptions.add requires a disposable or cleanup function')
    }

    this.subscriptions.push(subscription)
  }

  async disposeAll(): Promise<void> {
    const subscriptions = this.subscriptions.splice(0).reverse()
    for (const subscription of subscriptions) {
      await subscription.dispose()
    }
  }
}

export function qualifyLocalContributionId(pluginId: string, localId: string): string {
  return `${pluginId}.${localId}`
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isFunction(value: unknown): value is (...args: never[]) => unknown {
  return typeof value === 'function'
}

function assertLocalId(kind: RuntimeKind, id: unknown): asserts id is string {
  if (!isNonEmptyString(id)) {
    throw new RuntimeValidationError(kind, 'requires a non-empty id')
  }

  const trimmed = id.trim()
  if (trimmed.startsWith('openforge.')) {
    throw new RuntimeValidationError(kind, 'cannot use openforge.* reserved namespace')
  }

  if (trimmed.includes(':') || trimmed.startsWith('.') || trimmed.endsWith('.') || trimmed.includes('..')) {
    throw new RuntimeValidationError(kind, `has invalid id "${trimmed}"`)
  }
}

function assertTitle(kind: RuntimeKind, title: unknown): asserts title is string {
  if (!isNonEmptyString(title)) {
    throw new RuntimeValidationError(kind, 'requires a non-empty title')
  }
}

function assertHandler(kind: RuntimeKind, handler: unknown): asserts handler is RuntimeHandler {
  if (!isFunction(handler)) {
    throw new RuntimeValidationError(kind, 'requires a handler function')
  }
}

function assertComponent(kind: RuntimeKind, component: unknown): void {
  if (!isFunction(component)) {
    throw new RuntimeValidationError(kind, 'requires a component')
  }
}

function assertScope(scope: unknown): asserts scope is RuntimeScope {
  if (scope !== 'global' && scope !== 'project' && scope !== 'task') {
    throw new RuntimeValidationError('background', 'requires scope to be global, project, or task')
  }
}

function createDisposable(dispose: () => MaybePromise<void>): Disposable {
  let disposed = false
  return {
    async dispose() {
      if (disposed) return
      disposed = true
      await dispose()
    },
  }
}

function createMemoryStorageScope() {
  const values = new Map<string, unknown>()
  return {
    async get<T>(key: string): Promise<T | null> {
      return values.has(key) ? values.get(key) as T : null
    },
    async set<T>(key: string, value: T): Promise<void> {
      values.set(key, value)
    },
    async delete(key: string): Promise<void> {
      values.delete(key)
    },
  }
}

function createMemoryStorage(): PluginStorage {
  const global = createMemoryStorageScope()
  const projects = new Map<string, ReturnType<typeof createMemoryStorageScope>>()
  const tasks = new Map<string, ReturnType<typeof createMemoryStorageScope>>()

  return {
    global,
    project(projectId: string) {
      let scope = projects.get(projectId)
      if (!scope) {
        scope = createMemoryStorageScope()
        projects.set(projectId, scope)
      }
      return scope
    },
    task(taskId: string) {
      let scope = tasks.get(taskId)
      if (!scope) {
        scope = createMemoryStorageScope()
        tasks.set(taskId, scope)
      }
      return scope
    },
  }
}

export function createRuntimeContributionRegistry(options: RuntimeOptions) {
  return new RuntimeContributionRegistry(options)
}

export type RuntimeContributionRegistryInstance = ReturnType<typeof createRuntimeContributionRegistry>

class RuntimeContributionRegistry {
  private readonly pluginId: string
  private readonly projectId: string | null
  private readonly packageMetadata: OpenForgePackageMetadata
  private readonly contextSnapshot: OpenForgeContextSnapshot
  private readonly storage = createMemoryStorage()
  private readonly frontendSubscriptions = new RuntimeSubscriptionSink()
  private readonly backendSubscriptions = new RuntimeSubscriptionSink()
  private frontendApi: FrontendOpenForgeAPI | null = null
  private backendApi: BackendOpenForgeAPI | null = null
  private readonly duplicateKeys = new Set<string>()
  private readonly eventHandlers = new Map<string, Set<RuntimeEventHandler>>()
  private readonly globalEventHandlers = new Map<string, Set<RuntimeEventHandler>>()
  private readonly commands = new Map<string, RuntimeCommandContribution>()
  private readonly views = new Map<string, RuntimeViewContribution>()
  private readonly taskPaneTabs = new Map<string, RuntimeTaskPaneTabContribution>()
  private readonly settingsSections = new Map<string, RuntimeSettingsSectionContribution>()
  private readonly eventListeners = new Map<string, RuntimeEventListenerContribution>()
  private readonly backendMethods = new Map<string, RuntimeBackendMethodContribution>()
  private readonly backgroundServices = new Map<string, RuntimeBackgroundServiceContribution>()
  private eventListenerSequence = 0

  constructor(options: RuntimeOptions) {
    assertLocalId('backend', options.pluginId)
    this.pluginId = options.pluginId
    this.projectId = options.projectId
    this.packageMetadata = options.packageMetadata ?? {
      id: options.pluginId,
      apiVersion: 1,
      displayName: options.pluginId,
      description: '',
    }
    this.contextSnapshot = { pluginId: this.pluginId, projectId: this.projectId }
  }

  async activateFrontend(plugin: FrontendPlugin): Promise<void> {
    await plugin.activate(this.getFrontendApi(), this.createFrontendContext())
  }

  async activateBackend(plugin: BackendPlugin): Promise<void> {
    const before = new Set(this.backgroundServices.keys())
    await plugin.activate(this.getBackendApi(), this.createBackendContext())
    await this.startNewBackgroundServices(before)
  }

  async deactivate(): Promise<void> {
    await this.backendSubscriptions.disposeAll()
    await this.frontendSubscriptions.disposeAll()
  }

  getSnapshot(): RuntimeContributionSnapshot {
    return {
      pluginId: this.pluginId,
      projectId: this.projectId,
      views: Array.from(this.views.values()),
      taskPaneTabs: Array.from(this.taskPaneTabs.values()),
      settingsSections: Array.from(this.settingsSections.values()),
      commands: Array.from(this.commands.values()),
      eventListeners: Array.from(this.eventListeners.values()),
      backendMethods: Array.from(this.backendMethods.values()),
      backgroundServices: Array.from(this.backgroundServices.values()),
    }
  }

  getFrontendApi(): FrontendOpenForgeAPI {
    if (this.frontendApi) {
      return this.frontendApi
    }

    this.frontendApi = {
      ...this.createCommonApi(),
      views: {
        register: (registration) => this.registerView(registration),
      },
      taskPane: {
        registerTab: (registration) => this.registerTaskPaneTab(registration),
      },
      settings: {
        registerSection: (registration) => this.registerSettingsSection(registration),
      },
      backend: {
        state: 'ready',
        whenReady: async () => undefined,
        onReady: (handler) => {
          handler()
          return createDisposable(() => undefined)
        },
        invoke: async (method, payload) => this.invokeBackendMethod(method, payload),
      },
    }

    return this.frontendApi
  }

  getBackendApi(): BackendOpenForgeAPI {
    if (this.backendApi) {
      return this.backendApi
    }

    this.backendApi = {
      ...this.createCommonApi(),
      backend: {
        registerMethod: (method, registration) => this.registerBackendMethod(method, registration),
      },
      background: {
        register: (registration) => this.registerBackgroundService(registration),
      },
    }

    return this.backendApi
  }

  getContextSnapshot(): OpenForgeContextSnapshot {
    return { ...this.contextSnapshot }
  }

  createRenderContextSnapshot(projectId: string | null, taskId: string | null): OpenForgeContextSnapshot {
    return {
      ...this.contextSnapshot,
      projectId,
      taskId,
    }
  }

  private createFrontendContext(): FrontendPluginContext {
    return {
      pluginId: this.pluginId,
      apiVersion: 1,
      packageMetadata: this.packageMetadata,
      subscriptions: this.frontendSubscriptions,
    }
  }

  private createBackendContext(): BackendPluginContext {
    return {
      pluginId: this.pluginId,
      apiVersion: 1,
      packageMetadata: this.packageMetadata,
      subscriptions: this.backendSubscriptions,
    }
  }

  private createCommonApi() {
    return {
      commands: {
        register: (registration: Parameters<FrontendOpenForgeAPI['commands']['register']>[0]) => this.registerCommand(registration),
        invoke: async <TOutput>(id: string, payload?: unknown) => this.invokeCommand<TOutput>(id, payload),
        invokeGlobal: async <TOutput>(qualifiedId: string, payload?: unknown) => this.invokeGlobalCommand<TOutput>(qualifiedId, payload),
      },
      events: {
        on: <TPayload>(event: string, handler: (payload: TPayload) => void) => this.registerEventListener(event, handler as RuntimeEventHandler, false),
        onGlobal: <TPayload>(qualifiedEvent: string, handler: (payload: TPayload) => void) => this.registerEventListener(qualifiedEvent, handler as RuntimeEventHandler, true),
        emit: async <TPayload>(event: string, payload: TPayload) => this.emitEvent(this.qualifiedId('events', event), payload),
        emitGlobal: async <TPayload>(qualifiedEvent: string, payload: TPayload) => this.emitEvent(qualifiedEvent, payload),
      },
      storage: this.storage,
      context: {
        getSnapshot: () => this.getContextSnapshot(),
      },
      tasks: {},
      projects: {},
      fs: {
        readFile: async () => '',
        writeFile: async () => undefined,
      },
      shell: {},
      notifications: {},
      attention: {},
      system: {
        openUrl: async () => undefined,
      },
      config: createMemoryStorageScope(),
      projectConfig: createMemoryStorageScope(),
    } satisfies Omit<FrontendOpenForgeAPI, 'views' | 'taskPane' | 'settings' | 'backend'>
  }

  private qualifiedId(kind: RuntimeKind, localId: string): string {
    assertLocalId(kind, localId)
    return qualifyLocalContributionId(this.pluginId, localId.trim())
  }

  private claim(kind: RuntimeKind, qualifiedId: string): void {
    const duplicateNamespace = kind === 'commands' ? 'commands' : `${kind}:${qualifiedId}`
    const key = kind === 'commands' ? `commands:${qualifiedId}` : duplicateNamespace
    if (this.duplicateKeys.has(key)) {
      throw new Error(`Duplicate runtime contribution id: ${qualifiedId}`)
    }
    this.duplicateKeys.add(key)
  }

  private release(kind: RuntimeKind, qualifiedId: string): void {
    const key = kind === 'commands' ? `commands:${qualifiedId}` : `${kind}:${qualifiedId}`
    this.duplicateKeys.delete(key)
  }

  private registerCommand(registration: Parameters<FrontendOpenForgeAPI['commands']['register']>[0]): Disposable {
    const qualifiedId = this.qualifiedId('commands', registration?.id)
    assertTitle('commands', registration?.title)
    assertHandler('commands', registration?.handler)
    this.claim('commands', qualifiedId)

    const contribution: RuntimeCommandContribution = {
      ...registration,
      id: registration.id.trim(),
      title: registration.title.trim(),
      qualifiedId,
      pluginId: this.pluginId,
      projectId: this.projectId,
      handler: registration.handler as RuntimeHandler,
    }
    this.commands.set(qualifiedId, contribution)

    return createDisposable(() => {
      this.commands.delete(qualifiedId)
      this.release('commands', qualifiedId)
    })
  }

  private registerEventListener(event: string, handler: RuntimeEventHandler, global: boolean): Disposable {
    const qualifiedId = global ? event : this.qualifiedId('events', event)
    if (!isNonEmptyString(qualifiedId)) {
      throw new RuntimeValidationError('events', 'requires a non-empty id')
    }
    assertHandler('events', handler)

    const target = global ? this.globalEventHandlers : this.eventHandlers
    const handlers = target.get(qualifiedId) ?? new Set<RuntimeEventHandler>()
    handlers.add(handler)
    target.set(qualifiedId, handlers)

    const contribution: RuntimeEventListenerContribution = {
      id: event,
      qualifiedId,
      pluginId: this.pluginId,
      projectId: this.projectId,
      handler,
      global,
    }
    const listenerKey = `${qualifiedId}#${++this.eventListenerSequence}`
    if (!global) {
      this.eventListeners.set(listenerKey, contribution)
    }

    return createDisposable(() => {
      handlers.delete(handler)
      if (handlers.size === 0) {
        target.delete(qualifiedId)
      }
      if (!global) {
        this.eventListeners.delete(listenerKey)
      }
    })
  }

  private registerView(registration: PluginViewRegistration): Disposable {
    const qualifiedId = this.qualifiedId('views', registration?.id)
    assertTitle('views', registration?.title)
    assertComponent('views', registration?.component)
    this.claim('views', qualifiedId)

    const contribution: RuntimeViewContribution = {
      ...registration,
      id: registration.id.trim(),
      title: registration.title.trim(),
      qualifiedId,
      pluginId: this.pluginId,
      projectId: this.projectId,
    }
    this.views.set(qualifiedId, contribution)

    return createDisposable(() => {
      this.views.delete(qualifiedId)
      this.release('views', qualifiedId)
    })
  }

  private registerTaskPaneTab(registration: PluginTaskPaneTabRegistration): Disposable {
    const qualifiedId = this.qualifiedId('taskPane', registration?.id)
    assertTitle('taskPane', registration?.title)
    assertComponent('taskPane', registration?.component)
    this.claim('taskPane', qualifiedId)

    const contribution: RuntimeTaskPaneTabContribution = {
      ...registration,
      id: registration.id.trim(),
      title: registration.title.trim(),
      qualifiedId,
      pluginId: this.pluginId,
      projectId: this.projectId,
    }
    this.taskPaneTabs.set(qualifiedId, contribution)

    return createDisposable(() => {
      this.taskPaneTabs.delete(qualifiedId)
      this.release('taskPane', qualifiedId)
    })
  }

  private registerSettingsSection(registration: PluginSettingsSectionRegistration): Disposable {
    const qualifiedId = this.qualifiedId('settings', registration?.id)
    assertTitle('settings', registration?.title)
    assertComponent('settings', registration?.component)
    this.claim('settings', qualifiedId)

    const contribution: RuntimeSettingsSectionContribution = {
      ...registration,
      id: registration.id.trim(),
      title: registration.title.trim(),
      qualifiedId,
      pluginId: this.pluginId,
      projectId: this.projectId,
    }
    this.settingsSections.set(qualifiedId, contribution)

    return createDisposable(() => {
      this.settingsSections.delete(qualifiedId)
      this.release('settings', qualifiedId)
    })
  }

  private registerBackendMethod(method: string, registration: BackendMethodRegistration): Disposable {
    const qualifiedId = this.qualifiedId('backend', method)
    assertHandler('backend', registration?.handler)
    this.claim('backend', qualifiedId)

    const contribution: RuntimeBackendMethodContribution = {
      id: method.trim(),
      qualifiedId,
      pluginId: this.pluginId,
      projectId: this.projectId,
      registration,
    }
    this.backendMethods.set(qualifiedId, contribution)

    return createDisposable(() => {
      this.backendMethods.delete(qualifiedId)
      this.release('backend', qualifiedId)
    })
  }

  private registerBackgroundService(registration: BackgroundServiceRegistration): Disposable {
    const qualifiedId = this.qualifiedId('background', registration?.id)
    assertScope(registration?.scope)
    if (!isFunction(registration?.start)) {
      throw new RuntimeValidationError('background', 'requires a start function')
    }
    this.claim('background', qualifiedId)

    const contribution: RuntimeBackgroundServiceContribution = {
      ...registration,
      id: registration.id.trim(),
      qualifiedId,
      pluginId: this.pluginId,
      projectId: this.projectId,
      started: false,
    }
    this.backgroundServices.set(qualifiedId, contribution)

    return createDisposable(async () => {
      this.backgroundServices.delete(qualifiedId)
      this.release('background', qualifiedId)
      if (contribution.started) {
        await contribution.stop?.()
        contribution.started = false
      }
    })
  }

  private async startNewBackgroundServices(previousKeys: Set<string>): Promise<void> {
    for (const [key, service] of this.backgroundServices.entries()) {
      if (previousKeys.has(key) || service.started) continue
      await service.start()
      service.started = true
    }
  }

  private async invokeCommand<TOutput>(id: string, payload?: unknown): Promise<TOutput> {
    const qualifiedId = this.qualifiedId('commands', id)
    return this.invokeGlobalCommand<TOutput>(qualifiedId, payload)
  }

  private async invokeGlobalCommand<TOutput>(qualifiedId: string, payload?: unknown): Promise<TOutput> {
    const command = this.commands.get(qualifiedId)
    if (!command) {
      throw new Error(`Unknown command: ${qualifiedId}`)
    }
    return await command.handler(payload) as TOutput
  }

  private async invokeBackendMethod<TOutput>(method: string, payload?: unknown): Promise<TOutput> {
    const qualifiedId = this.qualifiedId('backend', method)
    const contribution = this.backendMethods.get(qualifiedId)
    if (!contribution) {
      throw new Error(`Backend method is not registered: ${qualifiedId}`)
    }
    return await contribution.registration.handler(payload) as TOutput
  }

  private async emitEvent<TPayload>(qualifiedEvent: string, payload: TPayload): Promise<void> {
    const handlers = [
      ...Array.from(this.eventHandlers.get(qualifiedEvent) ?? []),
      ...Array.from(this.globalEventHandlers.get(qualifiedEvent) ?? []),
    ]
    for (const handler of handlers) {
      handler(payload)
    }
  }
}
