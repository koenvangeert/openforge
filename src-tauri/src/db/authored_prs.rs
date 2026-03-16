use rusqlite::Result;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct AuthoredPrRow {
    pub id: i64,
    pub number: i64,
    pub title: String,
    pub body: Option<String>,
    pub state: String,
    pub draft: bool,
    pub html_url: String,
    pub user_login: String,
    pub user_avatar_url: Option<String>,
    pub repo_owner: String,
    pub repo_name: String,
    pub head_ref: String,
    pub base_ref: String,
    pub head_sha: String,
    pub additions: i64,
    pub deletions: i64,
    pub changed_files: i64,
    pub ci_status: Option<String>,
    pub ci_check_runs: Option<String>,
    pub review_status: Option<String>,
    pub merged_at: Option<i64>,
    pub is_queued: bool,
    pub task_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl super::Database {
    #[allow(clippy::too_many_arguments)]
    pub fn upsert_authored_pr(
        &self,
        id: i64,
        number: i64,
        title: &str,
        body: Option<&str>,
        state: &str,
        draft: bool,
        html_url: &str,
        user_login: &str,
        user_avatar_url: Option<&str>,
        repo_owner: &str,
        repo_name: &str,
        head_ref: &str,
        base_ref: &str,
        head_sha: &str,
        additions: i64,
        deletions: i64,
        changed_files: i64,
        ci_status: Option<&str>,
        ci_check_runs: Option<&str>,
        review_status: Option<&str>,
        merged_at: Option<i64>,
        is_queued: bool,
        task_id: Option<&str>,
        created_at: i64,
        updated_at: i64,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO authored_prs (id, number, title, body, state, draft, html_url, user_login, user_avatar_url, repo_owner, repo_name, head_ref, base_ref, head_sha, additions, deletions, changed_files, ci_status, ci_check_runs, review_status, merged_at, is_queued, task_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25)
             ON CONFLICT(id) DO UPDATE SET
                 number = excluded.number,
                 title = excluded.title,
                 body = excluded.body,
                 state = excluded.state,
                 draft = excluded.draft,
                 html_url = excluded.html_url,
                 user_login = excluded.user_login,
                 user_avatar_url = excluded.user_avatar_url,
                 repo_owner = excluded.repo_owner,
                 repo_name = excluded.repo_name,
                 head_ref = excluded.head_ref,
                 base_ref = excluded.base_ref,
                 head_sha = excluded.head_sha,
                 additions = excluded.additions,
                 deletions = excluded.deletions,
                 changed_files = excluded.changed_files,
                 ci_status = excluded.ci_status,
                  ci_check_runs = excluded.ci_check_runs,
                  review_status = excluded.review_status,
                  merged_at = excluded.merged_at,
                  is_queued = excluded.is_queued,
                  task_id = excluded.task_id,
                  created_at = excluded.created_at,
                  updated_at = excluded.updated_at",
            rusqlite::params![
                id,
                number,
                title,
                body,
                state,
                draft as i32,
                html_url,
                user_login,
                user_avatar_url,
                repo_owner,
                repo_name,
                head_ref,
                base_ref,
                head_sha,
                additions,
                deletions,
                changed_files,
                ci_status,
                ci_check_runs,
                review_status,
                merged_at,
                is_queued as i32,
                task_id,
                created_at,
                updated_at
            ],
        )?;
        Ok(())
    }

    pub fn get_all_authored_prs(&self) -> Result<Vec<AuthoredPrRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, number, title, body, state, draft, html_url, user_login, user_avatar_url,
                    repo_owner, repo_name, head_ref, base_ref, head_sha, additions, deletions,
                    changed_files, ci_status, ci_check_runs, review_status, merged_at, is_queued,
                    task_id, created_at, updated_at
             FROM authored_prs
             ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(AuthoredPrRow {
                id: row.get(0)?,
                number: row.get(1)?,
                title: row.get(2)?,
                body: row.get(3)?,
                state: row.get(4)?,
                draft: row.get::<_, i32>(5)? != 0,
                html_url: row.get(6)?,
                user_login: row.get(7)?,
                user_avatar_url: row.get(8)?,
                repo_owner: row.get(9)?,
                repo_name: row.get(10)?,
                head_ref: row.get(11)?,
                base_ref: row.get(12)?,
                head_sha: row.get(13)?,
                additions: row.get(14)?,
                deletions: row.get(15)?,
                changed_files: row.get(16)?,
                ci_status: row.get(17)?,
                ci_check_runs: row.get(18)?,
                review_status: row.get(19)?,
                merged_at: row.get(20)?,
                is_queued: row.get::<_, i32>(21)? != 0,
                task_id: row.get(22)?,
                created_at: row.get(23)?,
                updated_at: row.get(24)?,
            })
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    pub fn delete_stale_authored_prs(&self, current_ids: &[i64]) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        if current_ids.is_empty() {
            conn.execute("DELETE FROM authored_prs", [])?;
        } else {
            let placeholders: Vec<String> = current_ids
                .iter()
                .enumerate()
                .map(|(i, _)| format!("?{}", i + 1))
                .collect();
            let sql = format!(
                "DELETE FROM authored_prs WHERE id NOT IN ({})",
                placeholders.join(", ")
            );
            let mut stmt = conn.prepare(&sql)?;
            let params: Vec<Box<dyn rusqlite::types::ToSql>> = current_ids
                .iter()
                .map(|id| Box::new(*id) as Box<dyn rusqlite::types::ToSql>)
                .collect();
            let param_refs: Vec<&dyn rusqlite::types::ToSql> =
                params.iter().map(|p| p.as_ref()).collect();
            stmt.execute(param_refs.as_slice())?;
        }
        Ok(())
    }

    pub fn get_authored_pr_count(&self) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT COUNT(*) FROM authored_prs WHERE state = 'open'",
            [],
            |row| row.get(0),
        )
    }
}

#[cfg(test)]
mod tests {
    use crate::db::test_helpers::*;
    use std::fs;

    #[test]
    fn test_authored_pr_upsert_and_retrieve() {
        let (db, path) = make_test_db("authored_pr_upsert");

        db.upsert_authored_pr(
            123,
            456,
            "Add authored PR feature",
            Some("Body text"),
            "open",
            false,
            "https://github.com/owner/repo/pull/456",
            "octocat",
            Some("https://avatars.githubusercontent.com/u/1?v=4"),
            "owner",
            "repo",
            "feature-branch",
            "main",
            "abc123",
            100,
            50,
            10,
            None,
            None,
            None,
            None,
            false,
            None,
            1000,
            2000,
        )
        .expect("upsert failed");

        let prs = db.get_all_authored_prs().expect("get_all failed");
        assert_eq!(prs.len(), 1);
        assert_eq!(prs[0].id, 123);
        assert_eq!(prs[0].number, 456);
        assert_eq!(prs[0].title, "Add authored PR feature");
        assert_eq!(prs[0].body, Some("Body text".to_string()));
        assert_eq!(prs[0].state, "open");
        assert!(!prs[0].draft);
        assert_eq!(prs[0].repo_owner, "owner");
        assert_eq!(prs[0].repo_name, "repo");
        assert_eq!(prs[0].head_sha, "abc123");

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_authored_pr_upsert_updates() {
        let (db, path) = make_test_db("authored_pr_upsert_updates");

        db.upsert_authored_pr(
            123,
            456,
            "Original title",
            None,
            "open",
            false,
            "https://github.com/owner/repo/pull/456",
            "octocat",
            None,
            "owner",
            "repo",
            "feature-branch",
            "main",
            "abc123",
            100,
            50,
            10,
            None,
            None,
            None,
            None,
            false,
            None,
            1000,
            2000,
        )
        .expect("insert failed");

        db.upsert_authored_pr(
            123,
            456,
            "Updated title",
            Some("updated body"),
            "open",
            true,
            "https://github.com/owner/repo/pull/456",
            "octocat",
            None,
            "owner",
            "repo",
            "feature-branch",
            "main",
            "def456",
            120,
            60,
            12,
            Some("pending"),
            Some("[]"),
            Some("review_required"),
            None,
            false,
            None,
            1000,
            3000,
        )
        .expect("update failed");

        let prs = db.get_all_authored_prs().expect("get_all failed");
        assert_eq!(prs.len(), 1);
        assert_eq!(prs[0].title, "Updated title");
        assert_eq!(prs[0].body, Some("updated body".to_string()));
        assert!(prs[0].draft);
        assert_eq!(prs[0].head_sha, "def456");
        assert_eq!(prs[0].updated_at, 3000);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_authored_pr_delete_stale() {
        let (db, path) = make_test_db("authored_pr_delete_stale");

        for i in 1_i64..=3 {
            db.upsert_authored_pr(
                i,
                i,
                &format!("PR {}", i),
                None,
                "open",
                false,
                &format!("https://github.com/owner/repo/pull/{}", i),
                "octocat",
                None,
                "owner",
                "repo",
                &format!("branch{}", i),
                "main",
                &format!("sha{}", i),
                10,
                5,
                2,
                None,
                None,
                None,
                None,
                false,
                None,
                i * 1000,
                i * 1000,
            )
            .expect("insert failed");
        }

        db.delete_stale_authored_prs(&[1, 3])
            .expect("delete stale failed");

        let prs = db.get_all_authored_prs().expect("get_all failed");
        assert_eq!(prs.len(), 2);
        assert!(prs.iter().any(|pr| pr.id == 1));
        assert!(prs.iter().any(|pr| pr.id == 3));
        assert!(!prs.iter().any(|pr| pr.id == 2));

        db.delete_stale_authored_prs(&[])
            .expect("delete all failed");
        let prs = db.get_all_authored_prs().expect("get_all failed");
        assert!(prs.is_empty());

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_authored_pr_ordering() {
        let (db, path) = make_test_db("authored_pr_ordering");

        db.upsert_authored_pr(
            1,
            1,
            "Older",
            None,
            "open",
            false,
            "https://github.com/owner/repo/pull/1",
            "octocat",
            None,
            "owner",
            "repo",
            "branch1",
            "main",
            "sha1",
            10,
            5,
            2,
            None,
            None,
            None,
            None,
            false,
            None,
            1000,
            1000,
        )
        .expect("insert older failed");

        db.upsert_authored_pr(
            2,
            2,
            "Newer",
            None,
            "open",
            false,
            "https://github.com/owner/repo/pull/2",
            "octocat",
            None,
            "owner",
            "repo",
            "branch2",
            "main",
            "sha2",
            20,
            10,
            3,
            None,
            None,
            None,
            None,
            false,
            None,
            2000,
            5000,
        )
        .expect("insert newer failed");

        let prs = db.get_all_authored_prs().expect("get_all failed");
        assert_eq!(prs.len(), 2);
        assert_eq!(prs[0].id, 2);
        assert_eq!(prs[1].id, 1);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_authored_pr_with_task_link() {
        let (db, path) = make_test_db("authored_pr_task_link");

        db.upsert_authored_pr(
            77,
            77,
            "Linked PR",
            None,
            "open",
            false,
            "https://github.com/owner/repo/pull/77",
            "octocat",
            None,
            "owner",
            "repo",
            "branch",
            "main",
            "sha77",
            1,
            1,
            1,
            None,
            None,
            None,
            None,
            false,
            Some("T-100"),
            1000,
            1000,
        )
        .expect("insert failed");

        let prs = db.get_all_authored_prs().expect("get_all failed");
        assert_eq!(prs[0].task_id, Some("T-100".to_string()));

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_authored_pr_with_ci_status() {
        let (db, path) = make_test_db("authored_pr_ci_status");

        db.upsert_authored_pr(
            88,
            88,
            "CI PR",
            None,
            "open",
            false,
            "https://github.com/owner/repo/pull/88",
            "octocat",
            None,
            "owner",
            "repo",
            "branch",
            "main",
            "sha88",
            10,
            4,
            2,
            Some("success"),
            Some("[{\"name\":\"build\"}]"),
            Some("approved"),
            None,
            false,
            None,
            1000,
            1000,
        )
        .expect("insert failed");

        let prs = db.get_all_authored_prs().expect("get_all failed");
        assert_eq!(prs[0].ci_status, Some("success".to_string()));
        assert_eq!(prs[0].review_status, Some("approved".to_string()));
        assert_eq!(db.get_authored_pr_count().expect("count failed"), 1);

        drop(db);
        let _ = fs::remove_file(&path);
    }
}
