use rusqlite::Result;
use serde::{Deserialize, Serialize};

/// Plugin row from the plugins table
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginRow {
    pub id: String,
    pub name: String,
    pub version: String,
    pub api_version: i64,
    pub description: String,
    pub permissions: String,
    pub contributes: String,
    pub frontend_entry: String,
    pub backend_entry: Option<String>,
    pub install_path: String,
    pub installed_at: i64,
    pub is_builtin: bool,
}

/// Row from the project_plugins join table
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectPluginRow {
    pub project_id: String,
    pub plugin_id: String,
    pub enabled: bool,
}

impl super::Database {
    /// Insert a plugin record. Replaces if id already exists.
    pub fn install_plugin(&self, plugin: &PluginRow) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO plugins
                (id, name, version, api_version, description, permissions, contributes,
                 frontend_entry, backend_entry, install_path, installed_at, is_builtin)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            rusqlite::params![
                plugin.id,
                plugin.name,
                plugin.version,
                plugin.api_version,
                plugin.description,
                plugin.permissions,
                plugin.contributes,
                plugin.frontend_entry,
                plugin.backend_entry,
                plugin.install_path,
                plugin.installed_at,
                plugin.is_builtin as i64,
            ],
        )?;
        Ok(())
    }

    /// Remove a plugin (and cascade-delete project_plugins rows).
    pub fn uninstall_plugin(&self, plugin_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM plugins WHERE id = ?1", [plugin_id])?;
        Ok(())
    }

    /// Fetch a single plugin by id.
    pub fn get_plugin(&self, plugin_id: &str) -> Result<Option<PluginRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, version, api_version, description, permissions, contributes,
                    frontend_entry, backend_entry, install_path, installed_at, is_builtin
             FROM plugins WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map([plugin_id], row_to_plugin)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    /// Return all installed plugins ordered by name.
    pub fn list_plugins(&self) -> Result<Vec<PluginRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, version, api_version, description, permissions, contributes,
                    frontend_entry, backend_entry, install_path, installed_at, is_builtin
             FROM plugins ORDER BY name ASC",
        )?;
        let rows = stmt.query_map([], row_to_plugin)?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    /// Set the enabled flag for a plugin within a project.
    /// Creates the project_plugins row if it does not exist.
    pub fn set_plugin_enabled(
        &self,
        project_id: &str,
        plugin_id: &str,
        enabled: bool,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO project_plugins (project_id, plugin_id, enabled)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(project_id, plugin_id) DO UPDATE SET enabled = excluded.enabled",
            rusqlite::params![project_id, plugin_id, enabled as i64],
        )?;
        Ok(())
    }

    /// Return all plugins that are enabled for the given project.
    pub fn get_enabled_plugins(&self, project_id: &str) -> Result<Vec<PluginRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT p.id, p.name, p.version, p.api_version, p.description, p.permissions,
                    p.contributes, p.frontend_entry, p.backend_entry, p.install_path,
                    p.installed_at, p.is_builtin
             FROM plugins p
             JOIN project_plugins pp ON pp.plugin_id = p.id
             WHERE pp.project_id = ?1 AND pp.enabled = 1
             ORDER BY p.name ASC",
        )?;
        let rows = stmt.query_map([project_id], row_to_plugin)?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    /// Return true if the plugin is enabled for the given project.
    pub fn is_plugin_enabled(&self, project_id: &str, plugin_id: &str) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let enabled: bool = conn
            .query_row(
                "SELECT enabled FROM project_plugins WHERE project_id = ?1 AND plugin_id = ?2",
                rusqlite::params![project_id, plugin_id],
                |row| row.get::<_, bool>(0),
            )
            .unwrap_or(false);
        Ok(enabled)
    }

    pub fn get_plugin_storage(&self, plugin_id: &str, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT value FROM plugin_storage WHERE plugin_id = ?1 AND key = ?2",
        )?;
        let mut rows = stmt.query(rusqlite::params![plugin_id, key])?;

        match rows.next()? {
            Some(row) => Ok(Some(row.get(0)?)),
            None => Ok(None),
        }
    }

    pub fn set_plugin_storage(&self, plugin_id: &str, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO plugin_storage (plugin_id, key, value)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(plugin_id, key) DO UPDATE SET value = excluded.value",
            rusqlite::params![plugin_id, key, value],
        )?;
        Ok(())
    }
}

fn row_to_plugin(row: &rusqlite::Row<'_>) -> rusqlite::Result<PluginRow> {
    Ok(PluginRow {
        id: row.get(0)?,
        name: row.get(1)?,
        version: row.get(2)?,
        api_version: row.get(3)?,
        description: row.get(4)?,
        permissions: row.get(5)?,
        contributes: row.get(6)?,
        frontend_entry: row.get(7)?,
        backend_entry: row.get(8)?,
        install_path: row.get(9)?,
        installed_at: row.get(10)?,
        is_builtin: row.get::<_, i64>(11)? != 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::make_test_db;

    fn sample_plugin(id: &str) -> PluginRow {
        PluginRow {
            id: id.to_string(),
            name: format!("Plugin {}", id),
            version: "1.0.0".to_string(),
            api_version: 1,
            description: "A test plugin".to_string(),
            permissions: "[]".to_string(),
            contributes: "{}".to_string(),
            frontend_entry: "index.js".to_string(),
            backend_entry: None,
            install_path: "/tmp/plugin".to_string(),
            installed_at: 0,
            is_builtin: false,
        }
    }

    #[test]
    fn install_and_get_plugin() {
        let (db, _tmp) = make_test_db("plugins_install_get");
        let p = sample_plugin("p1");
        db.install_plugin(&p).unwrap();
        let got = db.get_plugin("p1").unwrap().expect("plugin should exist");
        assert_eq!(got.id, "p1");
        assert_eq!(got.name, "Plugin p1");
    }

    #[test]
    fn list_plugins_empty_then_populated() {
        let (db, _tmp) = make_test_db("plugins_list");
        assert!(db.list_plugins().unwrap().is_empty());
        db.install_plugin(&sample_plugin("a")).unwrap();
        db.install_plugin(&sample_plugin("b")).unwrap();
        let list = db.list_plugins().unwrap();
        assert_eq!(list.len(), 2);
    }

    #[test]
    fn uninstall_plugin() {
        let (db, _tmp) = make_test_db("plugins_uninstall");
        db.install_plugin(&sample_plugin("x")).unwrap();
        db.uninstall_plugin("x").unwrap();
        assert!(db.get_plugin("x").unwrap().is_none());
    }

    #[test]
    fn set_and_get_enabled_plugins() {
        let (db, _tmp) = make_test_db("plugins_enabled");
        db.install_plugin(&sample_plugin("pa")).unwrap();
        db.install_plugin(&sample_plugin("pb")).unwrap();

        db.set_plugin_enabled("proj1", "pa", true).unwrap();
        db.set_plugin_enabled("proj1", "pb", false).unwrap();

        let enabled = db.get_enabled_plugins("proj1").unwrap();
        assert_eq!(enabled.len(), 1);
        assert_eq!(enabled[0].id, "pa");

        assert!(db.is_plugin_enabled("proj1", "pa").unwrap());
        assert!(!db.is_plugin_enabled("proj1", "pb").unwrap());
    }

    #[test]
    fn set_enabled_idempotent() {
        let (db, _tmp) = make_test_db("plugins_idempotent");
        db.install_plugin(&sample_plugin("q")).unwrap();
        db.set_plugin_enabled("proj1", "q", true).unwrap();
        db.set_plugin_enabled("proj1", "q", false).unwrap();
        assert!(!db.is_plugin_enabled("proj1", "q").unwrap());
    }

    #[test]
    fn plugin_storage_round_trip() {
        let (db, _tmp) = make_test_db("plugins_storage_round_trip");
        db.install_plugin(&sample_plugin("plugin-a")).unwrap();

        assert!(db
            .get_plugin_storage("plugin-a", "theme")
            .unwrap()
            .is_none());

        db.set_plugin_storage("plugin-a", "theme", "dark").unwrap();
        assert_eq!(
            db.get_plugin_storage("plugin-a", "theme").unwrap(),
            Some("dark".to_string())
        );

        db.set_plugin_storage("plugin-a", "theme", "light").unwrap();
        assert_eq!(
            db.get_plugin_storage("plugin-a", "theme").unwrap(),
            Some("light".to_string())
        );
    }
}
