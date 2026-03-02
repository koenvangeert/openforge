import { listen } from '@tauri-apps/api/event'
import type { UnlistenFn } from '@tauri-apps/api/event'
import type { SDKChatMessage, SDKToolCall, SDKToolApprovalRequest, ClaudeSessionState } from './types'
import { sendClaudeInput, interruptClaudeSession, resumeClaudeSdkSession, respondToolApproval, runAction, getWorktreeForTask } from './ipc'

// ============================================================================
// Payload types for Tauri events
// ============================================================================

interface AgentEventPayload {
  task_id: string
  event_type: string
  data: string | Record<string, unknown>
  timestamp: number
}

interface ToolApprovalPayload {
  task_id: string
  request_id: string
  session_id: string
  tool_use_id: string
  tool_name: string
  tool_input: unknown
  description: string | null
}

interface ActionCompletePayload {
  task_id: string
  total_cost?: number | null
}

interface ImplementationFailedPayload {
  task_id: string
}

// ============================================================================
// Composable
// ============================================================================

export function useClaudeSession(taskId: string) {
  let sessionState = $state<ClaudeSessionState>({
    sessionId: null,
    status: 'idle',
    messages: [],
    pendingApprovals: [],
    totalCost: null,
  })

  let unlisteners: UnlistenFn[] = []

  // ============================================================================
  // Methods
  // ============================================================================

  async function sendInput(text: string): Promise<void> {
    if (sessionState.status === 'completed' || sessionState.status === 'interrupted') {
      await sendFollowUp(text)
      return
    }
    if (sessionState.status === 'failed' || sessionState.status === 'idle') {
      console.warn('[useClaudeSession] Cannot send input — session is', sessionState.status)
      return
    }
    try {
      await sendClaudeInput(taskId, text)
    } catch (e) {
      console.error('[useClaudeSession] Failed to send input:', e)
    }
  }

  async function sendFollowUp(text: string): Promise<void> {
    try {
      const worktree = await getWorktreeForTask(taskId)
      if (!worktree) {
        console.error('[useClaudeSession] No worktree found for task — cannot send follow-up')
        return
      }

      sessionState.messages.push({
        id: crypto.randomUUID(),
        role: 'user',
        content: text,
        timestamp: Date.now() / 1000,
        status: 'complete',
        toolCalls: null,
      })
      sessionState.status = 'running'

      await runAction(taskId, worktree.worktree_path, text, null)
    } catch (e) {
      console.error('[useClaudeSession] Failed to send follow-up:', e)
      sessionState.status = 'failed'
    }
  }

  async function interrupt(): Promise<void> {
    try {
      await interruptClaudeSession(taskId)
      sessionState.status = 'interrupted'
    } catch (e) {
      console.error('[useClaudeSession] Failed to interrupt session:', e)
    }
  }

  async function resume(sessionId: string, cwd: string): Promise<void> {
    try {
      await resumeClaudeSdkSession(taskId, sessionId, cwd)
      sessionState.sessionId = sessionId
      sessionState.status = 'running'
    } catch (e) {
      console.error('[useClaudeSession] Failed to resume session:', e)
    }
  }

  async function approveToolUse(requestId: string): Promise<void> {
    try {
      await respondToolApproval(taskId, requestId, 'allow')
      sessionState.pendingApprovals = sessionState.pendingApprovals.map(a =>
        a.id === requestId ? { ...a, pending: false } : a
      )
    } catch (e) {
      console.error('[useClaudeSession] Failed to approve tool use:', e)
    }
  }

  async function denyToolUse(requestId: string, reason: string): Promise<void> {
    try {
      await respondToolApproval(taskId, requestId, 'deny', reason)
      sessionState.pendingApprovals = sessionState.pendingApprovals.map(a =>
        a.id === requestId ? { ...a, pending: false } : a
      )
    } catch (e) {
      console.error('[useClaudeSession] Failed to deny tool use:', e)
    }
  }

  // ============================================================================
  // Event handlers
  // ============================================================================

  function handleAgentEvent(payload: AgentEventPayload): void {
    console.log(`[useClaudeSession] handleAgentEvent type=${payload.event_type} task=${payload.task_id} dataType=${typeof payload.data} msgCount=${sessionState.messages.length}`)
    sessionState.status = 'running'
    const { event_type, timestamp } = payload
    const data: Record<string, unknown> = typeof payload.data === 'string'
      ? JSON.parse(payload.data)
      : payload.data
    console.log(`[useClaudeSession]   parsed keys=${Object.keys(data).join(',')} event_type=${event_type}`)

    if (event_type === 'assistant') {
      // Full assistant message with complete text + tool uses.
      // Sent when the SDK emits a complete SDKAssistantMessage.
      const text = (data.text as string | undefined) ?? ''
      const toolUses = data.toolUses as Array<{ id: string; name: string; input: Record<string, unknown> }> | undefined

      const lastIdx = sessionState.messages.length - 1
      const lastMsg = lastIdx >= 0 ? sessionState.messages[lastIdx] : null
      if (lastMsg && lastMsg.role === 'assistant' && lastMsg.status === 'streaming') {
        // Replace streaming content with the complete text
        lastMsg.content = text
        if (toolUses) {
          lastMsg.toolCalls = toolUses.map(tu => ({
            id: tu.id,
            toolName: tu.name,
            input: JSON.stringify(tu.input),
            output: null,
            status: 'running' as const,
            duration: null,
          }))
        }
      } else {
        // Start new assistant message with complete content
        const newMsg: SDKChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: text,
          timestamp,
          status: 'streaming',
          toolCalls: toolUses
            ? toolUses.map(tu => ({
                id: tu.id,
                toolName: tu.name,
                input: JSON.stringify(tu.input),
                output: null,
                status: 'running' as const,
                duration: null,
              }))
            : null,
        }
        sessionState.messages.push(newMsg)
      }
    } else if (event_type === 'assistant_delta') {
      // Streaming text delta — append to the current assistant message.
      // These arrive from stream_event (content_block_delta) in the sidecar.
      const deltaText = (data.text as string | undefined) ?? ''
      if (!deltaText) return

      const lastIdx = sessionState.messages.length - 1
      const lastMsg = lastIdx >= 0 ? sessionState.messages[lastIdx] : null
      if (lastMsg && lastMsg.role === 'assistant' && lastMsg.status === 'streaming') {
        // Append delta to existing streaming message
        lastMsg.content += deltaText
      } else {
        // Create new streaming message with this delta
        const newMsg: SDKChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: deltaText,
          timestamp,
          status: 'streaming',
          toolCalls: null,
        }
        sessionState.messages.push(newMsg)
      }
    } else if (event_type === 'tool_use') {
      // SDKToolUseContent: { type, toolUseId, toolName, toolInput }
      const toolUseId = data.toolUseId as string | undefined
      const toolName = (data.toolName as string | undefined) ?? ''
      const toolInput = data.toolInput !== undefined
        ? JSON.stringify(data.toolInput)
        : JSON.stringify(data)

      if (!toolUseId) return

      const toolCall: SDKToolCall = {
        id: toolUseId,
        toolName,
        input: toolInput,
        output: null,
        status: 'running',
        duration: null,
      }

      // Attach to last assistant message or create a new one
      const lastIdx = sessionState.messages.length - 1
      const lastMsg = lastIdx >= 0 ? sessionState.messages[lastIdx] : null
      if (lastMsg && lastMsg.role === 'assistant') {
        lastMsg.toolCalls = [...(lastMsg.toolCalls ?? []), toolCall]
      } else {
        const newMsg: SDKChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: '',
          timestamp,
          status: 'streaming',
          toolCalls: [toolCall],
        }
        sessionState.messages.push(newMsg)
      }
    } else if (event_type === 'tool_result') {
      // SDKToolResultContent: { type, toolUseId, content, isError? }
      const toolUseId = data.toolUseId as string | undefined
      if (!toolUseId) return

      const rawContent = data.content
      const output = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent)
      const isError = data.isError === true

      // Update matching tool call across all messages
      for (const msg of sessionState.messages) {
        if (!msg.toolCalls) continue
        for (const tc of msg.toolCalls) {
          if (tc.id === toolUseId) {
            tc.output = output
            tc.status = isError ? 'error' : 'completed'
            break
          }
        }
      }

      // Mark last assistant message as complete if all tools are done
      const lastMsg = sessionState.messages.length > 0
        ? sessionState.messages[sessionState.messages.length - 1]
        : null
      if (lastMsg?.role === 'assistant' && lastMsg.status === 'streaming') {
        const allDone = (lastMsg.toolCalls ?? []).every(tc => tc.status !== 'running')
        if (allDone) lastMsg.status = 'complete'
      }
    } else if (event_type === 'system.init') {
      // SDKSystemInitContent: { type, sessionId, model, tools, cwd, permissionMode }
      const sessionId = data.sessionId as string | undefined
      if (sessionId) {
        sessionState.sessionId = sessionId
      }
    } else if (event_type === 'result' || event_type === 'result.success') {
      // Finalize the last streaming message
      const lastMsg = sessionState.messages.length > 0
        ? sessionState.messages[sessionState.messages.length - 1]
        : null
      if (lastMsg?.status === 'streaming') {
        lastMsg.status = 'complete'
      }
      // Update session status based on result subtype
      const subtype = data.subtype as string | undefined
      if (subtype === 'success') {
        sessionState.status = 'completed'
      } else if (subtype && subtype.startsWith('error')) {
        sessionState.status = 'failed'
      }
    } else if (event_type === 'tool_progress') {
      // Optional: update tool duration indicators
      // For now just acknowledge — could show elapsed time in UI later
    }
  }

  function handleToolApproval(payload: ToolApprovalPayload): void {
    // Session still running, waiting for user approval
    const approval: SDKToolApprovalRequest = {
      id: payload.request_id,
      toolName: payload.tool_name,
      toolInput: typeof payload.tool_input === 'string'
        ? payload.tool_input
        : JSON.stringify(payload.tool_input),
      description: payload.description,
      pending: true,
    }
    sessionState.pendingApprovals = [...sessionState.pendingApprovals, approval]
  }

  function handleActionComplete(payload: ActionCompletePayload): void {
    sessionState.status = 'completed'
    if (payload.total_cost != null) {
      sessionState.totalCost = payload.total_cost
    }
    // Finalize any still-streaming messages
    for (const msg of sessionState.messages) {
      if (msg.status === 'streaming') msg.status = 'complete'
    }
  }

  function handleImplementationFailed(_payload: ImplementationFailedPayload): void {
    sessionState.status = 'failed'
    // Mark any streaming messages as errored
    for (const msg of sessionState.messages) {
      if (msg.status === 'streaming') msg.status = 'error'
    }
  }

  // ============================================================================
  // Listener lifecycle — detach only removes listeners; sidecar keeps running
  // ============================================================================

  async function setup(): Promise<void> {
    console.log(`[useClaudeSession] setup() registering listeners for task=${taskId}`)
    unlisteners.push(
      await listen('agent-event', (e) => {
        const payload = e.payload as AgentEventPayload
        console.log(`[useClaudeSession] listen('agent-event') fired: task=${payload.task_id} type=${payload.event_type} (myTask=${taskId})`)
        if (payload.task_id !== taskId) return
        handleAgentEvent(payload)
      })
    )

    unlisteners.push(
      await listen('claude-tool-approval', (e) => {
        const payload = e.payload as ToolApprovalPayload
        if (payload.task_id !== taskId) return
        handleToolApproval(payload)
      })
    )

    unlisteners.push(
      await listen('action-complete', (e) => {
        const payload = e.payload as ActionCompletePayload
        if (payload.task_id !== taskId) return
        handleActionComplete(payload)
      })
    )

    unlisteners.push(
      await listen('implementation-failed', (e) => {
        const payload = e.payload as ImplementationFailedPayload
        if (payload.task_id !== taskId) return
        handleImplementationFailed(payload)
      })
    )
  }

  function replayEvent(eventType: string, data: string, timestamp: number): void {
    handleAgentEvent({
      task_id: taskId,
      event_type: eventType,
      data,
      timestamp,
    })
  }

  function cleanup(): void {
    unlisteners.forEach(fn => fn())
    unlisteners = []
  }

  return {
    get state() { return sessionState },
    sendInput,
    interrupt,
    resume,
    approveToolUse,
    denyToolUse,
    replayEvent,
    setup,
    cleanup,
  }
}
