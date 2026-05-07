import { get } from "svelte/store";
import { beforeEach, describe, expect, it } from "vitest";
import type { ReviewSubmissionComment } from "./types";
import {
	appendPendingSelfReviewComment,
	clearPendingSelfReviewComments,
	clearSelfReviewInlineCommentDraft,
	getPendingSelfReviewComments,
	getSelfReviewInlineCommentDraft,
	pendingSelfReviewCommentsByTask,
	selfReviewInlineCommentDrafts,
	selfReviewStateByTask,
	setPendingSelfReviewComments,
	setSelfReviewInlineCommentDraft,
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
		selfReviewStateByTask.set(new Map());
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

	it("keeps open inline textarea drafts isolated by task, file, line, and side", () => {
		setSelfReviewInlineCommentDraft("task-1", "src/task-one.ts", 12, "RIGHT", "right-side draft");
		setSelfReviewInlineCommentDraft("task-1", "src/task-one.ts", 12, "LEFT", "left-side draft");
		setSelfReviewInlineCommentDraft("task-1", "src/task-one.ts", 13, "RIGHT", "other line draft");
		setSelfReviewInlineCommentDraft("task-1", "src/other.ts", 12, "RIGHT", "other file draft");
		setSelfReviewInlineCommentDraft("task-2", "src/task-one.ts", 12, "RIGHT", "other task draft");

		expect(getSelfReviewInlineCommentDraft("task-1", "src/task-one.ts", 12, "RIGHT")).toBe("right-side draft");
		expect(getSelfReviewInlineCommentDraft("task-1", "src/task-one.ts", 12, "LEFT")).toBe("left-side draft");
		expect(getSelfReviewInlineCommentDraft("task-1", "src/task-one.ts", 13, "RIGHT")).toBe("other line draft");
		expect(getSelfReviewInlineCommentDraft("task-1", "src/other.ts", 12, "RIGHT")).toBe("other file draft");
		expect(getSelfReviewInlineCommentDraft("task-2", "src/task-one.ts", 12, "RIGHT")).toBe("other task draft");
	});

	it("updates draft maps immutably and removes empty drafts", () => {
		const before = get(selfReviewInlineCommentDrafts);

		setSelfReviewInlineCommentDraft("task-1", "src/task-one.ts", 12, "RIGHT", "draft");

		const afterSet = get(selfReviewInlineCommentDrafts);
		expect(afterSet).not.toBe(before);
		expect(getSelfReviewInlineCommentDraft("task-1", "src/task-one.ts", 12, "RIGHT")).toBe("draft");

		setSelfReviewInlineCommentDraft("task-1", "src/task-one.ts", 12, "RIGHT", "");

		const afterClear = get(selfReviewInlineCommentDrafts);
		expect(afterClear).not.toBe(afterSet);
		expect(getSelfReviewInlineCommentDraft("task-1", "src/task-one.ts", 12, "RIGHT")).toBe("");
		expect(afterClear.size).toBe(0);
	});

	it("clears only the selected inline textarea draft", () => {
		setSelfReviewInlineCommentDraft("task-1", "src/task-one.ts", 12, "RIGHT", "draft to clear");
		setSelfReviewInlineCommentDraft("task-1", "src/task-one.ts", 12, "LEFT", "draft to keep");

		clearSelfReviewInlineCommentDraft("task-1", "src/task-one.ts", 12, "RIGHT");

		expect(getSelfReviewInlineCommentDraft("task-1", "src/task-one.ts", 12, "RIGHT")).toBe("");
		expect(getSelfReviewInlineCommentDraft("task-1", "src/task-one.ts", 12, "LEFT")).toBe("draft to keep");
	});
});
