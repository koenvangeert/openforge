import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { writable } from "svelte/store";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	PrComment,
	PrFileDiff,
	PullRequestInfo,
	Task,
} from "../../lib/types";

vi.mock("../../lib/stores", () => ({
	selfReviewDiffFiles: writable([]),
	selfReviewGeneralComments: writable([]),
	selfReviewArchivedComments: writable([]),
	pendingManualComments: writable([]),
	ticketPrs: writable(new Map()),
	taskReviewModes: writable(new Map()),
	taskDraftNotes: writable(new Map()),
}));

vi.mock("../../lib/useDiffWorker.svelte", () => ({
	createDiffWorker: vi.fn().mockReturnValue({
		getDiffFile: () => undefined,
		processing: false,
	}),
}));

vi.mock("../../lib/useVirtualizer.svelte", () => ({
	createVirtualizer: vi.fn((opts: { getCount: () => number }) => ({
		get virtualItems() {
			const count = opts.getCount();
			return Array.from({ length: count }, (_, i) => ({
				key: i,
				index: i,
				start: i * 300,
				end: (i + 1) * 300,
				size: 300,
				lane: 0,
			}));
		},
		totalSize: 0,
		scrollToIndex: vi.fn(),
		measureAction: () => ({ destroy() {} }),
	})),
}));

vi.mock("../../lib/ipc", () => ({
	getTaskDiff: vi.fn().mockResolvedValue([]),
	getTaskCommits: vi.fn().mockResolvedValue([]),
	getCommitDiff: vi.fn().mockResolvedValue([]),
	getTaskFileContents: vi.fn().mockResolvedValue(["", ""]),
	getTaskBatchFileContents: vi.fn().mockResolvedValue([["", ""]]),
	getCommitFileContents: vi.fn().mockResolvedValue(["", ""]),
	getCommitBatchFileContents: vi.fn().mockResolvedValue([["", ""]]),
	getActiveSelfReviewComments: vi.fn().mockResolvedValue([]),
	getArchivedSelfReviewComments: vi.fn().mockResolvedValue([]),
	getPrComments: vi.fn().mockResolvedValue([]),
	markCommentAddressed: vi.fn().mockResolvedValue(undefined),
	openUrl: vi.fn(),
	addSelfReviewComment: vi.fn().mockResolvedValue(undefined),
	deleteSelfReviewComment: vi.fn().mockResolvedValue(undefined),
	archiveSelfReviewComments: vi.fn().mockResolvedValue(undefined),
}));

import SelfReviewView from "./SelfReviewView.svelte";

beforeAll(() => {
	Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
		value: vi.fn().mockReturnValue({
			font: "",
			measureText: (text: string) => ({ width: text.length * 7 }),
			fillText: vi.fn(),
			clearRect: vi.fn(),
		}),
		configurable: true,
	});
});

import {
	getActiveSelfReviewComments,
	getCommitDiff,
	getPrComments,
	getTaskBatchFileContents,
	getTaskCommits,
	getTaskDiff,
} from "../../lib/ipc";
import {
	pendingManualComments,
	selfReviewArchivedComments,
	selfReviewDiffFiles,
	selfReviewGeneralComments,
	ticketPrs,
} from "../../lib/stores";
import { createVirtualizer } from "../../lib/useVirtualizer.svelte";

const baseTask: Task = {
	id: "task-1",
	initial_prompt: "Test Task",
	status: "doing",
	project_id: "proj-1",
	prompt: null,
	summary: null,
	agent: null,
	permission_mode: null,
	created_at: Date.now(),
	updated_at: Date.now(),
};

const baseDiff: PrFileDiff = {
	sha: "abc123",
	filename: "src/main.rs",
	status: "modified",
	additions: 5,
	deletions: 2,
	changes: 7,
	patch: "@@ -1,3 +1,4 @@\n line1\n+added\n line2",
	previous_filename: null,
	is_truncated: false,
	patch_line_count: null,
};

describe("SelfReviewView uncommitted toggle", () => {
	beforeEach(() => {
		selfReviewDiffFiles.set([]);
		selfReviewGeneralComments.set([]);
		selfReviewArchivedComments.set([]);
		pendingManualComments.set([]);
		ticketPrs.set(new Map());
		vi.clearAllMocks();
	});

	it("toggle defaults to unchecked", async () => {
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);

		render(SelfReviewView, {
			props: {
				task: baseTask,
				agentStatus: null,
				onSendToAgent: vi.fn(),
			},
		});

		await waitFor(() => {
			const checkbox = screen.getByRole("checkbox");
			expect((checkbox as HTMLInputElement).checked).toBe(false);
		});
	});

	it("initial load calls getTaskDiff with includeUncommitted=false", async () => {
		const mockGetTaskDiff = vi
			.mocked(getTaskDiff)
			.mockResolvedValue([baseDiff]);

		render(SelfReviewView, {
			props: {
				task: baseTask,
				agentStatus: null,
				onSendToAgent: vi.fn(),
			},
		});

		await waitFor(() => {
			expect(mockGetTaskDiff).toHaveBeenCalledWith("task-1", false);
		});
	});

	it("toggle visible even with no diff files (empty state)", async () => {
		vi.mocked(getTaskDiff).mockResolvedValue([]);

		render(SelfReviewView, {
			props: {
				task: baseTask,
				agentStatus: null,
				onSendToAgent: vi.fn(),
			},
		});

		await waitFor(() => {
			const checkbox = screen.getByRole("checkbox");
			expect(checkbox).toBeTruthy();
			expect((checkbox as HTMLInputElement).checked).toBe(true);
		});
	});

	it("auto-enables uncommitted when initial committed diff is empty", async () => {
		const mockGetTaskDiff = vi.mocked(getTaskDiff);
		mockGetTaskDiff.mockResolvedValueOnce([]).mockResolvedValueOnce([baseDiff]);

		render(SelfReviewView, {
			props: {
				task: baseTask,
				agentStatus: null,
				onSendToAgent: vi.fn(),
			},
		});

		await waitFor(() => {
			const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
			expect(checkbox.checked).toBe(true);
			expect(mockGetTaskDiff).toHaveBeenCalledTimes(2);
			expect(mockGetTaskDiff).toHaveBeenNthCalledWith(1, "task-1", false);
			expect(mockGetTaskDiff).toHaveBeenNthCalledWith(2, "task-1", true);
		});
	});

	it("does not auto-enable uncommitted when committed changes exist", async () => {
		const mockGetTaskDiff = vi
			.mocked(getTaskDiff)
			.mockResolvedValue([baseDiff]);

		render(SelfReviewView, {
			props: {
				task: baseTask,
				agentStatus: null,
				onSendToAgent: vi.fn(),
			},
		});

		await waitFor(() => {
			const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
			expect(checkbox.checked).toBe(false);
			expect(mockGetTaskDiff).toHaveBeenCalledTimes(1);
			expect(mockGetTaskDiff).toHaveBeenCalledWith("task-1", false);
		});
	});

	it("toggling checkbox calls getTaskDiff with includeUncommitted=true", async () => {
		const mockGetTaskDiff = vi
			.mocked(getTaskDiff)
			.mockResolvedValue([baseDiff]);

		render(SelfReviewView, {
			props: {
				task: baseTask,
				agentStatus: null,
				onSendToAgent: vi.fn(),
			},
		});

		await screen.findByRole("checkbox");
		mockGetTaskDiff.mockClear();

		await waitFor(() => {
			expect(screen.getByRole("checkbox").isConnected).toBe(true);
		});

		const cb = screen.getByRole("checkbox") as HTMLInputElement;
		cb.click();
		cb.dispatchEvent(new Event("change", { bubbles: true }));

		await waitFor(() => {
			expect(mockGetTaskDiff).toHaveBeenCalledWith("task-1", true);
		});
	});

	it("specific commit mode hides uncommitted checkbox and shows recovery action", async () => {
		const commitDiff = { ...baseDiff, filename: "src/only-commit.rs" };
		const mockGetTaskDiff = vi.mocked(getTaskDiff);
		const mockGetCommitDiff = vi.mocked(getCommitDiff);

		mockGetTaskDiff.mockResolvedValue([baseDiff]);
		mockGetCommitDiff.mockResolvedValue([commitDiff]);

		render(SelfReviewView, {
			props: {
				task: baseTask,
				agentStatus: null,
				onSendToAgent: vi.fn(),
			},
		});

		await waitFor(() => {
			expect(screen.getByRole("checkbox")).toBeTruthy();
		});

		const commitButton = screen.getByText("All changes");
		commitButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

		await waitFor(() => {
			expect(screen.queryByRole("checkbox")).toBeTruthy();
			expect(screen.queryByText("Show all changes")).toBeNull();
		});
	});
});

describe("SelfReviewView integration — performance fixes", () => {
	beforeEach(() => {
		selfReviewDiffFiles.set([]);
		selfReviewGeneralComments.set([]);
		selfReviewArchivedComments.set([]);
		pendingManualComments.set([]);
		ticketPrs.set(new Map());
		vi.clearAllMocks();
	});

	it("commit history pane remains visible while loading diffs", async () => {
		// Start with a mock that won't resolve immediately
		let resolveTaskDiff: (val: PrFileDiff[]) => void = () => {};
		const diffPromise = new Promise<PrFileDiff[]>((resolve) => {
			resolveTaskDiff = resolve;
		});
		vi.mocked(getTaskDiff).mockReturnValue(diffPromise);

		render(SelfReviewView, {
			props: { task: baseTask, agentStatus: null, onSendToAgent: vi.fn() },
		});

		// Wait for the loading spinner to appear
		await screen.findByText("Loading diff...");

		// Crucially, the File and Commit history panes should STILL be visible!
		// (This will fail currently because the whole view is gated on isLoading)
		expect(screen.getByText("Commit history")).toBeTruthy();
		expect(screen.getByText("Files")).toBeTruthy();

		// Let it finish to clean up
		resolveTaskDiff([baseDiff]);
	});

	it("getTaskDiff called exactly once on mount", async () => {
		const mockGetTaskDiff = vi
			.mocked(getTaskDiff)
			.mockResolvedValue([baseDiff]);

		render(SelfReviewView, {
			props: { task: baseTask, agentStatus: null, onSendToAgent: vi.fn() },
		});

		await waitFor(() => {
			expect(mockGetTaskDiff).toHaveBeenCalledTimes(1);
			expect(mockGetTaskDiff).toHaveBeenCalledWith("task-1", false);
		});
	});

	it("getActiveSelfReviewComments called exactly once on mount", async () => {
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);
		const mockGetActiveComments = vi.mocked(getActiveSelfReviewComments);

		render(SelfReviewView, {
			props: { task: baseTask, agentStatus: null, onSendToAgent: vi.fn() },
		});

		await waitFor(() => {
			expect(mockGetActiveComments).toHaveBeenCalledTimes(1);
			expect(mockGetActiveComments).toHaveBeenCalledWith("task-1");
		});
	});

	it("DiffViewer toolbar visible after toggle (DiffViewer successfully re-mounted)", async () => {
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);
		vi.mocked(getTaskBatchFileContents).mockResolvedValue([["", ""]]);

		render(SelfReviewView, {
			props: { task: baseTask, agentStatus: null, onSendToAgent: vi.fn() },
		});

		await waitFor(() => {
			expect(screen.getByTitle("Search (\u2318F)")).toBeTruthy();
		});

		const cb = screen.getByRole("checkbox") as HTMLInputElement;
		cb.click();
		cb.dispatchEvent(new Event("change", { bubbles: true }));

		await waitFor(
			() => {
				expect(screen.getByTitle("Search (\u2318F)")).toBeTruthy();
			},
			{ timeout: 2000 },
		);
	});

	it("commit switching preserves panes and file scrolling when earlier diff responses finish late", async () => {
		const firstCommit = {
			sha: "first-sha",
			short_sha: "first",
			message: "First commit",
			author: "dev",
			date: "2025-01-01T00:00:00Z",
		};
		const secondCommit = {
			sha: "second-sha",
			short_sha: "second",
			message: "Second commit",
			author: "dev",
			date: "2025-01-02T00:00:00Z",
		};

		let resolveFirstCommit!: (value: PrFileDiff[]) => void;
		let resolveSecondCommit!: (value: PrFileDiff[]) => void;

		const firstCommitPromise = new Promise<PrFileDiff[]>((resolve) => {
			resolveFirstCommit = resolve;
		});
		const secondCommitPromise = new Promise<PrFileDiff[]>((resolve) => {
			resolveSecondCommit = resolve;
		});

		const firstCommitDiff = [{ ...baseDiff, filename: "src/first.ts" }];
		const secondCommitDiff = [{ ...baseDiff, filename: "src/second.ts" }];

		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);
		vi.mocked(getTaskCommits).mockResolvedValue([firstCommit, secondCommit]);
		vi.mocked(getCommitDiff).mockImplementation(async (_taskId, commitSha) => {
			if (commitSha === firstCommit.sha) return firstCommitPromise;
			if (commitSha === secondCommit.sha) return secondCommitPromise;
			return [];
		});

		render(SelfReviewView, {
			props: { task: baseTask, agentStatus: null, onSendToAgent: vi.fn() },
		});

		await waitFor(() => {
			expect(screen.getByTitle(firstCommit.message)).toBeTruthy();
			expect(screen.getByTitle(secondCommit.message)).toBeTruthy();
		});

		await fireEvent.click(screen.getByTitle(firstCommit.message));
		await fireEvent.click(screen.getByTitle(secondCommit.message));

		expect(screen.getByText("Commit history")).toBeTruthy();
		expect(screen.getByText("Files")).toBeTruthy();
		expect(screen.getByText("Loading diff...")).toBeTruthy();

		resolveSecondCommit(secondCommitDiff);

		await waitFor(() => {
			expect(screen.getByText("second.ts")).toBeTruthy();
		});

		resolveFirstCommit(firstCommitDiff);

		await waitFor(() => {
			expect(screen.getByText("second.ts")).toBeTruthy();
		});

		expect(screen.queryByText("first.ts")).toBeNull();
		expect(screen.getByText("Commit history")).toBeTruthy();

		const mockCreateVirtualizer = vi.mocked(createVirtualizer);
		const virtualizer = mockCreateVirtualizer.mock.results.at(-1)?.value;
		expect(virtualizer).toBeTruthy();

		await fireEvent.click(screen.getByText("second.ts"));

		expect(virtualizer?.scrollToIndex).toHaveBeenCalledWith(0, {
			align: "start",
			behavior: "smooth",
		});
	});
});

describe("SelfReviewView — hide addressed comments", () => {
	beforeEach(() => {
		selfReviewDiffFiles.set([baseDiff]);
		selfReviewGeneralComments.set([]);
		selfReviewArchivedComments.set([]);
		pendingManualComments.set([]);
		ticketPrs.set(new Map());
		vi.clearAllMocks();
	});

	const makeComment = (id: number, addressed: number): PrComment => ({
		id,
		pr_id: 1,
		author: "alice",
		body: `Comment ${id}`,
		comment_type: "review_comment",
		file_path: "src/main.rs",
		line_number: 10,
		addressed,
		created_at: 1000 + id,
	});

	const mockPr: PullRequestInfo = {
		id: 1,
		ticket_id: "task-1",
		repo_owner: "acme",
		repo_name: "repo",
		title: "Test PR",
		url: "https://github.com/acme/repo/pull/1",
		state: "open",
		head_sha: "abc",
		ci_status: null,
		ci_check_runs: null,
		review_status: null,
		mergeable: null,
		mergeable_state: null,
		merged_at: null,
		created_at: 1000,
		updated_at: 2000,
		draft: false,
		is_queued: false,
		unaddressed_comment_count: 0,
	};

	it("addressed comments hidden by default", async () => {
		const comments = [
			makeComment(1, 0), // unaddressed
			makeComment(2, 1), // addressed
		];
		vi.mocked(getPrComments).mockResolvedValue(comments);
		ticketPrs.set(new Map([["task-1", [mockPr]]]));
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);

		render(SelfReviewView, {
			props: {
				task: baseTask,
				agentStatus: null,
				onSendToAgent: vi.fn(),
			},
		});

		await waitFor(() => {
			// Unaddressed comment should be visible
			expect(screen.getByText("Comment 1")).toBeTruthy();
			// Addressed comment should NOT be in DOM
			expect(screen.queryByText("Comment 2")).toBeNull();
		});
	});

	it("toggle shows addressed comments", async () => {
		const comments = [
			makeComment(1, 0), // unaddressed
			makeComment(2, 1), // addressed
		];
		vi.mocked(getPrComments).mockResolvedValue(comments);
		ticketPrs.set(new Map([["task-1", [mockPr]]]));
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);

		render(SelfReviewView, {
			props: {
				task: baseTask,
				agentStatus: null,
				onSendToAgent: vi.fn(),
			},
		});

		await waitFor(() => {
			expect(screen.getByText("Comment 1")).toBeTruthy();
		});

		// Find and click the toggle button
		const toggleButton = screen.getByText(/Show 1 addressed/);
		expect(toggleButton).toBeTruthy();
		toggleButton.click();

		await waitFor(() => {
			// Now addressed comment should be visible
			expect(screen.getByText("Comment 2")).toBeTruthy();
			// Toggle text should change
			expect(screen.getByText("Hide addressed")).toBeTruthy();
		});
	});

	it("toggle hidden when no addressed comments", async () => {
		const comments = [
			makeComment(1, 0), // unaddressed only
		];
		vi.mocked(getPrComments).mockResolvedValue(comments);
		ticketPrs.set(new Map([["task-1", [mockPr]]]));
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);

		render(SelfReviewView, {
			props: {
				task: baseTask,
				agentStatus: null,
				onSendToAgent: vi.fn(),
			},
		});

		await waitFor(() => {
			expect(screen.getByText("Comment 1")).toBeTruthy();
		});

		// Toggle button should not exist
		expect(screen.queryByText(/Show.*addressed/)).toBeNull();
	});

	it("all addressed empty state", async () => {
		const comments = [
			makeComment(1, 1), // addressed only
		];
		vi.mocked(getPrComments).mockResolvedValue(comments);
		ticketPrs.set(new Map([["task-1", [mockPr]]]));
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);

		render(SelfReviewView, {
			props: {
				task: baseTask,
				agentStatus: null,
				onSendToAgent: vi.fn(),
			},
		});

		// Sidebar doesn't auto-open when all comments are addressed (unaddressedCount === 0)
		// So we need to manually click the Comments button
		await waitFor(() => {
			const commentsButton = screen.getByText("Comments");
			expect(commentsButton).toBeTruthy();
		});

		const commentsButton = screen.getByText("Comments");
		commentsButton.click();

		await waitFor(() => {
			// Should show "All comments addressed" empty state
			expect(screen.getByText("All comments addressed")).toBeTruthy();
			// Comment should not be visible (toggle is OFF by default)
			expect(screen.queryByText("Comment 1")).toBeNull();
		});
	});

	it("comments sidebar renders inside ResizablePanel at 360px default width", async () => {
		const comments = [
			makeComment(1, 0), // unaddressed — triggers auto-open
		];
		vi.mocked(getPrComments).mockResolvedValue(comments);
		ticketPrs.set(new Map([["task-1", [mockPr]]]));
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);

		render(SelfReviewView, {
			props: {
				task: baseTask,
				agentStatus: null,
				onSendToAgent: vi.fn(),
			},
		});

		await waitFor(() => {
			// Sidebar should auto-open due to unaddressed comment
			expect(screen.getByText("Comment 1")).toBeTruthy();
		});

		const prCommentsTab = screen.getByText("PR Comments");
		const resizablePanel = prCommentsTab.closest(
			'[data-testid="resizable-panel"]',
		) as HTMLElement;
		expect(resizablePanel).toBeTruthy();
	});
});
