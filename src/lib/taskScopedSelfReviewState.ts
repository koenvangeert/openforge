import { derived, get, writable } from "svelte/store";
import type {
	PrFileDiff,
	ReviewSubmissionComment,
	SelfReviewComment,
} from "./types";

export interface SelfReviewTaskState {
	diffFiles: PrFileDiff[];
	generalComments: SelfReviewComment[];
	archivedComments: SelfReviewComment[];
	pendingInlineComments: ReviewSubmissionComment[];
}

export const emptySelfReviewTaskState: SelfReviewTaskState = {
	diffFiles: [],
	generalComments: [],
	archivedComments: [],
	pendingInlineComments: [],
};

/**
 * Task-detail self-review state keyed by task id.
 *
 * Self-review data belongs to a task detail view. Keeping diff files, general
 * notes, archived notes, and pending inline comments together behind this
 * scoped module prevents a task switch or late async load from writing data
 * into broad global view stores that another task is currently rendering.
 */
export const selfReviewStateByTask = writable<Map<string, SelfReviewTaskState>>(
	new Map(),
);

export const pendingSelfReviewCommentsByTask = derived(
	selfReviewStateByTask,
	($stateByTask) => {
		const commentsByTask = new Map<string, ReviewSubmissionComment[]>();
		for (const [taskId, state] of $stateByTask) {
			if (state.pendingInlineComments.length > 0) {
				commentsByTask.set(taskId, state.pendingInlineComments);
			}
		}
		return commentsByTask;
	},
);

function cloneStateForUpdate(current: SelfReviewTaskState): SelfReviewTaskState {
	return {
		diffFiles: current.diffFiles,
		generalComments: current.generalComments,
		archivedComments: current.archivedComments,
		pendingInlineComments: current.pendingInlineComments,
	};
}

function updateSelfReviewState(
	taskId: string,
	updater: (state: SelfReviewTaskState) => SelfReviewTaskState,
): void {
	selfReviewStateByTask.update((current) => {
		const next = new Map(current);
		const existing = current.get(taskId) ?? emptySelfReviewTaskState;
		next.set(taskId, updater(cloneStateForUpdate(existing)));
		return next;
	});
}

export function getSelfReviewTaskState(taskId: string): SelfReviewTaskState {
	return get(selfReviewStateByTask).get(taskId) ?? emptySelfReviewTaskState;
}

export function getSelfReviewDiffFiles(taskId: string): PrFileDiff[] {
	return getSelfReviewTaskState(taskId).diffFiles;
}

export function setSelfReviewDiffFiles(
	taskId: string,
	diffFiles: PrFileDiff[],
): void {
	updateSelfReviewState(taskId, (state) => ({ ...state, diffFiles }));
}

export function getSelfReviewGeneralComments(
	taskId: string,
): SelfReviewComment[] {
	return getSelfReviewTaskState(taskId).generalComments;
}

export function setSelfReviewGeneralComments(
	taskId: string,
	generalComments: SelfReviewComment[],
): void {
	updateSelfReviewState(taskId, (state) => ({ ...state, generalComments }));
}

export function getSelfReviewArchivedComments(
	taskId: string,
): SelfReviewComment[] {
	return getSelfReviewTaskState(taskId).archivedComments;
}

export function setSelfReviewArchivedComments(
	taskId: string,
	archivedComments: SelfReviewComment[],
): void {
	updateSelfReviewState(taskId, (state) => ({ ...state, archivedComments }));
}

export function getPendingSelfReviewComments(
	taskId: string,
): ReviewSubmissionComment[] {
	return getSelfReviewTaskState(taskId).pendingInlineComments;
}

export function setPendingSelfReviewComments(
	taskId: string,
	pendingInlineComments: ReviewSubmissionComment[],
): void {
	updateSelfReviewState(taskId, (state) => ({
		...state,
		pendingInlineComments,
	}));
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

/**
 * Clear loaded data owned by a diff-loader instance while preserving pending
 * inline feedback that the user may have drafted before navigating away.
 */
export function resetLoadedSelfReviewState(taskId: string): void {
	updateSelfReviewState(taskId, (state) => ({
		...state,
		diffFiles: [],
		generalComments: [],
		archivedComments: [],
	}));
}
