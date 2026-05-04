import { openExternalUrl } from './shellCommands.js'
import type { SidecarLaunchConfig } from './sidecar.js'

export interface ElectronInvokeRequest {
  command?: unknown
  payload?: unknown
}

export interface BridgeResponseLike {
  ok: boolean
  status?: number
  json(): Promise<unknown>
  text?(): Promise<string>
}

export type BridgeFetch = (url: string, init: {
  method: 'POST'
  headers: Record<string, string>
  body: string
}) => Promise<BridgeResponseLike>

export type OpenExternal = (url: string) => Promise<void>

export interface ElectronInvokeDeps {
  sidecarConfig: SidecarLaunchConfig | null
  fetch: BridgeFetch
  openExternal: OpenExternal
}

const SIDECAR_BACKED_COMMANDS = new Set([
  'create_task',
  'update_task',
  'update_task_summary',
  'get_tasks',
  'get_task_detail',
  'get_tasks_for_project',
  'get_task_workspace',
  'create_project',
  'get_projects',
  'get_project_attention',
  'update_project',
  'get_project_config',
  'set_project_config',
  'get_config',
  'set_config',
  'get_app_mode',
  'get_git_branch',
  'get_latest_session',
  'get_latest_sessions',
  'get_session_status',
  'resume_startup_sessions',
  'start_implementation',
  'abort_implementation',
  'finalize_claude_session',
  'pty_spawn',
  'pty_spawn_shell',
  'pty_write',
  'pty_resize',
  'pty_kill',
  'pty_kill_shells_for_task',
  'get_pty_buffer',
  'get_pull_requests',
  'get_pr_comments',
  'mark_comment_addressed',
  'merge_pull_request',
  'get_github_username',
  'fetch_review_prs',
  'get_review_prs',
  'mark_review_pr_viewed',
  'get_pr_file_diffs',
  'get_file_content',
  'get_file_content_base64',
  'get_file_at_ref',
  'get_file_at_ref_base64',
  'get_review_comments',
  'get_pr_overview_comments',
  'submit_pr_review',
  'fetch_authored_prs',
  'get_authored_prs',
  'fs_read_dir',
  'fs_read_file',
  'fs_search_files',
  'get_task_diff',
  'get_task_file_contents',
  'get_task_batch_file_contents',
  'add_self_review_comment',
  'get_active_self_review_comments',
  'get_archived_self_review_comments',
  'delete_self_review_comment',
  'archive_self_review_comments',
  'get_task_commits',
  'get_commit_diff',
  'get_commit_file_contents',
  'get_commit_batch_file_contents',
  'start_agent_review',
  'get_agent_review_comments',
  'update_agent_review_comment_status',
  'dismiss_all_agent_review_comments',
  'abort_agent_review',
  'install_plugin',
  'install_plugin_from_local',
  'install_plugin_from_npm',
  'uninstall_plugin',
  'get_plugin',
  'list_plugins',
  'set_plugin_enabled',
  'get_enabled_plugins',
  'get_plugin_storage',
  'set_plugin_storage',
  'plugin_invoke',
])

export function isSidecarBackedCommand(command: string): boolean {
  return SIDECAR_BACKED_COMMANDS.has(command)
}

function commandFromRequest(request: ElectronInvokeRequest): string {
  if (typeof request !== 'object' || request === null || typeof request.command !== 'string') {
    throw new Error('invalid Open Forge IPC request')
  }
  return request.command
}

async function responseError(response: BridgeResponseLike): Promise<Error> {
  const detail = response.text ? await response.text() : `HTTP ${response.status ?? 'error'}`
  return new Error(`Rust sidecar command failed: ${detail}`)
}

async function forwardToSidecar(command: string, payload: unknown, deps: ElectronInvokeDeps): Promise<unknown> {
  if (!deps.sidecarConfig) {
    throw new Error('Rust sidecar is not available')
  }

  const response = await deps.fetch(`http://${deps.sidecarConfig.host}:${deps.sidecarConfig.port}/app/invoke`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${deps.sidecarConfig.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ command, payload: payload ?? null }),
  })

  if (!response.ok) {
    throw await responseError(response)
  }

  const body = await response.json()
  return typeof body === 'object' && body !== null && 'value' in body
    ? (body as { value: unknown }).value
    : body
}

export async function handleElectronInvoke(request: ElectronInvokeRequest, deps: ElectronInvokeDeps): Promise<unknown> {
  const command = commandFromRequest(request)
  const payload = request.payload ?? null

  if (command === 'open_url') {
    const url = typeof (payload as { url?: unknown } | null)?.url === 'string'
      ? (payload as { url: string }).url
      : null
    if (!url) throw new Error('open_url requires a url payload')
    return openExternalUrl(url, deps.openExternal)
  }

  if (command === 'force_github_sync') {
    return {
      new_comments: 0,
      ci_changes: 0,
      review_changes: 0,
      pr_changes: 0,
      errors: 0,
      rate_limited: false,
      rate_limit_reset_at: null,
    }
  }

  if (isSidecarBackedCommand(command)) {
    return forwardToSidecar(command, payload, deps)
  }

  throw new Error(`Electron backend bridge is not implemented for command: ${command}`)
}
