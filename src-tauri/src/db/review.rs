use rusqlite::Result;
use serde::Serialize;

/// Review PR row from database (cross-repo, not task-linked)
#[derive(Debug, Clone, Serialize)]
pub struct ReviewPrRow {
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
    pub created_at: i64,
    pub updated_at: i64,
}

impl super::Database {
    #[allow(clippy::too_many_arguments)]
    pub fn upsert_review_pr(
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
        created_at: i64,
        updated_at: i64,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO review_prs (id, number, title, body, state, draft, html_url, user_login, user_avatar_url, repo_owner, repo_name, head_ref, base_ref, head_sha, additions, deletions, changed_files, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
            rusqlite::params![
                id, number, title, body, state, draft as i32, html_url, user_login, user_avatar_url,
                repo_owner, repo_name, head_ref, base_ref, head_sha, additions, deletions, changed_files,
                created_at, updated_at
            ],
        )?;
        Ok(())
    }

    pub fn get_all_review_prs(&self) -> Result<Vec<ReviewPrRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, number, title, body, state, draft, html_url, user_login, user_avatar_url,
                    repo_owner, repo_name, head_ref, base_ref, head_sha, additions, deletions,
                    changed_files, created_at, updated_at
             FROM review_prs ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ReviewPrRow {
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
                created_at: row.get(17)?,
                updated_at: row.get(18)?,
            })
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    pub fn delete_stale_review_prs(&self, current_ids: &[i64]) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        if current_ids.is_empty() {
            conn.execute("DELETE FROM review_prs", [])?;
        } else {
            let placeholders: Vec<String> = current_ids
                .iter()
                .enumerate()
                .map(|(i, _)| format!("?{}", i + 1))
                .collect();
            let sql = format!(
                "DELETE FROM review_prs WHERE id NOT IN ({})",
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
}

#[cfg(test)]
mod tests {
    use crate::db::test_helpers::*;
    use std::fs;

    #[test]
    fn test_review_pr_upsert_and_retrieve() {
        let (db, path) = make_test_db("review_pr_upsert");

        db.upsert_review_pr(
            123,
            456,
            "Add new feature",
            Some("This PR adds a new feature"),
            "open",
            false,
            "https://github.com/owner/repo/pull/456",
            "octocat",
            Some("https://avatars.githubusercontent.com/u/1?v=4"),
            "owner",
            "repo",
            "feature-branch",
            "main",
            "abc123def",
            100,
            50,
            10,
            1000,
            2000,
        )
        .expect("upsert failed");

        let prs = db.get_all_review_prs().expect("get_all failed");
        assert_eq!(prs.len(), 1);
        assert_eq!(prs[0].id, 123);
        assert_eq!(prs[0].number, 456);
        assert_eq!(prs[0].title, "Add new feature");
        assert_eq!(prs[0].body, Some("This PR adds a new feature".to_string()));
        assert_eq!(prs[0].state, "open");
        assert_eq!(prs[0].draft, false);
        assert_eq!(prs[0].html_url, "https://github.com/owner/repo/pull/456");
        assert_eq!(prs[0].user_login, "octocat");
        assert_eq!(
            prs[0].user_avatar_url,
            Some("https://avatars.githubusercontent.com/u/1?v=4".to_string())
        );
        assert_eq!(prs[0].repo_owner, "owner");
        assert_eq!(prs[0].repo_name, "repo");
        assert_eq!(prs[0].head_ref, "feature-branch");
        assert_eq!(prs[0].base_ref, "main");
        assert_eq!(prs[0].head_sha, "abc123def");
        assert_eq!(prs[0].additions, 100);
        assert_eq!(prs[0].deletions, 50);
        assert_eq!(prs[0].changed_files, 10);
        assert_eq!(prs[0].created_at, 1000);
        assert_eq!(prs[0].updated_at, 2000);

        db.upsert_review_pr(
            123,
            456,
            "Add new feature - updated",
            Some("This PR adds a new feature"),
            "open",
            false,
            "https://github.com/owner/repo/pull/456",
            "octocat",
            Some("https://avatars.githubusercontent.com/u/1?v=4"),
            "owner",
            "repo",
            "feature-branch",
            "main",
            "abc123def",
            100,
            50,
            10,
            1000,
            3000,
        )
        .expect("upsert update failed");

        let prs = db.get_all_review_prs().expect("get_all failed");
        assert_eq!(prs.len(), 1);
        assert_eq!(prs[0].title, "Add new feature - updated");
        assert_eq!(prs[0].updated_at, 3000);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_review_pr_delete_stale() {
        let (db, path) = make_test_db("review_pr_stale");

        db.upsert_review_pr(
            100,
            1,
            "PR 1",
            None,
            "open",
            false,
            "https://github.com/owner/repo/pull/1",
            "user1",
            None,
            "owner",
            "repo",
            "branch1",
            "main",
            "sha1",
            10,
            5,
            2,
            1000,
            1000,
        )
        .expect("insert 1 failed");
        db.upsert_review_pr(
            200,
            2,
            "PR 2",
            None,
            "open",
            false,
            "https://github.com/owner/repo/pull/2",
            "user2",
            None,
            "owner",
            "repo",
            "branch2",
            "main",
            "sha2",
            20,
            10,
            3,
            2000,
            2000,
        )
        .expect("insert 2 failed");
        db.upsert_review_pr(
            300,
            3,
            "PR 3",
            None,
            "open",
            false,
            "https://github.com/owner/repo/pull/3",
            "user3",
            None,
            "owner",
            "repo",
            "branch3",
            "main",
            "sha3",
            30,
            15,
            4,
            3000,
            3000,
        )
        .expect("insert 3 failed");

        db.delete_stale_review_prs(&[100, 300])
            .expect("delete stale failed");

        let prs = db.get_all_review_prs().expect("get_all failed");
        assert_eq!(prs.len(), 2);
        assert!(prs.iter().any(|pr| pr.id == 100));
        assert!(prs.iter().any(|pr| pr.id == 300));
        assert!(!prs.iter().any(|pr| pr.id == 200));

        db.delete_stale_review_prs(&[]).expect("delete all failed");

        let prs = db.get_all_review_prs().expect("get_all failed");
        assert_eq!(prs.len(), 0);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_review_pr_ordering() {
        let (db, path) = make_test_db("review_pr_ordering");

        db.upsert_review_pr(
            1,
            10,
            "Older PR",
            None,
            "open",
            false,
            "https://github.com/owner/repo/pull/10",
            "user1",
            None,
            "owner",
            "repo",
            "branch1",
            "main",
            "sha1",
            10,
            5,
            2,
            1000,
            1000,
        )
        .expect("insert older failed");
        db.upsert_review_pr(
            2,
            20,
            "Newer PR",
            None,
            "open",
            false,
            "https://github.com/owner/repo/pull/20",
            "user2",
            None,
            "owner",
            "repo",
            "branch2",
            "main",
            "sha2",
            20,
            10,
            3,
            2000,
            5000,
        )
        .expect("insert newer failed");

        let prs = db.get_all_review_prs().expect("get_all failed");
        assert_eq!(prs.len(), 2);
        assert_eq!(prs[0].id, 2);
        assert_eq!(prs[1].id, 1);

        drop(db);
        let _ = fs::remove_file(&path);
    }
}
