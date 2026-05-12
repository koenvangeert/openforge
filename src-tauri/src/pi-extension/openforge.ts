import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

function openForgeLifecycleKind(eventType: "agent.start" | "agent.end") {
  return eventType === "agent.start" ? "started" : "ended";
}

async function reportPiLifecycle(eventType: "agent.start" | "agent.end") {
  const taskId = process.env.OPENFORGE_TASK_ID;
  const ptyInstanceId = process.env.OPENFORGE_PTY_INSTANCE_ID;
  if (!taskId || !ptyInstanceId) return;

  const port = process.env.OPENFORGE_HTTP_PORT ?? "17422";
  try {
    await fetch(`http://127.0.0.1:${port}/hooks/agent-lifecycle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "pi",
        task_id: taskId,
        pty_instance_id: Number(ptyInstanceId),
        kind: openForgeLifecycleKind(eventType),
        raw_event_type: eventType,
      }),
    });
  } catch (error) {
    console.error(`[openforge] Failed to report Pi lifecycle event ${eventType}:`, error);
  }
}

export default function openForgeExtension(pi: ExtensionAPI) {
  pi.on("agent_start", async () => {
    await reportPiLifecycle("agent.start");
  });

  pi.on("agent_end", async () => {
    await reportPiLifecycle("agent.end");
  });
}
