import { get } from "svelte/store";
import {
	getActiveSelfReviewComments,
	getArchivedSelfReviewComments,
	getCommitDiff,
	getPrComments,
	getTaskCommits,
	getTaskDiff,
} from "./ipc";
import {
	pendingManualComments,
	selfReviewArchivedComments,
	selfReviewDiffFiles,
	selfReviewGeneralComments,
	ticketPrs,
} from "./stores";
import type { CommitInfo, PrComment, PullRequestInfo } from "./types";

// ============================================================================
// Interface
// ============================================================================

export interface DiffLoaderState {
	readonly isLoading: boolean;
	readonly error: string | null;
	readonly prComments: PrComment[];
	readonly linkedPr: PullRequestInfo | null;
	readonly commits: CommitInfo[];
	readonly selectedCommitSha: string | null;
	loadDiff(): Promise<void>;
	loadCommits(): Promise<void>;
	selectCommit(sha: string | null): Promise<void>;
	refresh(): Promise<void>;
	cleanup(): void;
}

// ============================================================================
// Factory
// ============================================================================

export function createDiffLoader(deps: {
	getTaskId: () => string;
	getIncludeUncommitted: () => boolean;
}): DiffLoaderState {
	let isLoading = $state(false);
	let error = $state<string | null>(null);
	let prComments = $state<PrComment[]>([]);
	let linkedPr = $state<PullRequestInfo | null>(null);
	let commits = $state<CommitInfo[]>([]);
	let selectedCommitSha = $state<string | null>(null);
	let loadGeneration = 0;

	function beginLoad(): number {
		const generation = ++loadGeneration;
		isLoading = true;
		error = null;
		return generation;
	}

	function isStale(generation: number): boolean {
		return generation !== loadGeneration;
	}

	async function loadDiff(): Promise<void> {
		const generation = beginLoad();
		try {
			const taskId = deps.getTaskId();

			const diffs =
				selectedCommitSha !== null
					? await getCommitDiff(taskId, selectedCommitSha)
					: await getTaskDiff(taskId, deps.getIncludeUncommitted());
			if (isStale(generation)) return;
			selfReviewDiffFiles.set(diffs);

			if (selectedCommitSha === null) {
				const activeComments = await getActiveSelfReviewComments(taskId);
				if (isStale(generation)) return;
				selfReviewGeneralComments.set(
					activeComments.filter((c) => c.comment_type === "general"),
				);

				const archivedComments = await getArchivedSelfReviewComments(taskId);
				if (isStale(generation)) return;
				selfReviewArchivedComments.set(
					archivedComments.filter((c) => c.comment_type === "general"),
				);

				pendingManualComments.set(
					activeComments
						.filter((c) => c.comment_type === "inline")
						.map((c) => ({
							path: c.file_path!,
							line: c.line_number!,
							body: c.body,
							side: "RIGHT",
						})),
				);

				const taskPrs = get(ticketPrs).get(taskId) || [];
				const openPrs = taskPrs
					.filter((pr) => pr.state === "open")
					.sort((a, b) => b.updated_at - a.updated_at);
				if (openPrs.length > 0) {
					const pr = openPrs[0];
					linkedPr = pr;
					try {
						const nextPrComments = await getPrComments(pr.id);
						if (isStale(generation)) return;
						prComments = nextPrComments;
					} catch (e) {
						if (isStale(generation)) return;
						console.error(`Failed to load comments for PR ${pr.id}:`, e);
						prComments = [];
					}
				}
			}
		} catch (e) {
			if (isStale(generation)) return;
			console.error("Failed to load self-review data:", e);
			error = "Failed to load diff. Please try again.";
		} finally {
			if (!isStale(generation)) {
				isLoading = false;
			}
		}
	}

	async function loadCommits(): Promise<void> {
		try {
			commits = await getTaskCommits(deps.getTaskId());
		} catch (e) {
			console.error("Failed to load commits:", e);
		}
	}

	async function selectCommit(sha: string | null): Promise<void> {
		selectedCommitSha = sha;
		selfReviewDiffFiles.set([]);
		await refresh();
	}

	async function refresh(): Promise<void> {
		const generation = beginLoad();
		try {
			const taskId = deps.getTaskId();
			const diffs =
				selectedCommitSha !== null
					? await getCommitDiff(taskId, selectedCommitSha)
					: await getTaskDiff(taskId, deps.getIncludeUncommitted());
			if (isStale(generation)) return;
			selfReviewDiffFiles.set(diffs);
		} catch (e) {
			if (isStale(generation)) return;
			console.error("Failed to refresh diff:", e);
			error = "Failed to refresh diff.";
		} finally {
			if (!isStale(generation)) {
				isLoading = false;
			}
		}
	}

	function cleanup(): void {
		loadGeneration += 1;
		isLoading = false;
		error = null;
		prComments = [];
		linkedPr = null;
		selfReviewDiffFiles.set([]);
		selfReviewGeneralComments.set([]);
		selfReviewArchivedComments.set([]);
		pendingManualComments.set([]);
		selectedCommitSha = null;
		commits = [];
	}

	return {
		get isLoading() {
			return isLoading;
		},
		get error() {
			return error;
		},
		get prComments() {
			return prComments;
		},
		get linkedPr() {
			return linkedPr;
		},
		get commits() {
			return commits;
		},
		get selectedCommitSha() {
			return selectedCommitSha;
		},
		loadDiff,
		loadCommits,
		selectCommit,
		refresh,
		cleanup,
	};
}
