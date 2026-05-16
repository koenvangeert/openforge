import type {
  BackendMethodRegistration,
  BackendOpenForgeAPI,
  BackendPlugin,
  BackendPluginContext,
  BackgroundServiceRegistration,
  CommandDescriptor,
  CommandRegistration,
  CommandShortcutMetadata,
  Disposable,
  FrontendOpenForgeAPI,
  FrontendPlugin,
  FrontendPluginContext,
  JsonValue,
  NotificationRequest,
  OpenForgeContextSnapshot,
  OpenForgePackageMetadata,
  PluginSettingsSectionRegistration,
  PluginStorage,
  PluginStorageScope,
  PluginTaskPaneTabRegistration,
  PluginViewRegistration,
  SubscriptionSink,
} from './types'

export type TestingRuntimeScope = 'global' | 'project' | 'task'
export type TestingRuntimeKind = 'commands' | 'events' | 'views' | 'taskPane' | 'settings' | 'backend' | 'background'

type MaybePromise<T> = T | Promise<T>
type CommandHandler = (payload?: unknown) => MaybePromise<unknown>
type EventHandler = (payload: unknown) => void

export interface TestingOpenForgeApiOptions {
  pluginId?: string
  projectId?: string | null
  taskId?: string | null
  packageMetadata?: OpenForgePackageMetadata
  storage?: PluginStorage
}

export interface TestingOpenForgeApiCalls {
  commandInvocations: Array<{ id: string; qualifiedId: string; payload: unknown }>
  globalCommandInvocations: Array<{ qualifiedId: string; payload: unknown }>
  backendInvocations: Array<{ method: string; qualifiedId: string; payload: unknown }>
  emittedEvents: Array<{ event: string; qualifiedEvent: string; payload: unknown }>
  emittedGlobalEvents: Array<{ qualifiedEvent: string; payload: unknown }>
  openUrl: string[]
  notify: NotificationRequest[]
  taskSummaryUpdates: Array<{ taskId: string; summary: string }>
  taskStatusUpdates: Array<{ taskId: string; status: string }>
  configWrites: Array<{ key: string; value: JsonValue; projectId: string | null }>
  fsWrites: Array<{ projectId: string; path: string; content: string }>
  shellSpawns: Array<{ taskId: string; cwd: string; cols: number; rows: number; terminalIndex: number }>
  shellWrites: Array<{ taskId: string; data: string }>
  shellResizes: Array<{ taskId: string; cols: number; rows: number }>
  shellKills: Array<{ taskId: string }>
  storageGets: Array<{ scope: TestingRuntimeScope; scopeId: string | null; key: string }>
  storageSets: Array<{ scope: TestingRuntimeScope; scopeId: string | null; key: string; value: JsonValue }>
  storageDeletes: Array<{ scope: TestingRuntimeScope; scopeId: string | null; key: string }>
}

export interface TestingContributionBase {
  id: string
  qualifiedId: string
  pluginId: string
  projectId: string | null
}

export type TestingCommandContribution = TestingContributionBase & CommandRegistration & {
  title: string
  icon?: string
  shortcut?: CommandShortcutMetadata
  handler: CommandHandler
}

export type TestingEventListenerContribution = TestingContributionBase & {
  handler: EventHandler
  global: boolean
}

export type TestingViewContribution = TestingContributionBase & PluginViewRegistration
export type TestingTaskPaneTabContribution = TestingContributionBase & PluginTaskPaneTabRegistration
export type TestingSettingsSectionContribution = TestingContributionBase & PluginSettingsSectionRegistration
export type TestingBackendMethodContribution = TestingContributionBase & {
  registration: BackendMethodRegistration
}
export type TestingBackgroundServiceContribution = TestingContributionBase & BackgroundServiceRegistration & {
  started: boolean
}

export interface TestingOpenForgeRegistrySnapshot {
  pluginId: string
  projectId: string | null
  views: TestingViewContribution[]
  taskPaneTabs: TestingTaskPaneTabContribution[]
  settingsSections: TestingSettingsSectionContribution[]
  commands: TestingCommandContribution[]
  eventListeners: TestingEventListenerContribution[]
  backendMethods: TestingBackendMethodContribution[]
  backgroundServices: TestingBackgroundServiceContribution[]
}

export type MockFrontendOpenForgeAPI = FrontendOpenForgeAPI & {
  readonly __testing: {
    readonly calls: TestingOpenForgeApiCalls
    readonly registry: TestingOpenForgeRegistryFake
  }
}

export type MockBackendOpenForgeAPI = BackendOpenForgeAPI & {
  readonly __testing: {
    readonly calls: TestingOpenForgeApiCalls
    readonly registry: TestingOpenForgeRegistryFake
  }
}

export class TestingSubscriptionSink implements SubscriptionSink {
  readonly subscriptions: Disposable[] = []

  add(subscription: Disposable | (() => void)): void {
    if (typeof subscription === 'function') {
      this.subscriptions.push(createDisposable(subscription))
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

export class TestingOpenForgeRegistryFake {
  readonly pluginId: string
  readonly projectId: string | null
  readonly taskId: string | null
  readonly packageMetadata: OpenForgePackageMetadata
  readonly calls: TestingOpenForgeApiCalls
  readonly storage: PluginStorage
  readonly frontendSubscriptions = new TestingSubscriptionSink()
  readonly backendSubscriptions = new TestingSubscriptionSink()

  private readonly commands = new Map<string, TestingCommandContribution>()
  private readonly views = new Map<string, TestingViewContribution>()
  private readonly taskPaneTabs = new Map<string, TestingTaskPaneTabContribution>()
  private readonly settingsSections = new Map<string, TestingSettingsSectionContribution>()
  private readonly eventListeners = new Map<string, TestingEventListenerContribution>()
  private readonly eventHandlers = new Map<string, Set<EventHandler>>()
  private readonly backendMethods = new Map<string, TestingBackendMethodContribution>()
  private readonly backgroundServices = new Map<string, TestingBackgroundServiceContribution>()
  private readonly claimedIds = new Set<string>()
  private readonly config = new Map<string, JsonValue>()
  private eventListenerSequence = 0
  private cachedFrontendApi: MockFrontendOpenForgeAPI | null = null
  private cachedBackendApi: MockBackendOpenForgeAPI | null = null

  constructor(options: TestingOpenForgeApiOptions = {}) {
    this.pluginId = options.pluginId ?? 'test-plugin'
    this.projectId = options.projectId ?? null
    this.taskId = options.taskId ?? null
    this.packageMetadata = options.packageMetadata ?? {
      id: this.pluginId,
      apiVersion: 1,
      displayName: this.pluginId,
      description: '',
    }
    this.calls = createTestingCalls()
    this.storage = options.storage ?? createMemoryPluginStorage(this.calls)
  }

  get frontendApi(): MockFrontendOpenForgeAPI {
    return this.createFrontendApi()
  }

  get backendApi(): MockBackendOpenForgeAPI {
    return this.createBackendApi()
  }

  get snapshot(): TestingOpenForgeRegistrySnapshot {
    return this.getSnapshot()
  }

  createFrontendApi(): MockFrontendOpenForgeAPI {
    if (this.cachedFrontendApi) return this.cachedFrontendApi

    const api = {
      ...this.createCommonApi(),
      views: {
        register: (registration: PluginViewRegistration) => this.registerView(registration),
      },
      taskPane: {
        registerTab: (registration: PluginTaskPaneTabRegistration) => this.registerTaskPaneTab(registration),
      },
      settings: {
        registerSection: (registration: PluginSettingsSectionRegistration) => this.registerSettingsSection(registration),
      },
      backend: {
        state: 'ready' as const,
        whenReady: async () => undefined,
        onReady: (handler: () => void) => {
          handler()
          return createDisposable(() => undefined)
        },
        invoke: async <TOutput = unknown>(method: string, payload?: unknown) => this.invokeBackend<TOutput>(method, payload),
      },
      __testing: {
        calls: this.calls,
        registry: this,
      },
    } satisfies MockFrontendOpenForgeAPI

    this.cachedFrontendApi = api
    return api
  }

  createBackendApi(): MockBackendOpenForgeAPI {
    if (this.cachedBackendApi) return this.cachedBackendApi

    const api = {
      ...this.createCommonApi(),
      backend: {
        registerMethod: (method: string, registration: BackendMethodRegistration) => this.registerBackendMethod(method, registration),
      },
      background: {
        register: (registration: BackgroundServiceRegistration) => this.registerBackgroundService(registration),
      },
      __testing: {
        calls: this.calls,
        registry: this,
      },
    } satisfies MockBackendOpenForgeAPI

    this.cachedBackendApi = api
    return api
  }

  createFrontendContext(): FrontendPluginContext {
    return this.createContext(this.frontendSubscriptions)
  }

  createBackendContext(): BackendPluginContext {
    return this.createContext(this.backendSubscriptions)
  }

  async activateFrontend(plugin: FrontendPlugin): Promise<void> {
    await plugin.activate(this.frontendApi, this.createFrontendContext())
  }

  async activateBackend(plugin: BackendPlugin): Promise<void> {
    const existingServices = new Set(this.backgroundServices.keys())
    await plugin.activate(this.backendApi, this.createBackendContext())
    await this.startBackgroundServices(existingServices)
  }

  async disposeAll(): Promise<void> {
    await this.backendSubscriptions.disposeAll()
    await this.frontendSubscriptions.disposeAll()
  }

  getSnapshot(): TestingOpenForgeRegistrySnapshot {
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

  private createContext(subscriptions: TestingSubscriptionSink): FrontendPluginContext {
    return {
      pluginId: this.pluginId,
      apiVersion: 1,
      packageMetadata: this.packageMetadata,
      subscriptions,
    }
  }

  private createCommonApi(): Omit<FrontendOpenForgeAPI, 'views' | 'taskPane' | 'settings' | 'backend'> {
    return {
      commands: {
        register: (registration) => this.registerCommand(registration),
        invoke: async <TOutput = unknown>(id: string, payload?: unknown) => this.invokeCommand<TOutput>(id, payload),
        invokeGlobal: async <TOutput = unknown>(qualifiedId: string, payload?: unknown) => this.invokeGlobalCommand<TOutput>(qualifiedId, payload),
        list: async () => Array.from(this.commands.values()).map(commandDescriptor),
      },
      events: {
        on: <TPayload = unknown>(event: string, handler: (payload: TPayload) => void) => this.registerEventListener(event, handler as EventHandler, false),
        onGlobal: <TPayload = unknown>(qualifiedEvent: string, handler: (payload: TPayload) => void) => this.registerEventListener(qualifiedEvent, handler as EventHandler, true),
        emit: async <TPayload = unknown>(event: string, payload: TPayload) => this.emitEvent(event, payload, false),
        emitGlobal: async <TPayload = unknown>(qualifiedEvent: string, payload: TPayload) => this.emitEvent(qualifiedEvent, payload, true),
      },
      storage: this.storage,
      context: {
        getSnapshot: () => this.getContextSnapshot(),
      },
      tasks: {
        list: async () => [],
        get: async (taskId) => { throw new Error(`Mock task not found: ${taskId}`) },
        updateSummary: async (taskId, summary) => {
          this.calls.taskSummaryUpdates.push({ taskId, summary })
        },
        updateStatus: async (taskId, status) => {
          this.calls.taskStatusUpdates.push({ taskId, status })
        },
        getWorkspace: async () => null,
        getLatestSession: async () => null,
      },
      projects: {
        list: async () => [],
        get: async () => null,
      },
      fs: {
        readDir: async () => [],
        readFile: async () => ({ type: 'text', content: '', mimeType: null, size: 0 }),
        writeFile: async (request) => {
          this.calls.fsWrites.push(request)
        },
        searchFiles: async () => [],
      },
      shell: {
        spawn: async (request) => {
          this.calls.shellSpawns.push(request)
          return 0
        },
        write: async (request) => {
          this.calls.shellWrites.push(request)
        },
        resize: async (request) => {
          this.calls.shellResizes.push(request)
        },
        kill: async (request) => {
          this.calls.shellKills.push(request)
        },
        getBuffer: async () => null,
      },
      notifications: {
        notify: async (request) => {
          this.calls.notify.push(request)
        },
      },
      attention: {
        listProjects: async () => [],
      },
      system: {
        openUrl: async (url) => {
          this.calls.openUrl.push(url)
        },
      },
      config: {
        get: async <T extends JsonValue = JsonValue>(key: string): Promise<T | null> => this.config.has(`global:${key}`) ? this.config.get(`global:${key}`) as T : null,
        set: async (key, value) => {
          this.config.set(`global:${key}`, value)
          this.calls.configWrites.push({ key, value, projectId: null })
        },
      },
      projectConfig: {
        get: async <T extends JsonValue = JsonValue>(key: string, projectId = this.projectId ?? ''): Promise<T | null> => this.config.has(`project:${projectId}:${key}`) ? this.config.get(`project:${projectId}:${key}`) as T : null,
        set: async (key, value, projectId = this.projectId ?? '') => {
          this.config.set(`project:${projectId}:${key}`, value)
          this.calls.configWrites.push({ key, value, projectId })
        },
      },
    }
  }

  private getContextSnapshot(): OpenForgeContextSnapshot {
    return {
      pluginId: this.pluginId,
      projectId: this.projectId,
      ...(this.taskId === null ? {} : { taskId: this.taskId }),
    }
  }

  private localQualifiedId(kind: TestingRuntimeKind, id: string): string {
    assertLocalId(kind, id)
    return `${this.pluginId}.${id.trim()}`
  }

  private claim(kind: TestingRuntimeKind, qualifiedId: string): void {
    const key = kind === 'commands' ? `commands:${qualifiedId}` : `${kind}:${qualifiedId}`
    if (this.claimedIds.has(key)) {
      throw new Error(`Duplicate runtime contribution id: ${qualifiedId}`)
    }
    this.claimedIds.add(key)
  }

  private release(kind: TestingRuntimeKind, qualifiedId: string): void {
    const key = kind === 'commands' ? `commands:${qualifiedId}` : `${kind}:${qualifiedId}`
    this.claimedIds.delete(key)
  }

  private registerCommand(registration: CommandRegistration): Disposable {
    const qualifiedId = this.localQualifiedId('commands', registration.id)
    assertTitle('commands', registration.title)
    assertFunction('commands', 'handler', registration.handler)
    this.claim('commands', qualifiedId)

    const contribution: TestingCommandContribution = {
      ...registration,
      id: registration.id.trim(),
      title: registration.title.trim(),
      qualifiedId,
      pluginId: this.pluginId,
      projectId: this.projectId,
      handler: registration.handler as CommandHandler,
    }
    this.commands.set(qualifiedId, contribution)

    return createDisposable(() => {
      this.commands.delete(qualifiedId)
      this.release('commands', qualifiedId)
    })
  }

  private registerView(registration: PluginViewRegistration): Disposable {
    const qualifiedId = this.localQualifiedId('views', registration.id)
    assertTitle('views', registration.title)
    assertFunction('views', 'component', registration.component)
    this.claim('views', qualifiedId)

    const contribution = {
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
    const qualifiedId = this.localQualifiedId('taskPane', registration.id)
    assertTitle('taskPane', registration.title)
    assertFunction('taskPane', 'component', registration.component)
    this.claim('taskPane', qualifiedId)

    const contribution = {
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
    const qualifiedId = this.localQualifiedId('settings', registration.id)
    assertTitle('settings', registration.title)
    assertFunction('settings', 'component', registration.component)
    this.claim('settings', qualifiedId)

    const contribution = {
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
    const qualifiedId = this.localQualifiedId('backend', method)
    assertFunction('backend', 'handler', registration.handler)
    this.claim('backend', qualifiedId)

    const contribution = {
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
    const qualifiedId = this.localQualifiedId('background', registration.id)
    if (registration.scope !== 'global' && registration.scope !== 'project' && registration.scope !== 'task') {
      throw new Error('background registration requires scope to be global, project, or task')
    }
    assertFunction('background', 'start', registration.start)
    this.claim('background', qualifiedId)

    const contribution = {
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

  private registerEventListener(event: string, handler: EventHandler, global: boolean): Disposable {
    const qualifiedId = global ? event : this.localQualifiedId('events', event)
    if (qualifiedId.trim().length === 0) {
      throw new Error('events registration requires a non-empty id')
    }
    assertFunction('events', 'handler', handler)

    const handlers = this.eventHandlers.get(qualifiedId) ?? new Set<EventHandler>()
    handlers.add(handler)
    this.eventHandlers.set(qualifiedId, handlers)

    const listenerKey = `${qualifiedId}#${++this.eventListenerSequence}`
    const contribution = {
      id: event,
      qualifiedId,
      pluginId: this.pluginId,
      projectId: this.projectId,
      handler,
      global,
    }
    this.eventListeners.set(listenerKey, contribution)

    return createDisposable(() => {
      handlers.delete(handler)
      if (handlers.size === 0) {
        this.eventHandlers.delete(qualifiedId)
      }
      this.eventListeners.delete(listenerKey)
    })
  }

  private async startBackgroundServices(existingServices: Set<string>): Promise<void> {
    for (const [key, service] of this.backgroundServices.entries()) {
      if (existingServices.has(key) || service.started) continue
      await service.start()
      service.started = true
    }
  }

  private async invokeCommand<TOutput>(id: string, payload?: unknown): Promise<TOutput> {
    const qualifiedId = this.localQualifiedId('commands', id)
    this.calls.commandInvocations.push({ id, qualifiedId, payload })
    return this.invokeGlobalCommand(qualifiedId, payload)
  }

  private async invokeGlobalCommand<TOutput>(qualifiedId: string, payload?: unknown): Promise<TOutput> {
    this.calls.globalCommandInvocations.push({ qualifiedId, payload })
    const command = this.commands.get(qualifiedId)
    if (!command) {
      throw new Error(`Unknown command: ${qualifiedId}`)
    }
    return await command.handler(payload) as TOutput
  }

  private async invokeBackend<TOutput>(method: string, payload?: unknown): Promise<TOutput> {
    const qualifiedId = this.localQualifiedId('backend', method)
    this.calls.backendInvocations.push({ method, qualifiedId, payload })
    const contribution = this.backendMethods.get(qualifiedId)
    if (!contribution) {
      throw new Error(`Backend method is not registered: ${qualifiedId}`)
    }
    return await contribution.registration.handler(payload) as TOutput
  }

  private async emitEvent<TPayload>(event: string, payload: TPayload, global: boolean): Promise<void> {
    const qualifiedEvent = global ? event : this.localQualifiedId('events', event)
    if (global) {
      this.calls.emittedGlobalEvents.push({ qualifiedEvent, payload })
    } else {
      this.calls.emittedEvents.push({ event, qualifiedEvent, payload })
    }

    for (const handler of Array.from(this.eventHandlers.get(qualifiedEvent) ?? [])) {
      handler(payload)
    }
  }
}

export function createOpenForgeRegistryFake(options: TestingOpenForgeApiOptions = {}): TestingOpenForgeRegistryFake {
  return new TestingOpenForgeRegistryFake(options)
}

export function createMockOpenForgeApi(options: TestingOpenForgeApiOptions = {}): MockFrontendOpenForgeAPI {
  return createMockFrontendOpenForgeApi(options)
}

export function createMockFrontendOpenForgeApi(options: TestingOpenForgeApiOptions = {}): MockFrontendOpenForgeAPI {
  return createOpenForgeRegistryFake(options).frontendApi
}

export function createMockBackendOpenForgeApi(options: TestingOpenForgeApiOptions = {}): MockBackendOpenForgeAPI {
  return createOpenForgeRegistryFake(options).backendApi
}

export function createMockPluginContext(options: TestingOpenForgeApiOptions = {}): FrontendPluginContext {
  return createOpenForgeRegistryFake(options).createFrontendContext()
}

export function createMemoryPluginStorage(calls: TestingOpenForgeApiCalls = createTestingCalls()): PluginStorage {
  const values = new Map<string, JsonValue>()

  function scope(scopeKind: TestingRuntimeScope, scopeId: string | null): PluginStorageScope {
    const prefix = `${scopeKind}:${scopeId ?? ''}:`
    return {
      async get<T extends JsonValue = JsonValue>(key: string): Promise<T | null> {
        calls.storageGets.push({ scope: scopeKind, scopeId, key })
        return values.has(`${prefix}${key}`) ? values.get(`${prefix}${key}`) as T : null
      },
      async set<T extends JsonValue = JsonValue>(key: string, value: T): Promise<void> {
        values.set(`${prefix}${key}`, value)
        calls.storageSets.push({ scope: scopeKind, scopeId, key, value })
      },
      async delete(key: string): Promise<void> {
        values.delete(`${prefix}${key}`)
        calls.storageDeletes.push({ scope: scopeKind, scopeId, key })
      },
    }
  }

  return {
    global: scope('global', null),
    project: (projectId: string) => scope('project', projectId),
    task: (taskId: string) => scope('task', taskId),
  }
}

export function createTestingCalls(): TestingOpenForgeApiCalls {
  return {
    commandInvocations: [],
    globalCommandInvocations: [],
    backendInvocations: [],
    emittedEvents: [],
    emittedGlobalEvents: [],
    openUrl: [],
    notify: [],
    taskSummaryUpdates: [],
    taskStatusUpdates: [],
    configWrites: [],
    fsWrites: [],
    shellSpawns: [],
    shellWrites: [],
    shellResizes: [],
    shellKills: [],
    storageGets: [],
    storageSets: [],
    storageDeletes: [],
  }
}

function commandDescriptor(command: TestingCommandContribution): CommandDescriptor {
  return {
    id: command.id,
    qualifiedId: command.qualifiedId,
    pluginId: command.pluginId,
    projectId: command.projectId,
    title: command.title,
    icon: command.icon,
    shortcut: command.shortcut,
    input: command.input,
    output: command.output,
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

function assertLocalId(kind: TestingRuntimeKind, id: string): void {
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new Error(`${kind} registration requires a non-empty id`)
  }

  const trimmed = id.trim()
  if (trimmed.startsWith('openforge.')) {
    throw new Error(`${kind} registration cannot use openforge.* reserved namespace`)
  }
  if (trimmed.includes(':') || trimmed.startsWith('.') || trimmed.endsWith('.') || trimmed.includes('..')) {
    throw new Error(`${kind} registration has invalid id "${trimmed}"`)
  }
}

function assertTitle(kind: TestingRuntimeKind, title: string): void {
  if (typeof title !== 'string' || title.trim().length === 0) {
    throw new Error(`${kind} registration requires a non-empty title`)
  }
}

function assertFunction(kind: TestingRuntimeKind, field: string, value: unknown): void {
  if (typeof value !== 'function') {
    throw new Error(`${kind} registration requires a ${field} function`)
  }
}
