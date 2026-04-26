import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

async function reportPiLifecycle(hookPath: "/hooks/pi-agent-start" | "/hooks/pi-agent-end") {
  const taskId = process.env.OPENFORGE_TASK_ID;
  const ptyInstanceId = process.env.OPENFORGE_PTY_INSTANCE_ID;
  if (!taskId || !ptyInstanceId) return;

  const port = process.env.OPENFORGE_HTTP_PORT ?? "17422";
  try {
    await fetch(`http://127.0.0.1:${port}${hookPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_id: taskId, pty_instance_id: Number(ptyInstanceId) }),
    });
  } catch (error) {
    console.error(`[openforge] Failed to report Pi lifecycle event to ${hookPath}:`, error);
  }
}

export default function openForgeExtension(pi: ExtensionAPI) {
  pi.on("agent_start", async () => {
    await reportPiLifecycle("/hooks/pi-agent-start");
  });

  pi.on("agent_end", async () => {
    await reportPiLifecycle("/hooks/pi-agent-end");
  });
}
