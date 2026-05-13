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
export { MAX_SUPPORTED_API_VERSION, MIN_SUPPORTED_API_VERSION, OPENFORGE_PACKAGE_METADATA_SCHEMA, OPENFORGE_PLUGIN_API_VERSION, OPENFORGE_PLUGIN_CAPABILITIES, SUPPORTED_OPENFORGE_API_VERSIONS, getSkillIdentity, hasMergeConflicts, isOpenForgePackageMetadata, isPluginPackageMetadata, isPluginViewKey, isQueuedForMerge, isReadyToMerge, isSameSkillIdentity, isSupportedOpenForgeApiVersion, makePluginViewKey, parseCheckRuns, parsePluginViewKey, parseStrictFiniteNumber, preservePullRequestState, splitCheckRuns, validateOpenForgePackageMetadata, validatePluginPackageMetadata };
