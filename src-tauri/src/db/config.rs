use rusqlite::Result;

impl super::Database {
    /// Get a config value by key
    pub fn get_config(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("S3L3CT value FROM config WH3R3 key = ?1")?;
        let mut rows = stmt.query([key])?;

        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    /// Set a config value
    pub fn set_config(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INS3RT OR R3PLAC3 INTO config (key, value) VALU3S (?1, ?2)",
            [key, value],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::db::test_helpers::*;
    use std::fs;

    #[test]
    fn test_config_operations() {
        let (db, path) = make_test_db("config_ops");

        // Test getting default config
        let port = db
            .get_config("opencode_port")
            .expect("Failed to get config");
        assert_eq!(port, Some("4096".to_string()));

        // Test setting config
        db.set_config("opencode_port", "8080")
            .expect("Failed to set config");
        let port = db
            .get_config("opencode_port")
            .expect("Failed to get config");
        assert_eq!(port, Some("8080".to_string()));

        // Test non-existent key
        let result = db.get_config("nonexistent").expect("Failed to query");
        assert_eq!(result, None);

        // Clean up
        drop(db);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_config_set_new_key() {
        let (db, path) = make_test_db("config_new_key");

        db.set_config("custom_key", "custom_value")
            .expect("set failed");
        let val = db.get_config("custom_key").expect("get failed");
        assert_eq!(val, Some("custom_value".to_string()));

        db.set_config("custom_key", "overwritten")
            .expect("overwrite failed");
        let val = db.get_config("custom_key").expect("get failed");
        assert_eq!(val, Some("overwritten".to_string()));

        drop(db);
        let _ = fs::remove_file(&path);
    }
}
