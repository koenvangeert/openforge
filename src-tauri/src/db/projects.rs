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

    /// Delete a project
    pub fn delete_project(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
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
                let entry = attention.entry(project_id.clone()).or_insert_with(|| ProjectAttentionRow {
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
                GROUP BY t.project_id"
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
                let entry = attention.entry(project_id.clone()).or_insert_with(|| ProjectAttentionRow {
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
}

#[cfg(test)]
mod tests {
    use crate::db::test_helpers::*;
    use std::fs;

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
        assert!(summaries.is_empty(), "Expected no attention rows for project with no doing tasks");

        // Create a backlog task — still no attention since it's not 'doing'
        db.create_task("Backlog task", "backlog", None, Some(&project.id))
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
            .create_task("Doing task 1", "doing", None, Some(&project.id))
            .expect("create task failed");
        db.create_agent_session("ses-1", &task1.id, None, "implement", "paused")
            .expect("create session failed");
        db.update_agent_session("ses-1", "implement", "paused", Some("{\"q\":\"approve?\"}"), None)
            .expect("update session failed");

        // Create a doing task with a running agent
        let task2 = db
            .create_task("Doing task 2", "doing", None, Some(&project.id))
            .expect("create task failed");
        db.create_agent_session("ses-2", &task2.id, None, "implement", "running")
            .expect("create session failed");

        // Create a doing task with a completed agent (needs review/move)
        let task4 = db
            .create_task("Doing task 4", "doing", None, Some(&project.id))
            .expect("create task failed");
        db.create_agent_session("ses-4", &task4.id, None, "implement", "completed")
            .expect("create session failed");

        // Create a doing task with an open PR that has CI failure + unaddressed comment
        let task3 = db
            .create_task("Doing task 3", "doing", None, Some(&project.id))
            .expect("create task failed");
        db.insert_pull_request(42, &task3.id, "acme", "repo", "Fix", "https://example.com", "open", 1000, 1000)
            .expect("insert pr failed");
        db.update_pr_ci_status(42, "sha1", "failure", "[]")
            .expect("update ci failed");
        db.insert_pr_comment(501, 42, "reviewer", "Fix this", "review", Some("main.rs"), Some(10), false, 2000)
            .expect("insert comment failed");

        let summaries = db.get_project_attention_summaries().expect("query failed");
        let summary = summaries.iter().find(|s| s.project_id == project.id).expect("project not found");

        assert_eq!(summary.needs_input, 1);
        assert_eq!(summary.running_agents, 1);
        assert_eq!(summary.ci_failures, 1);
        assert_eq!(summary.unaddressed_comments, 1);
        assert_eq!(summary.completed_agents, 1);

        drop(db);
        let _ = fs::remove_file(&path);
    }
}
