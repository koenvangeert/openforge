const interestingEvents = new Set([
  "session.created",
  "session.idle",
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

function openForgeLifecycleKind(event) {
  switch (event?.type) {
    case "session.created":
      return "started"
    case "session.idle":
      return "ended"
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
