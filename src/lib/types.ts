export type BoardStatus = 'backlog' | 'doing' | 'done'

export interface Task {
  id: string;
  initial_prompt: string;
  status: BoardStatus;
  prompt: string | null;
  summary: string | null;
  agent: string | null;
  permission_mode: string | null;
  project_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface AgentSession {
  id: string;
  ticket_id: string;
  opencode_session_id: string | null;
  stage: string;
  status: string;
  checkpoint_data: string | null;
  error_message: string | null;
  created_at: number;
  updated_at: number;
  provider: string;
  claude_session_id: string | null;
}

export interface ClaudeInstallStatus {
  installed: boolean;
  path: string | null;
  version: string | null;
  authenticated: boolean;
}

export interface CheckpointNotification {
  ticketId: string;
  ticketKey: string | null;
  sessionId: string;
  stage: string;
  message: string;
  timestamp: number;
}

export interface PrComment {
  id: number;
  pr_id: number;
  author: string;
  body: string;
  comment_type: string;
  file_path: string | null;
  line_number: number | null;
  addressed: number;
  created_at: number;
}

export interface PullRequestInfo {
  id: number;
  ticket_id: string;
  repo_owner: string;
  repo_name: string;
  title: string;
  url: string;
  state: string;
  head_sha: string;
  ci_status: string | null;
  ci_check_runs: string | null;
  review_status: string | null;
  mergeable: boolean | null;
  mergeable_state: string | null;
  merged_at: number | null;
  created_at: number;
  updated_at: number;
  draft: boolean;
  is_queued: boolean;
  unaddressed_comment_count: number;
}

export interface PollResult {
  new_comments: number;
  ci_changes: number;
  review_changes: number;
  pr_changes: number;
  errors: number;
  rate_limited: boolean;
  rate_limit_reset_at: number | null;
}

interface MergeStatusInfo {
  state: string;
  mergeable: boolean | null;
  mergeable_state: string | null;
}

export function hasMergeConflicts(pr: MergeStatusInfo): boolean {
  if (pr.state !== 'open') return false

  const mergeableState = pr.mergeable_state?.toLowerCase() ?? null
  return mergeableState === 'dirty' || mergeableState === 'conflicting'
}

/** Check if a PR is ready to merge based on GitHub's mergeable_state field */
export function isReadyToMerge(pr: PullRequestInfo): boolean {
  if (pr.state !== 'open') return false
  const mergeableState = pr.mergeable_state?.toLowerCase() ?? null
  return mergeableState === 'clean' || mergeableState === 'behind'
}

/** Check if a PR is queued in a merge queue (ready to merge + is_queued) */
export function isQueuedForMerge(pr: PullRequestInfo): boolean {
  return pr.state === 'open' && pr.is_queued;
}

/** Preserves optimistic and definitive states across transient background syncs */
export function preservePullRequestState(oldPr: PullRequestInfo | undefined, newPr: PullRequestInfo): PullRequestInfo {
  if (!oldPr) return newPr;

  const result = { ...newPr };

  // Preserve optimistic 'merged' state if new PR hasn't caught up
  if (oldPr.state === 'merged' && result.state === 'open') {
    result.state = 'merged';
    result.merged_at = oldPr.merged_at;
  }

  // Preserve definitive mergeability if new state is transient
  const isTransient = result.mergeable === null || result.mergeable_state === 'unknown' || result.mergeable_state === null;
  const oldIsDefinitive = oldPr.mergeable_state !== 'unknown' && oldPr.mergeable_state !== null;
  
  if (isTransient && oldIsDefinitive) {
    result.mergeable = oldPr.mergeable;
    result.mergeable_state = oldPr.mergeable_state;
  }

  return result;
}

export interface CheckRunInfo {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
}

export interface CiFailureNotification {
  task_id: string;
  pr_id: number;
  pr_title: string;
  ci_status: string;
  timestamp: number;
}

export interface RateLimitNotification {
  reset_at: number | null;  // Unix timestamp (seconds) when limit resets
  timestamp: number;        // When the notification was created (ms)
}

export interface AgentInfo {
  name: string;
}

// ============================================================================
// Autocomplete Types (OpenCode API)
// ============================================================================

/** Command/skill info from OpenCode GET /command endpoint — used for / autocomplete */
export interface CommandInfo {
  name: string;
  description: string | null;
  source: string | null;
  agent: string | null;
}

/** Skill info for the Skills view — enriched from CommandInfo with content and level */
export interface SkillInfo {
  name: string;
  description: string | null;
  agent: string | null;
  template: string | null;
  level: "project" | "user";
  source_dir: string;
}

/** Extended agent info from OpenCode GET /agent endpoint — used for @ autocomplete */
export interface AutocompleteAgentInfo {
  name: string;
  hidden: boolean | null;
  mode: string | null;
}

/** Model option from OpenCode GET /provider endpoint */
export interface ProviderModelInfo {
  provider_id: string;
  model_id: string;
  name: string;
}

export interface AutocompleteItem {
  label: string;
  description: string | null;
  type: 'file' | 'directory' | 'agent' | 'skill' | 'command';
  source?: string | null;
}

export interface OpenCodeEvent {
  event_type: string;
  data: string;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  created_at: number;
  updated_at: number;
}

export interface ProjectAttention {
  project_id: string;
  needs_input: number;
  running_agents: number;
  ci_failures: number;
  unaddressed_comments: number;
  completed_agents: number;
}

export interface WorktreeInfo {
  id: number;
  task_id: string;
  project_id: string;
  repo_path: string;
  worktree_path: string;
  branch_name: string;
  opencode_port: number | null;
  opencode_pid: number | null;
  status: string;
  created_at: number;
  updated_at: number;
}

export interface TaskWorkspaceInfo {
  id: number;
  task_id: string;
  project_id: string;
  workspace_path: string;
  repo_path: string;
  kind: string;
  branch_name: string | null;
  provider_name: string;
  opencode_port: number | null;
  status: string;
  created_at: number;
  updated_at: number;
}



export interface AgentEvent {
  task_id: string;
  event_type: string;
  data: string;
  timestamp: number;
}

export interface ImplementationStatus {
  task_id: string;
  worktree_path: string;
  workspace_path: string;
  port: number;
  session_id: string;
}

// ============================================================================
// PR Review Types (cross-repo, not task-linked)
// ============================================================================

/** PR authored by the authenticated user — cached from GitHub Search API */
export interface AuthoredPullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string;
  draft: boolean;
  html_url: string;
  user_login: string;
  user_avatar_url: string | null;
  repo_owner: string;
  repo_name: string;
  head_ref: string;
  base_ref: string;
  head_sha: string;
  additions: number;
  deletions: number;
  changed_files: number;
  ci_status: string | null;
  ci_check_runs: string | null;
  review_status: string | null;
  mergeable: boolean | null;
  mergeable_state: string | null;
  merged_at: number | null;
  is_queued: boolean;
  task_id: string | null;
  created_at: number;
  updated_at: number;
}

/** PR from GitHub Search API — review requested for the authenticated user */
export interface ReviewPullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string;
  draft: boolean;
  html_url: string;
  user_login: string;
  user_avatar_url: string | null;
  repo_owner: string;
  repo_name: string;
  head_ref: string;
  base_ref: string;
  head_sha: string;
  additions: number;
  deletions: number;
  changed_files: number;
  mergeable: boolean | null;
  mergeable_state: string | null;
  created_at: number;
  updated_at: number;
  viewed_at: number | null;
  viewed_head_sha: string | null;
}

/** File diff from PR files endpoint */
export interface PrFileDiff {
  sha: string;
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch: string | null;
  previous_filename: string | null;
  is_truncated: boolean;
  patch_line_count: number | null;
}

/** Commit info from git log for per-commit diff viewing */
export interface CommitInfo {
  sha: string;
  short_sha: string;
  message: string;
  author: string;
  date: string;
}

/** PR overview comment (both review and general comments) */
export interface PrOverviewComment {
  id: number;
  body: string;
  author: string;
  avatar_url: string | null;
  comment_type: string;
  file_path: string | null;
  line_number: number | null;
  created_at: string;
}

/** Inline review comment from GitHub PR */
export interface ReviewComment {
  id: number;
  pr_number: number;
  repo_owner: string;
  repo_name: string;
  path: string;
  line: number | null;
  side: string | null;
  body: string;
  author: string;
  created_at: string;
  in_reply_to_id: number | null;
}

/** Comment to include in a review submission */
export interface ReviewSubmissionComment {
  path: string;
  line: number;
  side: string;
  body: string;
}

/** Review submission payload */
export interface ReviewSubmission {
  event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
  body: string;
  comments: ReviewSubmissionComment[];
}

/** Self-review comment for task implementation review */
export interface SelfReviewComment {
  id: number;
  task_id: string;
  round: number;
  comment_type: string;
  file_path: string | null;
  line_number: number | null;
  body: string;
  created_at: number;
  archived_at: number | null;
}

/** Agent review comment for AI-powered PR review */
export interface AgentReviewComment {
  id: number;
  review_pr_id: number;
  review_session_key: string;
  comment_type: string;  // 'inline' | 'summary'
  file_path: string | null;
  line_number: number | null;
  side: string | null;  // 'LEFT' | 'RIGHT'
  body: string;
  status: string;  // 'pending' | 'approved' | 'dismissed'
  opencode_session_id: string | null;
  created_at: number;
  updated_at: number;
}

/** App-level view for top-bar navigation */
export type AppView = "board" | "pr_review" | "skills" | "settings" | "workqueue" | "global_settings" | "files";

export interface WorkQueueEntry {
  task: Task;
  project_name: string;
  session_status: string | null;
  session_checkpoint_data: string | null;
  pull_requests: PullRequestInfo[];
}

export interface PtySpawnRequest {
  task_id: string;
  server_port: number;
  opencode_session_id: string;
  cols: number;
  rows: number;
}

export interface PtyEvent {
  task_id: string;
  data: string;
  instance_id?: number;
}

/** File entry metadata */
export interface FileEntry {
  name: string;
  path: string;          // relative to project root
  isDir: boolean;
  size: number | null;   // file size in bytes (null for dirs)
  modifiedAt: number | null; // unix timestamp ms
}

/** File content with type information */
export interface FileContent {
  type: 'text' | 'image' | 'binary';
  content: string;       // text content, base64 for images, empty for binary
  mimeType: string | null;
  size: number;
}

export function parseCheckRuns(json: string | null): CheckRunInfo[] {
  if (!json) return [];
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

/** Split check runs into visible (non-passing) and a count of hidden passing checks. */
export function splitCheckRuns(checks: CheckRunInfo[]): { visible: CheckRunInfo[]; passingCount: number } {
  const visible: CheckRunInfo[] = [];
  let passingCount = 0;
  for (const check of checks) {
    if (check.status === 'completed' && check.conclusion === 'success') {
      passingCount++;
    } else {
      visible.push(check);
    }
  }
  return { visible, passingCount };
}

export interface Action {
  id: string;
  name: string;
  prompt: string;
  builtin: boolean;
  enabled: boolean;
}

// ============================================================================
// Voice Input / Whisper Types
// ============================================================================

export type VoiceInputState = 'idle' | 'recording' | 'transcribing' | 'error'

export interface TranscriptionResult {
  text: string;
  duration_ms: number;
}

export type WhisperModelSizeId = 'tiny' | 'base' | 'small' | 'medium' | 'large';
export interface WhisperModelStatus {
  size: WhisperModelSizeId;
  display_name: string;
  downloaded: boolean;
  model_path: string | null;
  model_size_bytes: number | null;
  model_name: string;
  disk_size_mb: number;
  ram_usage_mb: number;
  is_active: boolean;
}

// ============================================================================
// Claude Code SDK Types
// ============================================================================

/** Permission mode for Claude Code sessions */
export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions' | 'dontAsk';
