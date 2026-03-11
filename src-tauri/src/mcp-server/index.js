#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';

// Read at invocation time
const HTTP_PORT = process.env.OPENFORGE_HTTP_PORT ?? '17422';
const BASE_URL = `http://127.0.0.1:${HTTP_PORT}`;

const server = new McpServer({
  name: 'openforge',
  version: '1.0.0',
});

server.tool(
  'create_task',
  'Create a new task in Open Forge. Use this when you need to create follow-up work or break a task into subtasks. The task will be added to the backlog.',
  {
    initial_prompt: z.string().describe('Initial instructions or prompt for the task'),
    project_id: z.string().optional().describe('Project ID to associate with (optional, e.g. "P-1")'),
  },
  async ({ initial_prompt, project_id }) => {
    try {
      const res = await fetch(`${BASE_URL}/create_task`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ initial_prompt, project_id }),
      });

      if (!res.ok) {
        const error = await res.text();
        return { content: [{ type: 'text', text: `Failed to create task: HTTP ${res.status} — ${error}` }] };
      }

      const data = await res.json();
      return { content: [{ type: 'text', text: `Task created successfully: ${data.task_id}` }] };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { content: [{ type: 'text', text: `Error creating task: ${message}. Is Open Forge running?` }] };
    }
  },
);

server.tool(
  'update_task',
  'Update the initial prompt and/or summary of a task. Call this to set a descriptive initial prompt based on what you\'ve discovered, and a TLDR summary of what you did and what needs attention.',
  {
    task_id: z.string().describe('ID of the task to update (e.g. "T-42")'),
    initial_prompt: z.string().optional().describe('New initial prompt for the task'),
    summary: z.string().optional().describe('TLDR summary of what was done and what needs attention'),
  },
  async ({ task_id, initial_prompt, summary }) => {
    try {
      const res = await fetch(`${BASE_URL}/update_task`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ task_id, initial_prompt, summary }),
      });

      if (!res.ok) {
        const error = await res.text();
        return { content: [{ type: 'text', text: `Failed to update task: HTTP ${res.status} — ${error}` }] };
      }

      const data = await res.json();
      return { content: [{ type: 'text', text: `Task updated successfully: ${data.task_id}` }] };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { content: [{ type: 'text', text: `Error updating task: ${message}. Is Open Forge running?` }] };
    }
  },
);

server.tool(
  'get_task_info',
  'Get current information about a task, including its prompt, initial prompt, and summary.',
  {
    task_id: z.string().describe('ID of the task to retrieve (e.g. "T-42")'),
  },
  async ({ task_id }) => {
    try {
      const res = await fetch(`${BASE_URL}/task/${task_id}`, {
        method: 'GET',
      });

      if (!res.ok) {
        const error = await res.text();
        return { content: [{ type: 'text', text: `Failed to get task info: HTTP ${res.status} — ${error}` }] };
      }

      const data = await res.json();
      const lines = [
        `Task: ${data.id}`,
        `Initial Prompt: ${data.initial_prompt}`,
        `Status: ${data.status}`,
        data.prompt ? `Prompt: ${data.prompt}` : null,
        data.summary ? `Summary: ${data.summary}` : null,
        data.jira_key ? `Jira: ${data.jira_key}` : null,
      ].filter(Boolean).join('\n');
      return { content: [{ type: 'text', text: lines }] };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { content: [{ type: 'text', text: `Error getting task info: ${message}. Is Open Forge running?` }] };
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Open Forge MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error in Open Forge MCP server:', error);
  process.exit(1);
});

export { HTTP_PORT, BASE_URL };
