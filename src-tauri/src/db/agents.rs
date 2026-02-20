use rusqlite::Result;
use serde::Serialize;

/// Agent session row from database
#[derive(Debug, Clone, Serialize)]
pub struct AgentSessionRow {
    pub id: String,
    pub ticket_id: String,
    pub opencode_session_id: Option<String>,
    pub stage: String,
    pub status: String,
    pub checkpoint_data: Option<String>,
    pub error_message: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Agent log row from database
#[derive(Debug, Clone, Serialize)]
pub struct AgentLogRow {
    pub id: i64,
    pub session_id: String,
    pub timestamp: i64,
    pub log_type: String,
    pub content: String,
}

impl super::Database {
    pub fn create_agent_session(
        &self,
        id: &str,
        ticket_id: &str,
        opencode_session_id: Option<&str>,
        stage: &str,
        status: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;
        conn.execute(
            "INSERT INTO agent_sessions (id, ticket_id, opencode_session_id, stage, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![id, ticket_id, opencode_session_id, stage, status, now, now],
        )?;
        Ok(())
    }

    pub fn update_agent_session(
        &self,
        id: &str,
        stage: &str,
        status: &str,
        checkpoint_data: Option<&str>,
        error_message: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;
        conn.execute(
            "UPDATE agent_sessions SET stage = ?1, status = ?2, checkpoint_data = ?3, error_message = ?4, updated_at = ?5 WHERE id = ?6",
            rusqlite::params![stage, status, checkpoint_data, error_message, now, id],
        )?;
        Ok(())
    }

    pub fn set_agent_session_opencode_id(&self, id: &str, opencode_session_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE agent_sessions SET opencode_session_id = ?1 WHERE id = ?2",
            [opencode_session_id, id],
        )?;
        Ok(())
    }

    pub fn get_agent_session(&self, id: &str) -> Result<Option<AgentSessionRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, ticket_id, opencode_session_id, stage, status, checkpoint_data, error_message, created_at, updated_at
             FROM agent_sessions WHERE id = ?1",
        )?;
        let mut rows = stmt.query([id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(AgentSessionRow {
                id: row.get(0)?,
                ticket_id: row.get(1)?,
                opencode_session_id: row.get(2)?,
                stage: row.get(3)?,
                status: row.get(4)?,
                checkpoint_data: row.get(5)?,
                error_message: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn get_latest_session_for_ticket(
        &self,
        ticket_id: &str,
    ) -> Result<Option<AgentSessionRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, ticket_id, opencode_session_id, stage, status, checkpoint_data, error_message, created_at, updated_at
             FROM agent_sessions WHERE ticket_id = ?1 ORDER BY created_at DESC, rowid DESC LIMIT 1",
        )?;
        let mut rows = stmt.query([ticket_id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(AgentSessionRow {
                id: row.get(0)?,
                ticket_id: row.get(1)?,
                opencode_session_id: row.get(2)?,
                stage: row.get(3)?,
                status: row.get(4)?,
                checkpoint_data: row.get(5)?,
                error_message: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn get_latest_sessions_for_tickets(
        &self,
        ticket_ids: &[String],
    ) -> Result<Vec<AgentSessionRow>> {
        if ticket_ids.is_empty() {
            return Ok(Vec::new());
        }
        let conn = self.conn.lock().unwrap();
        let placeholders: Vec<String> = ticket_ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect();
        let sql = format!(
            "SELECT s.id, s.ticket_id, s.opencode_session_id, s.stage, s.status, s.checkpoint_data, s.error_message, s.created_at, s.updated_at
             FROM agent_sessions s
             INNER JOIN (
                 SELECT ticket_id, MAX(created_at) as max_created
                 FROM agent_sessions
                 WHERE ticket_id IN ({})
                 GROUP BY ticket_id
             ) latest ON s.ticket_id = latest.ticket_id AND s.created_at = latest.max_created",
            placeholders.join(", ")
        );
        let mut stmt = conn.prepare(&sql)?;
        let params: Vec<&dyn rusqlite::types::ToSql> = ticket_ids
            .iter()
            .map(|id| id as &dyn rusqlite::types::ToSql)
            .collect();
        let rows = stmt.query_map(params.as_slice(), |row| {
            Ok(AgentSessionRow {
                id: row.get(0)?,
                ticket_id: row.get(1)?,
                opencode_session_id: row.get(2)?,
                stage: row.get(3)?,
                status: row.get(4)?,
                checkpoint_data: row.get(5)?,
                error_message: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    pub fn insert_agent_log(&self, session_id: &str, log_type: &str, content: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;
        conn.execute(
            "INSERT INTO agent_logs (session_id, timestamp, log_type, content) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![session_id, now, log_type, content],
        )?;
        Ok(())
    }

    pub fn get_agent_logs(&self, session_id: &str) -> Result<Vec<AgentLogRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, session_id, timestamp, log_type, content FROM agent_logs WHERE session_id = ?1 ORDER BY timestamp ASC",
        )?;
        let logs = stmt.query_map([session_id], |row| {
            Ok(AgentLogRow {
                id: row.get(0)?,
                session_id: row.get(1)?,
                timestamp: row.get(2)?,
                log_type: row.get(3)?,
                content: row.get(4)?,
            })
        })?;
        let mut result = Vec::new();
        for log in logs {
            result.push(log?);
        }
        Ok(result)
    }

    pub fn mark_running_sessions_interrupted(&self) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;
        conn.execute(
            "UPDATE agent_sessions SET status = 'interrupted', error_message = 'Session interrupted by app restart', updated_at = ?1 WHERE status = 'running'",
            rusqlite::params![now],
        )?;
        Ok(conn.changes() as usize)
    }
}

#[cfg(test)]
mod tests {
    use crate::db::test_helpers::*;
    use std::fs;

    #[test]
    fn test_agent_session_lifecycle() {
        let (db, path) = make_test_db("agent_session_lifecycle");
        insert_test_task(&db);

        db.create_agent_session("ses-1", "T-100", None, "read_ticket", "running")
            .expect("create failed");

        let session = db
            .get_agent_session("ses-1")
            .expect("get failed")
            .expect("not found");
        assert_eq!(session.ticket_id, "T-100");
        assert_eq!(session.stage, "read_ticket");
        assert_eq!(session.status, "running");
        assert!(session.opencode_session_id.is_none());

        db.set_agent_session_opencode_id("ses-1", "oc-abc")
            .expect("set opencode id failed");

        let session = db
            .get_agent_session("ses-1")
            .expect("get failed")
            .expect("not found");
        assert_eq!(session.opencode_session_id, Some("oc-abc".to_string()));

        db.update_agent_session(
            "ses-1",
            "implement",
            "paused",
            Some("{\"diff\":\"...\"}"),
            None,
        )
        .expect("update failed");

        let session = db
            .get_agent_session("ses-1")
            .expect("get failed")
            .expect("not found");
        assert_eq!(session.stage, "implement");
        assert_eq!(session.status, "paused");
        assert_eq!(
            session.checkpoint_data,
            Some("{\"diff\":\"...\"}".to_string())
        );

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_get_latest_session_for_ticket() {
        let (db, path) = make_test_db("latest_session");
        insert_test_task(&db);

        db.create_agent_session("ses-old", "T-100", None, "read_ticket", "completed")
            .expect("create 1 failed");
        db.create_agent_session("ses-new", "T-100", None, "implement", "running")
            .expect("create 2 failed");

        let latest = db
            .get_latest_session_for_ticket("T-100")
            .expect("get failed")
            .expect("not found");
        assert_eq!(latest.id, "ses-new");

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_checkpoint_data_persistence() {
        let (db, path) = make_test_db("checkpoint_persist");
        insert_test_task(&db);

        db.create_agent_session("ses-cp", "T-100", None, "implement", "running")
            .expect("create session failed");

        db.update_agent_session(
            "ses-cp",
            "implement",
            "paused",
            Some("{\"question\":\"approve?\"}"),
            None,
        )
        .expect("update with checkpoint failed");

        let session = db
            .get_agent_session("ses-cp")
            .expect("get failed")
            .expect("not found");
        assert_eq!(
            session.checkpoint_data,
            Some("{\"question\":\"approve?\"}".to_string())
        );

        db.update_agent_session("ses-cp", "implement", "running", None, None)
            .expect("clear checkpoint failed");

        let session = db
            .get_agent_session("ses-cp")
            .expect("get failed")
            .expect("not found");
        assert_eq!(session.checkpoint_data, None);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_agent_logs() {
        let (db, path) = make_test_db("agent_logs");
        insert_test_task(&db);

        db.create_agent_session("ses-log", "T-100", None, "implement", "running")
            .expect("create session failed");

        db.insert_agent_log("ses-log", "stdout", "Building project...")
            .expect("insert log 1 failed");
        db.insert_agent_log("ses-log", "stderr", "Warning: unused var")
            .expect("insert log 2 failed");

        let logs = db.get_agent_logs("ses-log").expect("get logs failed");
        assert_eq!(logs.len(), 2);
        assert_eq!(logs[0].log_type, "stdout");
        assert_eq!(logs[0].content, "Building project...");
        assert_eq!(logs[1].log_type, "stderr");

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_mark_running_sessions_interrupted() {
        let (db, path) = make_test_db("mark_interrupted");
        insert_test_task(&db);

        db.create_agent_session("ses-run1", "T-100", None, "implement", "running")
            .expect("create running 1 failed");
        db.create_agent_session("ses-run2", "T-100", None, "implement", "running")
            .expect("create running 2 failed");
        db.create_agent_session("ses-done", "T-100", None, "implement", "completed")
            .expect("create completed failed");
        db.create_agent_session("ses-fail", "T-100", None, "implement", "failed")
            .expect("create failed failed");

        let count = db
            .mark_running_sessions_interrupted()
            .expect("mark interrupted failed");
        assert_eq!(count, 2);

        let s1 = db.get_agent_session("ses-run1").expect("get").unwrap();
        assert_eq!(s1.status, "interrupted");
        assert_eq!(
            s1.error_message,
            Some("Session interrupted by app restart".to_string())
        );

        let s2 = db.get_agent_session("ses-run2").expect("get").unwrap();
        assert_eq!(s2.status, "interrupted");

        let s3 = db.get_agent_session("ses-done").expect("get").unwrap();
        assert_eq!(s3.status, "completed");

        let s4 = db.get_agent_session("ses-fail").expect("get").unwrap();
        assert_eq!(s4.status, "failed");

        let count2 = db
            .mark_running_sessions_interrupted()
            .expect("second call failed");
        assert_eq!(count2, 0);

        drop(db);
        let _ = fs::remove_file(&path);
    }
}
