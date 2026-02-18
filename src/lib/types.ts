export interface Task {
  id: string;
  title: string;
  status: string;
  jira_key: string | null;
  jira_status: string | null;
  jira_assignee: string | null;
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
  created_at: number;
  updated_at: number;
}

export interface OpenCodeStatus {
  api_url: string;
  healthy: boolean;
  version: string | null;
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

/** App-level view for top-bar navigation */
export type AppView = "board" | "pr_review" | "settings";

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
}


export type KanbanColumn = "todo" | "in_progress" | "in_review" | "testing" | "done";

export const COLUMN_LABELS: Record<KanbanColumn, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  in_review: "In Review",
  testing: "Testing",
  done: "Done",
};

export const COLUMNS: KanbanColumn[] = ["todo", "in_progress", "in_review", "testing", "done"];

export interface Action {
  id: string;
  name: string;
  prompt: string;
  builtin: boolean;
  enabled: boolean;
}
