import { get } from "svelte/store";
import { beforeEach, describe, expect, it } from "vitest";
import type { PrFileDiff, ReviewSubmissionComment, SelfReviewComment } from "./types";
import {
	appendPendingSelfReviewComment,
	clearPendingSelfReviewComments,
	getPendingSelfReviewComments,
	getSelfReviewArchivedComments,
	getSelfReviewDiffFiles,
	getSelfReviewGeneralComments,
	pendingSelfReviewCommentsByTask,
	resetLoadedSelfReviewState,
	selfReviewStateByTask,
	setPendingSelfReviewComments,
	setSelfReviewArchivedComments,
	setSelfReviewDiffFiles,
	setSelfReviewGeneralComments,
} from "./taskScopedSelfReviewState";

const taskOneComment: ReviewSubmissionComment = {
	path: "src/task-one.ts",
	line: 12,
	side: "RIGHT",
	body: "task one feedback",
};

const taskTwoComment: ReviewSubmissionComment = {
	path: "src/task-two.ts",
	line: 34,
	side: "RIGHT",
	body: "task two feedback",
};

const taskOneDiff: PrFileDiff = {
	sha: "abc123",
	filename: "src/task-one.ts",
	status: "modified",
	additions: 1,
	deletions: 0,
	changes: 1,
	patch: "@@ -1 +1 @@\n+task one",
	previous_filename: null,
	is_truncated: false,
	patch_line_count: null,
};

const taskTwoDiff: PrFileDiff = {
	...taskOneDiff,
	sha: "def456",
	filename: "src/task-two.ts",
};

const taskOneGeneralComment: SelfReviewComment = {
	id: 1,
	task_id: "task-1",
	round: 1,
	comment_type: "general",
	file_path: null,
	line_number: null,
	body: "task one note",
	created_at: 1700000000,
	archived_at: null,
};

const taskTwoGeneralComment: SelfReviewComment = {
	...taskOneGeneralComment,
	id: 2,
	task_id: "task-2",
	body: "task two note",
};

describe("task-scoped self-review state", () => {
	beforeEach(() => {
		selfReviewStateByTask.set(new Map());
	});

	it("keeps loaded diff, general, and archived comments isolated by task id", () => {
		setSelfReviewDiffFiles("task-1", [taskOneDiff]);
		setSelfReviewDiffFiles("task-2", [taskTwoDiff]);
		setSelfReviewGeneralComments("task-1", [taskOneGeneralComment]);
		setSelfReviewGeneralComments("task-2", [taskTwoGeneralComment]);
		setSelfReviewArchivedComments("task-1", [taskOneGeneralComment]);
		setSelfReviewArchivedComments("task-2", [taskTwoGeneralComment]);

		expect(getSelfReviewDiffFiles("task-1")).toEqual([taskOneDiff]);
		expect(getSelfReviewDiffFiles("task-2")).toEqual([taskTwoDiff]);
		expect(getSelfReviewGeneralComments("task-1")).toEqual([
			taskOneGeneralComment,
		]);
		expect(getSelfReviewGeneralComments("task-2")).toEqual([
			taskTwoGeneralComment,
		]);
		expect(getSelfReviewArchivedComments("task-1")).toEqual([
			taskOneGeneralComment,
		]);
		expect(getSelfReviewArchivedComments("task-2")).toEqual([
			taskTwoGeneralComment,
		]);
	});

	it("updates maps immutably so scoped self-review changes are reactive", () => {
		const before = get(selfReviewStateByTask);

		setSelfReviewDiffFiles("task-1", [taskOneDiff]);

		const after = get(selfReviewStateByTask);
		expect(after).not.toBe(before);
		expect(after.get("task-1")?.diffFiles).toEqual([taskOneDiff]);
	});

	it("keeps pending inline review comments isolated by task id", () => {
		setPendingSelfReviewComments("task-1", [taskOneComment]);
		setPendingSelfReviewComments("task-2", [taskTwoComment]);

		expect(getPendingSelfReviewComments("task-1")).toEqual([taskOneComment]);
		expect(getPendingSelfReviewComments("task-2")).toEqual([taskTwoComment]);
		expect(get(pendingSelfReviewCommentsByTask)).toEqual(
			new Map([
				["task-1", [taskOneComment]],
				["task-2", [taskTwoComment]],
			]),
		);
	});

	it("clears only the selected task pending inline comments", () => {
		setPendingSelfReviewComments("task-1", [taskOneComment]);
		setPendingSelfReviewComments("task-2", [taskTwoComment]);

		clearPendingSelfReviewComments("task-1");

		expect(getPendingSelfReviewComments("task-1")).toEqual([]);
		expect(getPendingSelfReviewComments("task-2")).toEqual([taskTwoComment]);
	});

	it("resets loaded review data for one task without losing pending inline feedback", () => {
		setSelfReviewDiffFiles("task-1", [taskOneDiff]);
		setSelfReviewGeneralComments("task-1", [taskOneGeneralComment]);
		setSelfReviewArchivedComments("task-1", [taskOneGeneralComment]);
		appendPendingSelfReviewComment("task-1", taskOneComment);

		resetLoadedSelfReviewState("task-1");

		expect(getSelfReviewDiffFiles("task-1")).toEqual([]);
		expect(getSelfReviewGeneralComments("task-1")).toEqual([]);
		expect(getSelfReviewArchivedComments("task-1")).toEqual([]);
		expect(getPendingSelfReviewComments("task-1")).toEqual([taskOneComment]);
	});
});
