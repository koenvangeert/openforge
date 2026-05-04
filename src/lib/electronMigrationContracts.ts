// Phase 0 inventory for the Tauri-to-Electron migration.
// Keep this file in sync with src/lib/ipc.ts and registerAppTauriEventListeners().
// It is intentionally data-only: no Electron runtime is implemented here.

export type IpcContractOwner = 'rust-sidecar' | 'electron-main'

export type IpcContractDomain =
  | 'agent-session-pty'
  | 'config'
  | 'files-review'
  | 'github-review'
  | 'misc'
  | 'plugins'
  | 'tasks-projects'
  | 'whisper-audio'

export interface IpcCommandContract {
  functionName: string
  tauriCommand: string
  payloadKeys: readonly string[]
  targetOwner: IpcContractOwner
  domain: IpcContractDomain
}

export interface AppShellEventContract {
  eventName: string
  payload: string
  producer: 'rust-backend' | 'electron-main'
  transportAfterMigration: 'sse-or-websocket' | 'electron-shell-event'
  domain: IpcContractDomain
}

export interface DynamicShellEventContract {
  eventPattern: string
  currentSubscribers: readonly string[]
  currentProducers: readonly string[]
  payload: string
  producer: 'rust-backend' | 'plugin-host'
  transportAfterMigration: 'sse-or-websocket' | 'plugin-event-adapter'
  domain: IpcContractDomain
}

export const ipcCommandContracts = [
  { functionName: 'createTask', tauriCommand: 'create_task', payloadKeys: ['initialPrompt', 'status', 'projectId', 'agent', 'permissionMode'], targetOwner: 'rust-sidecar', domain: 'tasks-projects' },
  { functionName: 'updateTask', tauriCommand: 'update_task', payloadKeys: ['id', 'prompt'], targetOwner: 'rust-sidecar', domain: 'tasks-projects' },
  { functionName: 'updateTaskSummary', tauriCommand: 'update_task_summary', payloadKeys: ['id', 'summary'], targetOwner: 'rust-sidecar', domain: 'tasks-projects' },
  { functionName: 'updateTaskStatus', tauriCommand: 'update_task_status', payloadKeys: ['id', 'status'], targetOwner: 'rust-sidecar', domain: 'tasks-projects' },
  { functionName: 'deleteTask', tauriCommand: 'delete_task', payloadKeys: ['id'], targetOwner: 'rust-sidecar', domain: 'tasks-projects' },
  { functionName: 'clearDoneTasks', tauriCommand: 'clear_done_tasks', payloadKeys: ['projectId'], targetOwner: 'rust-sidecar', domain: 'tasks-projects' },
  { functionName: 'getAppMode', tauriCommand: 'get_app_mode', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'config' },
  { functionName: 'getGitBranch', tauriCommand: 'get_git_branch', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'config' },
  { functionName: 'getAgents', tauriCommand: 'get_agents', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'misc' },
  { functionName: 'createProject', tauriCommand: 'create_project', payloadKeys: ['name', 'path'], targetOwner: 'rust-sidecar', domain: 'tasks-projects' },
  { functionName: 'getProjects', tauriCommand: 'get_projects', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'tasks-projects' },
  { functionName: 'updateProject', tauriCommand: 'update_project', payloadKeys: ['id', 'name', 'path'], targetOwner: 'rust-sidecar', domain: 'tasks-projects' },
  { functionName: 'deleteProject', tauriCommand: 'delete_project', payloadKeys: ['id'], targetOwner: 'rust-sidecar', domain: 'tasks-projects' },
  { functionName: 'getProjectAttention', tauriCommand: 'get_project_attention', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'tasks-projects' },
  { functionName: 'getProjectConfig', tauriCommand: 'get_project_config', payloadKeys: ['projectId', 'key'], targetOwner: 'rust-sidecar', domain: 'config' },
  { functionName: 'setProjectConfig', tauriCommand: 'set_project_config', payloadKeys: ['projectId', 'key', 'value'], targetOwner: 'rust-sidecar', domain: 'config' },
  { functionName: 'getAllTasks', tauriCommand: 'get_tasks', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'tasks-projects' },
  { functionName: 'getTasksForProject', tauriCommand: 'get_tasks_for_project', payloadKeys: ['projectId'], targetOwner: 'rust-sidecar', domain: 'tasks-projects' },
  { functionName: 'startImplementation', tauriCommand: 'start_implementation', payloadKeys: ['taskId', 'repoPath'], targetOwner: 'rust-sidecar', domain: 'tasks-projects' },
  { functionName: 'resumeStartupSessions', tauriCommand: 'resume_startup_sessions', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'agent-session-pty' },
  { functionName: 'abortImplementation', tauriCommand: 'abort_implementation', payloadKeys: ['taskId'], targetOwner: 'rust-sidecar', domain: 'tasks-projects' },
  { functionName: 'getWorktreeForTask', tauriCommand: 'get_worktree_for_task', payloadKeys: ['taskId'], targetOwner: 'rust-sidecar', domain: 'tasks-projects' },
  { functionName: 'getTaskWorkspace', tauriCommand: 'get_task_workspace', payloadKeys: ['taskId'], targetOwner: 'rust-sidecar', domain: 'tasks-projects' },
  { functionName: 'getSessionStatus', tauriCommand: 'get_session_status', payloadKeys: ['sessionId'], targetOwner: 'rust-sidecar', domain: 'agent-session-pty' },
  { functionName: 'abortSession', tauriCommand: 'abort_session', payloadKeys: ['sessionId'], targetOwner: 'rust-sidecar', domain: 'agent-session-pty' },
  { functionName: 'forceGithubSync', tauriCommand: 'force_github_sync', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'github-review' },
  { functionName: 'getPullRequests', tauriCommand: 'get_pull_requests', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'github-review' },
  { functionName: 'openUrl', tauriCommand: 'open_url', payloadKeys: ['url'], targetOwner: 'electron-main', domain: 'misc' },
  { functionName: 'getPrComments', tauriCommand: 'get_pr_comments', payloadKeys: ['prId'], targetOwner: 'rust-sidecar', domain: 'github-review' },
  { functionName: 'markCommentAddressed', tauriCommand: 'mark_comment_addressed', payloadKeys: ['commentId'], targetOwner: 'rust-sidecar', domain: 'github-review' },
  { functionName: 'mergePullRequest', tauriCommand: 'merge_pull_request', payloadKeys: ['owner', 'repo', 'prNumber'], targetOwner: 'rust-sidecar', domain: 'github-review' },
  { functionName: 'checkOpenCodeInstalled', tauriCommand: 'check_opencode_installed', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'config' },
  { functionName: 'checkPiInstalled', tauriCommand: 'check_pi_installed', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'config' },
  { functionName: 'checkClaudeInstalled', tauriCommand: 'check_claude_installed', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'config' },
  { functionName: 'getConfig', tauriCommand: 'get_config', payloadKeys: ['key'], targetOwner: 'rust-sidecar', domain: 'config' },
  { functionName: 'setConfig', tauriCommand: 'set_config', payloadKeys: ['key', 'value'], targetOwner: 'rust-sidecar', domain: 'config' },
  { functionName: 'getTaskDetail', tauriCommand: 'get_task_detail', payloadKeys: ['taskId'], targetOwner: 'rust-sidecar', domain: 'tasks-projects' },
  { functionName: 'getLatestSession', tauriCommand: 'get_latest_session', payloadKeys: ['taskId'], targetOwner: 'rust-sidecar', domain: 'agent-session-pty' },
  { functionName: 'getLatestSessions', tauriCommand: 'get_latest_sessions', payloadKeys: ['taskIds'], targetOwner: 'rust-sidecar', domain: 'agent-session-pty' },
  { functionName: 'getSessionOutput', tauriCommand: 'get_session_output', payloadKeys: ['taskId'], targetOwner: 'rust-sidecar', domain: 'agent-session-pty' },
  { functionName: 'getGithubUsername', tauriCommand: 'get_github_username', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'github-review' },
  { functionName: 'fetchReviewPrs', tauriCommand: 'fetch_review_prs', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'github-review' },
  { functionName: 'getReviewPrs', tauriCommand: 'get_review_prs', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'github-review' },
  { functionName: 'markReviewPrViewed', tauriCommand: 'mark_review_pr_viewed', payloadKeys: ['prId', 'headSha'], targetOwner: 'rust-sidecar', domain: 'github-review' },
  { functionName: 'getPrFileDiffs', tauriCommand: 'get_pr_file_diffs', payloadKeys: ['owner', 'repo', 'prNumber'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'getFileContent', tauriCommand: 'get_file_content', payloadKeys: ['owner', 'repo', 'sha'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'getFileContentBase64', tauriCommand: 'get_file_content_base64', payloadKeys: ['owner', 'repo', 'sha'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'getFileAtRef', tauriCommand: 'get_file_at_ref', payloadKeys: ['owner', 'repo', 'path', 'refSha'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'getFileAtRefBase64', tauriCommand: 'get_file_at_ref_base64', payloadKeys: ['owner', 'repo', 'path', 'refSha'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'getReviewComments', tauriCommand: 'get_review_comments', payloadKeys: ['owner', 'repo', 'prNumber'], targetOwner: 'rust-sidecar', domain: 'github-review' },
  { functionName: 'getPrOverviewComments', tauriCommand: 'get_pr_overview_comments', payloadKeys: ['owner', 'repo', 'prNumber'], targetOwner: 'rust-sidecar', domain: 'github-review' },
  { functionName: 'submitPrReview', tauriCommand: 'submit_pr_review', payloadKeys: ['owner', 'repo', 'prNumber', 'event', 'body', 'comments', 'commitId'], targetOwner: 'rust-sidecar', domain: 'github-review' },
  { functionName: 'spawnPty', tauriCommand: 'pty_spawn', payloadKeys: ['taskId', 'serverPort', 'opencodeSessionId', 'cols', 'rows'], targetOwner: 'rust-sidecar', domain: 'agent-session-pty' },
  { functionName: 'spawnShellPty', tauriCommand: 'pty_spawn_shell', payloadKeys: ['taskId', 'cwd', 'cols', 'rows', 'terminalIndex'], targetOwner: 'rust-sidecar', domain: 'agent-session-pty' },
  { functionName: 'writePty', tauriCommand: 'pty_write', payloadKeys: ['taskId', 'data'], targetOwner: 'rust-sidecar', domain: 'agent-session-pty' },
  { functionName: 'resizePty', tauriCommand: 'pty_resize', payloadKeys: ['taskId', 'cols', 'rows'], targetOwner: 'rust-sidecar', domain: 'agent-session-pty' },
  { functionName: 'killPty', tauriCommand: 'pty_kill', payloadKeys: ['taskId'], targetOwner: 'rust-sidecar', domain: 'agent-session-pty' },
  { functionName: 'killShellsForTask', tauriCommand: 'pty_kill_shells_for_task', payloadKeys: ['taskId'], targetOwner: 'rust-sidecar', domain: 'agent-session-pty' },
  { functionName: 'getPtyBuffer', tauriCommand: 'get_pty_buffer', payloadKeys: ['taskId'], targetOwner: 'rust-sidecar', domain: 'agent-session-pty' },
  { functionName: 'getTaskDiff', tauriCommand: 'get_task_diff', payloadKeys: ['taskId', 'includeUncommitted'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'getTaskFileContents', tauriCommand: 'get_task_file_contents', payloadKeys: ['taskId', 'path', 'oldPath', 'status', 'includeUncommitted'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'getTaskBatchFileContents', tauriCommand: 'get_task_batch_file_contents', payloadKeys: ['taskId', 'files', 'includeUncommitted'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'addSelfReviewComment', tauriCommand: 'add_self_review_comment', payloadKeys: ['taskId', 'commentType', 'filePath', 'lineNumber', 'body'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'getActiveSelfReviewComments', tauriCommand: 'get_active_self_review_comments', payloadKeys: ['taskId'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'getArchivedSelfReviewComments', tauriCommand: 'get_archived_self_review_comments', payloadKeys: ['taskId'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'deleteSelfReviewComment', tauriCommand: 'delete_self_review_comment', payloadKeys: ['commentId'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'archiveSelfReviewComments', tauriCommand: 'archive_self_review_comments', payloadKeys: ['taskId'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'getTaskCommits', tauriCommand: 'get_task_commits', payloadKeys: ['taskId'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'getCommitDiff', tauriCommand: 'get_commit_diff', payloadKeys: ['taskId', 'commitSha'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'getCommitFileContents', tauriCommand: 'get_commit_file_contents', payloadKeys: ['taskId', 'commitSha', 'path', 'oldPath', 'status'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'getCommitBatchFileContents', tauriCommand: 'get_commit_batch_file_contents', payloadKeys: ['taskId', 'commitSha', 'files'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'startAgentReview', tauriCommand: 'start_agent_review', payloadKeys: ['repoOwner', 'repoName', 'prNumber', 'headRef', 'baseRef', 'prTitle', 'prBody', 'reviewPrId'], targetOwner: 'rust-sidecar', domain: 'misc' },
  { functionName: 'getAgentReviewComments', tauriCommand: 'get_agent_review_comments', payloadKeys: ['reviewPrId'], targetOwner: 'rust-sidecar', domain: 'github-review' },
  { functionName: 'updateAgentReviewCommentStatus', tauriCommand: 'update_agent_review_comment_status', payloadKeys: ['commentId', 'status'], targetOwner: 'rust-sidecar', domain: 'github-review' },
  { functionName: 'dismissAllAgentReviewComments', tauriCommand: 'dismiss_all_agent_review_comments', payloadKeys: ['reviewPrId'], targetOwner: 'rust-sidecar', domain: 'github-review' },
  { functionName: 'abortAgentReview', tauriCommand: 'abort_agent_review', payloadKeys: ['reviewSessionKey'], targetOwner: 'rust-sidecar', domain: 'misc' },
  { functionName: 'listOpenCodeCommands', tauriCommand: 'list_opencode_commands', payloadKeys: ['projectId'], targetOwner: 'rust-sidecar', domain: 'agent-session-pty' },
  { functionName: 'listOpenCodeSkills', tauriCommand: 'list_opencode_skills', payloadKeys: ['projectId'], targetOwner: 'rust-sidecar', domain: 'agent-session-pty' },
  { functionName: 'saveSkillContent', tauriCommand: 'save_skill_content', payloadKeys: ['projectId', 'skillName', 'level', 'sourceDir', 'content'], targetOwner: 'rust-sidecar', domain: 'misc' },
  { functionName: 'searchOpenCodeFiles', tauriCommand: 'search_opencode_files', payloadKeys: ['projectId', 'query'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'listOpenCodeAgents', tauriCommand: 'list_opencode_agents', payloadKeys: ['projectId'], targetOwner: 'rust-sidecar', domain: 'agent-session-pty' },
  { functionName: 'listOpenCodeModels', tauriCommand: 'list_opencode_models', payloadKeys: ['projectId'], targetOwner: 'rust-sidecar', domain: 'agent-session-pty' },
  { functionName: 'transcribeAudio', tauriCommand: 'transcribe_audio', payloadKeys: ['audioData'], targetOwner: 'rust-sidecar', domain: 'whisper-audio' },
  { functionName: 'getWhisperModelStatus', tauriCommand: 'get_whisper_model_status', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'whisper-audio' },
  { functionName: 'downloadWhisperModel', tauriCommand: 'download_whisper_model', payloadKeys: ['modelSize'], targetOwner: 'rust-sidecar', domain: 'whisper-audio' },
  { functionName: 'getAllWhisperModelStatuses', tauriCommand: 'get_all_whisper_model_statuses', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'whisper-audio' },
  { functionName: 'setWhisperModel', tauriCommand: 'set_whisper_model', payloadKeys: ['modelSize'], targetOwner: 'rust-sidecar', domain: 'whisper-audio' },
  { functionName: 'finalizeClaudeSession', tauriCommand: 'finalize_claude_session', payloadKeys: ['taskId', 'success'], targetOwner: 'rust-sidecar', domain: 'agent-session-pty' },
  { functionName: 'fetchAuthoredPrs', tauriCommand: 'fetch_authored_prs', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'github-review' },
  { functionName: 'getAuthoredPrs', tauriCommand: 'get_authored_prs', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'github-review' },
  { functionName: 'fsReadDir', tauriCommand: 'fs_read_dir', payloadKeys: ['projectId', 'dirPath'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'fsReadFile', tauriCommand: 'fs_read_file', payloadKeys: ['projectId', 'filePath'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'fsSearchFiles', tauriCommand: 'fs_search_files', payloadKeys: ['projectId', 'query', 'limit'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'installPlugin', tauriCommand: 'install_plugin', payloadKeys: ['plugin'], targetOwner: 'rust-sidecar', domain: 'plugins' },
  { functionName: 'installPluginFromLocal', tauriCommand: 'install_plugin_from_local', payloadKeys: ['sourcePath'], targetOwner: 'rust-sidecar', domain: 'plugins' },
  { functionName: 'installPluginFromNpm', tauriCommand: 'install_plugin_from_npm', payloadKeys: ['packageName'], targetOwner: 'rust-sidecar', domain: 'plugins' },
  { functionName: 'uninstallPlugin', tauriCommand: 'uninstall_plugin', payloadKeys: ['pluginId'], targetOwner: 'rust-sidecar', domain: 'plugins' },
  { functionName: 'getPlugin', tauriCommand: 'get_plugin', payloadKeys: ['pluginId'], targetOwner: 'rust-sidecar', domain: 'plugins' },
  { functionName: 'listPlugins', tauriCommand: 'list_plugins', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'plugins' },
  { functionName: 'setPluginEnabled', tauriCommand: 'set_plugin_enabled', payloadKeys: ['projectId', 'pluginId', 'enabled'], targetOwner: 'rust-sidecar', domain: 'plugins' },
  { functionName: 'getEnabledPlugins', tauriCommand: 'get_enabled_plugins', payloadKeys: ['projectId'], targetOwner: 'rust-sidecar', domain: 'plugins' },
  { functionName: 'getPluginStorage', tauriCommand: 'get_plugin_storage', payloadKeys: ['pluginId', 'key'], targetOwner: 'rust-sidecar', domain: 'plugins' },
  { functionName: 'setPluginStorage', tauriCommand: 'set_plugin_storage', payloadKeys: ['pluginId', 'key', 'value'], targetOwner: 'rust-sidecar', domain: 'plugins' },
  { functionName: 'pluginInvoke', tauriCommand: 'plugin_invoke', payloadKeys: ['pluginId', 'command', 'payload'], targetOwner: 'rust-sidecar', domain: 'plugins' },
] as const satisfies readonly IpcCommandContract[]

export const appShellEventContracts = [
  { eventName: 'github-sync-complete', payload: 'PollResult', producer: 'rust-backend', transportAfterMigration: 'sse-or-websocket', domain: 'github-review' },
  { eventName: 'review-status-changed', payload: 'review status payload', producer: 'rust-backend', transportAfterMigration: 'sse-or-websocket', domain: 'github-review' },
  { eventName: 'action-complete', payload: '{ task_id: string }', producer: 'rust-backend', transportAfterMigration: 'sse-or-websocket', domain: 'agent-session-pty' },
  { eventName: 'implementation-failed', payload: '{ task_id: string; error: string }', producer: 'rust-backend', transportAfterMigration: 'sse-or-websocket', domain: 'agent-session-pty' },
  { eventName: 'server-resumed', payload: '{ task_id: string; port: number; workspace_path: string }', producer: 'rust-backend', transportAfterMigration: 'sse-or-websocket', domain: 'agent-session-pty' },
  { eventName: 'startup-resume-complete', payload: 'void', producer: 'rust-backend', transportAfterMigration: 'sse-or-websocket', domain: 'agent-session-pty' },
  { eventName: 'new-pr-comment', payload: 'PR comment notification payload', producer: 'rust-backend', transportAfterMigration: 'sse-or-websocket', domain: 'github-review' },
  { eventName: 'comment-addressed', payload: 'void', producer: 'rust-backend', transportAfterMigration: 'sse-or-websocket', domain: 'github-review' },
  { eventName: 'ci-status-changed', payload: '{ task_id: string; pr_id: number; pr_title: string; ci_status: string; timestamp: number }', producer: 'rust-backend', transportAfterMigration: 'sse-or-websocket', domain: 'github-review' },
  { eventName: 'agent-event', payload: 'AgentEvent', producer: 'rust-backend', transportAfterMigration: 'sse-or-websocket', domain: 'agent-session-pty' },
  { eventName: 'session-aborted', payload: '{ ticket_id: string; session_id: string }', producer: 'rust-backend', transportAfterMigration: 'sse-or-websocket', domain: 'agent-session-pty' },
  { eventName: 'agent-status-changed', payload: '{ task_id: string; status: string }', producer: 'rust-backend', transportAfterMigration: 'sse-or-websocket', domain: 'agent-session-pty' },
  { eventName: 'agent-pty-exited', payload: '{ task_id: string; success: boolean }', producer: 'rust-backend', transportAfterMigration: 'sse-or-websocket', domain: 'agent-session-pty' },
  { eventName: 'review-pr-count-changed', payload: 'number', producer: 'rust-backend', transportAfterMigration: 'sse-or-websocket', domain: 'github-review' },
  { eventName: 'authored-prs-updated', payload: 'void', producer: 'rust-backend', transportAfterMigration: 'sse-or-websocket', domain: 'github-review' },
  { eventName: 'github-rate-limited', payload: 'GitHub rate limit payload', producer: 'rust-backend', transportAfterMigration: 'sse-or-websocket', domain: 'github-review' },
  { eventName: 'task-changed', payload: '{ action: "created" | "updated" | "deleted"; task_id: string } | { action: "cleared_done"; count: number }', producer: 'rust-backend', transportAfterMigration: 'sse-or-websocket', domain: 'tasks-projects' },
] as const satisfies readonly AppShellEventContract[]

export const dynamicShellEventContracts = [
  {
    eventPattern: 'pty-output-{taskId}',
    currentSubscribers: ['src/lib/terminalPool.ts', 'src/lib/usePtyBridge.svelte.ts'],
    currentProducers: ['src-tauri/src/pty_manager.rs'],
    payload: '{ task_id: string; data: string; instance_id: number }',
    producer: 'rust-backend',
    transportAfterMigration: 'sse-or-websocket',
    domain: 'agent-session-pty',
  },
  {
    eventPattern: 'pty-exit-{taskId}',
    currentSubscribers: ['src/lib/terminalPool.ts', 'src/lib/usePtyBridge.svelte.ts'],
    currentProducers: ['src-tauri/src/pty_manager.rs'],
    payload: '{ instance_id: number }',
    producer: 'rust-backend',
    transportAfterMigration: 'sse-or-websocket',
    domain: 'agent-session-pty',
  },
  {
    eventPattern: 'pty-output-{taskId}-shell-{terminalIndex}',
    currentSubscribers: ['src/components/task-detail/TerminalTabs.svelte', 'src/components/task-detail/TaskTerminal.svelte', 'src/lib/terminalPool.ts', 'src/lib/plugin/pluginRegistry.ts'],
    currentProducers: ['src-tauri/src/pty_manager.rs'],
    payload: '{ task_id: string; data: string; instance_id: number }',
    producer: 'rust-backend',
    transportAfterMigration: 'sse-or-websocket',
    domain: 'agent-session-pty',
  },
  {
    eventPattern: 'pty-exit-{taskId}-shell-{terminalIndex}',
    currentSubscribers: ['src/components/task-detail/TerminalTabs.svelte', 'src/components/task-detail/TaskTerminal.svelte', 'src/lib/terminalPool.ts', 'src/lib/plugin/pluginRegistry.ts'],
    currentProducers: ['src-tauri/src/pty_manager.rs'],
    payload: '{ instance_id: number }',
    producer: 'rust-backend',
    transportAfterMigration: 'sse-or-websocket',
    domain: 'agent-session-pty',
  },
  {
    eventPattern: 'plugin:sidecar-exited',
    currentSubscribers: ['plugin-defined event subscriptions through src/lib/plugin/pluginRegistry.ts'],
    currentProducers: ['src-tauri/src/plugin_host.rs'],
    payload: '{ code: number | null; signal: number | null; pid: number | null; retry_attempts: number }',
    producer: 'plugin-host',
    transportAfterMigration: 'plugin-event-adapter',
    domain: 'plugins',
  },
  {
    eventPattern: 'plugin:sidecar-failed',
    currentSubscribers: ['plugin-defined event subscriptions through src/lib/plugin/pluginRegistry.ts'],
    currentProducers: ['src-tauri/src/plugin_host.rs'],
    payload: '{ error: string | null; retry_attempts: number }',
    producer: 'plugin-host',
    transportAfterMigration: 'plugin-event-adapter',
    domain: 'plugins',
  },
  {
    eventPattern: 'whisper-download-progress',
    currentSubscribers: ['src/components/shared/input/ModelDownloadProgress.svelte'],
    currentProducers: ['src-tauri/src/whisper_manager.rs'],
    payload: '{ model_size: string; bytes_downloaded: number; total_bytes: number; percentage: number }',
    producer: 'rust-backend',
    transportAfterMigration: 'sse-or-websocket',
    domain: 'whisper-audio',
  },
  {
    eventPattern: '{plugin-defined-tauri-event}',
    currentSubscribers: ['src/lib/plugin/pluginRegistry.ts'],
    currentProducers: ['plugin backend sidecar via Rust plugin host bridge'],
    payload: 'unknown plugin-defined payload',
    producer: 'plugin-host',
    transportAfterMigration: 'plugin-event-adapter',
    domain: 'plugins',
  },
] as const satisfies readonly DynamicShellEventContract[]
