#[derive(Debug, Clone, Default)]
pub struct ProjectSnapshot {
    pub needs_input: i64,
    pub running_agents: i64,
    pub ci_failures: i64,
    pub unaddressed_comments: i64,
    pub completed_agents: i64,
    pub doing_tasks: Vec<SnapshotTask>,
    pub work_queue: Vec<SnapshotTask>,
    pub active_action_items: Vec<SnapshotActionItem>,
}

#[derive(Debug, Clone)]
pub struct SnapshotTask {
    pub id: String,
    pub prompt: String,
    pub session_status: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SnapshotActionItem {
    pub id: i64,
    pub title: String,
    pub task_id: Option<String>,
}

#[derive(Debug, Clone)]
pub enum ShepherdEvent {
    CiStatusChanged {
        task_id: String,
        pr_id: i64,
        status: String,
    },
    AgentCompleted {
        task_id: String,
    },
    PrReviewChanged {
        task_id: String,
        pr_id: i64,
        status: String,
    },
    NewPrComment {
        task_id: String,
        pr_id: i64,
    },
    TaskCreated {
        task_id: String,
    },
    TaskMoved {
        task_id: String,
    },
    TaskDeleted {
        task_id: String,
    },
    AgentStarted {
        task_id: String,
    },
    AgentErrored {
        task_id: String,
    },
    AgentCheckpoint {
        task_id: String,
    },
}

/// Build the system prompt for the Shepherd AI agent.
///
/// The Shepherd is an advise-only project manager for Open Forge.
/// It synthesizes project state and tells the developer what to focus on.
pub fn build_shepherd_system_prompt(project_name: &str, project_id: &str) -> String {
    let mut prompt = String::new();

    prompt.push_str("=== TASK SHEPHERD ===\n\n");
    prompt.push_str(&format!(
        "You are the Task Shepherd for project **{}** (ID: {}).\n\n",
        project_name, project_id
    ));

    prompt.push_str("Your role is that of a senior project manager who monitors AI coding agents and advises the developer on what needs attention. ");
    prompt.push_str("You ADVISE ONLY. You cannot create tasks, merge PRs, push code, or take any action in the codebase. ");
    prompt.push_str("Your job is to synthesize the current state and tell the developer exactly what to do next.\n\n");

    prompt.push_str("=== HOW YOU RECEIVE DATA ===\n");
    prompt.push_str("You do NOT have tools to query the project. Instead, the app pushes data directly to you:\n");
    prompt.push_str("- Each event message includes a full project snapshot (tasks, attention signals, work queue)\n");
    prompt.push_str("- You always have the latest state — no need to look anything up\n");
    prompt.push_str("- Focus on analyzing the data and giving advice, not on gathering it\n\n");

    prompt.push_str("=== PRIORITY ORDERING ===\n");
    prompt.push_str("When multiple things need attention, prioritize in this order:\n\n");
    prompt.push_str("1. **CI failures** — A failing CI pipeline blocks merging. Identify the failing check and tell the developer exactly what to fix.\n");
    prompt.push_str("2. **PR reviews** — Changes requested or approvals needed. Tell the developer which PR needs action and what the reviewer said.\n");
    prompt.push_str("3. **Completed agents** — An agent has finished its work and the task needs developer review before moving to done.\n");
    prompt
        .push_str("4. **Backlog** — Only suggest starting new work when the above are clear.\n\n");

    prompt.push_str("=== ACTION ITEMS ===\n");
    prompt.push_str("You have access to MCP tools for creating action items that the developer sees in the app:\n");
    prompt.push_str("- Use `create_action_item` to surface things requiring developer action (CI failures, PRs to review, agents needing sign-off).\n");
    prompt.push_str("- Use `list_action_items` BEFORE creating to check for duplicates — the developer can dismiss items.\n");
    prompt.push_str("- Use `dismiss_action_item` if an item is no longer relevant.\n");
    prompt.push_str("- Only create action items for things requiring developer action, not for informational updates.\n\n");

    prompt.push_str("=== RESPONSE FORMAT ===\n");
    prompt.push_str("Keep responses short and actionable. Lead with the most urgent item.\n");
    prompt.push_str("Example: \"T-42's CI failed on the lint check — the import on line 12 of `src/lib/foo.ts` is unused. Fix it and push.\"\n");
    prompt.push_str("Do not pad with pleasantries. The developer is busy.\n\n");

    prompt.push_str("=== CONTEXT ===\n");
    prompt.push_str("Open Forge is a desktop app that orchestrates AI coding agents on tasks in git worktrees. ");
    prompt.push_str("Each task runs in its own worktree on a dedicated branch. ");
    prompt.push_str("Agents can be paused (needs_input), running, or completed. ");
    prompt.push_str("Tasks move through: backlog → doing → done.\n");

    prompt
}

/// Format a batch of events into a human-readable user message for the Shepherd.
///
pub fn build_event_summary_prompt(events: &[ShepherdEvent], snapshot: &ProjectSnapshot) -> String {
    let mut event_lines: Vec<String> = Vec::new();

    for event in events {
        match event {
            ShepherdEvent::CiStatusChanged {
                task_id,
                pr_id,
                status,
            } => {
                event_lines.push(format!(
                    "CI status changed for task {} (PR #{}): status is now \"{}\"",
                    task_id, pr_id, status
                ));
            }
            ShepherdEvent::AgentCompleted { task_id } => {
                event_lines.push(format!(
                    "Agent completed work on task {} — needs developer review",
                    task_id
                ));
            }
            ShepherdEvent::PrReviewChanged {
                task_id,
                pr_id,
                status,
            } => {
                event_lines.push(format!(
                    "PR review status changed for task {} (PR #{}): status is now \"{}\"",
                    task_id, pr_id, status
                ));
            }
            ShepherdEvent::NewPrComment { task_id, pr_id } => {
                event_lines.push(format!(
                    "New comment on PR #{} for task {} — may need a response",
                    pr_id, task_id
                ));
            }
            ShepherdEvent::TaskCreated { task_id } => {
                event_lines.push(format!("New task {} created", task_id));
            }
            ShepherdEvent::TaskMoved { task_id } => {
                event_lines.push(format!("Task {} moved to a new column", task_id));
            }
            ShepherdEvent::TaskDeleted { task_id } => {
                event_lines.push(format!("Task {} was deleted", task_id));
            }
            ShepherdEvent::AgentStarted { task_id } => {
                event_lines.push(format!("Agent started working on task {}", task_id));
            }
            ShepherdEvent::AgentErrored { task_id } => {
                event_lines.push(format!(
                    "Agent encountered an error on task {} — needs attention",
                    task_id
                ));
            }
            ShepherdEvent::AgentCheckpoint { task_id } => {
                event_lines.push(format!(
                    "Agent on task {} is waiting for developer input",
                    task_id
                ));
            }
        }
    }

    if event_lines.is_empty() {
        return String::new();
    }

    let mut prompt = String::new();
    prompt.push_str("=== EVENTS ===\n");
    for line in &event_lines {
        prompt.push_str(&format!("- {}\n", line));
    }

    prompt.push_str("\n=== PROJECT SNAPSHOT ===\n");
    prompt.push_str(&format!(
        "Attention: {} needs_input, {} running, {} CI failures, {} unaddressed comments, {} completed\n",
        snapshot.needs_input, snapshot.running_agents, snapshot.ci_failures,
        snapshot.unaddressed_comments, snapshot.completed_agents
    ));

    if !snapshot.doing_tasks.is_empty() {
        prompt.push_str("\nDoing:\n");
        for task in &snapshot.doing_tasks {
            let session = task.session_status.as_deref().unwrap_or("no session");
            prompt.push_str(&format!("- {} [{}] {}\n", task.id, session, task.prompt));
        }
    }

    if !snapshot.work_queue.is_empty() {
        prompt.push_str("\nWork queue (needs your action):\n");
        for task in &snapshot.work_queue {
            let session = task.session_status.as_deref().unwrap_or("no session");
            prompt.push_str(&format!("- {} [{}] {}\n", task.id, session, task.prompt));
        }
    }

    if !snapshot.active_action_items.is_empty() {
        prompt.push_str("\nActive action items (do not duplicate):\n");
        for item in &snapshot.active_action_items {
            let task = item.task_id.as_deref().unwrap_or("no task");
            prompt.push_str(&format!(
                "- [{}] {} (task: {})\n",
                item.id, item.title, task
            ));
        }
    }

    prompt.push_str("\nAdvise on what needs attention.");
    prompt
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shepherd_system_prompt_content() {
        let prompt = build_shepherd_system_prompt("My Project", "P-1");

        assert!(prompt.contains("Task Shepherd"));
        assert!(prompt.contains("project manager"));
        assert!(prompt.contains("ADVISE ONLY") || prompt.contains("advise"));
        assert!(prompt.contains("My Project"));
        assert!(prompt.contains("P-1"));
        assert!(
            prompt.contains("pushes data directly to you") || prompt.contains("app pushes data")
        );
    }

    #[test]
    fn test_shepherd_system_prompt_priority_ordering() {
        let prompt = build_shepherd_system_prompt("Test Project", "P-2");

        // Must include CI failures as highest priority
        assert!(
            prompt.contains("CI failures"),
            "Prompt must mention CI failures"
        );

        // Must include PR reviews
        assert!(
            prompt.contains("PR reviews"),
            "Prompt must mention PR reviews"
        );

        // Must include completed agents
        assert!(
            prompt.contains("Completed agents") || prompt.contains("completed agents"),
            "Prompt must mention completed agents"
        );

        // Must include backlog as lowest priority
        assert!(
            prompt.contains("Backlog") || prompt.contains("backlog"),
            "Prompt must mention backlog"
        );

        // CI failures must appear before PR reviews in the text
        let ci_pos = prompt.find("CI failures").unwrap();
        let pr_pos = prompt.find("PR reviews").unwrap();
        let agent_pos = prompt
            .find("Completed agents")
            .or_else(|| prompt.find("completed agents"))
            .unwrap();
        let backlog_pos = prompt
            .find("Backlog")
            .or_else(|| prompt.find("backlog"))
            .unwrap();

        assert!(
            ci_pos < pr_pos,
            "CI failures must be listed before PR reviews"
        );
        assert!(
            pr_pos < agent_pos,
            "PR reviews must be listed before completed agents"
        );
        assert!(
            agent_pos < backlog_pos,
            "Completed agents must be listed before backlog"
        );
    }

    #[test]
    fn test_shepherd_system_prompt_no_action_instructions() {
        let prompt = build_shepherd_system_prompt("Test Project", "P-3");

        // Must NOT contain action-taking instructions (imperative form)
        assert!(
            !prompt.contains("Create a task") && !prompt.contains("create a task"),
            "Prompt must not instruct to create tasks"
        );
        assert!(
            !prompt.contains("Rebase the") && !prompt.contains("rebase the"),
            "Prompt must not instruct to rebase"
        );
        assert!(
            !prompt.contains("Merge the PR") && !prompt.contains("merge the PR"),
            "Prompt must not instruct to merge PRs"
        );
    }

    #[test]
    fn test_shepherd_system_prompt_project_name_interpolated() {
        let prompt_a = build_shepherd_system_prompt("Alpha Project", "P-10");
        let prompt_b = build_shepherd_system_prompt("Beta Project", "P-20");

        assert!(prompt_a.contains("Alpha Project"));
        assert!(prompt_a.contains("P-10"));
        assert!(prompt_b.contains("Beta Project"));
        assert!(prompt_b.contains("P-20"));

        // They should differ
        assert_ne!(prompt_a, prompt_b);
    }

    fn empty_snapshot() -> ProjectSnapshot {
        ProjectSnapshot::default()
    }

    fn snapshot_with_attention() -> ProjectSnapshot {
        ProjectSnapshot {
            ci_failures: 1,
            running_agents: 2,
            completed_agents: 1,
            doing_tasks: vec![SnapshotTask {
                id: "T-10".into(),
                prompt: "Build auth".into(),
                session_status: Some("running".into()),
            }],
            ..Default::default()
        }
    }

    #[test]
    fn test_shepherd_event_summary_format() {
        let events = vec![
            ShepherdEvent::CiStatusChanged {
                task_id: "T-42".to_string(),
                pr_id: 7,
                status: "failure".to_string(),
            },
            ShepherdEvent::AgentCompleted {
                task_id: "T-55".to_string(),
            },
            ShepherdEvent::PrReviewChanged {
                task_id: "T-33".to_string(),
                pr_id: 5,
                status: "changes_requested".to_string(),
            },
            ShepherdEvent::NewPrComment {
                task_id: "T-18".to_string(),
                pr_id: 3,
            },
        ];

        let summary = build_event_summary_prompt(&events, &empty_snapshot());

        assert!(summary.contains("T-42"));
        assert!(summary.contains("failure"));
        assert!(summary.contains("PR #7"));
        assert!(summary.contains("T-55"));
        assert!(summary.contains("review"));
        assert!(summary.contains("T-33"));
        assert!(summary.contains("changes_requested"));
        assert!(summary.contains("PR #5"));
        assert!(summary.contains("T-18"));
        assert!(summary.contains("PR #3"));
    }

    #[test]
    fn test_shepherd_event_summary_includes_snapshot() {
        let events = vec![ShepherdEvent::AgentCompleted {
            task_id: "T-1".to_string(),
        }];

        let summary = build_event_summary_prompt(&events, &snapshot_with_attention());

        assert!(summary.contains("PROJECT SNAPSHOT"));
        assert!(summary.contains("1 CI failures"));
        assert!(summary.contains("2 running"));
        assert!(summary.contains("T-10"));
        assert!(summary.contains("Build auth"));
    }

    #[test]
    fn test_shepherd_event_summary_empty_events() {
        let events: Vec<ShepherdEvent> = vec![];
        let summary = build_event_summary_prompt(&events, &empty_snapshot());
        assert!(summary.is_empty());
    }

    #[test]
    fn test_shepherd_event_summary_asks_for_advice() {
        let events = vec![ShepherdEvent::AgentCompleted {
            task_id: "T-1".to_string(),
        }];

        let summary = build_event_summary_prompt(&events, &empty_snapshot());
        assert!(summary.contains("advise") || summary.contains("attention"));
    }

    #[test]
    fn test_shepherd_event_summary_task_created() {
        let events = vec![ShepherdEvent::TaskCreated {
            task_id: "T-100".to_string(),
        }];

        let summary = build_event_summary_prompt(&events, &empty_snapshot());
        assert!(summary.contains("T-100"));
        assert!(summary.contains("created"));
    }

    #[test]
    fn test_shepherd_event_summary_task_moved() {
        let events = vec![ShepherdEvent::TaskMoved {
            task_id: "T-101".to_string(),
        }];

        let summary = build_event_summary_prompt(&events, &empty_snapshot());
        assert!(summary.contains("T-101"));
        assert!(summary.contains("moved"));
    }

    #[test]
    fn test_shepherd_event_summary_task_deleted() {
        let events = vec![ShepherdEvent::TaskDeleted {
            task_id: "T-102".to_string(),
        }];

        let summary = build_event_summary_prompt(&events, &empty_snapshot());
        assert!(summary.contains("T-102"));
        assert!(summary.contains("deleted"));
    }

    #[test]
    fn test_shepherd_event_summary_agent_started() {
        let events = vec![ShepherdEvent::AgentStarted {
            task_id: "T-103".to_string(),
        }];

        let summary = build_event_summary_prompt(&events, &empty_snapshot());
        assert!(summary.contains("T-103"));
        assert!(summary.contains("started"));
    }

    #[test]
    fn test_shepherd_event_summary_agent_errored() {
        let events = vec![ShepherdEvent::AgentErrored {
            task_id: "T-104".to_string(),
        }];

        let summary = build_event_summary_prompt(&events, &empty_snapshot());
        assert!(summary.contains("T-104"));
        assert!(summary.contains("error"));
    }

    #[test]
    fn test_shepherd_event_summary_agent_checkpoint() {
        let events = vec![ShepherdEvent::AgentCheckpoint {
            task_id: "T-105".to_string(),
        }];

        let summary = build_event_summary_prompt(&events, &empty_snapshot());
        assert!(summary.contains("T-105"));
        assert!(summary.contains("waiting"));
    }

    #[test]
    fn test_shepherd_system_prompt_includes_action_items_section() {
        let prompt = build_shepherd_system_prompt("Test Project", "P-1");
        assert!(
            prompt.contains("ACTION ITEMS"),
            "Prompt must include ACTION ITEMS section"
        );
        assert!(
            prompt.contains("create_action_item"),
            "Prompt must mention create_action_item tool"
        );
    }

    #[test]
    fn test_shepherd_system_prompt_action_items_no_shepherd_prefix() {
        let prompt = build_shepherd_system_prompt("Test Project", "P-1");
        if let Some(action_items_pos) = prompt.find("ACTION ITEMS") {
            let section_end = prompt[action_items_pos..]
                .find("===")
                .map(|p| action_items_pos + p)
                .unwrap_or(prompt.len());
            let section = &prompt[action_items_pos..section_end];
            assert!(
                !section.contains("shepherd_create_action_item"),
                "Tool names must not have shepherd prefix"
            );
        }
    }

    #[test]
    fn test_shepherd_event_summary_includes_active_action_items() {
        let snapshot = ProjectSnapshot {
            active_action_items: vec![
                SnapshotActionItem {
                    id: 1,
                    title: "Fix CI failure".to_string(),
                    task_id: Some("T-42".to_string()),
                },
                SnapshotActionItem {
                    id: 2,
                    title: "Review PR".to_string(),
                    task_id: None,
                },
            ],
            ..Default::default()
        };

        let events = vec![ShepherdEvent::AgentCompleted {
            task_id: "T-1".to_string(),
        }];

        let summary = build_event_summary_prompt(&events, &snapshot);
        assert!(
            summary.contains("Active action items"),
            "Summary must include active action items section"
        );
        assert!(summary.contains("Fix CI failure"));
        assert!(summary.contains("T-42"));
        assert!(summary.contains("Review PR"));
    }

    #[test]
    fn test_shepherd_event_summary_excludes_action_items_when_empty() {
        let snapshot = ProjectSnapshot {
            active_action_items: vec![],
            ..Default::default()
        };

        let events = vec![ShepherdEvent::AgentCompleted {
            task_id: "T-1".to_string(),
        }];

        let summary = build_event_summary_prompt(&events, &snapshot);
        assert!(
            !summary.contains("Active action items"),
            "Summary must not include action items section when empty"
        );
    }
}
