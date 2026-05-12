const interestingEvents = new Set([
  "session.created",
  "session.updated",
  "session.status",
  "session.idle",
  "session.error",
  "message.updated",
  "tool.execute.before",
  "tool.execute.after",
])

function isOpenCodeSessionId(value) {
  return typeof value === "string" && value.startsWith("ses")
}

function sessionIdFromEvent(event) {
  const candidates = [
    event?.properties?.session?.id,
    event?.properties?.sessionID,
    event?.properties?.sessionId,
    event?.properties?.info?.id,
  ]

  return candidates.find(isOpenCodeSessionId) ?? null
}

function statusTypeFromEvent(event) {
  return event?.properties?.status?.type
    ?? event?.properties?.status
    ?? event?.properties?.info?.status?.type
    ?? event?.properties?.info?.status
    ?? null
}

function openForgeLifecycleKind(event) {
  const statusType = statusTypeFromEvent(event)
  switch (event?.type) {
    case "session.status":
    case "session.created":
    case "session.updated":
      if (statusType === "idle") return "became_idle"
      if (statusType === "busy" || statusType === "retry" || statusType === "running") return "became_busy"
      if (statusType === "error" || statusType === "failed") return "failed"
      return null
    case "session.idle":
      return "became_idle"
    case "session.error":
      return "failed"
    case "message.updated":
    case "tool.execute.before":
    case "tool.execute.after":
      return "became_busy"
    default:
      return null
  }
}

async function postOpenForgeEvent(event) {
  const taskId = process.env.OPENFORGE_TASK_ID
  const ptyInstanceId = Number(process.env.OPENFORGE_PTY_INSTANCE_ID ?? "0")
  const port = process.env.OPENFORGE_HTTP_PORT
  if (!taskId || !ptyInstanceId || !port || !event?.type) return
  if (!interestingEvents.has(event.type)) return
  const kind = openForgeLifecycleKind(event)
  if (!kind) return

  try {
    await fetch(`http://127.0.0.1:${port}/hooks/agent-lifecycle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "opencode",
        task_id: taskId,
        pty_instance_id: ptyInstanceId,
        provider_session_id: sessionIdFromEvent(event),
        kind,
        raw_event_type: event.type,
        raw_status_type: statusTypeFromEvent(event),
      }),
    })
  } catch {
    // Keep OpenCode responsive if OpenForge is not listening.
  }
}

export const OpenForgePlugin = async () => {
  return {
    event: async ({ event }) => {
      await postOpenForgeEvent(event)
    },
  }
}
