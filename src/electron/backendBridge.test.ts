import { describe, expect, it, vi } from 'vitest'
import { handleElectronInvoke, isSidecarBackedCommand } from './backendBridge'
import type { SidecarLaunchConfig } from './sidecar'

function sidecarConfig(): SidecarLaunchConfig {
  return {
    command: 'openforge-sidecar',
    args: [],
    env: {},
    host: '127.0.0.1',
    port: 17642,
    token: 'launch-token',
    healthUrl: 'http://127.0.0.1:17642/app/health',
  }
}

describe('Electron backend bridge command forwarding', () => {
  it('keeps open_url shell-owned and does not forward it to the Rust sidecar', async () => {
    const fetch = vi.fn()
    const openExternal = vi.fn(async () => undefined)

    await expect(handleElectronInvoke(
      { command: 'open_url', payload: { url: 'https://github.com' } },
      { sidecarConfig: sidecarConfig(), fetch, openExternal },
    )).resolves.toBeNull()

    expect(openExternal).toHaveBeenCalledWith('https://github.com')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('forwards config/projects/tasks commands to the authenticated sidecar app IPC route', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ value: [{ id: 'P-1', name: 'Open Forge' }] }),
    }))

    await expect(handleElectronInvoke(
      { command: 'get_projects', payload: null },
      { sidecarConfig: sidecarConfig(), fetch, openExternal: vi.fn() },
    )).resolves.toEqual([{ id: 'P-1', name: 'Open Forge' }])

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:17642/app/invoke', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer launch-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ command: 'get_projects', payload: null }),
    })
  })

  it('forwards PTY/session commands to the authenticated sidecar app IPC route', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ value: 42 }),
    }))

    await expect(handleElectronInvoke(
      {
        command: 'pty_spawn_shell',
        payload: {
          taskId: 'T-1',
          cwd: '/tmp/worktree',
          cols: 80,
          rows: 24,
          terminalIndex: 2,
        },
      },
      { sidecarConfig: sidecarConfig(), fetch, openExternal: vi.fn() },
    )).resolves.toBe(42)

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:17642/app/invoke', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer launch-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        command: 'pty_spawn_shell',
        payload: {
          taskId: 'T-1',
          cwd: '/tmp/worktree',
          cols: 80,
          rows: 24,
          terminalIndex: 2,
        },
      }),
    })
  })

  it('returns a no-op result for force_github_sync until live GitHub client state is ported', async () => {
    const fetch = vi.fn()

    await expect(handleElectronInvoke(
      { command: 'force_github_sync', payload: null },
      { sidecarConfig: sidecarConfig(), fetch, openExternal: vi.fn() },
    )).resolves.toEqual({
      new_comments: 0,
      ci_changes: 0,
      review_changes: 0,
      pr_changes: 0,
      errors: 0,
      rate_limited: false,
      rate_limit_reset_at: null,
    })

    expect(fetch).not.toHaveBeenCalled()
  })

  it('forwards GitHub and PR review commands to the authenticated sidecar app IPC route', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ value: [{ id: 10, title: 'Review me' }] }),
    }))

    await expect(handleElectronInvoke(
      { command: 'get_review_prs', payload: null },
      { sidecarConfig: sidecarConfig(), fetch, openExternal: vi.fn() },
    )).resolves.toEqual([{ id: 10, title: 'Review me' }])

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:17642/app/invoke', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer launch-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ command: 'get_review_prs', payload: null }),
    })
  })

  it('forwards files/self-review/agent-review commands to the authenticated sidecar app IPC route', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ value: [{ id: 1, body: 'Fix this' }] }),
    }))

    await expect(handleElectronInvoke(
      { command: 'get_active_self_review_comments', payload: { taskId: 'T-1' } },
      { sidecarConfig: sidecarConfig(), fetch, openExternal: vi.fn() },
    )).resolves.toEqual([{ id: 1, body: 'Fix this' }])

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:17642/app/invoke', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer launch-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ command: 'get_active_self_review_comments', payload: { taskId: 'T-1' } }),
    })
  })

  it('forwards plugin commands to the authenticated sidecar app IPC route', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ value: [{ id: 'com.example.plugin', name: 'Example' }] }),
    }))

    await expect(handleElectronInvoke(
      { command: 'list_plugins', payload: null },
      { sidecarConfig: sidecarConfig(), fetch, openExternal: vi.fn() },
    )).resolves.toEqual([{ id: 'com.example.plugin', name: 'Example' }])

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:17642/app/invoke', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer launch-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ command: 'list_plugins', payload: null }),
    })
  })

  it('declares config/projects/tasks, PTY/session, and GitHub/PR review commands as sidecar-backed for this slice', () => {
    expect(isSidecarBackedCommand('get_projects')).toBe(true)
    expect(isSidecarBackedCommand('get_project_attention')).toBe(true)
    expect(isSidecarBackedCommand('create_task')).toBe(true)
    expect(isSidecarBackedCommand('update_task_status')).toBe(true)
    expect(isSidecarBackedCommand('delete_task')).toBe(true)
    expect(isSidecarBackedCommand('clear_done_tasks')).toBe(true)
    expect(isSidecarBackedCommand('delete_project')).toBe(true)
    expect(isSidecarBackedCommand('get_config')).toBe(true)
    expect(isSidecarBackedCommand('get_app_mode')).toBe(true)
    expect(isSidecarBackedCommand('get_git_branch')).toBe(true)
    expect(isSidecarBackedCommand('get_latest_session')).toBe(true)
    expect(isSidecarBackedCommand('get_latest_sessions')).toBe(true)
    expect(isSidecarBackedCommand('get_session_status')).toBe(true)
    expect(isSidecarBackedCommand('resume_startup_sessions')).toBe(true)
    expect(isSidecarBackedCommand('start_implementation')).toBe(true)
    expect(isSidecarBackedCommand('abort_implementation')).toBe(true)
    expect(isSidecarBackedCommand('finalize_claude_session')).toBe(true)
    expect(isSidecarBackedCommand('get_task_workspace')).toBe(true)
    expect(isSidecarBackedCommand('pty_spawn')).toBe(true)
    expect(isSidecarBackedCommand('pty_spawn_shell')).toBe(true)
    expect(isSidecarBackedCommand('pty_write')).toBe(true)
    expect(isSidecarBackedCommand('pty_resize')).toBe(true)
    expect(isSidecarBackedCommand('pty_kill')).toBe(true)
    expect(isSidecarBackedCommand('pty_kill_shells_for_task')).toBe(true)
    expect(isSidecarBackedCommand('get_pty_buffer')).toBe(true)
    expect(isSidecarBackedCommand('force_github_sync')).toBe(false)
    expect(isSidecarBackedCommand('get_pull_requests')).toBe(true)
    expect(isSidecarBackedCommand('get_pr_comments')).toBe(true)
    expect(isSidecarBackedCommand('mark_comment_addressed')).toBe(true)
    expect(isSidecarBackedCommand('merge_pull_request')).toBe(true)
    expect(isSidecarBackedCommand('fetch_review_prs')).toBe(true)
    expect(isSidecarBackedCommand('get_review_prs')).toBe(true)
    expect(isSidecarBackedCommand('mark_review_pr_viewed')).toBe(true)
    expect(isSidecarBackedCommand('fetch_authored_prs')).toBe(true)
    expect(isSidecarBackedCommand('get_authored_prs')).toBe(true)
    expect(isSidecarBackedCommand('fs_read_dir')).toBe(true)
    expect(isSidecarBackedCommand('fs_read_file')).toBe(true)
    expect(isSidecarBackedCommand('fs_search_files')).toBe(true)
    expect(isSidecarBackedCommand('get_task_diff')).toBe(true)
    expect(isSidecarBackedCommand('get_task_file_contents')).toBe(true)
    expect(isSidecarBackedCommand('get_task_batch_file_contents')).toBe(true)
    expect(isSidecarBackedCommand('add_self_review_comment')).toBe(true)
    expect(isSidecarBackedCommand('get_active_self_review_comments')).toBe(true)
    expect(isSidecarBackedCommand('get_archived_self_review_comments')).toBe(true)
    expect(isSidecarBackedCommand('delete_self_review_comment')).toBe(true)
    expect(isSidecarBackedCommand('archive_self_review_comments')).toBe(true)
    expect(isSidecarBackedCommand('get_task_commits')).toBe(true)
    expect(isSidecarBackedCommand('get_commit_diff')).toBe(true)
    expect(isSidecarBackedCommand('get_commit_file_contents')).toBe(true)
    expect(isSidecarBackedCommand('get_commit_batch_file_contents')).toBe(true)
    expect(isSidecarBackedCommand('start_agent_review')).toBe(true)
    expect(isSidecarBackedCommand('get_agent_review_comments')).toBe(true)
    expect(isSidecarBackedCommand('update_agent_review_comment_status')).toBe(true)
    expect(isSidecarBackedCommand('dismiss_all_agent_review_comments')).toBe(true)
    expect(isSidecarBackedCommand('abort_agent_review')).toBe(true)
    expect(isSidecarBackedCommand('install_plugin')).toBe(true)
    expect(isSidecarBackedCommand('install_plugin_from_local')).toBe(true)
    expect(isSidecarBackedCommand('install_plugin_from_npm')).toBe(true)
    expect(isSidecarBackedCommand('uninstall_plugin')).toBe(true)
    expect(isSidecarBackedCommand('get_plugin')).toBe(true)
    expect(isSidecarBackedCommand('list_plugins')).toBe(true)
    expect(isSidecarBackedCommand('set_plugin_enabled')).toBe(true)
    expect(isSidecarBackedCommand('get_enabled_plugins')).toBe(true)
    expect(isSidecarBackedCommand('get_plugin_storage')).toBe(true)
    expect(isSidecarBackedCommand('set_plugin_storage')).toBe(true)
    expect(isSidecarBackedCommand('plugin_invoke')).toBe(true)
    expect(isSidecarBackedCommand('transcribe_audio')).toBe(false)
  })
})
