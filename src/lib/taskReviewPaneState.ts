export interface TaskReviewPaneState {
	selectedCommitSha: string | null;
	diffScrollTop: number;
}

const defaultTaskReviewPaneState: TaskReviewPaneState = {
	selectedCommitSha: null,
	diffScrollTop: 0,
};

const taskReviewPaneStates = new Map<string, TaskReviewPaneState>();

export function getTaskReviewPaneState(taskId: string): TaskReviewPaneState {
	return taskReviewPaneStates.get(taskId) ?? defaultTaskReviewPaneState;
}

export function updateTaskReviewPaneState(
	taskId: string,
	patch: Partial<TaskReviewPaneState>,
): TaskReviewPaneState {
	const next = { ...getTaskReviewPaneState(taskId), ...patch };
	taskReviewPaneStates.set(taskId, next);
	return next;
}

export function clearTaskReviewPaneState(taskId?: string): void {
	if (taskId !== undefined) {
		taskReviewPaneStates.delete(taskId);
		return;
	}
	taskReviewPaneStates.clear();
}
