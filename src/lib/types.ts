export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: string;
  jira_key: string | null;
  jira_status: string | null;
  jira_assignee: string | null;
  acceptance_criteria: string | null;
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

export type KanbanColumn = "todo" | "in_progress" | "in_review" | "testing" | "done";

export const COLUMN_LABELS: Record<KanbanColumn, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  in_review: "In Review",
  testing: "Testing",
  done: "Done",
};

export const COLUMNS: KanbanColumn[] = ["todo", "in_progress", "in_review", "testing", "done"];
