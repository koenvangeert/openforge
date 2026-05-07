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

function sessionIdFromEvent(event) {
  return event?.properties?.info?.id
    ?? event?.properties?.session?.id
    ?? event?.properties?.sessionID
    ?? event?.properties?.sessionId
    ?? null
}

function statusTypeFromEvent(event) {
  return event?.properties?.status?.type
    ?? event?.properties?.status
    ?? event?.properties?.info?.status?.type
    ?? event?.properties?.info?.status
    ?? null
}

async function postOpenForgeEvent(event) {
  const taskId = process.env.OPENFORGE_TASK_ID
  const ptyInstanceId = Number(process.env.OPENFORGE_PTY_INSTANCE_ID ?? "0")
  const port = process.env.OPENFORGE_HTTP_PORT
  if (!taskId || !ptyInstanceId || !port || !event?.type) return
  if (!interestingEvents.has(event.type)) return

  try {
    await fetch(`http://127.0.0.1:${port}/hooks/opencode-event`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        task_id: taskId,
        pty_instance_id: ptyInstanceId,
        event_type: event.type,
        session_id: sessionIdFromEvent(event),
        status_type: statusTypeFromEvent(event),
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
