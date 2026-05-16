import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import { validateSchemaValue } from '@openforge/plugin-runtime/commandValidation'
import type { CommandDescriptor, CommandRegistration, OpenForgePackageMetadata, PluginStorage, SubscriptionSink } from '@openforge/plugin-sdk'
import type { BackendMethodRegistration, BackendOpenForgeAPI, BackendPlugin, BackendPluginContext, BackgroundServiceRegistration, Disposable, OpenForgeContextSnapshot } from '@openforge/plugin-sdk/backend'

type JsonRpcId = number | null | undefined

type JsonRpcRequest = {
  jsonrpc?: string
  id?: JsonRpcId
  method?: string
  params?: {
    pluginId?: string
    command?: string
    backendPath?: string
    projectId?: string | null
    packageMetadata?: OpenForgePackageMetadata
    payload?: unknown
    [key: string]: unknown
  }
}

type JsonRpcResponse = {
  jsonrpc: '2.0'
  id: JsonRpcId
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

type BackendReadyState = 'missing' | 'starting' | 'ready' | 'error'

type BackendStateSnapshot = {
  pluginId: string
  state: BackendReadyState
  ready: boolean
  error: string | null
  methods: string[]
  backgroundServices: string[]
  crashLoopGuardTripped: boolean
}

type HostCallbackRequest = {
  method: string
  params: Record<string, unknown>
}

type HostCallbackHandler = (request: HostCallbackRequest) => Promise<unknown> | unknown

type RuntimeOptions = {
  crashLoopLimit?: number
  crashLoopWindowMs?: number
  hostCallbacks?: HostCallbackHandler
}

type ActivateBackendInput = {
  pluginId: string
  backendPath: string
  projectId?: string | null
  packageMetadata?: OpenForgePackageMetadata
}

type InvokeBackendInput = {
  pluginId: string
  command: string
  backendPath?: string
  projectId?: string | null
  packageMetadata?: OpenForgePackageMetadata
  payload?: unknown
}

type RuntimeBackendService = BackgroundServiceRegistration & {
  localId: string
  qualifiedId: string
  started: boolean
}

type RuntimeBackendMethod = BackendMethodRegistration & {
  localId: string
  qualifiedId: string
}

type RuntimeBackendCommand = CommandRegistration & {
  localId: string
  qualifiedId: string
  pluginId: string
  projectId: string | null
}

type RuntimeEventHandler = (payload: unknown) => void

type RuntimePluginState = {
  pluginId: string
  backendPath: string | null
  projectId: string | null
  packageMetadata: OpenForgePackageMetadata
  state: BackendReadyState
  error: Error | null
  activationPromise: Promise<void> | null
  module: Record<string, unknown> | null
  methods: Map<string, RuntimeBackendMethod>
  commands: Map<string, RuntimeBackendCommand>
  eventHandlers: Map<string, Set<RuntimeEventHandler>>
  backgroundServices: Map<string, RuntimeBackendService>
  storage: PluginStorage
  subscriptions: RuntimeSubscriptionSink
  crashTimestamps: number[]
  crashLoopGuardTripped: boolean
}

const DEFAULT_CRASH_LOOP_LIMIT = 3
const DEFAULT_CRASH_LOOP_WINDOW_MS = 60_000

const globalCommands = new Map<string, RuntimeBackendCommand>()
const globalEventHandlers = new Map<string, Set<RuntimeEventHandler>>()

function commandDescriptor(command: RuntimeBackendCommand): CommandDescriptor {
  return {
    id: command.localId,
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

class RuntimeValidationError extends Error {
  constructor(kind: 'backend' | 'background' | 'commands' | 'events', message: string) {
    super(`${kind} registration ${message}`)
    this.name = 'RuntimeValidationError'
  }
}

class RuntimeSubscriptionSink implements SubscriptionSink {
  readonly subscriptions: Disposable[] = []

  constructor(private readonly pluginId: string) {}

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
      try {
        await subscription.dispose()
      } catch (error) {
        logPluginHostError(this.pluginId, `subscription dispose error: ${toError(error).message}`)
      }
    }
  }
}

function createDisposable(dispose: () => void | Promise<void>): Disposable {
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

function createHostStorageScope(pluginId: string, scope: 'global' | 'project' | 'task', scopeId: string | null, hostCallbacks: HostCallbackHandler) {
  const params = (key: string, value?: unknown, includeValue = false): Record<string, unknown> => {
    const payload: Record<string, unknown> = { pluginId, scope, scopeId, key }
    if (includeValue) payload.value = value
    return payload
  }

  return {
    async get<T>(key: string): Promise<T | null> {
      return await hostCallbacks({ method: 'openforge.storage.get', params: params(key) }) as T | null
    },
    async set<T>(key: string, value: T): Promise<void> {
      await hostCallbacks({ method: 'openforge.storage.set', params: params(key, value, true) })
    },
    async delete(key: string): Promise<void> {
      await hostCallbacks({ method: 'openforge.storage.delete', params: params(key) })
    },
  }
}

function createHostStorage(pluginId: string, hostCallbacks: HostCallbackHandler): PluginStorage {
  return {
    global: createHostStorageScope(pluginId, 'global', null, hostCallbacks),
    project: (projectId: string) => createHostStorageScope(pluginId, 'project', projectId, hostCallbacks),
    task: (taskId: string) => createHostStorageScope(pluginId, 'task', taskId, hostCallbacks),
  }
}

class StdioHostCallbackBridge {
  private nextId = 1
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()

  request: HostCallbackHandler = ({ method, params }) => {
    const id = this.nextId++
    const message = { jsonrpc: '2.0', id, method, params }
    process.stdout.write(`${JSON.stringify(message)}\n`)
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
  }

  handleResponse(response: JsonRpcResponse): boolean {
    if (typeof response.id !== 'number') return false
    const pending = this.pending.get(response.id)
    if (!pending) return false
    this.pending.delete(response.id)
    if (response.error) {
      pending.reject(new Error(response.error.message))
      return true
    }
    pending.resolve(response.result)
    return true
  }
}

function isJsonRpcResponse(value: JsonRpcRequest | JsonRpcResponse): value is JsonRpcResponse {
  return 'result' in value || 'error' in value
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function assertLocalId(kind: 'backend' | 'background' | 'commands' | 'events', id: unknown): asserts id is string {
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

function assertScope(scope: unknown): asserts scope is BackgroundServiceRegistration['scope'] {
  if (scope !== 'global' && scope !== 'project' && scope !== 'task') {
    throw new RuntimeValidationError('background', 'requires scope to be global, project, or task')
  }
}

function assertFunction(kind: 'backend' | 'background' | 'commands' | 'events', label: string, value: unknown): asserts value is (...args: never[]) => unknown {
  if (typeof value !== 'function') {
    throw new RuntimeValidationError(kind, `requires a ${label} function`)
  }
}

function formatPluginValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.stack ?? value.message
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

let pluginConsoleQueue: Promise<void> = Promise.resolve()

async function withPluginConsole<T>(pluginId: string, operation: () => Promise<T> | T): Promise<T> {
  const previousConsoleUse = pluginConsoleQueue
  let releaseConsoleUse: () => void = () => undefined
  pluginConsoleQueue = new Promise<void>((resolve) => {
    releaseConsoleUse = resolve
  })
  await previousConsoleUse.catch(() => undefined)

  const originalConsole = {
    debug: console.debug,
    error: console.error,
    info: console.info,
    log: console.log,
    warn: console.warn,
  }
  const write = (...values: unknown[]) => {
    process.stderr.write(`[plugin:${pluginId}] ${values.map(formatPluginValue).join(' ')}\n`)
  }

  console.debug = write
  console.error = write
  console.info = write
  console.log = write
  console.warn = write

  try {
    return await operation()
  } finally {
    console.debug = originalConsole.debug
    console.error = originalConsole.error
    console.info = originalConsole.info
    console.log = originalConsole.log
    console.warn = originalConsole.warn
    releaseConsoleUse()
  }
}

function logPluginHostError(pluginId: string, message: string): void {
  process.stderr.write(`[plugin:${pluginId}] ${message}\n`)
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function createDefaultPackageMetadata(pluginId: string): OpenForgePackageMetadata {
  return {
    id: pluginId,
    apiVersion: 1,
    displayName: pluginId,
    description: '',
  }
}

function createInitialPluginState(pluginId: string, storage: PluginStorage): RuntimePluginState {
  return {
    pluginId,
    backendPath: null,
    projectId: null,
    packageMetadata: createDefaultPackageMetadata(pluginId),
    state: 'missing',
    error: null,
    activationPromise: null,
    module: null,
    methods: new Map(),
    commands: new Map(),
    eventHandlers: new Map(),
    backgroundServices: new Map(),
    storage,
    subscriptions: new RuntimeSubscriptionSink(pluginId),
    crashTimestamps: [],
    crashLoopGuardTripped: false,
  }
}

function extractBackendPlugin(module: Record<string, unknown>): BackendPlugin | null {
  const candidate = module.default ?? module
  if (typeof candidate === 'object' && candidate !== null && typeof (candidate as BackendPlugin).activate === 'function') {
    return candidate as BackendPlugin
  }
  return null
}

async function loadBackendModule(backendPath: string): Promise<Record<string, unknown>> {
  return await import(pathToFileURL(backendPath).href) as Record<string, unknown>
}

export class PluginHostRuntime {
  private readonly plugins = new Map<string, RuntimePluginState>()
  private readonly crashLoopLimit: number
  private readonly crashLoopWindowMs: number
  private readonly hostCallbacks: HostCallbackHandler | null

  constructor(options: RuntimeOptions = {}) {
    this.crashLoopLimit = options.crashLoopLimit ?? DEFAULT_CRASH_LOOP_LIMIT
    this.crashLoopWindowMs = options.crashLoopWindowMs ?? DEFAULT_CRASH_LOOP_WINDOW_MS
    this.hostCallbacks = options.hostCallbacks ?? null
  }

  async activateBackend(input: ActivateBackendInput): Promise<BackendStateSnapshot> {
    assertLocalId('backend', input.pluginId)
    if (!isNonEmptyString(input.backendPath)) {
      throw new Error('backend activation requires a backendPath')
    }

    const state = this.getOrCreateState(input.pluginId)
    if (state.crashLoopGuardTripped) {
      throw new Error(`Plugin ${input.pluginId} activation blocked by crash-loop guard`)
    }

    if (state.state === 'ready' && state.backendPath === input.backendPath) {
      return this.getBackendState(input.pluginId)
    }

    if (state.state === 'starting' && state.activationPromise) {
      await state.activationPromise
      return this.getBackendState(input.pluginId)
    }

    if (state.state === 'ready' || state.state === 'error') {
      await this.cleanupPluginState(state)
    }

    state.backendPath = input.backendPath
    state.projectId = input.projectId ?? null
    state.packageMetadata = input.packageMetadata ?? createDefaultPackageMetadata(input.pluginId)
    state.state = 'starting'
    state.error = null

    state.activationPromise = this.activatePluginState(state)
    await state.activationPromise
    return this.getBackendState(input.pluginId)
  }

  async deactivateBackend(pluginId: string): Promise<BackendStateSnapshot> {
    assertLocalId('backend', pluginId)
    const state = this.getOrCreateState(pluginId)
    await this.cleanupPluginState(state)
    state.state = 'missing'
    state.error = null
    state.backendPath = null
    state.projectId = null
    state.module = null
    state.activationPromise = null
    return this.getBackendState(pluginId)
  }

  async whenBackendReady(input: { pluginId: string; backendPath?: string; projectId?: string | null; packageMetadata?: OpenForgePackageMetadata }): Promise<BackendStateSnapshot> {
    assertLocalId('backend', input.pluginId)
    const state = this.getOrCreateState(input.pluginId)

    if (state.state === 'ready') {
      return this.getBackendState(input.pluginId)
    }

    if (state.state === 'starting' && state.activationPromise) {
      await state.activationPromise
      return this.getBackendState(input.pluginId)
    }

    if (input.backendPath) {
      return await this.activateBackend({
        pluginId: input.pluginId,
        backendPath: input.backendPath,
        projectId: input.projectId,
        packageMetadata: input.packageMetadata,
      })
    }

    if (state.state === 'error') {
      throw new Error(state.error?.message ?? `Plugin ${input.pluginId} backend is in error state`)
    }

    throw new Error(`Plugin ${input.pluginId} backend is not ready`)
  }

  async invokeBackend(input: InvokeBackendInput): Promise<unknown> {
    assertLocalId('backend', input.pluginId)
    assertLocalId('backend', input.command)
    await this.whenBackendReady(input)

    const state = this.getOrCreateState(input.pluginId)
    if (state.state !== 'ready') {
      throw new Error(`Plugin ${input.pluginId} backend is not ready`)
    }

    const method = state.methods.get(input.command.trim())
    if (!method) {
      throw new Error(`Backend method not found for ${input.pluginId}.${input.command}`)
    }

    try {
      return await withPluginConsole(input.pluginId, async () => await method.handler(input.payload as never))
    } catch (error) {
      const pluginError = toError(error)
      logPluginHostError(input.pluginId, `handler error in ${input.pluginId}.${input.command}: ${pluginError.message}`)
      throw pluginError
    }
  }

  async invokeCommand(input: InvokeBackendInput): Promise<unknown> {
    assertLocalId('commands', input.pluginId)
    assertLocalId('commands', input.command)
    await this.whenBackendReady(input)
    return this.invokeGlobalCommand(`${input.pluginId}.${input.command.trim()}`, input.payload)
  }

  async invokeGlobalCommand(qualifiedId: string, payload?: unknown): Promise<unknown> {
    const command = globalCommands.get(qualifiedId)
    if (!command) {
      throw new Error(`Command not found: ${qualifiedId}`)
    }
    validateSchemaValue(command.input, payload, `${qualifiedId} input`)
    try {
      const result = await withPluginConsole(command.pluginId, async () => await command.handler(payload as never))
      validateSchemaValue(command.output, result, `${qualifiedId} output`)
      return result
    } catch (error) {
      const pluginError = toError(error)
      logPluginHostError(command.pluginId, `command error in ${qualifiedId}: ${pluginError.message}`)
      throw pluginError
    }
  }

  async listCommands(): Promise<CommandDescriptor[]> {
    return Array.from(globalCommands.values()).map(commandDescriptor)
  }

  async getBackendState(pluginId: string): Promise<BackendStateSnapshot> {
    assertLocalId('backend', pluginId)
    const state = this.getOrCreateState(pluginId)
    return {
      pluginId,
      state: state.state,
      ready: state.state === 'ready',
      error: state.error?.message ?? null,
      methods: Array.from(state.methods.values()).map(method => method.qualifiedId),
      backgroundServices: Array.from(state.backgroundServices.values()).map(service => service.qualifiedId),
      crashLoopGuardTripped: state.crashLoopGuardTripped,
    }
  }

  async handleJsonRpcRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (request.jsonrpc !== '2.0' || typeof request.id !== 'number') {
      return { jsonrpc: '2.0', id: request.id, error: { code: -32600, message: 'Invalid request' } }
    }

    try {
      const params = request.params ?? {}
      const method = request.method
      switch (method) {
        case 'plugin.backend.activate':
          return { jsonrpc: '2.0', id: request.id, result: await this.activateBackend(this.requireActivationParams(params)) }
        case 'plugin.backend.deactivate':
          return { jsonrpc: '2.0', id: request.id, result: await this.deactivateBackend(this.requirePluginId(params)) }
        case 'plugin.backend.state':
          return { jsonrpc: '2.0', id: request.id, result: await this.getBackendState(this.requirePluginId(params)) }
        case 'plugin.backend.whenReady':
          return { jsonrpc: '2.0', id: request.id, result: await this.whenBackendReady(this.requireReadyParams(params)) }
        case 'plugin.backend.invoke':
          return { jsonrpc: '2.0', id: request.id, result: await this.invokeBackend(this.requireInvokeParams(params, method)) }
        default:
          return { jsonrpc: '2.0', id: request.id, result: await this.invokeBackend(this.requireInvokeParams(params, method)) }
      }
    } catch (error) {
      const pluginError = toError(error)
      return { jsonrpc: '2.0', id: request.id, error: { code: this.errorCodeFor(error), message: pluginError.message } }
    }
  }

  private async activatePluginState(state: RuntimePluginState): Promise<void> {
    try {
      state.module = await loadBackendModule(state.backendPath ?? '')
      const plugin = extractBackendPlugin(state.module)

      if (!plugin) {
        throw new Error(`Backend entry for ${state.pluginId} does not export a defineBackendPlugin-compatible activate() function`)
      }

      await withPluginConsole(state.pluginId, async () => {
        await plugin.activate(this.createBackendApi(state), this.createBackendContext(state))
        await this.startBackgroundServices(state)
      })

      state.state = 'ready'
      state.error = null
    } catch (error) {
      const pluginError = toError(error)
      state.error = pluginError
      await this.cleanupPluginState(state)
      this.recordActivationCrash(state, pluginError)
      state.state = 'error'
      logPluginHostError(state.pluginId, `activation error: ${pluginError.message}`)
      throw pluginError
    } finally {
      state.activationPromise = null
    }
  }

  private recordActivationCrash(state: RuntimePluginState, error: Error): void {
    const now = Date.now()
    state.crashTimestamps = state.crashTimestamps.filter(timestamp => now - timestamp <= this.crashLoopWindowMs)
    state.crashTimestamps.push(now)
    if (state.crashTimestamps.length >= this.crashLoopLimit) {
      state.crashLoopGuardTripped = true
      state.error = new Error(`Plugin ${state.pluginId} activation blocked by crash-loop guard after ${state.crashTimestamps.length} crashes: ${error.message}`)
    }
  }

  private async cleanupPluginState(state: RuntimePluginState): Promise<void> {
    await state.subscriptions.disposeAll()

    const services = Array.from(state.backgroundServices.values()).reverse()
    for (const service of services) {
      if (!service.started) continue
      try {
        await withPluginConsole(state.pluginId, async () => await service.stop?.())
      } catch (error) {
        const pluginError = toError(error)
        logPluginHostError(state.pluginId, `background service stop error in ${service.qualifiedId}: ${pluginError.message}`)
      } finally {
        service.started = false
      }
    }

    for (const command of state.commands.values()) {
      globalCommands.delete(command.qualifiedId)
    }
    for (const [event, handlers] of state.eventHandlers.entries()) {
      const globalHandlers = globalEventHandlers.get(event)
      if (!globalHandlers) continue
      for (const handler of handlers) {
        globalHandlers.delete(handler)
      }
      if (globalHandlers.size === 0) {
        globalEventHandlers.delete(event)
      }
    }

    state.methods.clear()
    state.commands.clear()
    state.eventHandlers.clear()
    state.backgroundServices.clear()
    state.subscriptions = new RuntimeSubscriptionSink(state.pluginId)
  }

  private async startBackgroundServices(state: RuntimePluginState): Promise<void> {
    for (const service of state.backgroundServices.values()) {
      if (service.started) continue
      try {
        await service.start()
        service.started = true
      } catch (error) {
        const pluginError = toError(error)
        logPluginHostError(state.pluginId, `background service start error in ${service.qualifiedId}: ${pluginError.message}`)
        throw pluginError
      }
    }
  }

  private createBackendContext(state: RuntimePluginState): BackendPluginContext {
    return {
      pluginId: state.pluginId,
      apiVersion: 1,
      packageMetadata: state.packageMetadata,
      subscriptions: state.subscriptions,
    }
  }

  private createBackendApi(state: RuntimePluginState): BackendOpenForgeAPI {
    const contextSnapshot: OpenForgeContextSnapshot = {
      pluginId: state.pluginId,
      projectId: state.projectId,
    }
    const storage = state.storage
    const config = createMemoryStorageScope()
    const projectConfig = createMemoryStorageScope()

    return {
      commands: {
        register: (registration) => this.registerCommand(state, registration),
        invoke: async (command, payload) => this.invokeCommand({ pluginId: state.pluginId, command, payload }),
        invokeGlobal: async (qualifiedId, payload) => this.invokeGlobalCommand(qualifiedId, payload),
        list: async () => this.listCommands(),
      },
      events: {
        on: (event, handler) => this.registerEventListener(state, event, handler as RuntimeEventHandler, false),
        onGlobal: (event, handler) => this.registerEventListener(state, event, handler as RuntimeEventHandler, true),
        emit: async (event, payload) => this.emitEvent(`${state.pluginId}.${event}`, payload),
        emitGlobal: async (event, payload) => this.emitEvent(event, payload),
      },
      storage,
      context: {
        getSnapshot: () => ({ ...contextSnapshot }),
      },
      tasks: {},
      projects: {},
      fs: {
        readFile: async () => ({
          type: 'text',
          content: '',
          mimeType: null,
          size: 0,
        }),
        writeFile: async () => undefined,
      },
      shell: {},
      notifications: {},
      attention: {},
      system: {
        openUrl: async () => undefined,
      },
      config,
      projectConfig,
      backend: {
        registerMethod: (method, registration) => this.registerBackendMethod(state, method, registration),
      },
      background: {
        register: (registration) => this.registerBackgroundService(state, registration),
      },
    }
  }

  private registerCommand(state: RuntimePluginState, registration: CommandRegistration): Disposable {
    assertLocalId('commands', registration?.id)
    assertFunction('commands', 'handler', registration?.handler)
    if (!isNonEmptyString(registration.title)) {
      throw new RuntimeValidationError('commands', 'requires a non-empty title')
    }
    const localId = registration.id.trim()
    const qualifiedId = `${state.pluginId}.${localId}`
    if (state.commands.has(localId)) {
      throw new Error(`Duplicate command id: ${qualifiedId}`)
    }

    const runtimeCommand: RuntimeBackendCommand = {
      ...registration,
      localId,
      qualifiedId,
      pluginId: state.pluginId,
      projectId: state.projectId,
      title: registration.title.trim(),
    }
    state.commands.set(localId, runtimeCommand)
    globalCommands.set(qualifiedId, runtimeCommand)

    return createDisposable(() => {
      state.commands.delete(localId)
      globalCommands.delete(qualifiedId)
    })
  }

  private registerEventListener(state: RuntimePluginState, event: string, handler: RuntimeEventHandler, global: boolean): Disposable {
    const qualifiedId = global ? event : `${state.pluginId}.${event}`
    if (!isNonEmptyString(qualifiedId)) {
      throw new RuntimeValidationError('events', 'requires a non-empty id')
    }
    if (!global) {
      assertLocalId('events', event)
    }
    assertFunction('events', 'handler', handler)

    const handlers = globalEventHandlers.get(qualifiedId) ?? new Set<RuntimeEventHandler>()
    handlers.add(handler)
    globalEventHandlers.set(qualifiedId, handlers)

    const tracked = state.eventHandlers.get(qualifiedId) ?? new Set<RuntimeEventHandler>()
    tracked.add(handler)
    state.eventHandlers.set(qualifiedId, tracked)

    return createDisposable(() => {
      handlers.delete(handler)
      if (handlers.size === 0) globalEventHandlers.delete(qualifiedId)
      tracked.delete(handler)
      if (tracked.size === 0) state.eventHandlers.delete(qualifiedId)
    })
  }

  private async emitEvent(qualifiedId: string, payload: unknown): Promise<void> {
    const handlers = Array.from(globalEventHandlers.get(qualifiedId) ?? [])
    for (const handler of handlers) {
      handler(payload)
    }
  }

  private registerBackendMethod(state: RuntimePluginState, method: string, registration: BackendMethodRegistration): Disposable {
    assertLocalId('backend', method)
    assertFunction('backend', 'handler', registration?.handler)
    const localId = method.trim()
    if (state.methods.has(localId)) {
      throw new Error(`Duplicate backend method id: ${state.pluginId}.${localId}`)
    }

    const runtimeMethod: RuntimeBackendMethod = {
      ...registration,
      localId,
      qualifiedId: `${state.pluginId}.${localId}`,
    }
    state.methods.set(localId, runtimeMethod)

    return createDisposable(() => {
      state.methods.delete(localId)
    })
  }

  private registerBackgroundService(state: RuntimePluginState, registration: BackgroundServiceRegistration): Disposable {
    assertLocalId('background', registration?.id)
    assertScope(registration?.scope)
    assertFunction('background', 'start', registration?.start)
    const localId = registration.id.trim()
    if (state.backgroundServices.has(localId)) {
      throw new Error(`Duplicate background service id: ${state.pluginId}.${localId}`)
    }

    const service: RuntimeBackendService = {
      ...registration,
      localId,
      id: localId,
      qualifiedId: `${state.pluginId}.${localId}`,
      started: false,
    }
    state.backgroundServices.set(localId, service)

    return createDisposable(async () => {
      state.backgroundServices.delete(localId)
      if (service.started) {
        await service.stop?.()
        service.started = false
      }
    })
  }

  private getOrCreateState(pluginId: string): RuntimePluginState {
    let state = this.plugins.get(pluginId)
    if (!state) {
      const storage = this.hostCallbacks ? createHostStorage(pluginId, this.hostCallbacks) : createMemoryStorage()
      state = createInitialPluginState(pluginId, storage)
      this.plugins.set(pluginId, state)
    }
    return state
  }

  private requirePluginId(params: JsonRpcRequest['params']): string {
    const pluginId = params?.pluginId
    if (!isNonEmptyString(pluginId)) {
      throw new Error('Missing pluginId')
    }
    return pluginId
  }

  private requireActivationParams(params: JsonRpcRequest['params']): ActivateBackendInput {
    const pluginId = this.requirePluginId(params)
    if (!isNonEmptyString(params?.backendPath)) {
      throw new Error('Missing backendPath')
    }
    return {
      pluginId,
      backendPath: params.backendPath,
      projectId: params.projectId,
      packageMetadata: params.packageMetadata,
    }
  }

  private requireReadyParams(params: JsonRpcRequest['params']): { pluginId: string; backendPath?: string; projectId?: string | null; packageMetadata?: OpenForgePackageMetadata } {
    return {
      pluginId: this.requirePluginId(params),
      backendPath: params?.backendPath,
      projectId: params?.projectId,
      packageMetadata: params?.packageMetadata,
    }
  }

  private requireInvokeParams(params: JsonRpcRequest['params'], rpcMethod: string | undefined): InvokeBackendInput {
    const pluginId = this.requirePluginId(params)
    const command = isNonEmptyString(params?.command)
      ? params.command
      : this.commandFromRpcMethod(pluginId, rpcMethod)

    if (!isNonEmptyString(command)) {
      throw new Error('Missing backend command')
    }

    return {
      pluginId,
      command,
      backendPath: params?.backendPath,
      projectId: params?.projectId,
      packageMetadata: params?.packageMetadata,
      payload: params?.payload,
    }
  }

  private commandFromRpcMethod(pluginId: string, rpcMethod: string | undefined): string | undefined {
    if (!rpcMethod) return undefined
    const prefix = `${pluginId}.`
    return rpcMethod.startsWith(prefix) ? rpcMethod.slice(prefix.length) : undefined
  }

  private errorCodeFor(error: unknown): number {
    const message = toError(error).message
    if (message.includes('not found')) return -32601
    if (message.includes('Missing') || message.includes('Invalid') || message.includes('requires')) return -32602
    return -32603
  }
}

export function createPluginHostRuntime(options?: RuntimeOptions): PluginHostRuntime {
  return new PluginHostRuntime(options)
}

const defaultStdioHostCallbackBridge = new StdioHostCallbackBridge()
const defaultRuntime = createPluginHostRuntime({ hostCallbacks: defaultStdioHostCallbackBridge.request })

function respond(id: JsonRpcId, body: Omit<JsonRpcResponse, 'jsonrpc' | 'id'>): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, ...body })}\n`)
}

export async function handleRequest(request: JsonRpcRequest): Promise<void> {
  const response = await defaultRuntime.handleJsonRpcRequest(request)
  if (response.error) {
    respond(response.id, { error: response.error })
    return
  }
  respond(response.id, { result: response.result })
}

function startStdioServer(): void {
  const input = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  })

  let requestQueue: Promise<void> = Promise.resolve()

  input.on('line', (line) => {
    if (!line.trim()) {
      return
    }

    let message: JsonRpcRequest | JsonRpcResponse
    try {
      message = JSON.parse(line) as JsonRpcRequest | JsonRpcResponse
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message } })}\n`)
      return
    }

    if (isJsonRpcResponse(message) && defaultStdioHostCallbackBridge.handleResponse(message)) {
      return
    }

    requestQueue = requestQueue
      .catch(() => undefined)
      .then(() => handleRequest(message as JsonRpcRequest))
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        process.stderr.write(`[plugin_host] request handling error: ${message}\n`)
      })
    void requestQueue
  })

  input.on('close', () => {
    process.exit(0)
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startStdioServer()
}
