use rusqlite::Result;
use serde::Serialize;

/// Action item row from database
#[derive(Debug, Clone, Serialize)]
pub struct ActionItemRow {
    pub id: i64,
    pub project_id: String,
    pub source: String,
    pub title: String,
    pub description: String,
    pub task_id: Option<String>,
    pub status: String,
    pub created_at: i64,
    pub dismissed_at: Option<i64>,
}

impl super::Database {
    /// Insert an action item
    pub fn insert_action_item(
        &self,
        project_id: &str,
        source: &str,
        title: &str,
        description: &str,
        task_id: Option<&str>,
    ) -> Result<ActionItemRow> {
        let conn = self.conn.lock().unwrap();

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;

        conn.execute(
            "INSERT INTO action_items (project_id, source, title, description, task_id, status, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![project_id, source, title, description, task_id, "active", now],
        )?;

        let id = conn.last_insert_rowid();

        Ok(ActionItemRow {
            id,
            project_id: project_id.to_string(),
            source: source.to_string(),
            title: title.to_string(),
            description: description.to_string(),
            task_id: task_id.map(|s| s.to_string()),
            status: "active".to_string(),
            created_at: now,
            dismissed_at: None,
        })
    }

    /// Get active action items for a project, most recent first
    pub fn get_active_action_items(
        &self,
        project_id: &str,
        limit: i64,
    ) -> Result<Vec<ActionItemRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, source, title, description, task_id, status, created_at, dismissed_at
             FROM action_items
             WHERE project_id = ?1 AND status = 'active'
             ORDER BY created_at DESC, id DESC
             LIMIT ?2",
        )?;

        let items = stmt.query_map(rusqlite::params![project_id, limit], |row| {
            Ok(ActionItemRow {
                id: row.get(0)?,
                project_id: row.get(1)?,
                source: row.get(2)?,
                title: row.get(3)?,
                description: row.get(4)?,
                task_id: row.get(5)?,
                status: row.get(6)?,
                created_at: row.get(7)?,
                dismissed_at: row.get(8)?,
            })
        })?;

        let mut result = Vec::new();
        for item in items {
            result.push(item?);
        }
        Ok(result)
    }

    /// Dismiss an action item
    pub fn dismiss_action_item(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs() as i64;

        conn.execute(
            "UPDATE action_items SET status = 'dismissed', dismissed_at = ?1 WHERE id = ?2",
            rusqlite::params![now, id],
        )?;
        Ok(())
    }

    /// Get count of active action items for a project
    pub fn get_active_action_item_count(&self, project_id: &str) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM action_items WHERE project_id = ?1 AND status = 'active'",
            rusqlite::params![project_id],
            |row| row.get(0),
        )?;
        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use crate::db::test_helpers::*;
    use std::fs;

    #[test]
    fn test_action_items_crud() {
        let (db, path) = make_test_db("action_items_crud");

        // Create a project
        let project = db
            .create_project("Test Project", "/tmp/test")
            .expect("Failed to create project");

        // Insert action items
        let item1 = db
            .insert_action_item(
                &project.id,
                "shepherd",
                "Fix bug",
                "There is a bug in the code",
                None,
            )
            .expect("Failed to insert item 1");
        assert_eq!(item1.status, "active");
        assert_eq!(item1.title, "Fix bug");
        assert_eq!(item1.source, "shepherd");
        assert_eq!(item1.dismissed_at, None);

        let item2 = db
            .insert_action_item(
                &project.id,
                "shepherd",
                "Add feature",
                "Implement new feature",
                Some("T-123"),
            )
            .expect("Failed to insert item 2");
        assert_eq!(item2.status, "active");
        assert_eq!(item2.task_id, Some("T-123".to_string()));

        // Get active items (most recent first)
        let items = db
            .get_active_action_items(&project.id, 10)
            .expect("Failed to get items");
        assert_eq!(items.len(), 2);
        // Most recent first
        assert_eq!(items[0].id, item2.id);
        assert_eq!(items[1].id, item1.id);

        // Dismiss an item
        db.dismiss_action_item(item1.id)
            .expect("Failed to dismiss item");

        // Get active items again — should only have 1
        let items_after = db
            .get_active_action_items(&project.id, 10)
            .expect("Failed to get items after dismiss");
        assert_eq!(items_after.len(), 1);
        assert_eq!(items_after[0].id, item2.id);

        // Verify dismissed item has dismissed_at set
        let all_items = db
            .connection()
            .lock()
            .unwrap()
            .prepare("SELECT dismissed_at FROM action_items WHERE id = ?1")
            .expect("Failed to prepare query")
            .query_row(rusqlite::params![item1.id], |row| {
                row.get::<_, Option<i64>>(0)
            })
            .expect("Failed to query dismissed_at");
        assert!(all_items.is_some());

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_action_items_project_isolation() {
        let (db, path) = make_test_db("action_items_isolation");

        // Create two projects
        let project1 = db
            .create_project("Project 1", "/tmp/proj1")
            .expect("Failed to create project 1");
        let project2 = db
            .create_project("Project 2", "/tmp/proj2")
            .expect("Failed to create project 2");

        // Insert items for project 1
        db.insert_action_item(&project1.id, "shepherd", "Item 1", "Description 1", None)
            .expect("Failed to insert item for project 1");

        // Insert items for project 2
        db.insert_action_item(&project2.id, "shepherd", "Item 2", "Description 2", None)
            .expect("Failed to insert item for project 2");

        // Get items for project 1 — should only have 1
        let items1 = db
            .get_active_action_items(&project1.id, 10)
            .expect("Failed to get items for project 1");
        assert_eq!(items1.len(), 1);
        assert_eq!(items1[0].title, "Item 1");

        // Get items for project 2 — should only have 1
        let items2 = db
            .get_active_action_items(&project2.id, 10)
            .expect("Failed to get items for project 2");
        assert_eq!(items2.len(), 1);
        assert_eq!(items2[0].title, "Item 2");

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_action_items_dismiss_sets_timestamp() {
        let (db, path) = make_test_db("action_items_dismiss");

        // Create a project
        let project = db
            .create_project("Test Project", "/tmp/test")
            .expect("Failed to create project");

        // Insert an item
        let item = db
            .insert_action_item(
                &project.id,
                "shepherd",
                "Test item",
                "Test description",
                None,
            )
            .expect("Failed to insert item");

        // Verify dismissed_at is None initially
        assert_eq!(item.dismissed_at, None);

        // Dismiss the item
        db.dismiss_action_item(item.id)
            .expect("Failed to dismiss item");

        // Get the item and verify dismissed_at is set
        let dismissed_items = db
            .connection()
            .lock()
            .unwrap()
            .prepare("SELECT dismissed_at FROM action_items WHERE id = ?1")
            .expect("Failed to prepare query")
            .query_row(rusqlite::params![item.id], |row| {
                row.get::<_, Option<i64>>(0)
            })
            .expect("Failed to query dismissed_at");

        assert!(dismissed_items.is_some());
        assert!(dismissed_items.unwrap() > 0);

        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_action_items_count() {
        let (db, path) = make_test_db("action_items_count");

        // Create a project
        let project = db
            .create_project("Test Project", "/tmp/test")
            .expect("Failed to create project");

        // Initially count should be 0
        let count = db
            .get_active_action_item_count(&project.id)
            .expect("Failed to get count");
        assert_eq!(count, 0);

        // Insert 3 items
        let item1 = db
            .insert_action_item(&project.id, "shepherd", "Item 1", "Desc 1", None)
            .expect("Failed to insert item 1");
        let item2 = db
            .insert_action_item(&project.id, "shepherd", "Item 2", "Desc 2", None)
            .expect("Failed to insert item 2");
        let _item3 = db
            .insert_action_item(&project.id, "shepherd", "Item 3", "Desc 3", None)
            .expect("Failed to insert item 3");

        // Count should be 3
        let count = db
            .get_active_action_item_count(&project.id)
            .expect("Failed to get count");
        assert_eq!(count, 3);

        // Dismiss one item
        db.dismiss_action_item(item1.id)
            .expect("Failed to dismiss item");

        // Count should be 2
        let count = db
            .get_active_action_item_count(&project.id)
            .expect("Failed to get count");
        assert_eq!(count, 2);

        // Dismiss another item
        db.dismiss_action_item(item2.id)
            .expect("Failed to dismiss item");

        // Count should be 1
        let count = db
            .get_active_action_item_count(&project.id)
            .expect("Failed to get count");
        assert_eq!(count, 1);

        drop(db);
        let _ = fs::remove_file(&path);
    }
}
