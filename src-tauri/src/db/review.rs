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
    pub mergeable: Option<bool>,
    pub mergeable_state: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub viewed_at: Option<i64>,
    pub viewed_head_sha: Option<String>,
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
            "INSERT INTO review_prs (id, number, title, body, state, draft, html_url, user_login, user_avatar_url, repo_owner, repo_name, head_ref, base_ref, head_sha, additions, deletions, changed_files, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
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
                  created_at = excluded.created_at,
                  updated_at = excluded.updated_at,
                  viewed_at = CASE WHEN review_prs.viewed_head_sha IS NOT NULL AND review_prs.viewed_head_sha != excluded.head_sha THEN NULL ELSE review_prs.viewed_at END,
                  viewed_head_sha = CASE WHEN review_prs.viewed_head_sha IS NOT NULL AND review_prs.viewed_head_sha != excluded.head_sha THEN NULL ELSE review_prs.viewed_head_sha END",
            rusqlite::params![
                id, number, title, body, state, draft as i32, html_url, user_login, user_avatar_url,
                repo_owner, repo_name, head_ref, base_ref, head_sha, additions, deletions, changed_files,
                created_at, updated_at
            ],
        )?;
        Ok(())
    }

    pub fn update_review_pr_mergeability(
        &self,
        id: i64,
        mergeable: Option<bool>,
        mergeable_state: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE review_prs SET mergeable = ?1, mergeable_state = ?2 WHERE id = ?3",
            rusqlite::params![mergeable, mergeable_state, id],
        )?;
        Ok(())
    }

    pub fn get_all_review_prs(&self) -> Result<Vec<ReviewPrRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, number, title, body, state, draft, html_url, user_login, user_avatar_url,
                    repo_owner, repo_name, head_ref, base_ref, head_sha, additions, deletions,
                    changed_files, mergeable, mergeable_state, created_at, updated_at, viewed_at, viewed_head_sha
             FROM review_prs
             ORDER BY CASE WHEN viewed_at IS NULL THEN 0 ELSE 1 END, updated_at DESC",
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
                mergeable: row.get(17)?,
                mergeable_state: row.get(18)?,
                created_at: row.get(19)?,
                updated_at: row.get(20)?,
                viewed_at: row.get(21)?,
                viewed_head_sha: row.get(22)?,
            })
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    /// Mark a review PR as viewed with the given head SHA.
    /// Sets `viewed_at` to the current Unix timestamp and `viewed_head_sha` to the provided sha.
    pub fn mark_review_pr_viewed(&self, pr_id: i64, head_sha: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;
        conn.execute(
            "UPDATE review_prs SET viewed_at = ?1, viewed_head_sha = ?2 WHERE id = ?3",
            rusqlite::params![now, head_sha, pr_id],
        )?;
        Ok(())
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
        assert!(!prs[0].draft);
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

    #[test]
    fn test_review_pr_viewed_null_by_default() {
        let (db, path) = make_test_db("review_pr_viewed_null");

        db.upsert_review_pr(
            1,
            10,
            "PR 1",
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
            2000,
        )
        .expect("upsert failed");

        let prs = db.get_all_review_prs().expect("get_all failed");
        assert_eq!(prs.len(), 1);
        assert!(prs[0].viewed_at.is_none());
        assert!(prs[0].viewed_head_sha.is_none());

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_mark_review_pr_viewed() {
        let (db, path) = make_test_db("review_pr_mark_viewed");

        db.upsert_review_pr(
            1,
            10,
            "PR 1",
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
            2000,
        )
        .expect("upsert failed");

        db.mark_review_pr_viewed(1, "sha1")
            .expect("mark viewed failed");

        let prs = db.get_all_review_prs().expect("get_all failed");
        assert_eq!(prs.len(), 1);
        assert!(prs[0].viewed_at.is_some());
        assert_eq!(prs[0].viewed_head_sha, Some("sha1".to_string()));

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_upsert_preserves_viewed_when_sha_unchanged() {
        let (db, path) = make_test_db("review_pr_preserve_viewed");

        db.upsert_review_pr(
            1,
            10,
            "PR 1",
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
            "abc",
            10,
            5,
            2,
            1000,
            2000,
        )
        .expect("upsert failed");

        db.mark_review_pr_viewed(1, "abc")
            .expect("mark viewed failed");

        let prs_before = db.get_all_review_prs().expect("get_all failed");
        let viewed_at_before = prs_before[0].viewed_at;

        // Upsert again with same sha
        db.upsert_review_pr(
            1,
            10,
            "PR 1 updated",
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
            "abc",
            10,
            5,
            2,
            1000,
            3000,
        )
        .expect("re-upsert failed");

        let prs = db.get_all_review_prs().expect("get_all failed");
        assert_eq!(prs.len(), 1);
        assert_eq!(prs[0].viewed_at, viewed_at_before);
        assert_eq!(prs[0].viewed_head_sha, Some("abc".to_string()));

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_upsert_clears_viewed_when_sha_changed() {
        let (db, path) = make_test_db("review_pr_clear_viewed");

        db.upsert_review_pr(
            1,
            10,
            "PR 1",
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
            "abc",
            10,
            5,
            2,
            1000,
            2000,
        )
        .expect("upsert failed");

        db.mark_review_pr_viewed(1, "abc")
            .expect("mark viewed failed");

        // Upsert again with different sha
        db.upsert_review_pr(
            1,
            10,
            "PR 1",
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
            "def",
            10,
            5,
            2,
            1000,
            3000,
        )
        .expect("re-upsert failed");

        let prs = db.get_all_review_prs().expect("get_all failed");
        assert_eq!(prs.len(), 1);
        assert!(prs[0].viewed_at.is_none());
        assert!(prs[0].viewed_head_sha.is_none());

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_upsert_never_viewed_stays_unviewed() {
        let (db, path) = make_test_db("review_pr_never_viewed");

        db.upsert_review_pr(
            1,
            10,
            "PR 1",
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
            "abc",
            10,
            5,
            2,
            1000,
            2000,
        )
        .expect("upsert failed");

        // Never mark as viewed, upsert with new sha
        db.upsert_review_pr(
            1,
            10,
            "PR 1",
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
            "new-sha",
            10,
            5,
            2,
            1000,
            3000,
        )
        .expect("re-upsert failed");

        let prs = db.get_all_review_prs().expect("get_all failed");
        assert_eq!(prs.len(), 1);
        assert!(prs[0].viewed_at.is_none());
        assert!(prs[0].viewed_head_sha.is_none());

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_review_pr_viewed_sorting() {
        let (db, path) = make_test_db("review_pr_viewed_sorting");

        // Insert 3 PRs (all unviewed initially)
        for i in 1_i64..=3 {
            db.upsert_review_pr(
                i,
                i * 10,
                &format!("PR {}", i),
                None,
                "open",
                false,
                &format!("https://github.com/owner/repo/pull/{}", i * 10),
                "user1",
                None,
                "owner",
                "repo",
                &format!("branch{}", i),
                "main",
                &format!("sha{}", i),
                10,
                5,
                2,
                i * 1000,
                i * 1000,
            )
            .expect("upsert failed");
        }

        // Mark PR 2 as viewed
        db.mark_review_pr_viewed(2, "sha2")
            .expect("mark viewed failed");

        let prs = db.get_all_review_prs().expect("get_all failed");
        assert_eq!(prs.len(), 3);

        // Unviewed PRs should come first
        assert!(prs[0].viewed_at.is_none());
        assert!(prs[1].viewed_at.is_none());
        // Viewed PR should be last
        assert!(prs[2].viewed_at.is_some());
        assert_eq!(prs[2].id, 2);

        drop(db);
        let _ = fs::remove_file(&path);
    }
}
