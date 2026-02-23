export interface Task {
  id: string;
  title: string;
  status: string;
  jira_key: string | null;
  jira_title: string | null;
  jira_status: string | null;
  jira_assignee: string | null;
  jira_description: string | null;
  plan_text: string | null;
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
}

export interface AgentLog {
  id: number;
  session_id: string;
  timestamp: number;
  log_type: string;
  content: string;
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
  merged_at: number | null;
  created_at: number;
  updated_at: number;
  unaddressed_comment_count: number;
}

export interface PollResult {
  new_comments: number;
  ci_changes: number;
  review_changes: number;
  pr_changes: number;
  errors: number;
}

/** Check if a PR is ready to merge (open + CI green + approved) */
export function isReadyToMerge(pr: PullRequestInfo): boolean {
  return pr.state === 'open'
    && pr.ci_status === 'success'
    && pr.review_status === 'approved';
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

export interface OpenCodeStatus {
  api_url: string;
  healthy: boolean;
  version: string | null;
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

/** Extended agent info from OpenCode GET /agent endpoint — used for @ autocomplete */
export interface AutocompleteAgentInfo {
  name: string;
  hidden: boolean | null;
  mode: string | null;
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



export interface AgentEvent {
  task_id: string;
  event_type: string;
  data: string;
  timestamp: number;
}

export interface ImplementationStatus {
  task_id: string;
  worktree_path: string;
  port: number;
  session_id: string;
}

// ============================================================================
// PR Review Types (cross-repo, not task-linked)
// ============================================================================

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
  created_at: number;
  updated_at: number;
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

/** App-level view for top-bar navigation */
export type AppView = "board" | "pr_review" | "settings" | "global_settings";

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


export function parseCheckRuns(json: string | null): CheckRunInfo[] {
  if (!json) return [];
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

export type KanbanColumn = "backlog" | "doing" | "done";

export const COLUMN_LABELS: Record<KanbanColumn, string> = {
  backlog: "Backlog",
  doing: "Doing",
  done: "Done",
};

export const COLUMNS: KanbanColumn[] = ["backlog", "doing", "done"];

export interface Action {
  id: string;
  name: string;
  prompt: string;
  agent: string | null;
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

export interface WhisperModelStatus {
  downloaded: boolean;
  model_path: string | null;
  model_size_bytes: number | null;
  model_name: string;
}
