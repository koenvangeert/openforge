---
name: openforge
description: Manage OpenForge tasks from AI providers using the installed OpenForge CLI client.
---

# OpenForge task management

Use this skill when you need to create follow-up work, inspect task context, or update the current task summary in OpenForge.

The OpenForge CLI client is installed at:

```bash
OPENFORGE_CLI="{{OPENFORGE_CLI_PATH}}"
```

If OpenForge is listening on a non-default HTTP bridge port, set `OPENFORGE_HTTP_PORT` before running the command. The default is `17422`.

## Commands

```bash
openforge create-task --initial-prompt "Describe the follow-up work" --project-id P-1
openforge update-task --task-id T-123 --summary "What changed and what needs attention"
openforge get-task --task-id T-123
openforge list-tasks --project-id P-1 --state doing
openforge list-projects
```

Use `--worktree "$PWD"` with `create-task` when the project can be inferred from the current worktree and no project id is known.

## Guidance

- Create follow-up tasks for real cleanup or missing work; do not create tasks for trivial preferences.
- Update the active task with a concise implementation summary before finishing.
- The CLI prints JSON so you can pass results back into your reasoning without scraping UI text.
