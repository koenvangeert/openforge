import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
	invokeMock: vi.fn(),
}));

vi.mock("./desktopIpc", () => ({
	invokeDesktopCommand: invokeMock,
	isElectronDesktopBridgeAvailable: vi.fn(() => true),
}));

import {
	checkPiInstalled,
	createTask,
	fsSearchFiles,
	getAllTasks,
	getCommitBatchFileContents,
	getTaskBatchFileContents,
	getPtyBuffer,
	registerBuiltinPlugin,
	installPluginFromGit,
	installPluginFromLocal,
	installPluginFromNpm,
	installPluginFromSource,
	killPty,
	killShellsForTask,
	resizePty,
	spawnShellPty,
	transcribeAudio,
	updateTask,
	updateTaskSummary,
	writePty,
} from "./ipc";

type PtyPayloadFixture = {
	name: string;
	command: string;
	payload: Record<string, unknown>;
}

const ptyPayloadContracts = JSON.parse(
	readFileSync(resolve(process.cwd(), "src-tauri/src/app_invoke/tests/fixtures/pty_payload_contracts.json"), "utf8"),
) as { valid: PtyPayloadFixture[] };

function ptyFixture(command: string, name: string): PtyPayloadFixture {
	const fixture = ptyPayloadContracts.valid.find((entry) => entry.command === command && entry.name === name);
	if (!fixture) throw new Error(`Missing PTY payload fixture ${command}/${name}`);
	return fixture;
}

describe("ipc spawnShellPty", () => {
	beforeEach(() => {
		invokeMock.mockReset();
		invokeMock.mockResolvedValue(7);
	});

	it("sends terminalIndex in the invoke payload for shell tabs", async () => {
		await spawnShellPty("T-42", "/tmp/worktree", 80, 24, 1);

		expect(invokeMock).toHaveBeenCalledWith("pty_spawn_shell", {
			taskId: "T-42",
			cwd: "/tmp/worktree",
			cols: 80,
			rows: 24,
			terminalIndex: 1,
		});
	});

	it("keeps renderer PTY payloads aligned with the Rust decoder contract fixtures", async () => {
		const spawnShell = ptyFixture("pty_spawn_shell", "spawn_shell_with_index");
		await spawnShellPty("T-pty", "/tmp/openforge-worktree", 80, 24, 2);
		expect(invokeMock).toHaveBeenLastCalledWith(spawnShell.command, spawnShell.payload);

		const write = ptyFixture("pty_write", "write_pty");
		await writePty("T-pty", "echo ready\n");
		expect(invokeMock).toHaveBeenLastCalledWith(write.command, write.payload);

		const resize = ptyFixture("pty_resize", "resize_pty");
		await resizePty("T-pty", 120, 40);
		expect(invokeMock).toHaveBeenLastCalledWith(resize.command, resize.payload);

		const kill = ptyFixture("pty_kill", "kill_pty");
		await killPty("T-pty");
		expect(invokeMock).toHaveBeenLastCalledWith(kill.command, kill.payload);

		const killShells = ptyFixture("pty_kill_shells_for_task", "kill_shells_for_task");
		await killShellsForTask("T-pty");
		expect(invokeMock).toHaveBeenLastCalledWith(killShells.command, killShells.payload);

		const buffer = ptyFixture("get_pty_buffer", "get_pty_buffer");
		await getPtyBuffer("T-pty");
		expect(invokeMock).toHaveBeenLastCalledWith(buffer.command, buffer.payload);
	});

	it("normalizes legacy board statuses in task responses", async () => {
		invokeMock.mockResolvedValueOnce([
			{
				id: "T-1",
				initial_prompt: "Legacy task",
				status: "todo",
				prompt: null,
				summary: null,
				agent: null,
				permission_mode: null,
				depends_on: [],
				project_id: null,
				created_at: 1000,
				updated_at: 1000,
			},
		]);

		await expect(getAllTasks()).resolves.toEqual([
			expect.objectContaining({ id: "T-1", status: "backlog" }),
		]);
	});

	it("rejects unknown task statuses from the backend boundary", async () => {
		invokeMock.mockResolvedValueOnce([
			{
				id: "T-2",
				initial_prompt: "Broken task",
				status: "wat",
				prompt: null,
				summary: null,
				agent: null,
				permission_mode: null,
				depends_on: [],
				project_id: null,
				created_at: 1000,
				updated_at: 1000,
			},
		]);

		await expect(getAllTasks()).rejects.toThrow("Invalid board status: wat");
	});

	it("normalizes createTask responses before returning to the UI", async () => {
		invokeMock.mockResolvedValueOnce({
			id: "T-4",
			initial_prompt: "Created task",
			status: "testing",
			prompt: null,
			summary: null,
			agent: null,
			permission_mode: null,
			depends_on: [],
			project_id: null,
			created_at: 1000,
			updated_at: 1000,
		});

		await expect(
			createTask("Created task", "doing", null, null),
		).resolves.toEqual(expect.objectContaining({ id: "T-4", status: "doing" }));
		expect(invokeMock).toHaveBeenCalledWith("create_task", {
			initialPrompt: "Created task",
			status: "doing",
			projectId: null,
			permissionMode: null,
			dependsOn: [],
			labelNames: [],
		});
	});

	it("sends task edits as mutable prompt updates, not initialPrompt updates", async () => {
		await updateTask("T-42", "Updated prompt");

		expect(invokeMock).toHaveBeenCalledWith("update_task", {
			id: "T-42",
			prompt: "Updated prompt",
		});
	});

	it("sends summary updates without initialPrompt", async () => {
		await updateTaskSummary("T-42", "Done");

		expect(invokeMock).toHaveBeenCalledWith("update_task_summary", {
			id: "T-42",
			summary: "Done",
		});
	});

	it("preserves snake_case nested file payload keys for task batch contents", async () => {
		await getTaskBatchFileContents("T-42", [{ path: "src/App.svelte", oldPath: "src/Old.svelte", status: "renamed" }], true);

		expect(invokeMock).toHaveBeenCalledWith("get_task_batch_file_contents", {
			taskId: "T-42",
			files: [{ path: "src/App.svelte", old_path: "src/Old.svelte", status: "renamed" }],
			includeUncommitted: true,
		});
	});

	it("preserves snake_case nested file payload keys for commit batch contents", async () => {
		await getCommitBatchFileContents("T-42", "abc123", [{ path: "src/App.svelte", oldPath: null, status: "added" }]);

		expect(invokeMock).toHaveBeenCalledWith("get_commit_batch_file_contents", {
			taskId: "T-42",
			commitSha: "abc123",
			files: [{ path: "src/App.svelte", old_path: null, status: "added" }],
		});
	});

	it("sends registerBuiltinPlugin metadata as a single trusted builtin command argument", async () => {
		await registerBuiltinPlugin({
			id: "com.openforge.file-viewer",
			name: "File Viewer",
			version: "1.2.3",
			apiVersion: 1,
			description: "Built-in file viewer",
			permissions: "[]",
			contributes: "{}",
			frontendEntry: "./dist/frontend.js",
			backendEntry: null,
			installPath: "builtin:com.openforge.file-viewer",
			sourceKind: "builtin",
			sourceSpec: "com.openforge.file-viewer",
			packageMetadata: "{}",
			installedAt: 1234,
			isBuiltin: true,
		});

		expect(invokeMock).toHaveBeenCalledWith("register_builtin_plugin", {
			plugin: {
				id: "com.openforge.file-viewer",
				name: "File Viewer",
				version: "1.2.3",
				apiVersion: 1,
				description: "Built-in file viewer",
				permissions: "[]",
				contributes: "{}",
				frontendEntry: "./dist/frontend.js",
				backendEntry: null,
				installPath: "builtin:com.openforge.file-viewer",
				sourceKind: "builtin",
				sourceSpec: "com.openforge.file-viewer",
				packageMetadata: "{}",
				installedAt: 1234,
				isBuiltin: true,
			},
		});
	});

	it("routes package-source plugin installs through typed IPC payloads", async () => {
		invokeMock.mockResolvedValue({
			id: "com.example.plugin",
			name: "Example Plugin",
			version: "1.2.3",
			api_version: 1,
			description: "Adds examples",
			permissions: "[]",
			contributes: "{}",
			frontend_entry: "dist/frontend.js",
			backend_entry: null,
			install_path: "/plugins/example",
			source_kind: "npm",
			source_spec: "npm:@example/plugin@1.2.3",
			package_metadata: "{}",
			installed_at: 1234,
			is_builtin: false,
		});

		await expect(installPluginFromNpm("@example/plugin@1.2.3")).resolves.toMatchObject({
			id: "com.example.plugin",
			sourceKind: "npm",
			sourceSpec: "npm:@example/plugin@1.2.3",
		});
		expect(invokeMock).toHaveBeenLastCalledWith("install_plugin_from_npm", { packageName: "@example/plugin@1.2.3" });

		await installPluginFromGit("github.com/example/openforge-plugin@main");
		expect(invokeMock).toHaveBeenLastCalledWith("install_plugin_from_git", { gitSpec: "github.com/example/openforge-plugin@main" });

		await installPluginFromLocal("/Users/me/plugin");
		expect(invokeMock).toHaveBeenLastCalledWith("install_plugin_from_local", { sourcePath: "/Users/me/plugin" });

		await installPluginFromSource("git:github.com/example/openforge-plugin@main");
		expect(invokeMock).toHaveBeenLastCalledWith("install_plugin_from_source", { sourceSpec: "git:github.com/example/openforge-plugin@main" });
	});

	it("encodes voice audio as base64 little-endian Float32 PCM instead of a JSON number array", async () => {
		await transcribeAudio(new Float32Array([0, 0.25, -0.25]));

		expect(invokeMock).toHaveBeenCalledWith("transcribe_audio", {
			audioPcmBase64: "AAAAAAAAgD4AAIC+",
		});
	});
});

describe("ipc checkPiInstalled", () => {
	beforeEach(() => {
		invokeMock.mockReset();
		invokeMock.mockResolvedValue({
			installed: true,
			path: "/usr/local/bin/pi",
			version: "1.2.3",
		});
	});

	it("calls check_pi_installed", async () => {
		await checkPiInstalled();

		expect(invokeMock).toHaveBeenCalledWith("check_pi_installed");
	});

	it("returns the installed/path/version shape", async () => {
		await expect(checkPiInstalled()).resolves.toEqual({
			installed: true,
			path: "/usr/local/bin/pi",
			version: "1.2.3",
		});
	});
});

describe("ipc fsSearchFiles", () => {
	beforeEach(() => {
		invokeMock.mockReset();
		invokeMock.mockResolvedValue(["src/lib/ipc.ts", "src/lib/types.ts"]);
	});

	it("calls fs_search_files with correct payload including limit", async () => {
		await fsSearchFiles("P-1", "ipc", 30);
		expect(invokeMock).toHaveBeenCalledWith("fs_search_files", {
			projectId: "P-1",
			query: "ipc",
			limit: 30,
		});
	});

	it("defaults limit to 50 when not specified", async () => {
		await fsSearchFiles("P-1", "foo");
		expect(invokeMock).toHaveBeenCalledWith("fs_search_files", {
			projectId: "P-1",
			query: "foo",
			limit: 50,
		});
	});

	it("returns string array from invoke", async () => {
		const result = await fsSearchFiles("P-1", "test");
		expect(result).toEqual(["src/lib/ipc.ts", "src/lib/types.ts"]);
	});
});
