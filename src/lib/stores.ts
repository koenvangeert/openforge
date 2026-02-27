import { writable } from "svelte/store";
import type { Task, AgentSession, PullRequestInfo, Project, Agent3vent, CheckpointNotification, CiFailureNotification, ReviewPullRequest, PrFileDiff, AppView, ReviewComment, ReviewSubmissionComment, SelfReviewComment, PrOverviewComment, ProjectAttention } from "./types";

export const tasks = writable<Task[]>([]);
// selectedTaskId serves as both selection state and navigation:
// - null = show Kanban board
// - non-null = show full-page detail view for that task
export const selectedTaskId = writable<string | null>(null);
export const activeSessions = writable<Map<string, AgentSession>>(new Map());
export const checkpointNotification = writable<CheckpointNotification | null>(null);
export const ciFailureNotification = writable<CiFailureNotification | null>(null);
export const taskSpawned = writable<{ taskId: string; title: string } | null>(null);
export const ticketPrs = writable<Map<string, PullRequestInfo[]>>(new Map());
export const isLoading = writable(false);
export const error = writable<string | null>(null);
export const projects = writable<Project[]>([]);
export const activeProjectId = writable<string | null>(null);
export const projectAttention = writable<Map<string, ProjectAttention>>(new Map());
export const agent3vents = writable<Map<string, Agent3vent[]>>(new Map());

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

export const searchQuery = writable<string>("");
