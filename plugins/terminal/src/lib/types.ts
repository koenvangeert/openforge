export interface PtyEvent {
  task_id: string
  data: string
  instance_id?: number
}

export interface TaskWorkspaceInfo {
  id: number
  task_id: string
  project_id: string
  workspace_path: string
  repo_path: string
  kind: string
  branch_name: string | null
  provider_name: string
  /** @deprecated Direct-TTY providers no longer expose an OpenCode server port. */
  opencode_port: number | null
  status: string
  created_at: number
  updated_at: number
}
