var openforgePackageMetadataSchema_default = {
	$schema: "https://json-schema.org/draft/2020-12/schema",
	$id: "https://openforge.dev/schemas/package-openforge.v1.schema.json",
	title: "OpenForge package metadata",
	description: "Schema for package.json#openforge metadata used by OpenForge plugin packages.",
	type: "object",
	additionalProperties: false,
	required: [
		"id",
		"apiVersion",
		"displayName",
		"description"
	],
	properties: {
		"id": {
			"type": "string",
			"minLength": 1,
			"pattern": "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$",
			"description": "Explicit app-wide plugin id. Host-exposed contribution ids are qualified with this id."
		},
		"apiVersion": { "enum": [1] },
		"displayName": {
			"type": "string",
			"minLength": 1
		},
		"description": {
			"type": "string",
			"minLength": 1
		},
		"icon": {
			"type": "string",
			"minLength": 1,
			"description": "Semantic OpenForge icon key or package asset reference."
		},
		"frontend": {
			"type": "string",
			"minLength": 1,
			"description": "Path to the built frontend JavaScript entry artifact."
		},
		"backend": {
			"type": "string",
			"minLength": 1,
			"description": "Path to the built backend JavaScript entry artifact."
		},
		"requires": {
			"type": "array",
			"uniqueItems": true,
			"items": { "enum": [
				"commands",
				"events",
				"views",
				"taskPane",
				"settings",
				"background",
				"backend",
				"storage",
				"context",
				"tasks",
				"projects",
				"fs",
				"shell",
				"notifications",
				"attention",
				"system.openUrl",
				"config",
				"projectConfig"
			] }
		}
	}
};
//#endregion
//#region packages/plugin-sdk/src/types.ts
var OPENFORGE_PLUGIN_API_VERSION = 1;
var MIN_SUPPORTED_API_VERSION = 1;
var MAX_SUPPORTED_API_VERSION = 1;
var SUPPORTED_OPENFORGE_API_VERSIONS = [1];
function makePluginViewKey(pluginId, viewId) {
	return `plugin:${pluginId}:${viewId}`;
}
function isPluginViewKey(value) {
	return value.startsWith("plugin:") && value.match(/^plugin:[^:]+:[^:]+$/) !== null;
}
function parsePluginViewKey(key) {
	const parts = key.split(":");
	return {
		pluginId: parts[1],
		viewId: parts[2]
	};
}
//#endregion
//#region packages/plugin-sdk/src/manifest.ts
var OPENFORGE_PACKAGE_METADATA_SCHEMA = openforgePackageMetadataSchema_default;
var OPENFORGE_PLUGIN_CAPABILITIES = [
	"commands",
	"events",
	"views",
	"taskPane",
	"settings",
	"background",
	"backend",
	"storage",
	"context",
	"tasks",
	"projects",
	"fs",
	"shell",
	"notifications",
	"attention",
	"system.openUrl",
	"config",
	"projectConfig"
];
var CAPABILITIES = new Set(OPENFORGE_PLUGIN_CAPABILITIES);
function isString(value) {
	return typeof value === "string";
}
function isNonEmptyString(value) {
	return isString(value) && value.length > 0;
}
function isObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function validateRequiredString(value, path) {
	if (!isNonEmptyString(value)) return [{
		path,
		message: "Required string"
	}];
	return [];
}
function validateOptionalString(value, path) {
	if (value === void 0) return [];
	if (!isNonEmptyString(value)) return [{
		path,
		message: "Must be a non-empty string"
	}];
	return [];
}
function isSupportedOpenForgeApiVersion(apiVersion) {
	return typeof apiVersion === "number" && Number.isInteger(apiVersion) && SUPPORTED_OPENFORGE_API_VERSIONS.includes(apiVersion);
}
function validateApiVersion(value) {
	if (typeof value !== "number" || !Number.isInteger(value)) return [{
		path: "apiVersion",
		message: "Required integer"
	}];
	if (!isSupportedOpenForgeApiVersion(value)) return [{
		path: "apiVersion",
		message: `API version ${value} not supported (supported: ${SUPPORTED_OPENFORGE_API_VERSIONS.join(", ")})`
	}];
	return [];
}
function validateRequires(value) {
	const errors = [];
	if (value === void 0) return errors;
	if (!Array.isArray(value)) return [{
		path: "requires",
		message: "Must be an array"
	}];
	value.forEach((item, index) => {
		const path = `requires[${index}]`;
		if (!isString(item)) {
			errors.push({
				path,
				message: "Must be a string"
			});
			return;
		}
		if (!CAPABILITIES.has(item)) errors.push({
			path,
			message: `Unknown OpenForge capability "${item}"`
		});
	});
	return errors;
}
function validateOpenForgePackageMetadata(data) {
	const errors = [];
	if (!isObject(data)) return [{
		path: "",
		message: "OpenForge package metadata must be an object"
	}];
	errors.push(...validateRequiredString(data.id, "id"));
	errors.push(...validateApiVersion(data.apiVersion));
	errors.push(...validateRequiredString(data.displayName, "displayName"));
	errors.push(...validateRequiredString(data.description, "description"));
	errors.push(...validateOptionalString(data.icon, "icon"));
	errors.push(...validateOptionalString(data.frontend, "frontend"));
	errors.push(...validateOptionalString(data.backend, "backend"));
	errors.push(...validateRequires(data.requires));
	if (data.contributes !== void 0) errors.push({
		path: "contributes",
		message: "Manifest contribution arrays are not supported; register contributions at runtime"
	});
	for (const key of Object.keys(data)) if (!Object.prototype.hasOwnProperty.call(OPENFORGE_PACKAGE_METADATA_SCHEMA.properties, key)) {
		if (key !== "contributes") errors.push({
			path: key,
			message: "Unknown OpenForge package metadata field"
		});
	}
	return errors;
}
var validatePluginPackageMetadata = validateOpenForgePackageMetadata;
function isOpenForgePackageMetadata(data) {
	return validateOpenForgePackageMetadata(data).length === 0;
}
var isPluginPackageMetadata = isOpenForgePackageMetadata;
//#endregion
//#region packages/plugin-sdk/src/testing.ts
var TestingSubscriptionSink = class {
	subscriptions = [];
	add(subscription) {
		if (typeof subscription === "function") {
			this.subscriptions.push(createDisposable(subscription));
			return;
		}
		if (!subscription || typeof subscription.dispose !== "function") throw new Error("context.subscriptions.add requires a disposable or cleanup function");
		this.subscriptions.push(subscription);
	}
	async disposeAll() {
		const subscriptions = this.subscriptions.splice(0).reverse();
		for (const subscription of subscriptions) await subscription.dispose();
	}
};
var TestingOpenForgeRegistryFake = class {
	pluginId;
	projectId;
	taskId;
	packageMetadata;
	calls;
	storage;
	frontendSubscriptions = new TestingSubscriptionSink();
	backendSubscriptions = new TestingSubscriptionSink();
	commands = /* @__PURE__ */ new Map();
	views = /* @__PURE__ */ new Map();
	taskPaneTabs = /* @__PURE__ */ new Map();
	settingsSections = /* @__PURE__ */ new Map();
	eventListeners = /* @__PURE__ */ new Map();
	eventHandlers = /* @__PURE__ */ new Map();
	backendMethods = /* @__PURE__ */ new Map();
	backgroundServices = /* @__PURE__ */ new Map();
	claimedIds = /* @__PURE__ */ new Set();
	config = /* @__PURE__ */ new Map();
	eventListenerSequence = 0;
	cachedFrontendApi = null;
	cachedBackendApi = null;
	constructor(options = {}) {
		this.pluginId = options.pluginId ?? "test-plugin";
		this.projectId = options.projectId ?? null;
		this.taskId = options.taskId ?? null;
		this.packageMetadata = options.packageMetadata ?? {
			id: this.pluginId,
			apiVersion: 1,
			displayName: this.pluginId,
			description: ""
		};
		this.calls = createTestingCalls();
		this.storage = options.storage ?? createMemoryPluginStorage(this.calls);
	}
	get frontendApi() {
		return this.createFrontendApi();
	}
	get backendApi() {
		return this.createBackendApi();
	}
	get snapshot() {
		return this.getSnapshot();
	}
	createFrontendApi() {
		if (this.cachedFrontendApi) return this.cachedFrontendApi;
		const api = {
			...this.createCommonApi(),
			views: { register: (registration) => this.registerView(registration) },
			taskPane: { registerTab: (registration) => this.registerTaskPaneTab(registration) },
			settings: { registerSection: (registration) => this.registerSettingsSection(registration) },
			backend: {
				state: "ready",
				whenReady: async () => void 0,
				onReady: (handler) => {
					handler();
					return createDisposable(() => void 0);
				},
				invoke: async (method, payload) => this.invokeBackend(method, payload)
			},
			__testing: {
				calls: this.calls,
				registry: this
			}
		};
		this.cachedFrontendApi = api;
		return api;
	}
	createBackendApi() {
		if (this.cachedBackendApi) return this.cachedBackendApi;
		const api = {
			...this.createCommonApi(),
			backend: { registerMethod: (method, registration) => this.registerBackendMethod(method, registration) },
			background: { register: (registration) => this.registerBackgroundService(registration) },
			__testing: {
				calls: this.calls,
				registry: this
			}
		};
		this.cachedBackendApi = api;
		return api;
	}
	createFrontendContext() {
		return this.createContext(this.frontendSubscriptions);
	}
	createBackendContext() {
		return this.createContext(this.backendSubscriptions);
	}
	async activateFrontend(plugin) {
		await plugin.activate(this.frontendApi, this.createFrontendContext());
	}
	async activateBackend(plugin) {
		const existingServices = new Set(this.backgroundServices.keys());
		await plugin.activate(this.backendApi, this.createBackendContext());
		await this.startBackgroundServices(existingServices);
	}
	async disposeAll() {
		await this.backendSubscriptions.disposeAll();
		await this.frontendSubscriptions.disposeAll();
	}
	getSnapshot() {
		return {
			pluginId: this.pluginId,
			projectId: this.projectId,
			views: Array.from(this.views.values()),
			taskPaneTabs: Array.from(this.taskPaneTabs.values()),
			settingsSections: Array.from(this.settingsSections.values()),
			commands: Array.from(this.commands.values()),
			eventListeners: Array.from(this.eventListeners.values()),
			backendMethods: Array.from(this.backendMethods.values()),
			backgroundServices: Array.from(this.backgroundServices.values())
		};
	}
	createContext(subscriptions) {
		return {
			pluginId: this.pluginId,
			apiVersion: 1,
			packageMetadata: this.packageMetadata,
			subscriptions
		};
	}
	createCommonApi() {
		return {
			commands: {
				register: (registration) => this.registerCommand(registration),
				invoke: async (id, payload) => this.invokeCommand(id, payload),
				invokeGlobal: async (qualifiedId, payload) => this.invokeGlobalCommand(qualifiedId, payload),
				list: async () => Array.from(this.commands.values()).map(commandDescriptor)
			},
			events: {
				on: (event, handler) => this.registerEventListener(event, handler, false),
				onGlobal: (qualifiedEvent, handler) => this.registerEventListener(qualifiedEvent, handler, true),
				emit: async (event, payload) => this.emitEvent(event, payload, false),
				emitGlobal: async (qualifiedEvent, payload) => this.emitEvent(qualifiedEvent, payload, true)
			},
			storage: this.storage,
			context: { getSnapshot: () => this.getContextSnapshot() },
			tasks: {
				list: async () => [],
				get: async (taskId) => {
					throw new Error(`Mock task not found: ${taskId}`);
				},
				updateSummary: async (taskId, summary) => {
					this.calls.taskSummaryUpdates.push({
						taskId,
						summary
					});
				},
				updateStatus: async (taskId, status) => {
					this.calls.taskStatusUpdates.push({
						taskId,
						status
					});
				},
				getWorkspace: async () => null,
				getLatestSession: async () => null
			},
			projects: {
				list: async () => [],
				get: async () => null
			},
			fs: {
				readDir: async () => [],
				readFile: async () => "",
				writeFile: async (request) => {
					this.calls.fsWrites.push(request);
				},
				searchFiles: async () => []
			},
			shell: {
				spawn: async (request) => {
					this.calls.shellSpawns.push(request);
					return 0;
				},
				write: async (request) => {
					this.calls.shellWrites.push(request);
				},
				resize: async (request) => {
					this.calls.shellResizes.push(request);
				},
				kill: async (request) => {
					this.calls.shellKills.push(request);
				},
				getBuffer: async () => null
			},
			notifications: { notify: async (request) => {
				this.calls.notify.push(request);
			} },
			attention: { listProjects: async () => [] },
			system: { openUrl: async (url) => {
				this.calls.openUrl.push(url);
			} },
			config: {
				get: async (key) => this.config.has(`global:${key}`) ? this.config.get(`global:${key}`) : null,
				set: async (key, value) => {
					this.config.set(`global:${key}`, value);
					this.calls.configWrites.push({
						key,
						value,
						projectId: null
					});
				}
			},
			projectConfig: {
				get: async (key, projectId = this.projectId ?? "") => this.config.has(`project:${projectId}:${key}`) ? this.config.get(`project:${projectId}:${key}`) : null,
				set: async (key, value, projectId = this.projectId ?? "") => {
					this.config.set(`project:${projectId}:${key}`, value);
					this.calls.configWrites.push({
						key,
						value,
						projectId
					});
				}
			}
		};
	}
	getContextSnapshot() {
		return {
			pluginId: this.pluginId,
			projectId: this.projectId,
			...this.taskId === null ? {} : { taskId: this.taskId }
		};
	}
	localQualifiedId(kind, id) {
		assertLocalId(kind, id);
		return `${this.pluginId}.${id.trim()}`;
	}
	claim(kind, qualifiedId) {
		const key = kind === "commands" ? `commands:${qualifiedId}` : `${kind}:${qualifiedId}`;
		if (this.claimedIds.has(key)) throw new Error(`Duplicate runtime contribution id: ${qualifiedId}`);
		this.claimedIds.add(key);
	}
	release(kind, qualifiedId) {
		const key = kind === "commands" ? `commands:${qualifiedId}` : `${kind}:${qualifiedId}`;
		this.claimedIds.delete(key);
	}
	registerCommand(registration) {
		const qualifiedId = this.localQualifiedId("commands", registration.id);
		assertTitle("commands", registration.title);
		assertFunction("commands", "handler", registration.handler);
		this.claim("commands", qualifiedId);
		const contribution = {
			...registration,
			id: registration.id.trim(),
			title: registration.title.trim(),
			qualifiedId,
			pluginId: this.pluginId,
			projectId: this.projectId,
			handler: registration.handler
		};
		this.commands.set(qualifiedId, contribution);
		return createDisposable(() => {
			this.commands.delete(qualifiedId);
			this.release("commands", qualifiedId);
		});
	}
	registerView(registration) {
		const qualifiedId = this.localQualifiedId("views", registration.id);
		assertTitle("views", registration.title);
		assertFunction("views", "component", registration.component);
		this.claim("views", qualifiedId);
		const contribution = {
			...registration,
			id: registration.id.trim(),
			title: registration.title.trim(),
			qualifiedId,
			pluginId: this.pluginId,
			projectId: this.projectId
		};
		this.views.set(qualifiedId, contribution);
		return createDisposable(() => {
			this.views.delete(qualifiedId);
			this.release("views", qualifiedId);
		});
	}
	registerTaskPaneTab(registration) {
		const qualifiedId = this.localQualifiedId("taskPane", registration.id);
		assertTitle("taskPane", registration.title);
		assertFunction("taskPane", "component", registration.component);
		this.claim("taskPane", qualifiedId);
		const contribution = {
			...registration,
			id: registration.id.trim(),
			title: registration.title.trim(),
			qualifiedId,
			pluginId: this.pluginId,
			projectId: this.projectId
		};
		this.taskPaneTabs.set(qualifiedId, contribution);
		return createDisposable(() => {
			this.taskPaneTabs.delete(qualifiedId);
			this.release("taskPane", qualifiedId);
		});
	}
	registerSettingsSection(registration) {
		const qualifiedId = this.localQualifiedId("settings", registration.id);
		assertTitle("settings", registration.title);
		assertFunction("settings", "component", registration.component);
		this.claim("settings", qualifiedId);
		const contribution = {
			...registration,
			id: registration.id.trim(),
			title: registration.title.trim(),
			qualifiedId,
			pluginId: this.pluginId,
			projectId: this.projectId
		};
		this.settingsSections.set(qualifiedId, contribution);
		return createDisposable(() => {
			this.settingsSections.delete(qualifiedId);
			this.release("settings", qualifiedId);
		});
	}
	registerBackendMethod(method, registration) {
		const qualifiedId = this.localQualifiedId("backend", method);
		assertFunction("backend", "handler", registration.handler);
		this.claim("backend", qualifiedId);
		const contribution = {
			id: method.trim(),
			qualifiedId,
			pluginId: this.pluginId,
			projectId: this.projectId,
			registration
		};
		this.backendMethods.set(qualifiedId, contribution);
		return createDisposable(() => {
			this.backendMethods.delete(qualifiedId);
			this.release("backend", qualifiedId);
		});
	}
	registerBackgroundService(registration) {
		const qualifiedId = this.localQualifiedId("background", registration.id);
		if (registration.scope !== "global" && registration.scope !== "project" && registration.scope !== "task") throw new Error("background registration requires scope to be global, project, or task");
		assertFunction("background", "start", registration.start);
		this.claim("background", qualifiedId);
		const contribution = {
			...registration,
			id: registration.id.trim(),
			qualifiedId,
			pluginId: this.pluginId,
			projectId: this.projectId,
			started: false
		};
		this.backgroundServices.set(qualifiedId, contribution);
		return createDisposable(async () => {
			this.backgroundServices.delete(qualifiedId);
			this.release("background", qualifiedId);
			if (contribution.started) {
				await contribution.stop?.();
				contribution.started = false;
			}
		});
	}
	registerEventListener(event, handler, global) {
		const qualifiedId = global ? event : this.localQualifiedId("events", event);
		if (qualifiedId.trim().length === 0) throw new Error("events registration requires a non-empty id");
		assertFunction("events", "handler", handler);
		const handlers = this.eventHandlers.get(qualifiedId) ?? /* @__PURE__ */ new Set();
		handlers.add(handler);
		this.eventHandlers.set(qualifiedId, handlers);
		const listenerKey = `${qualifiedId}#${++this.eventListenerSequence}`;
		const contribution = {
			id: event,
			qualifiedId,
			pluginId: this.pluginId,
			projectId: this.projectId,
			handler,
			global
		};
		this.eventListeners.set(listenerKey, contribution);
		return createDisposable(() => {
			handlers.delete(handler);
			if (handlers.size === 0) this.eventHandlers.delete(qualifiedId);
			this.eventListeners.delete(listenerKey);
		});
	}
	async startBackgroundServices(existingServices) {
		for (const [key, service] of this.backgroundServices.entries()) {
			if (existingServices.has(key) || service.started) continue;
			await service.start();
			service.started = true;
		}
	}
	async invokeCommand(id, payload) {
		const qualifiedId = this.localQualifiedId("commands", id);
		this.calls.commandInvocations.push({
			id,
			qualifiedId,
			payload
		});
		return this.invokeGlobalCommand(qualifiedId, payload);
	}
	async invokeGlobalCommand(qualifiedId, payload) {
		this.calls.globalCommandInvocations.push({
			qualifiedId,
			payload
		});
		const command = this.commands.get(qualifiedId);
		if (!command) throw new Error(`Unknown command: ${qualifiedId}`);
		return await command.handler(payload);
	}
	async invokeBackend(method, payload) {
		const qualifiedId = this.localQualifiedId("backend", method);
		this.calls.backendInvocations.push({
			method,
			qualifiedId,
			payload
		});
		const contribution = this.backendMethods.get(qualifiedId);
		if (!contribution) throw new Error(`Backend method is not registered: ${qualifiedId}`);
		return await contribution.registration.handler(payload);
	}
	async emitEvent(event, payload, global) {
		const qualifiedEvent = global ? event : this.localQualifiedId("events", event);
		if (global) this.calls.emittedGlobalEvents.push({
			qualifiedEvent,
			payload
		});
		else this.calls.emittedEvents.push({
			event,
			qualifiedEvent,
			payload
		});
		for (const handler of Array.from(this.eventHandlers.get(qualifiedEvent) ?? [])) handler(payload);
	}
};
function createOpenForgeRegistryFake(options = {}) {
	return new TestingOpenForgeRegistryFake(options);
}
function createMockOpenForgeApi(options = {}) {
	return createMockFrontendOpenForgeApi(options);
}
function createMockFrontendOpenForgeApi(options = {}) {
	return createOpenForgeRegistryFake(options).frontendApi;
}
function createMockBackendOpenForgeApi(options = {}) {
	return createOpenForgeRegistryFake(options).backendApi;
}
function createMockPluginContext(options = {}) {
	return createOpenForgeRegistryFake(options).createFrontendContext();
}
function createMemoryPluginStorage(calls = createTestingCalls()) {
	const values = /* @__PURE__ */ new Map();
	function scope(scopeKind, scopeId) {
		const prefix = `${scopeKind}:${scopeId ?? ""}:`;
		return {
			async get(key) {
				calls.storageGets.push({
					scope: scopeKind,
					scopeId,
					key
				});
				return values.has(`${prefix}${key}`) ? values.get(`${prefix}${key}`) : null;
			},
			async set(key, value) {
				values.set(`${prefix}${key}`, value);
				calls.storageSets.push({
					scope: scopeKind,
					scopeId,
					key,
					value
				});
			},
			async delete(key) {
				values.delete(`${prefix}${key}`);
				calls.storageDeletes.push({
					scope: scopeKind,
					scopeId,
					key
				});
			}
		};
	}
	return {
		global: scope("global", null),
		project: (projectId) => scope("project", projectId),
		task: (taskId) => scope("task", taskId)
	};
}
function createTestingCalls() {
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
		storageDeletes: []
	};
}
function commandDescriptor(command) {
	return {
		id: command.id,
		qualifiedId: command.qualifiedId,
		pluginId: command.pluginId,
		projectId: command.projectId,
		title: command.title,
		icon: command.icon,
		shortcut: command.shortcut,
		input: command.input,
		output: command.output
	};
}
function createDisposable(dispose) {
	let disposed = false;
	return { async dispose() {
		if (disposed) return;
		disposed = true;
		await dispose();
	} };
}
function assertLocalId(kind, id) {
	if (typeof id !== "string" || id.trim().length === 0) throw new Error(`${kind} registration requires a non-empty id`);
	const trimmed = id.trim();
	if (trimmed.startsWith("openforge.")) throw new Error(`${kind} registration cannot use openforge.* reserved namespace`);
	if (trimmed.includes(":") || trimmed.startsWith(".") || trimmed.endsWith(".") || trimmed.includes("..")) throw new Error(`${kind} registration has invalid id "${trimmed}"`);
}
function assertTitle(kind, title) {
	if (typeof title !== "string" || title.trim().length === 0) throw new Error(`${kind} registration requires a non-empty title`);
}
function assertFunction(kind, field, value) {
	if (typeof value !== "function") throw new Error(`${kind} registration requires a ${field} function`);
}
//#endregion
//#region packages/plugin-sdk/src/numberParsing.ts
var STRICT_FINITE_NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
function parseStrictFiniteNumber(value) {
	if (!STRICT_FINITE_NUMBER_PATTERN.test(value)) return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}
//#endregion
//#region packages/plugin-sdk/src/domain.ts
function hasMergeConflicts(pr) {
	if (pr.state !== "open") return false;
	const mergeableState = pr.mergeable_state?.toLowerCase() ?? null;
	return mergeableState === "dirty" || mergeableState === "conflicting";
}
/** Check if a PR is ready to merge based on GitHub's mergeable_state field */
function isReadyToMerge(pr) {
	if (pr.state !== "open") return false;
	const mergeableState = pr.mergeable_state?.toLowerCase() ?? null;
	return mergeableState === "clean" || mergeableState === "behind";
}
/** Check if a PR is queued in a merge queue (ready to merge + is_queued) */
function isQueuedForMerge(pr) {
	return pr.state === "open" && pr.is_queued;
}
/** Preserves optimistic and definitive states across transient background syncs */
function preservePullRequestState(oldPr, newPr) {
	if (!oldPr) return newPr;
	const result = { ...newPr };
	if (oldPr.state === "merged" && result.state === "open") {
		result.state = "merged";
		result.merged_at = oldPr.merged_at;
	}
	const isTransient = result.mergeable === null || result.mergeable_state === "unknown" || result.mergeable_state === null;
	const oldIsDefinitive = oldPr.mergeable_state !== "unknown" && oldPr.mergeable_state !== null;
	if (isTransient && oldIsDefinitive) {
		result.mergeable = oldPr.mergeable;
		result.mergeable_state = oldPr.mergeable_state;
	}
	return result;
}
function getSkillIdentity(skill) {
	return {
		name: skill.name,
		level: skill.level,
		source_dir: skill.source_dir
	};
}
function isSameSkillIdentity(skill, identity) {
	return identity !== null && skill.name === identity.name && skill.level === identity.level && skill.source_dir === identity.source_dir;
}
function parseCheckRuns(json) {
	if (!json) return [];
	try {
		return JSON.parse(json);
	} catch {
		return [];
	}
}
/** Split check runs into visible (non-passing) and a count of hidden passing checks. */
function splitCheckRuns(checks) {
	const visible = [];
	let passingCount = 0;
	for (const check of checks) if (check.status === "completed" && check.conclusion === "success") passingCount++;
	else visible.push(check);
	return {
		visible,
		passingCount
	};
}
//#endregion
export { MAX_SUPPORTED_API_VERSION, MIN_SUPPORTED_API_VERSION, OPENFORGE_PACKAGE_METADATA_SCHEMA, OPENFORGE_PLUGIN_API_VERSION, OPENFORGE_PLUGIN_CAPABILITIES, SUPPORTED_OPENFORGE_API_VERSIONS, TestingOpenForgeRegistryFake, TestingSubscriptionSink, createMemoryPluginStorage, createMockBackendOpenForgeApi, createMockFrontendOpenForgeApi, createMockOpenForgeApi, createMockPluginContext, createOpenForgeRegistryFake, createTestingCalls, getSkillIdentity, hasMergeConflicts, isOpenForgePackageMetadata, isPluginPackageMetadata, isPluginViewKey, isQueuedForMerge, isReadyToMerge, isSameSkillIdentity, isSupportedOpenForgeApiVersion, makePluginViewKey, parseCheckRuns, parsePluginViewKey, parseStrictFiniteNumber, preservePullRequestState, splitCheckRuns, validateOpenForgePackageMetadata, validatePluginPackageMetadata };
