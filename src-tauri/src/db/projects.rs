use rusqlite::Result;
use serde::Serialize;

/// Project row from database
#[derive(Debug, Clone, Serialize)]
pub struct ProjectRow {
    pub id: String,
    pub name: String,
    pub path: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Attention summary for a project (cross-domain aggregation)
#[derive(Debug, Clone, Serialize)]
pub struct ProjectAttentionRow {
    pub project_id: String,
    /// Number of doing tasks where the agent is paused waiting for input
    pub needs_input: i64,
    /// Number of doing tasks where the agent is running
    pub running_agents: i64,
    /// Number of open PRs with CI failure
    pub ci_failures: i64,
    /// Total unaddressed PR comments across open PRs
    pub unaddressed_comments: i64,
    /// Number of doing tasks where the agent has completed (needs review/move)
    pub completed_agents: i64,
}

impl super::Database {
    /// Create a new project with auto-incremented ID
    pub fn create_project(&self, name: &str, path: &str) -> Result<ProjectRow> {
        let conn = self.conn.lock().unwrap();

        let next_id: i64 = conn.query_row(
            "SELECT value FROM config WHERE key = 'next_project_id'",
            [],
            |row| {
                let val: String = row.get(0)?;
                Ok(val.parse::<i64>().unwrap_or(1))
            },
        )?;

        let project_id = format!("P-{}", next_id);

        conn.execute(
            "UPDATE config SET value = ?1 WHERE key = 'next_project_id'",
            [&(next_id + 1).to_string()],
        )?;

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;

        conn.execute(
            "INSERT INTO projects (id, name, path, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![&project_id, name, path, now, now],
        )?;

        Ok(ProjectRow {
            id: project_id,
            name: name.to_string(),
            path: path.to_string(),
            created_at: now,
            updated_at: now,
        })
    }

    /// Get all projects
    pub fn get_all_projects(&self) -> Result<Vec<ProjectRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, path, created_at, updated_at 
             FROM projects ORDER BY updated_at DESC",
        )?;

        let projects = stmt.query_map([], |row| {
            Ok(ProjectRow {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })?;

        let mut result = Vec::new();
        for project in projects {
            result.push(project?);
        }
        Ok(result)
    }

    /// Get a project by ID
    pub fn get_project(&self, id: &str) -> Result<Option<ProjectRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, path, created_at, updated_at 
             FROM projects WHERE id = ?1",
        )?;
        let mut rows = stmt.query([id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(ProjectRow {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            }))
        } else {
            Ok(None)
        }
    }

    /// Update a project
    pub fn update_project(&self, id: &str, name: &str, path: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;
        conn.execute(
            "UPDATE projects SET name = ?1, path = ?2, updated_at = ?3 WHERE id = ?4",
            rusqlite::params![name, path, now, id],
        )?;
        Ok(())
    }

    /// Delete a project and all associated data
    pub fn delete_project(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM agent_sessions WHERE ticket_id IN (SELECT id FROM tasks WHERE project_id = ?1)",
            rusqlite::params![id],
        )?;
        conn.execute(
            "DELETE FROM pr_comments WHERE pr_id IN (SELECT id FROM pull_requests WHERE ticket_id IN (SELECT id FROM tasks WHERE project_id = ?1))",
            rusqlite::params![id],
        )?;
        conn.execute(
            "DELETE FROM pull_requests WHERE ticket_id IN (SELECT id FROM tasks WHERE project_id = ?1)",
            rusqlite::params![id],
        )?;
        conn.execute(
            "DELETE FROM worktrees WHERE project_id = ?1",
            rusqlite::params![id],
        )?;
        conn.execute(
            "DELETE FROM shepherd_messages WHERE project_id = ?1",
            rusqlite::params![id],
        )?;
        conn.execute(
            "DELETE FROM action_items WHERE project_id = ?1",
            rusqlite::params![id],
        )?;
        conn.execute(
            "DELETE FROM tasks WHERE project_id = ?1",
            rusqlite::params![id],
        )?;
        // project_config cascades automatically via ON DELETE CASCADE
        conn.execute("DELETE FROM projects WHERE id = ?1", rusqlite::params![id])?;
        Ok(())
    }

    /// Get a project config value
    pub fn get_project_config(&self, project_id: &str, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt =
            conn.prepare("SELECT value FROM project_config WHERE project_id = ?1 AND key = ?2")?;
        let mut rows = stmt.query([project_id, key])?;

        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    /// Set a project config value
    pub fn set_project_config(&self, project_id: &str, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO project_config (project_id, key, value) VALUES (?1, ?2, ?3)",
            [project_id, key, value],
        )?;
        Ok(())
    }

    /// Get all config values for a project
    pub fn get_all_project_config(
        &self,
        project_id: &str,
    ) -> Result<std::collections::HashMap<String, String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt =
            conn.prepare("SELECT key, value FROM project_config WHERE project_id = ?1")?;
        let rows = stmt.query_map([project_id], |row| Ok((row.get(0)?, row.get(1)?)))?;

        let mut result = std::collections::HashMap::new();
        for row in rows {
            let (key, value) = row?;
            result.insert(key, value);
        }
        Ok(result)
    }

    /// Resolve the AI provider for a project.
    /// Checks project_config first, falls back to global config, then defaults to "claude-code".
    pub fn resolve_ai_provider(&self, project_id: &str) -> String {
        if !project_id.is_empty() {
            if let Ok(Some(provider)) = self.get_project_config(project_id, "ai_provider") {
                if !provider.is_empty() {
                    return provider;
                }
            }
        }
        self.get_config("ai_provider")
            .ok()
            .flatten()
            .unwrap_or_else(|| "claude-code".to_string())
    }

    /// Resolve whether worktrees are enabled for a project.
    /// Checks project_config for "use_worktrees". Defaults to true (worktrees enabled).
    /// Only returns false when explicitly set to "false".
    pub fn resolve_use_worktrees(&self, project_id: &str) -> bool {
        if !project_id.is_empty() {
            if let Ok(Some(value)) = self.get_project_config(project_id, "use_worktrees") {
                return value != "false";
            }
        }
        true
    }

    /// Find a project by its github_default_repo config value.
    /// Returns the project that has github_default_repo set to the given repo_full_name (e.g. "owner/repo").
    pub fn find_project_by_github_repo(&self, repo_full_name: &str) -> Result<Option<ProjectRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT p.id, p.name, p.path, p.created_at, p.updated_at
             FROM projects p
             JOIN project_config pc ON p.id = pc.project_id
             WHERE pc.key = 'github_default_repo' AND pc.value = ?1",
        )?;
        let mut rows = stmt.query([repo_full_name])?;
        if let Some(row) = rows.next()? {
            Ok(Some(ProjectRow {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            }))
        } else {
            Ok(None)
        }
    }

    /// Get attention summaries for all projects.
    ///
    /// Aggregates cross-domain signals (agent status, PR status) per project
    /// so the project switcher can show which projects need attention.
    pub fn get_project_attention_summaries(&self) -> Result<Vec<ProjectAttentionRow>> {
        let conn = self.conn.lock().unwrap();
        let mut attention: std::collections::HashMap<String, ProjectAttentionRow> =
            std::collections::HashMap::new();

        // Query 1: Task/agent attention for "doing" tasks
        {
            let mut stmt = conn.prepare(
                "SELECT
                    t.project_id,
                    COALESCE(SUM(CASE WHEN ls.status = 'paused' AND ls.checkpoint_data IS NOT NULL THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN ls.status = 'running' THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN ls.status = 'completed' THEN 1 ELSE 0 END), 0)
                FROM tasks t
                LEFT JOIN (
                    SELECT s1.ticket_id, s1.status, s1.checkpoint_data
                    FROM agent_sessions s1
                    INNER JOIN (
                        SELECT ticket_id, MAX(created_at) as max_created
                        FROM agent_sessions
                        GROUP BY ticket_id
                    ) s2 ON s1.ticket_id = s2.ticket_id AND s1.created_at = s2.max_created
                ) ls ON ls.ticket_id = t.id
                WHERE t.project_id IS NOT NULL AND t.status = 'doing'
                GROUP BY t.project_id"
            )?;

            let rows = stmt.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            })?;

            for row in rows {
                let (project_id, needs_input, running_agents, completed_agents) = row?;
                let entry =
                    attention
                        .entry(project_id.clone())
                        .or_insert_with(|| ProjectAttentionRow {
                            project_id,
                            needs_input: 0,
                            running_agents: 0,
                            ci_failures: 0,
                            unaddressed_comments: 0,
                            completed_agents: 0,
                        });
                entry.needs_input = needs_input;
                entry.running_agents = running_agents;
                entry.completed_agents = completed_agents;
            }
        }

        // Query 2: PR attention for open PRs
        {
            let mut stmt = conn.prepare(
                "SELECT
                    t.project_id,
                    COUNT(DISTINCT CASE WHEN pr.ci_status = 'failure' THEN pr.id END),
                    COALESCE(SUM(
                        (SELECT COUNT(*) FROM pr_comments WHERE pr_id = pr.id AND addressed = 0)
                    ), 0)
                FROM pull_requests pr
                JOIN tasks t ON t.id = pr.ticket_id
                WHERE t.project_id IS NOT NULL AND pr.state = 'open'
                GROUP BY t.project_id",
            )?;

            let rows = stmt.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })?;

            for row in rows {
                let (project_id, ci_failures, unaddressed_comments) = row?;
                let entry =
                    attention
                        .entry(project_id.clone())
                        .or_insert_with(|| ProjectAttentionRow {
                            project_id,
                            needs_input: 0,
                            running_agents: 0,
                            ci_failures: 0,
                            unaddressed_comments: 0,
                            completed_agents: 0,
                        });
                entry.ci_failures = ci_failures;
                entry.unaddressed_comments = unaddressed_comments;
            }
        }

        Ok(attention.into_values().collect())
    }

    pub fn get_project_attention_for_project(
        &self,
        project_id: &str,
    ) -> Result<Option<ProjectAttentionRow>> {
        let summaries = self.get_project_attention_summaries()?;
        Ok(summaries
            .into_iter()
            .find(|row| row.project_id == project_id))
    }
}

#[cfg(test)]
mod tests {
    use crate::db::test_helpers::*;
    use std::fs;

    #[test]
    fn test_delete_project_with_tasks_succeeds() {
        let (db, path) = make_test_db("delete_project_with_tasks");

        let project = db
            .create_project("My Project", "/tmp/proj")
            .expect("create project failed");

        let task = db
            .create_task("Do something", "backlog", None, Some(&project.id), None, None, None)
            .expect("create task failed");

        db.create_agent_session("ses-1", &task.id, None, "implement", "running", "opencode")
            .expect("create session failed");

        db.delete_project(&project.id)
            .expect("delete_project should succeed even with associated tasks and sessions");

        let projects = db.get_all_projects().expect("get projects failed");
        assert!(projects.iter().all(|p| p.id != project.id), "project should be gone");

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_project_config_operations() {
        let (db, path) = make_test_db("project_config");

        let project = db
            .create_project("Test Project", "/tmp/test")
            .expect("Failed to create project");

        db.set_project_config(&project.id, "github_default_repo", "owner/repo")
            .expect("Failed to set github_default_repo");
        db.set_project_config(&project.id, "custom_setting", "value123")
            .expect("Failed to set custom_setting");

        let repo = db
            .get_project_config(&project.id, "github_default_repo")
            .expect("Failed to get github_default_repo");
        assert_eq!(repo, Some("owner/repo".to_string()));

        let setting = db
            .get_project_config(&project.id, "custom_setting")
            .expect("Failed to get custom_setting");
        assert_eq!(setting, Some("value123".to_string()));

        let nonexistent = db
            .get_project_config(&project.id, "nonexistent")
            .expect("Failed to query nonexistent");
        assert_eq!(nonexistent, None);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_global_and_project_config_are_independent() {
        let (db, path) = make_test_db("independent_configs");

        db.set_config("github_token", "global-token-456")
            .expect("Failed to set global github_token");

        let project = db
            .create_project("Test Project", "/tmp/test")
            .expect("Failed to create project");

        db.set_project_config(&project.id, "github_default_repo", "owner/repo")
            .expect("Failed to set project github_default_repo");

        let global_token = db
            .get_config("github_token")
            .expect("Failed to get global github_token");
        assert_eq!(global_token, Some("global-token-456".to_string()));

        let project_repo = db
            .get_project_config(&project.id, "github_default_repo")
            .expect("Failed to get project github_default_repo");
        assert_eq!(project_repo, Some("owner/repo".to_string()));

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_project_attention_summaries_empty() {
        let (db, path) = make_test_db("attention_empty");

        let project = db
            .create_project("Empty Project", "/tmp/empty")
            .expect("create failed");

        let summaries = db.get_project_attention_summaries().expect("query failed");
        // No doing tasks, no PRs — should return empty
        assert!(
            summaries.is_empty(),
            "Expected no attention rows for project with no doing tasks"
        );

        // Create a backlog task — still no attention since it's not 'doing'
        db.create_task(
            "Backlog task",
            "backlog",
            None,
            Some(&project.id),
            None,
            None,
            None,
        )
        .expect("create task failed");
        let summaries = db.get_project_attention_summaries().expect("query failed");
        assert!(summaries.is_empty());

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_project_attention_summaries_with_signals() {
        let (db, path) = make_test_db("attention_signals");

        let project = db
            .create_project("Active Project", "/tmp/active")
            .expect("create failed");

        // Create a doing task with a paused agent (needs input)
        let task1 = db
            .create_task(
                "Doing task 1",
                "doing",
                None,
                Some(&project.id),
                None,
                None,
                None,
            )
            .expect("create task failed");
        db.create_agent_session("ses-1", &task1.id, None, "implement", "paused", "opencode")
            .expect("create session failed");
        db.update_agent_session(
            "ses-1",
            "implement",
            "paused",
            Some("{\"q\":\"approve?\"}"),
            None,
        )
        .expect("update session failed");

        // Create a doing task with a running agent
        let task2 = db
            .create_task(
                "Doing task 2",
                "doing",
                None,
                Some(&project.id),
                None,
                None,
                None,
            )
            .expect("create task failed");
        db.create_agent_session("ses-2", &task2.id, None, "implement", "running", "opencode")
            .expect("create session failed");

        // Create a doing task with a completed agent (needs review/move)
        let task4 = db
            .create_task(
                "Doing task 4",
                "doing",
                None,
                Some(&project.id),
                None,
                None,
                None,
            )
            .expect("create task failed");
        db.create_agent_session(
            "ses-4",
            &task4.id,
            None,
            "implement",
            "completed",
            "opencode",
        )
        .expect("create session failed");

        // Create a doing task with an open PR that has CI failure + unaddressed comment
        let task3 = db
            .create_task(
                "Doing task 3",
                "doing",
                None,
                Some(&project.id),
                None,
                None,
                None,
            )
            .expect("create task failed");
        db.insert_pull_request(
            42,
            &task3.id,
            "acme",
            "repo",
            "Fix",
            "https://example.com",
            "open",
            1000,
            1000,
            false,
        )
        .expect("insert pr failed");
        db.update_pr_ci_status(42, "sha1", "failure", "[]")
            .expect("update ci failed");
        db.insert_pr_comment(
            501,
            42,
            "reviewer",
            "Fix this",
            "review",
            Some("main.rs"),
            Some(10),
            false,
            2000,
        )
        .expect("insert comment failed");

        let summaries = db.get_project_attention_summaries().expect("query failed");
        let summary = summaries
            .iter()
            .find(|s| s.project_id == project.id)
            .expect("project not found");

        assert_eq!(summary.needs_input, 1);
        assert_eq!(summary.running_agents, 1);
        assert_eq!(summary.ci_failures, 1);
        assert_eq!(summary.unaddressed_comments, 1);
        assert_eq!(summary.completed_agents, 1);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_resolve_ai_provider_uses_project_config() {
        let (db, path) = make_test_db("resolve_provider_project");

        let project = db
            .create_project("Test Project", "/tmp/test")
            .expect("create failed");

        // Set project-level ai_provider to opencode
        db.set_project_config(&project.id, "ai_provider", "opencode")
            .expect("set config failed");

        // Global default is claude-code, but project override should win
        let provider = db.resolve_ai_provider(&project.id);
        assert_eq!(provider, "opencode");

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_resolve_ai_provider_falls_back_to_global() {
        let (db, path) = make_test_db("resolve_provider_global");

        let project = db
            .create_project("Test Project", "/tmp/test")
            .expect("create failed");

        // No project-level ai_provider set, should fall back to global
        let provider = db.resolve_ai_provider(&project.id);
        assert_eq!(provider, "claude-code");

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_resolve_ai_provider_empty_project_id() {
        let (db, path) = make_test_db("resolve_provider_empty");

        // Empty project ID should fall back to global
        let provider = db.resolve_ai_provider("");
        assert_eq!(provider, "claude-code");

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_resolve_use_worktrees_defaults_to_true() {
        let (db, path) = make_test_db("worktrees_default");

        let project = db
            .create_project("Test Project", "/tmp/test")
            .expect("create failed");

        assert!(db.resolve_use_worktrees(&project.id));

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_resolve_use_worktrees_false_when_disabled() {
        let (db, path) = make_test_db("worktrees_disabled");

        let project = db
            .create_project("Test Project", "/tmp/test")
            .expect("create failed");

        db.set_project_config(&project.id, "use_worktrees", "false")
            .expect("set config failed");

        assert!(!db.resolve_use_worktrees(&project.id));

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_resolve_use_worktrees_true_when_explicitly_enabled() {
        let (db, path) = make_test_db("worktrees_enabled");

        let project = db
            .create_project("Test Project", "/tmp/test")
            .expect("create failed");

        db.set_project_config(&project.id, "use_worktrees", "true")
            .expect("set config failed");

        assert!(db.resolve_use_worktrees(&project.id));

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_resolve_use_worktrees_empty_project_id() {
        let (db, path) = make_test_db("worktrees_empty_id");

        assert!(db.resolve_use_worktrees(""));

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_find_project_by_github_repo() {
        let (db, path) = make_test_db("find_by_repo");
        // Create a project
        let project_id = db
            .create_project("My Project", "/path/to/project")
            .expect("create failed");
        // Set github_default_repo config
        db.set_project_config(&project_id.id, "github_default_repo", "facebook/react")
            .expect("set config failed");

        // Should find the project
        let found = db
            .find_project_by_github_repo("facebook/react")
            .expect("find failed");
        assert!(found.is_some());
        let found = found.unwrap();
        assert_eq!(found.id, project_id.id);
        assert_eq!(found.path, "/path/to/project");

        // Should NOT find with different repo
        let not_found = db
            .find_project_by_github_repo("unknown/repo")
            .expect("find failed");
        assert!(not_found.is_none());

        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_shepherd_enabled_default_false() {
        let (db, path) = make_test_db("shepherd_enabled_default");

        let project = db
            .create_project("Test Project", "/tmp/test")
            .expect("Failed to create project");

        // When not set, should default to false
        let enabled = db
            .get_project_config(&project.id, "task_shepherd_enabled")
            .expect("Failed to get shepherd enabled");
        assert_eq!(enabled, None);

        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_shepherd_enabled_toggle() {
        let (db, path) = make_test_db("shepherd_enabled_toggle");

        let project = db
            .create_project("Test Project", "/tmp/test")
            .expect("Failed to create project");

        // Set to true
        db.set_project_config(&project.id, "task_shepherd_enabled", "true")
            .expect("Failed to set shepherd enabled to true");

        let enabled = db
            .get_project_config(&project.id, "task_shepherd_enabled")
            .expect("Failed to get shepherd enabled");
        assert_eq!(enabled, Some("true".to_string()));

        // Set to false
        db.set_project_config(&project.id, "task_shepherd_enabled", "false")
            .expect("Failed to set shepherd enabled to false");

        let enabled = db
            .get_project_config(&project.id, "task_shepherd_enabled")
            .expect("Failed to get shepherd enabled");
        assert_eq!(enabled, Some("false".to_string()));

        drop(db);
        let _ = std::fs::remove_file(&path);
    }
}
