---
name: openforge
description: Manage OpenForge tasks from AI providers using the installed OpenForge CLI client.
---

# OpenForge task management

Use this skill when you need to create follow-up work, inspect task context, or update the current task summary in OpenForge.

Use the installed `openforge` launcher directly. If `openforge` is not available on PATH in a non-interactive shell, call the launcher with its explicit fallback path:

```bash
openforge list-projects
"$HOME/.openforge/bin/openforge" list-projects
```

Do not bypass the launcher with the underlying script path.

If OpenForge is listening on a non-default HTTP bridge port, set `OPENFORGE_HTTP_PORT` before running the command. The default is `17422`.

## Commands

```bash
openforge create-task --initial-prompt "Describe the follow-up work" --project-id P-1 --depends-on T-122 --label cleanup
openforge update-task --task-id T-123 --summary "What changed and what needs attention"
openforge set-task-dependencies --task-id T-123 --depends-on T-121,T-122
openforge add-task-dependency --task-id T-123 --depends-on T-122
openforge link-tasks --chain "T-121 -> T-122 -> T-123"
openforge get-task --task-id T-123
openforge list-task-labels --task-id T-123
openforge add-task-label --task-id T-123 --label bug
openforge remove-task-label --task-id T-123 --label-id 42
openforge list-tasks --project-id P-1 --state doing
openforge list-projects
```

Use `--worktree "$PWD"` with `create-task` when the project can be inferred from the current worktree and no project id is known.

Labels are project-scoped. Use `--label` on `create-task` for AI-created follow-up work that already has an obvious category. `--label` can be repeated or comma-separated, e.g. `--label bug --label "needs review"` or `--label bug,cleanup`. Use `add-task-label`, `remove-task-label`, and `list-task-labels` to manage labels on existing tasks.

## Guidance

- Create follow-up tasks for real cleanup or missing work; do not create tasks for trivial preferences.
- Update the active task with a concise implementation summary before finishing.
- Use dependencies to record prerequisite ordering, not to mark tasks blocked; Start Task enforcement is intentionally left to the app UX.
- Use labels to record task categories or triage context when they are useful for backlog filtering; do not add noisy labels just because the CLI supports them.
- Task summaries are Markdown-formatted; use short paragraphs or bullets when they improve readability.
- The CLI prints JSON so you can pass results back into your reasoning without scraping UI text.
