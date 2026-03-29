import { invoke } from "@tauri-apps/api/core";
import type { Task, AgentSession, PrComment, PollResult, PullRequestInfo, AgentInfo, Project, ProjectAttention, WorktreeInfo, TaskWorkspaceInfo, ImplementationStatus, ReviewPullRequest, AuthoredPullRequest, PrFileDiff, ReviewComment, ReviewSubmissionComment, SelfReviewComment, AgentReviewComment, CommandInfo, AutocompleteAgentInfo, PrOverviewComment, TranscriptionResult, WhisperModelStatus, WhisperModelSizeId, SkillInfo, WorkQueueEntry, ProviderModelInfo, CommitInfo, BoardStatus } from "./types";
import { normalizeTask, normalizeWorkQueueEntry } from './boardStatus'

type RawTask = Omit<Task, 'status'> & { status: string }
type RawWorkQueueEntry = Omit<WorkQueueEntry, 'task'> & { task: RawTask }

export async function createTask(initialPrompt: string, status: BoardStatus, projectId: string | null, agent: string | null, permissionMode: string | null): Promise<Task> {
  const task = await invoke<RawTask>("create_task", { initialPrompt, status, projectId, agent, permissionMode });
  return normalizeTask(task)
}

export async function updateTask(id: string, initialPrompt: string): Promise<void> {
  return invoke("update_task", { id, initialPrompt });
}

export async function updateTaskInitialPromptAndSummary(id: string, initialPrompt: string | null, summary: string | null): Promise<void> {
  return invoke("update_task_initial_prompt_and_summary", { id, initialPrompt, summary });
}

export async function updateTaskStatus(id: string, status: BoardStatus): Promise<void> {
  return invoke("update_task_status", { id, status });
}

export async function deleteTask(id: string): Promise<void> {
  return invoke("delete_task", { id });
}

export async function clearDoneTasks(projectId: string): Promise<number> {
  return invoke<number>("clear_done_tasks", { projectId });
}

export async function getWorkQueueTasks(): Promise<WorkQueueEntry[]> {
  const entries = await invoke<RawWorkQueueEntry[]>("get_work_queue_tasks");
  return entries.map(normalizeWorkQueueEntry)
}


export async function getAppMode(): Promise<string> {
  return invoke<string>("get_app_mode");
}

export async function getGitBranch(): Promise<string> {
  return invoke<string>("get_git_branch");
}


export async function getAgents(): Promise<AgentInfo[]> {
  return invoke<AgentInfo[]>("get_agents");
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

export async function getProjectAttention(): Promise<ProjectAttention[]> {
  return invoke<ProjectAttention[]>("get_project_attention");
}

export async function getProjectConfig(projectId: string, key: string): Promise<string | null> {
  return invoke<string | null>("get_project_config", { projectId, key });
}

export async function setProjectConfig(projectId: string, key: string, value: string): Promise<void> {
  return invoke("set_project_config", { projectId, key, value });
}

export async function getAllTasks(): Promise<Task[]> {
  const tasks = await invoke<RawTask[]>("get_tasks");
  return tasks.map(normalizeTask)
}

export async function getTasksForProject(projectId: string): Promise<Task[]> {
  const tasks = await invoke<RawTask[]>("get_tasks_for_project", { projectId });
  return tasks.map(normalizeTask)
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

export async function getTaskWorkspace(taskId: string): Promise<TaskWorkspaceInfo | null> {
  return invoke<TaskWorkspaceInfo | null>("get_task_workspace", { taskId });
}

export async function getSessionStatus(sessionId: string): Promise<AgentSession> {
  return invoke<AgentSession>("get_session_status", { sessionId });
}

export async function abortSession(sessionId: string): Promise<void> {
  return invoke("abort_session", { sessionId });
}

export async function forceGithubSync(): Promise<PollResult> {
  return invoke<PollResult>("force_github_sync");
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

export async function mergePullRequest(owner: string, repo: string, prNumber: number): Promise<void> {
  return invoke<void>("merge_pull_request", { owner, repo, prNumber });
}

export async function checkOpenCodeInstalled(): Promise<{ installed: boolean; path: string | null; version: string | null }> {
  return invoke("check_opencode_installed");
}

export async function checkClaudeInstalled(): Promise<{ installed: boolean; path: string | null; version: string | null; authenticated: boolean }> {
  return invoke<{ installed: boolean; path: string | null; version: string | null; authenticated: boolean }>("check_claude_installed");
}

export async function getConfig(key: string): Promise<string | null> {
  return invoke<string | null>("get_config", { key });
}

export async function setConfig(key: string, value: string): Promise<void> {
  return invoke("set_config", { key, value });
}

export async function getTaskDetail(taskId: string): Promise<Task> {
  const task = await invoke<RawTask>("get_task_detail", { taskId });
  return normalizeTask(task)
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

export async function getGithubUsername(): Promise<string> {
  return invoke<string>("get_github_username");
}

export async function fetchReviewPrs(): Promise<ReviewPullRequest[]> {
  return invoke<ReviewPullRequest[]>("fetch_review_prs");
}

export async function getReviewPrs(): Promise<ReviewPullRequest[]> {
  return invoke<ReviewPullRequest[]>("get_review_prs");
}

export async function markReviewPrViewed(prId: number, headSha: string): Promise<void> {
  return invoke('mark_review_pr_viewed', { prId, headSha });
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

export async function getPrOverviewComments(owner: string, repo: string, prNumber: number): Promise<PrOverviewComment[]> {
  return invoke<PrOverviewComment[]>("get_pr_overview_comments", { owner, repo, prNumber });
}

export async function submitPrReview(owner: string, repo: string, prNumber: number, event: string, body: string, comments: ReviewSubmissionComment[], commitId: string): Promise<void> {
  return invoke<void>("submit_pr_review", { owner, repo, prNumber, event, body, comments, commitId });
}

export async function spawnPty(taskId: string, serverPort: number, opencodeSessionId: string, cols: number, rows: number): Promise<number> {
  return invoke<number>("pty_spawn", { taskId, serverPort, opencodeSessionId, cols, rows });
}

export async function spawnShellPty(taskId: string, cwd: string, cols: number, rows: number, terminalIndex: number): Promise<number> {
  return invoke<number>("pty_spawn_shell", { taskId, cwd, cols, rows, terminalIndex });
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

export async function killShellsForTask(taskId: string): Promise<void> {
  return invoke("pty_kill_shells_for_task", { taskId });
}

export async function getPtyBuffer(taskId: string): Promise<string | null> {
  return invoke<string | null>("get_pty_buffer", { taskId });
}

export async function getTaskDiff(taskId: string, includeUncommitted: boolean): Promise<PrFileDiff[]> {
  return invoke<PrFileDiff[]>("get_task_diff", { taskId, includeUncommitted });
}

export async function getTaskFileContents(taskId: string, path: string, oldPath: string | null, status: string, includeUncommitted: boolean): Promise<[string, string]> {
  return invoke<[string, string]>("get_task_file_contents", { taskId, path, oldPath, status, includeUncommitted });
}

export interface FileContentRequest {
  path: string;
  oldPath: string | null;
  status: string;
}

export async function getTaskBatchFileContents(taskId: string, files: FileContentRequest[], includeUncommitted: boolean): Promise<[string, string][]> {
  return invoke<[string, string][]>("get_task_batch_file_contents", { taskId, files: files.map(f => ({ path: f.path, old_path: f.oldPath, status: f.status })), includeUncommitted });
}

export async function addSelfReviewComment(taskId: string, commentType: string, filePath: string | null, lineNumber: number | null, body: string): Promise<number> {
  return invoke<number>("add_self_review_comment", { taskId, commentType, filePath, lineNumber, body });
}

export async function getActiveSelfReviewComments(taskId: string): Promise<SelfReviewComment[]> {
  return invoke<SelfReviewComment[]>("get_active_self_review_comments", { taskId });
}

export async function getArchivedSelfReviewComments(taskId: string): Promise<SelfReviewComment[]> {
  return invoke<SelfReviewComment[]>("get_archived_self_review_comments", { taskId });
}

export async function deleteSelfReviewComment(commentId: number): Promise<void> {
  return invoke<void>("delete_self_review_comment", { commentId });
}

export async function archiveSelfReviewComments(taskId: string): Promise<void> {
  return invoke<void>("archive_self_review_comments", { taskId });
}

export async function getTaskCommits(taskId: string): Promise<CommitInfo[]> {
  return invoke<CommitInfo[]>("get_task_commits", { taskId });
}

export async function getCommitDiff(taskId: string, commitSha: string): Promise<PrFileDiff[]> {
  return invoke<PrFileDiff[]>("get_commit_diff", { taskId, commitSha });
}

export async function getCommitFileContents(taskId: string, commitSha: string, path: string, oldPath: string | null, status: string): Promise<[string, string]> {
  return invoke<[string, string]>("get_commit_file_contents", { taskId, commitSha, path, oldPath, status });
}

export async function getCommitBatchFileContents(taskId: string, commitSha: string, files: FileContentRequest[]): Promise<[string, string][]> {
  return invoke<[string, string][]>("get_commit_batch_file_contents", { taskId, commitSha, files: files.map(f => ({ path: f.path, old_path: f.oldPath, status: f.status })) });
}

export async function startAgentReview(repoOwner: string, repoName: string, prNumber: number, headRef: string, baseRef: string, prTitle: string, prBody: string | null, reviewPrId: number): Promise<{ review_session_key: string }> {
  return invoke<{ review_session_key: string }>("start_agent_review", { repoOwner, repoName, prNumber, headRef, baseRef, prTitle, prBody, reviewPrId });
}

export async function getAgentReviewComments(reviewPrId: number): Promise<AgentReviewComment[]> {
  return invoke<AgentReviewComment[]>("get_agent_review_comments", { reviewPrId });
}

export async function updateAgentReviewCommentStatus(commentId: number, status: string): Promise<void> {
  return invoke<void>("update_agent_review_comment_status", { commentId, status });
}

export async function dismissAllAgentReviewComments(reviewPrId: number): Promise<void> {
  return invoke<void>("dismiss_all_agent_review_comments", { reviewPrId });
}

export async function abortAgentReview(reviewSessionKey: string): Promise<void> {
  return invoke<void>("abort_agent_review", { reviewSessionKey });
}

export async function listOpenCodeCommands(projectId: string): Promise<CommandInfo[]> {
  return invoke<CommandInfo[]>("list_opencode_commands", { projectId });
}

export async function listOpenCodeSkills(projectId: string): Promise<SkillInfo[]> {
  return invoke<SkillInfo[]>("list_opencode_skills", { projectId });
}

export async function saveSkillContent(
  projectId: string,
  skillName: string,
  level: string,
  sourceDir: string,
  content: string,
): Promise<void> {
  return invoke<void>("save_skill_content", { projectId, skillName, level, sourceDir, content });
}

export async function searchOpenCodeFiles(projectId: string, query: string): Promise<string[]> {
  return invoke<string[]>("search_opencode_files", { projectId, query });
}

export async function listOpenCodeAgents(projectId: string): Promise<AutocompleteAgentInfo[]> {
  return invoke<AutocompleteAgentInfo[]>("list_opencode_agents", { projectId });
}

export async function listOpenCodeModels(projectId: string): Promise<ProviderModelInfo[]> {
  return invoke<ProviderModelInfo[]>("list_opencode_models", { projectId });
}

export async function transcribeAudio(audioData: number[]): Promise<TranscriptionResult> {
  return invoke<TranscriptionResult>("transcribe_audio", { audioData });
}

export async function getWhisperModelStatus(): Promise<WhisperModelStatus> {
  return invoke<WhisperModelStatus>("get_whisper_model_status");
}

export async function downloadWhisperModel(modelSize: WhisperModelSizeId): Promise<void> {
  return invoke<void>("download_whisper_model", { modelSize });
}

export async function getAllWhisperModelStatuses(): Promise<WhisperModelStatus[]> {
  return invoke<WhisperModelStatus[]>("get_all_whisper_model_statuses");
}

export async function setWhisperModel(modelSize: WhisperModelSizeId): Promise<void> {
  return invoke<void>("set_whisper_model", { modelSize });
}

export async function finalizeClaudeSession(taskId: string): Promise<void> {
  return invoke<void>("finalize_claude_session", { taskId });
}

export async function fetchAuthoredPrs(): Promise<AuthoredPullRequest[]> {
  return invoke<AuthoredPullRequest[]>("fetch_authored_prs");
}

export async function getAuthoredPrs(): Promise<AuthoredPullRequest[]> {
  return invoke<AuthoredPullRequest[]>("get_authored_prs");
}
