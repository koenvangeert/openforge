#!/usr/bin/env node

const HTTP_PORT = process.env.OPENFORGE_HTTP_PORT ?? '17422';
const BASE_URL = `http://127.0.0.1:${HTTP_PORT}`;

const COMMAND_FLAGS = {
  'create-task': new Set(['initialPrompt', 'projectId', 'worktree', 'dependsOn']),
  'update-task': new Set(['taskId', 'summary']),
  'set-task-dependencies': new Set(['taskId', 'dependsOn']),
  'add-task-dependency': new Set(['taskId', 'dependsOn']),
  'link-tasks': new Set(['chain']),
  'get-task': new Set(['taskId']),
  'list-tasks': new Set(['projectId', 'state']),
  'list-projects': new Set(),
};

const COMMANDS = new Set(Object.keys(COMMAND_FLAGS));

function printHelp() {
  console.log(`OpenForge CLI

Usage:
  openforge create-task --initial-prompt <text> [--project-id <id>] [--worktree <path>] [--depends-on <task-id>[,<task-id>...]]
  openforge update-task --task-id <id> --summary <text>
  openforge set-task-dependencies --task-id <id> --depends-on <task-id>[,<task-id>...]
  openforge add-task-dependency --task-id <id> --depends-on <task-id>
  openforge link-tasks --chain "T-1 -> T-2 -> T-3"
  openforge get-task --task-id <id>
  openforge list-tasks --project-id <id> [--state backlog|doing|done]
  openforge list-projects

Environment:
  OPENFORGE_HTTP_PORT  OpenForge HTTP bridge port (default: 17422)
`);
}

function appendFlagValue(flags, key, value) {
  if (flags[key] === undefined) {
    flags[key] = value;
    return;
  }
  if (Array.isArray(flags[key])) {
    flags[key].push(value);
    return;
  }
  flags[key] = [flags[key], value];
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
      appendFlagValue(flags, key, true);
      continue;
    }

    appendFlagValue(flags, key, next);
    i += 1;
  }

  return { command, flags };
}

function flagName(name) {
  return `--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

function validateSupportedFlags(command, flags) {
  const supportedFlags = COMMAND_FLAGS[command];
  for (const name of Object.keys(flags)) {
    if (!supportedFlags.has(name)) {
      throw new Error(`${command} does not support ${flagName(name)}`);
    }
  }
}

function requireFlag(flags, name) {
  const value = flags[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`missing required flag ${flagName(name)}`);
  }
  return value;
}

function optionalString(flags, name) {
  return typeof flags[name] === 'string' ? flags[name] : undefined;
}

function dependencyIdsFromFlag(flags, name = 'dependsOn') {
  const raw = flags[name];
  const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  const result = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    for (const part of value.split(',')) {
      const trimmed = part.trim();
      if (trimmed && !result.includes(trimmed)) result.push(trimmed);
    }
  }
  return result;
}

function parseTaskChain(value) {
  return value
    .split(/\s*(?:->|,|\n)\s*/u)
    .map((taskId) => taskId.trim())
    .filter(Boolean);
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

  validateSupportedFlags(command, flags);

  switch (command) {
    case 'create-task': {
      const dependsOn = dependencyIdsFromFlag(flags);
      const payload = {
        initial_prompt: requireFlag(flags, 'initialPrompt'),
        project_id: optionalString(flags, 'projectId'),
        worktree: optionalString(flags, 'worktree'),
        depends_on: dependsOn.length > 0 ? dependsOn : undefined,
      };
      printJson(await requestJson('/create_task', { method: 'POST', body: JSON.stringify(payload) }));
      return;
    }
    case 'update-task': {
      const payload = {
        task_id: requireFlag(flags, 'taskId'),
        summary: typeof flags.summary === 'string' ? flags.summary : undefined,
      };
      if (!payload.summary) {
        throw new Error('update-task requires --summary');
      }
      printJson(await requestJson('/update_task', { method: 'POST', body: JSON.stringify(payload) }));
      return;
    }
    case 'set-task-dependencies': {
      const dependsOn = dependencyIdsFromFlag(flags);
      if (dependsOn.length === 0) {
        throw new Error('set-task-dependencies requires --depends-on');
      }
      const payload = {
        task_id: requireFlag(flags, 'taskId'),
        depends_on: dependsOn,
      };
      printJson(await requestJson('/set_task_dependencies', { method: 'POST', body: JSON.stringify(payload) }));
      return;
    }
    case 'add-task-dependency': {
      const dependsOn = dependencyIdsFromFlag(flags);
      if (dependsOn.length !== 1) {
        throw new Error('add-task-dependency requires exactly one --depends-on task id');
      }
      const payload = {
        task_id: requireFlag(flags, 'taskId'),
        depends_on: dependsOn[0],
      };
      printJson(await requestJson('/add_task_dependency', { method: 'POST', body: JSON.stringify(payload) }));
      return;
    }
    case 'link-tasks': {
      const chain = parseTaskChain(requireFlag(flags, 'chain'));
      if (chain.length < 2) {
        throw new Error('link-tasks requires a chain with at least two task ids');
      }
      printJson(await requestJson('/link_task_chain', {
        method: 'POST',
        body: JSON.stringify({ chain }),
      }));
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
    default:
      throw new Error(`unhandled command: ${command}`);
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
