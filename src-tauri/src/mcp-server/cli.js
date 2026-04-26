#!/usr/bin/env node

const HTTP_PORT = process.env.OPENFORGE_HTTP_PORT ?? '17422';
const BASE_URL = `http://127.0.0.1:${HTTP_PORT}`;

const COMMANDS = new Set([
  'create-task',
  'update-task',
  'get-task',
  'list-tasks',
  'list-projects',
  'work-queue',
]);

function printHelp() {
  console.log(`OpenForge CLI

Usage:
  openforge create-task --initial-prompt <text> [--project-id <id>] [--worktree <path>]
  openforge update-task --task-id <id> [--initial-prompt <text>] [--summary <text>]
  openforge get-task --task-id <id>
  openforge list-tasks --project-id <id> [--state backlog|doing|done]
  openforge list-projects
  openforge work-queue --project-id <id>

Environment:
  OPENFORGE_HTTP_PORT  OpenForge HTTP bridge port (default: 17422)
`);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) {
      throw new Error(`unexpected positional argument: ${token}`);
    }

    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[key] = true;
      continue;
    }

    flags[key] = next;
    i += 1;
  }

  return { command, flags };
}

function requireFlag(flags, name) {
  const value = flags[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`missing required flag --${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
  }
  return value;
}

async function requestJson(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!res.ok) {
    const detail = typeof body === 'string' ? body : JSON.stringify(body);
    throw new Error(`OpenForge HTTP ${res.status}: ${detail}`);
  }

  return body;
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

async function main(argv) {
  const { command, flags } = parseArgs(argv);

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (!COMMANDS.has(command)) {
    throw new Error(`unknown command: ${command}`);
  }

  switch (command) {
    case 'create-task': {
      const payload = {
        initial_prompt: requireFlag(flags, 'initialPrompt'),
        project_id: typeof flags.projectId === 'string' ? flags.projectId : undefined,
        worktree: typeof flags.worktree === 'string' ? flags.worktree : undefined,
      };
      printJson(await requestJson('/create_task', { method: 'POST', body: JSON.stringify(payload) }));
      return;
    }
    case 'update-task': {
      const payload = {
        task_id: requireFlag(flags, 'taskId'),
        initial_prompt: typeof flags.initialPrompt === 'string' ? flags.initialPrompt : undefined,
        summary: typeof flags.summary === 'string' ? flags.summary : undefined,
      };
      if (!payload.initial_prompt && !payload.summary) {
        throw new Error('update-task requires --initial-prompt and/or --summary');
      }
      printJson(await requestJson('/update_task', { method: 'POST', body: JSON.stringify(payload) }));
      return;
    }
    case 'get-task': {
      const taskId = encodeURIComponent(requireFlag(flags, 'taskId'));
      printJson(await requestJson(`/task/${taskId}`));
      return;
    }
    case 'list-tasks': {
      const params = new URLSearchParams({ project_id: requireFlag(flags, 'projectId') });
      if (typeof flags.state === 'string') params.set('state', flags.state);
      printJson(await requestJson(`/tasks?${params.toString()}`));
      return;
    }
    case 'list-projects': {
      printJson(await requestJson('/projects'));
      return;
    }
    case 'work-queue': {
      const params = new URLSearchParams({ project_id: requireFlag(flags, 'projectId') });
      printJson(await requestJson(`/work-queue?${params.toString()}`));
      return;
    }
    default:
      throw new Error(`unhandled command: ${command}`);
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
