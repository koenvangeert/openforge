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
  status: string
  created_at: number
  updated_at: number
}
