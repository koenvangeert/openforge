import { writable } from "svelte/store";
import type { Task, AgentSession, PullRequestInfo, Project, AgentEvent, CheckpointNotification, CiFailureNotification, RateLimitNotification, ReviewPullRequest, AuthoredPullRequest, PrFileDiff, AppView, ReviewComment, ReviewSubmissionComment, SelfReviewComment, AgentReviewComment, PrOverviewComment, ProjectAttention, SkillInfo } from "./types";
import type { BoardFilter } from './boardFilters'

export interface TaskRuntimeInfo {
  workspacePath: string;
  opencodePort: number | null;
}

export const tasks = writable<Task[]>([]);
export const pendingTask = writable<Task | null>(null);
// selectedTaskId serves as both selection state and navigation:
// - null = show Flow board
// - non-null = show full-page detail view for that task
export const selectedTaskId = writable<string | null>(null);
export const activeSessions = writable<Map<string, AgentSession>>(new Map());
export const checkpointNotification = writable<CheckpointNotification | null>(null);
export const ciFailureNotification = writable<CiFailureNotification | null>(null);
export const rateLimitNotification = writable<RateLimitNotification | null>(null);
export const taskSpawned = writable<{ taskId: string; promptText: string } | null>(null);
export const ticketPrs = writable<Map<string, PullRequestInfo[]>>(new Map());
export const isLoading = writable(false);
export const error = writable<string | null>(null);
export const projects = writable<Project[]>([]);
export const activeProjectId = writable<string | null>(null);
export const pendingFileReveal = writable<string | null>(null);
export const projectAttention = writable<Map<string, ProjectAttention>>(new Map());
export const agentEvents = writable<Map<string, AgentEvent[]>>(new Map());
export const taskRuntimeInfo = writable<Map<string, TaskRuntimeInfo>>(new Map());

export const currentView = writable<AppView>("board");
export const reviewPrs = writable<ReviewPullRequest[]>([]);
export const selectedReviewPr = writable<ReviewPullRequest | null>(null);
export const prFileDiffs = writable<PrFileDiff[]>([]);
export const reviewRequestCount = writable<number>(0);
export const reviewComments = writable<ReviewComment[]>([]);
export const pendingManualComments = writable<ReviewSubmissionComment[]>([]);
export const prOverviewComments = writable<PrOverviewComment[]>([]);

export const selfReviewGeneralComments = writable<SelfReviewComment[]>([]);
export const selfReviewArchivedComments = writable<SelfReviewComment[]>([]);
export const selfReviewDiffFiles = writable<PrFileDiff[]>([]);

export const agentReviewComments = writable<AgentReviewComment[]>([]);
export const agentReviewLoading = writable(false);
export const agentReviewError = writable<string | null>(null);

export const skills = writable<SkillInfo[]>([]);
export const selectedSkillName = writable<string | null>(null);


/** Set of task IDs currently starting (worktree creation + agent spawn in progress) */
export const startingTasks = writable<Set<string>>(new Set());

export const codeCleanupTasksEnabled = writable<boolean>(false);

/** Per-task review mode state — preserved across navigation */
export const taskReviewModes = writable<Map<string, boolean>>(new Map());

/** Per-task terminal panel open state — preserved across navigation */
export const taskTerminalOpen = writable<Map<string, boolean>>(new Map());

/** Per-task draft note text — preserved across navigation */
export const taskDraftNotes = writable<Map<string, string>>(new Map());

export const focusBoardFilters = writable<Map<string, BoardFilter>>(new Map())

export const authoredPrs = writable<AuthoredPullRequest[]>([]);
export const authoredPrCount = writable<number>(0);
export const commandHeld = writable<boolean>(false);
