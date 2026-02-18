import { invoke } from "@tauri-apps/api/core";
import type { Task, AgentSession, AgentLog, PrComment, PullRequestInfo, OpenCodeStatus, Project, WorktreeInfo, ImplementationStatus, ReviewPullRequest, PrFileDiff, ReviewComment, ReviewSubmissionComment } from "./types";

export async function createTask(title: string, status: string, jiraKey: string | null, projectId: string | null): Promise<Task> {
  return invoke<Task>("create_task", { title, status, jiraKey, projectId });
}

export async function updateTask(id: string, title: string, jiraKey: string | null): Promise<void> {
  return invoke("update_task", { id, title, jiraKey });
}

export async function updateTaskStatus(id: string, status: string): Promise<void> {
  return invoke("update_task_status", { id, status });
}

export async function deleteTask(id: string): Promise<void> {
  return invoke("delete_task", { id });
}

export async function refreshJiraInfo(): Promise<number> {
  return invoke<number>("refresh_jira_info");
}

export async function getOpenCodeStatus(): Promise<OpenCodeStatus> {
  return invoke<OpenCodeStatus>("get_opencode_status");
}

export async function createProject(name: string, path: string): Promise<Project> {
  return invoke<Project>("create_project", { name, path });
}

export async function getProjects(): Promise<Project[]> {
  return invoke<Project[]>("get_projects");
}

export async function updateProject(id: string, name: string, path: string): Promise<void> {
  return invoke("update_project", { id, name, path });
}

export async function deleteProject(id: string): Promise<void> {
  return invoke("delete_project", { id });
}

export async function getProjectConfig(projectId: string, key: string): Promise<string | null> {
  return invoke<string | null>("get_project_config", { projectId, key });
}

export async function setProjectConfig(projectId: string, key: string, value: string): Promise<void> {
  return invoke("set_project_config", { projectId, key, value });
}



export async function getTasksForProject(projectId: string): Promise<Task[]> {
  return invoke<Task[]>("get_tasks_for_project", { projectId });
}

/** @deprecated Use runAction instead */
export async function startImplementation(taskId: string, repoPath: string): Promise<ImplementationStatus> {
  return invoke<ImplementationStatus>("start_implementation", { taskId, repoPath });
}

export async function runAction(taskId: string, repoPath: string, actionPrompt: string): Promise<ImplementationStatus> {
  return invoke<ImplementationStatus>("run_action", { taskId, repoPath, actionPrompt });
}

export async function abortImplementation(taskId: string): Promise<void> {
  return invoke("abort_implementation", { taskId });
}

export async function getWorktreeForTask(taskId: string): Promise<WorktreeInfo | null> {
  return invoke<WorktreeInfo | null>("get_worktree_for_task", { taskId });
}

export async function getSessionStatus(sessionId: string): Promise<AgentSession> {
  return invoke<AgentSession>("get_session_status", { sessionId });
}

export async function abortSession(sessionId: string): Promise<void> {
  return invoke("abort_session", { sessionId });
}

export async function getAgentLogs(sessionId: string): Promise<AgentLog[]> {
  return invoke<AgentLog[]>("get_agent_logs", { sessionId });
}

export async function pollPrCommentsNow(): Promise<number> {
  return invoke<number>("poll_pr_comments_now");
}

export async function getPullRequests(): Promise<PullRequestInfo[]> {
  return invoke<PullRequestInfo[]>("get_pull_requests");
}

export async function openUrl(url: string): Promise<void> {
  return invoke("open_url", { url });
}

export async function getPrComments(prId: number): Promise<PrComment[]> {
  return invoke<PrComment[]>("get_pr_comments", { prId });
}

export async function markCommentAddressed(commentId: number): Promise<void> {
  return invoke("mark_comment_addressed", { commentId });
}

export async function checkOpenCodeInstalled(): Promise<{ installed: boolean; path: string | null; version: string | null }> {
  return invoke("check_opencode_installed");
}

export async function getConfig(key: string): Promise<string | null> {
  return invoke<string | null>("get_config", { key });
}

export async function setConfig(key: string, value: string): Promise<void> {
  return invoke("set_config", { key, value });
}

export async function getTaskDetail(taskId: string): Promise<Task> {
  return invoke<Task>("get_task_detail", { taskId });
}

export async function persistSessionStatus(taskId: string, status: string, errorMessage: string | null, checkpointData?: string | null): Promise<void> {
  return invoke("persist_session_status", { taskId, status, errorMessage, checkpointData });
}

export async function getLatestSession(taskId: string): Promise<AgentSession | null> {
  return invoke<AgentSession | null>("get_latest_session", { taskId });
}

export async function getLatestSessions(taskIds: string[]): Promise<AgentSession[]> {
  return invoke<AgentSession[]>("get_latest_sessions", { taskIds });
}

export async function getSessionOutput(taskId: string): Promise<string> {
  return invoke<string>("get_session_output", { taskId });
}

export async function updateTaskFields(taskId: string, planText: string): Promise<void> {
  return invoke("update_task_fields", { taskId, planText });
}

export async function getGithubUsername(): Promise<string> {
  return invoke<string>("get_github_username");
}

export async function fetchReviewPrs(): Promise<ReviewPullRequest[]> {
  return invoke<ReviewPullRequest[]>("fetch_review_prs");
}

export async function getReviewPrs(): Promise<ReviewPullRequest[]> {
  return invoke<ReviewPullRequest[]>("get_review_prs");
}

export async function getPrFileDiffs(owner: string, repo: string, prNumber: number): Promise<PrFileDiff[]> {
  return invoke<PrFileDiff[]>("get_pr_file_diffs", { owner, repo, prNumber });
}

export async function getFileContent(owner: string, repo: string, sha: string): Promise<string> {
  return invoke<string>("get_file_content", { owner, repo, sha });
}

export async function getFileAtRef(owner: string, repo: string, path: string, refSha: string): Promise<string> {
  return invoke<string>("get_file_at_ref", { owner, repo, path, refSha });
}

export async function getReviewComments(owner: string, repo: string, prNumber: number): Promise<ReviewComment[]> {
  return invoke<ReviewComment[]>("get_review_comments", { owner, repo, prNumber });
}

export async function submitPrReview(owner: string, repo: string, prNumber: number, event: string, body: string, comments: ReviewSubmissionComment[], commitId: string): Promise<void> {
  return invoke<void>("submit_pr_review", { owner, repo, prNumber, event, body, comments, commitId });
}

export async function spawnPty(taskId: string, serverPort: number, opencodeSessionId: string, cols: number, rows: number): Promise<void> {
  return invoke("pty_spawn", { taskId, serverPort, opencodeSessionId, cols, rows });
}

export async function writePty(taskId: string, data: string): Promise<void> {
  return invoke("pty_write", { taskId, data });
}

export async function resizePty(taskId: string, cols: number, rows: number): Promise<void> {
  return invoke("pty_resize", { taskId, cols, rows });
}

export async function killPty(taskId: string): Promise<void> {
  return invoke("pty_kill", { taskId });
}
