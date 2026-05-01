import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
	invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
	invoke: invokeMock,
}));

import {
	checkPiInstalled,
	createTask,
	fsSearchFiles,
	getAllTasks,
	installPlugin,
	spawnShellPty,
	updateTask,
	updateTaskSummary,
} from "./ipc";

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
			project_id: null,
			created_at: 1000,
			updated_at: 1000,
		});

		await expect(
			createTask("Created task", "doing", null, null, null),
		).resolves.toEqual(expect.objectContaining({ id: "T-4", status: "doing" }));
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

	it("sends installPlugin metadata as a single command argument", async () => {
		await installPlugin({
			id: "com.example.plugin",
			name: "Example Plugin",
			version: "1.2.3",
			apiVersion: 1,
			description: "Adds examples",
			permissions: "[]",
			contributes: "{}",
			frontendEntry: "index.js",
			backendEntry: null,
			installPath: "/plugins/example",
			installedAt: 1234,
			isBuiltin: false,
		});

		expect(invokeMock).toHaveBeenCalledWith("install_plugin", {
			plugin: {
				id: "com.example.plugin",
				name: "Example Plugin",
				version: "1.2.3",
				apiVersion: 1,
				description: "Adds examples",
				permissions: "[]",
				contributes: "{}",
				frontendEntry: "index.js",
				backendEntry: null,
				installPath: "/plugins/example",
				installedAt: 1234,
				isBuiltin: false,
			},
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
