import { get } from "svelte/store";
import { beforeEach, describe, expect, it } from "vitest";
import type { ReviewSubmissionComment } from "./types";
import {
	appendPendingSelfReviewComment,
	clearPendingSelfReviewComments,
	getPendingSelfReviewComments,
	pendingSelfReviewCommentsByTask,
	setPendingSelfReviewComments,
} from "./taskScopedReviewComments";

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

describe("task-scoped self-review pending comments", () => {
	beforeEach(() => {
		pendingSelfReviewCommentsByTask.set(new Map());
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

	it("updates maps immutably so scoped comment changes are reactive", () => {
		const before = get(pendingSelfReviewCommentsByTask);

		appendPendingSelfReviewComment("task-1", taskOneComment);

		const after = get(pendingSelfReviewCommentsByTask);
		expect(after).not.toBe(before);
		expect(after.get("task-1")).toEqual([taskOneComment]);
	});

	it("clears only the selected task comments", () => {
		setPendingSelfReviewComments("task-1", [taskOneComment]);
		setPendingSelfReviewComments("task-2", [taskTwoComment]);

		clearPendingSelfReviewComments("task-1");

		expect(getPendingSelfReviewComments("task-1")).toEqual([]);
		expect(getPendingSelfReviewComments("task-2")).toEqual([taskTwoComment]);
	});
});
