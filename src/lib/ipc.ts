import { invoke } from "@tauri-apps/api/core";
import type { Task, AgentSession, AgentLog, PrComment, PullRequestInfo, OpenCodeStatus, Project, WorktreeInfo, ImplementationStatus } from "./types";

export async function createTask(title: string, description: string, status: string, jiraKey: string | null, projectId: string | null): Promise<Task> {
  return invoke<Task>("create_task", { title, description, status, jiraKey, projectId });
}

export async function updateTask(id: string, title: string, description: string, jiraKey: string | null): Promise<void> {
  return invoke("update_task", { id, title, description, jiraKey });
}

export async function updateTaskStatus(id: string, status: string): Promise<void> {
  return invoke("update_task_status", { id, status });
}

export async function deleteTask(id: string): Promise<void> {
  return invoke("delete_task", { id });
}

export async function getTasks(): Promise<Task[]> {
  return invoke<Task[]>("get_tasks");
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

export async function startImplementation(taskId: string, repoPath: string): Promise<ImplementationStatus> {
  return invoke<ImplementationStatus>("start_implementation", { taskId, repoPath });
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

export async function persistSessionStatus(taskId: string, status: string, errorMessage: string | null): Promise<void> {
  return invoke("persist_session_status", { taskId, status, errorMessage });
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

export async function updateTaskFields(taskId: string, acceptanceCriteria: string, planText: string): Promise<void> {
  return invoke("update_task_fields", { taskId, acceptanceCriteria, planText });
}
