// Phase 0 inventory for the Electron desktop migration.
// Keep this file in sync with src/lib/ipc.ts and registerAppDesktopEventListeners().
// It is intentionally data-only: no Electron runtime is implemented here.

export type IpcContractOwner = 'rust-sidecar' | 'electron-main'

export type IpcContractDomain =
  | 'agent-session-pty'
  | 'app-shell'
  | 'config'
  | 'files-review'
  | 'github-review'
  | 'misc'
  | 'plugins'
  | 'tasks-projects'
  | 'whisper-audio'

export interface IpcCommandContract {
  functionName: string
  ipcCommand: string
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
  { functionName: 'createTask', ipcCommand: 'create_task', payloadKeys: ['initialPrompt', 'status', 'projectId', 'permissionMode'], targetOwner: 'rust-sidecar', domain: 'tasks-projects' },
  { functionName: 'updateTask', ipcCommand: 'update_task', payloadKeys: ['id', 'prompt'], targetOwner: 'rust-sidecar', domain: 'tasks-projects' },
  { functionName: 'updateTaskSummary', ipcCommand: 'update_task_summary', payloadKeys: ['id', 'summary'], targetOwner: 'rust-sidecar', domain: 'tasks-projects' },
  { functionName: 'updateTaskStatus', ipcCommand: 'update_task_status', payloadKeys: ['id', 'status'], targetOwner: 'rust-sidecar', domain: 'tasks-projects' },
  { functionName: 'deleteTask', ipcCommand: 'delete_task', payloadKeys: ['id'], targetOwner: 'rust-sidecar', domain: 'tasks-projects' },
  { functionName: 'clearDoneTasks', ipcCommand: 'clear_done_tasks', payloadKeys: ['projectId'], targetOwner: 'rust-sidecar', domain: 'tasks-projects' },
  { functionName: 'getAppMode', ipcCommand: 'get_app_mode', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'config' },
  { functionName: 'getGitBranch', ipcCommand: 'get_git_branch', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'config' },
  { functionName: 'createProject', ipcCommand: 'create_project', payloadKeys: ['name', 'path'], targetOwner: 'rust-sidecar', domain: 'tasks-projects' },
  { functionName: 'getProjects', ipcCommand: 'get_projects', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'tasks-projects' },
  { functionName: 'updateProject', ipcCommand: 'update_project', payloadKeys: ['id', 'name', 'path'], targetOwner: 'rust-sidecar', domain: 'tasks-projects' },
  { functionName: 'deleteProject', ipcCommand: 'delete_project', payloadKeys: ['id'], targetOwner: 'rust-sidecar', domain: 'tasks-projects' },
  { functionName: 'getProjectAttention', ipcCommand: 'get_project_attention', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'tasks-projects' },
  { functionName: 'getProjectConfig', ipcCommand: 'get_project_config', payloadKeys: ['projectId', 'key'], targetOwner: 'rust-sidecar', domain: 'config' },
  { functionName: 'setProjectConfig', ipcCommand: 'set_project_config', payloadKeys: ['projectId', 'key', 'value'], targetOwner: 'rust-sidecar', domain: 'config' },
  { functionName: 'getAllTasks', ipcCommand: 'get_tasks', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'tasks-projects' },
  { functionName: 'getTasksForProject', ipcCommand: 'get_tasks_for_project', payloadKeys: ['projectId'], targetOwner: 'rust-sidecar', domain: 'tasks-projects' },
  { functionName: 'startImplementation', ipcCommand: 'start_implementation', payloadKeys: ['taskId', 'repoPath'], targetOwner: 'rust-sidecar', domain: 'tasks-projects' },
  { functionName: 'resumeStartupSessions', ipcCommand: 'resume_startup_sessions', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'agent-session-pty' },
  { functionName: 'abortImplementation', ipcCommand: 'abort_implementation', payloadKeys: ['taskId'], targetOwner: 'rust-sidecar', domain: 'tasks-projects' },
  { functionName: 'getWorktreeForTask', ipcCommand: 'get_worktree_for_task', payloadKeys: ['taskId'], targetOwner: 'rust-sidecar', domain: 'tasks-projects' },
  { functionName: 'getTaskWorkspace', ipcCommand: 'get_task_workspace', payloadKeys: ['taskId'], targetOwner: 'rust-sidecar', domain: 'tasks-projects' },
  { functionName: 'getSessionStatus', ipcCommand: 'get_session_status', payloadKeys: ['sessionId'], targetOwner: 'rust-sidecar', domain: 'agent-session-pty' },
  { functionName: 'abortSession', ipcCommand: 'abort_session', payloadKeys: ['sessionId'], targetOwner: 'rust-sidecar', domain: 'agent-session-pty' },
  { functionName: 'forceGithubSync', ipcCommand: 'force_github_sync', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'github-review' },
  { functionName: 'getPullRequests', ipcCommand: 'get_pull_requests', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'github-review' },
  { functionName: 'openUrl', ipcCommand: 'open_url', payloadKeys: ['url'], targetOwner: 'electron-main', domain: 'misc' },
  { functionName: 'quitApp', ipcCommand: 'quit_app', payloadKeys: [], targetOwner: 'electron-main', domain: 'app-shell' },
  { functionName: 'getPrComments', ipcCommand: 'get_pr_comments', payloadKeys: ['prId'], targetOwner: 'rust-sidecar', domain: 'github-review' },
  { functionName: 'markCommentAddressed', ipcCommand: 'mark_comment_addressed', payloadKeys: ['commentId'], targetOwner: 'rust-sidecar', domain: 'github-review' },
  { functionName: 'mergePullRequest', ipcCommand: 'merge_pull_request', payloadKeys: ['owner', 'repo', 'prNumber'], targetOwner: 'rust-sidecar', domain: 'github-review' },
  { functionName: 'checkOpenCodeInstalled', ipcCommand: 'check_opencode_installed', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'config' },
  { functionName: 'checkPiInstalled', ipcCommand: 'check_pi_installed', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'config' },
  { functionName: 'checkClaudeInstalled', ipcCommand: 'check_claude_installed', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'config' },
  { functionName: 'getConfig', ipcCommand: 'get_config', payloadKeys: ['key'], targetOwner: 'rust-sidecar', domain: 'config' },
  { functionName: 'setConfig', ipcCommand: 'set_config', payloadKeys: ['key', 'value'], targetOwner: 'rust-sidecar', domain: 'config' },
  { functionName: 'getTaskDetail', ipcCommand: 'get_task_detail', payloadKeys: ['taskId'], targetOwner: 'rust-sidecar', domain: 'tasks-projects' },
  { functionName: 'getLatestSession', ipcCommand: 'get_latest_session', payloadKeys: ['taskId'], targetOwner: 'rust-sidecar', domain: 'agent-session-pty' },
  { functionName: 'getLatestSessions', ipcCommand: 'get_latest_sessions', payloadKeys: ['taskIds'], targetOwner: 'rust-sidecar', domain: 'agent-session-pty' },
  { functionName: 'getSessionOutput', ipcCommand: 'get_session_output', payloadKeys: ['taskId'], targetOwner: 'rust-sidecar', domain: 'agent-session-pty' },
  { functionName: 'getGithubUsername', ipcCommand: 'get_github_username', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'github-review' },
  { functionName: 'fetchReviewPrs', ipcCommand: 'fetch_review_prs', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'github-review' },
  { functionName: 'getReviewPrs', ipcCommand: 'get_review_prs', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'github-review' },
  { functionName: 'markReviewPrViewed', ipcCommand: 'mark_review_pr_viewed', payloadKeys: ['prId', 'headSha'], targetOwner: 'rust-sidecar', domain: 'github-review' },
  { functionName: 'getPrFileDiffs', ipcCommand: 'get_pr_file_diffs', payloadKeys: ['owner', 'repo', 'prNumber'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'getFileContent', ipcCommand: 'get_file_content', payloadKeys: ['owner', 'repo', 'sha'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'getFileContentBase64', ipcCommand: 'get_file_content_base64', payloadKeys: ['owner', 'repo', 'sha'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'getFileAtRef', ipcCommand: 'get_file_at_ref', payloadKeys: ['owner', 'repo', 'path', 'refSha'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'getFileAtRefBase64', ipcCommand: 'get_file_at_ref_base64', payloadKeys: ['owner', 'repo', 'path', 'refSha'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'getReviewComments', ipcCommand: 'get_review_comments', payloadKeys: ['owner', 'repo', 'prNumber'], targetOwner: 'rust-sidecar', domain: 'github-review' },
  { functionName: 'getPrOverviewComments', ipcCommand: 'get_pr_overview_comments', payloadKeys: ['owner', 'repo', 'prNumber'], targetOwner: 'rust-sidecar', domain: 'github-review' },
  { functionName: 'submitPrReview', ipcCommand: 'submit_pr_review', payloadKeys: ['owner', 'repo', 'prNumber', 'event', 'body', 'comments', 'commitId'], targetOwner: 'rust-sidecar', domain: 'github-review' },
  { functionName: 'spawnShellPty', ipcCommand: 'pty_spawn_shell', payloadKeys: ['taskId', 'cwd', 'cols', 'rows', 'terminalIndex'], targetOwner: 'rust-sidecar', domain: 'agent-session-pty' },
  { functionName: 'writePty', ipcCommand: 'pty_write', payloadKeys: ['taskId', 'data'], targetOwner: 'rust-sidecar', domain: 'agent-session-pty' },
  { functionName: 'resizePty', ipcCommand: 'pty_resize', payloadKeys: ['taskId', 'cols', 'rows'], targetOwner: 'rust-sidecar', domain: 'agent-session-pty' },
  { functionName: 'killPty', ipcCommand: 'pty_kill', payloadKeys: ['taskId'], targetOwner: 'rust-sidecar', domain: 'agent-session-pty' },
  { functionName: 'killShellsForTask', ipcCommand: 'pty_kill_shells_for_task', payloadKeys: ['taskId'], targetOwner: 'rust-sidecar', domain: 'agent-session-pty' },
  { functionName: 'getPtyBuffer', ipcCommand: 'get_pty_buffer', payloadKeys: ['taskId'], targetOwner: 'rust-sidecar', domain: 'agent-session-pty' },
  { functionName: 'getTaskDiff', ipcCommand: 'get_task_diff', payloadKeys: ['taskId', 'includeUncommitted'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'getTaskFileContents', ipcCommand: 'get_task_file_contents', payloadKeys: ['taskId', 'path', 'oldPath', 'status', 'includeUncommitted'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'getTaskBatchFileContents', ipcCommand: 'get_task_batch_file_contents', payloadKeys: ['taskId', 'files', 'includeUncommitted'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'addSelfReviewComment', ipcCommand: 'add_self_review_comment', payloadKeys: ['taskId', 'commentType', 'filePath', 'lineNumber', 'body'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'getActiveSelfReviewComments', ipcCommand: 'get_active_self_review_comments', payloadKeys: ['taskId'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'getArchivedSelfReviewComments', ipcCommand: 'get_archived_self_review_comments', payloadKeys: ['taskId'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'deleteSelfReviewComment', ipcCommand: 'delete_self_review_comment', payloadKeys: ['commentId'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'archiveSelfReviewComments', ipcCommand: 'archive_self_review_comments', payloadKeys: ['taskId'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'getTaskCommits', ipcCommand: 'get_task_commits', payloadKeys: ['taskId'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'getCommitDiff', ipcCommand: 'get_commit_diff', payloadKeys: ['taskId', 'commitSha'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'getCommitFileContents', ipcCommand: 'get_commit_file_contents', payloadKeys: ['taskId', 'commitSha', 'path', 'oldPath', 'status'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'getCommitBatchFileContents', ipcCommand: 'get_commit_batch_file_contents', payloadKeys: ['taskId', 'commitSha', 'files'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'startAgentReview', ipcCommand: 'start_agent_review', payloadKeys: ['repoOwner', 'repoName', 'prNumber', 'headRef', 'baseRef', 'prTitle', 'prBody', 'reviewPrId'], targetOwner: 'rust-sidecar', domain: 'misc' },
  { functionName: 'getAgentReviewComments', ipcCommand: 'get_agent_review_comments', payloadKeys: ['reviewPrId'], targetOwner: 'rust-sidecar', domain: 'github-review' },
  { functionName: 'updateAgentReviewCommentStatus', ipcCommand: 'update_agent_review_comment_status', payloadKeys: ['commentId', 'status'], targetOwner: 'rust-sidecar', domain: 'github-review' },
  { functionName: 'dismissAllAgentReviewComments', ipcCommand: 'dismiss_all_agent_review_comments', payloadKeys: ['reviewPrId'], targetOwner: 'rust-sidecar', domain: 'github-review' },
  { functionName: 'abortAgentReview', ipcCommand: 'abort_agent_review', payloadKeys: ['reviewSessionKey'], targetOwner: 'rust-sidecar', domain: 'misc' },
  { functionName: 'listOpenCodeCommands', ipcCommand: 'list_opencode_commands', payloadKeys: ['projectId'], targetOwner: 'rust-sidecar', domain: 'agent-session-pty' },
  { functionName: 'listOpenCodeSkills', ipcCommand: 'list_opencode_skills', payloadKeys: ['projectId'], targetOwner: 'rust-sidecar', domain: 'agent-session-pty' },
  { functionName: 'saveSkillContent', ipcCommand: 'save_skill_content', payloadKeys: ['projectId', 'skillName', 'level', 'sourceDir', 'content'], targetOwner: 'rust-sidecar', domain: 'misc' },
  { functionName: 'searchOpenCodeFiles', ipcCommand: 'search_opencode_files', payloadKeys: ['projectId', 'query'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'listOpenCodeAgents', ipcCommand: 'list_opencode_agents', payloadKeys: ['projectId'], targetOwner: 'rust-sidecar', domain: 'agent-session-pty' },
  { functionName: 'listOpenCodeModels', ipcCommand: 'list_opencode_models', payloadKeys: ['projectId'], targetOwner: 'rust-sidecar', domain: 'agent-session-pty' },
  { functionName: 'transcribeAudio', ipcCommand: 'transcribe_audio', payloadKeys: ['audioPcmBase64'], targetOwner: 'rust-sidecar', domain: 'whisper-audio' },
  { functionName: 'getWhisperModelStatus', ipcCommand: 'get_whisper_model_status', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'whisper-audio' },
  { functionName: 'downloadWhisperModel', ipcCommand: 'download_whisper_model', payloadKeys: ['modelSize'], targetOwner: 'rust-sidecar', domain: 'whisper-audio' },
  { functionName: 'getAllWhisperModelStatuses', ipcCommand: 'get_all_whisper_model_statuses', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'whisper-audio' },
  { functionName: 'setWhisperModel', ipcCommand: 'set_whisper_model', payloadKeys: ['modelSize'], targetOwner: 'rust-sidecar', domain: 'whisper-audio' },
  { functionName: 'finalizeClaudeSession', ipcCommand: 'finalize_claude_session', payloadKeys: ['taskId', 'success'], targetOwner: 'rust-sidecar', domain: 'agent-session-pty' },
  { functionName: 'fetchAuthoredPrs', ipcCommand: 'fetch_authored_prs', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'github-review' },
  { functionName: 'getAuthoredPrs', ipcCommand: 'get_authored_prs', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'github-review' },
  { functionName: 'fsReadDir', ipcCommand: 'fs_read_dir', payloadKeys: ['projectId', 'dirPath'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'fsReadFile', ipcCommand: 'fs_read_file', payloadKeys: ['projectId', 'filePath'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'fsSearchFiles', ipcCommand: 'fs_search_files', payloadKeys: ['projectId', 'query', 'limit'], targetOwner: 'rust-sidecar', domain: 'files-review' },
  { functionName: 'installPlugin', ipcCommand: 'install_plugin', payloadKeys: ['plugin'], targetOwner: 'rust-sidecar', domain: 'plugins' },
  { functionName: 'installPluginFromLocal', ipcCommand: 'install_plugin_from_local', payloadKeys: ['sourcePath'], targetOwner: 'rust-sidecar', domain: 'plugins' },
  { functionName: 'installPluginFromNpm', ipcCommand: 'install_plugin_from_npm', payloadKeys: ['packageName'], targetOwner: 'rust-sidecar', domain: 'plugins' },
  { functionName: 'uninstallPlugin', ipcCommand: 'uninstall_plugin', payloadKeys: ['pluginId'], targetOwner: 'rust-sidecar', domain: 'plugins' },
  { functionName: 'getPlugin', ipcCommand: 'get_plugin', payloadKeys: ['pluginId'], targetOwner: 'rust-sidecar', domain: 'plugins' },
  { functionName: 'listPlugins', ipcCommand: 'list_plugins', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'plugins' },
  { functionName: 'setPluginEnabled', ipcCommand: 'set_plugin_enabled', payloadKeys: ['projectId', 'pluginId', 'enabled'], targetOwner: 'rust-sidecar', domain: 'plugins' },
  { functionName: 'getEnabledPlugins', ipcCommand: 'get_enabled_plugins', payloadKeys: ['projectId'], targetOwner: 'rust-sidecar', domain: 'plugins' },
  { functionName: 'getPluginStorage', ipcCommand: 'get_plugin_storage', payloadKeys: ['pluginId', 'key'], targetOwner: 'rust-sidecar', domain: 'plugins' },
  { functionName: 'setPluginStorage', ipcCommand: 'set_plugin_storage', payloadKeys: ['pluginId', 'key', 'value'], targetOwner: 'rust-sidecar', domain: 'plugins' },
  { functionName: 'pluginInvoke', ipcCommand: 'plugin_invoke', payloadKeys: ['pluginId', 'command', 'payload'], targetOwner: 'rust-sidecar', domain: 'plugins' },
  { functionName: 'stopPluginSidecar', ipcCommand: 'stop_plugin_sidecar', payloadKeys: [], targetOwner: 'rust-sidecar', domain: 'plugins' },
] as const satisfies readonly IpcCommandContract[]

export const appShellEventContracts = [
  { eventName: 'github-sync-complete', payload: 'PollResult', producer: 'rust-backend', transportAfterMigration: 'sse-or-websocket', domain: 'github-review' },
  { eventName: 'openforge-app-events-gap', payload: '{ requestedAfter: string; oldestAvailable: string; newestAvailable: string }', producer: 'rust-backend', transportAfterMigration: 'sse-or-websocket', domain: 'app-shell' },
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
    currentSubscribers: ['src/lib/terminalPool.ts'],
    currentProducers: ['src-tauri/src/pty_manager.rs'],
    payload: '{ task_id: string; data: string; instance_id: number }',
    producer: 'rust-backend',
    transportAfterMigration: 'sse-or-websocket',
    domain: 'agent-session-pty',
  },
  {
    eventPattern: 'pty-exit-{taskId}',
    currentSubscribers: ['src/lib/terminalPool.ts'],
    currentProducers: ['src-tauri/src/pty_manager.rs'],
    payload: '{ instance_id: number }',
    producer: 'rust-backend',
    transportAfterMigration: 'sse-or-websocket',
    domain: 'agent-session-pty',
  },
  {
    eventPattern: 'pty-output-{taskId}-shell-{terminalIndex}',
    currentSubscribers: ['src/lib/terminalPool.ts', 'src/lib/plugin/pluginRegistry.ts'],
    currentProducers: ['src-tauri/src/pty_manager.rs'],
    payload: '{ task_id: string; data: string; instance_id: number }',
    producer: 'rust-backend',
    transportAfterMigration: 'sse-or-websocket',
    domain: 'agent-session-pty',
  },
  {
    eventPattern: 'pty-exit-{taskId}-shell-{terminalIndex}',
    currentSubscribers: ['src/components/task-detail/TaskTerminal.svelte', 'src/lib/terminalPool.ts', 'src/lib/plugin/pluginRegistry.ts'],
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
    eventPattern: '{plugin-defined-desktop-event}',
    currentSubscribers: ['src/lib/plugin/pluginRegistry.ts'],
    currentProducers: ['plugin backend sidecar via Rust plugin host bridge'],
    payload: 'unknown plugin-defined payload',
    producer: 'plugin-host',
    transportAfterMigration: 'plugin-event-adapter',
    domain: 'plugins',
  },
] as const satisfies readonly DynamicShellEventContract[]
