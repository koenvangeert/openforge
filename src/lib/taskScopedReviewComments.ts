import { get, writable } from "svelte/store";
import type { ReviewSubmissionComment } from "./types";

/**
 * Task-detail self-review pending inline comments.
 *
 * Keep task-scoped review state in this module rather than writing to broad
 * global stores from task-detail components. Callers must pass an explicit
 * taskId, which makes task ownership visible at the call site and prevents
 * comments from leaking across task switches.
 */
export const pendingSelfReviewCommentsByTask = writable<
	Map<string, ReviewSubmissionComment[]>
>(new Map());

export function getPendingSelfReviewComments(
	taskId: string,
): ReviewSubmissionComment[] {
	return get(pendingSelfReviewCommentsByTask).get(taskId) ?? [];
}

export function setPendingSelfReviewComments(
	taskId: string,
	comments: ReviewSubmissionComment[],
): void {
	pendingSelfReviewCommentsByTask.update((current) => {
		const next = new Map(current);
		if (comments.length === 0) {
			next.delete(taskId);
		} else {
			next.set(taskId, comments);
		}
		return next;
	});
}

export function updatePendingSelfReviewComments(
	taskId: string,
	updater: (comments: ReviewSubmissionComment[]) => ReviewSubmissionComment[],
): void {
	setPendingSelfReviewComments(
		taskId,
		updater(getPendingSelfReviewComments(taskId)),
	);
}

export function appendPendingSelfReviewComment(
	taskId: string,
	comment: ReviewSubmissionComment,
): void {
	updatePendingSelfReviewComments(taskId, (comments) => [...comments, comment]);
}

export function clearPendingSelfReviewComments(taskId: string): void {
	setPendingSelfReviewComments(taskId, []);
}

function commentKey(comment: ReviewSubmissionComment): string {
	return `${comment.path}\u0000${comment.line}\u0000${comment.side}\u0000${comment.body}`;
}

export function mergeReviewSubmissionComments(
	first: ReviewSubmissionComment[],
	second: ReviewSubmissionComment[],
): ReviewSubmissionComment[] {
	const merged: ReviewSubmissionComment[] = [];
	const seen = new Set<string>();
	for (const comment of [...first, ...second]) {
		const key = commentKey(comment);
		if (seen.has(key)) continue;
		seen.add(key);
		merged.push(comment);
	}
	return merged;
}

export function mergePendingSelfReviewComments(
	taskId: string,
	comments: ReviewSubmissionComment[],
): void {
	setPendingSelfReviewComments(
		taskId,
		mergeReviewSubmissionComments(comments, getPendingSelfReviewComments(taskId)),
	);
}
