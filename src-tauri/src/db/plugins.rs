use rusqlite::{OptionalExtension, Result};
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
    pub source_kind: String,
    pub source_spec: String,
    pub package_metadata: String,
    pub installed_at: i64,
    pub is_builtin: bool,
}

impl super::Database {
    /// Insert a plugin record. Updates metadata if id already exists.
    pub fn install_plugin(&self, plugin: &PluginRow) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO plugins
                (id, name, version, api_version, description, permissions, contributes,
                 frontend_entry, backend_entry, install_path, source_kind, source_spec,
                 package_metadata, installed_at, is_builtin)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                version = excluded.version,
                api_version = excluded.api_version,
                description = excluded.description,
                permissions = excluded.permissions,
                contributes = excluded.contributes,
                frontend_entry = excluded.frontend_entry,
                backend_entry = excluded.backend_entry,
                install_path = excluded.install_path,
                source_kind = excluded.source_kind,
                source_spec = excluded.source_spec,
                package_metadata = excluded.package_metadata,
                installed_at = excluded.installed_at,
                is_builtin = excluded.is_builtin",
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
                plugin.source_kind,
                plugin.source_spec,
                plugin.package_metadata,
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
                    frontend_entry, backend_entry, install_path, source_kind, source_spec,
                    package_metadata, installed_at, is_builtin
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
                    frontend_entry, backend_entry, install_path, source_kind, source_spec,
                    package_metadata, installed_at, is_builtin
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
                    p.source_kind, p.source_spec, p.package_metadata, p.installed_at, p.is_builtin
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
        let enabled = conn
            .query_row(
                "SELECT enabled FROM project_plugins WHERE project_id = ?1 AND plugin_id = ?2",
                rusqlite::params![project_id, plugin_id],
                |row| row.get::<_, bool>(0),
            )
            .optional()?
            .unwrap_or(false);
        Ok(enabled)
    }

    pub fn get_plugin_storage(
        &self,
        plugin_id: &str,
        scope: &str,
        scope_id: Option<&str>,
        key: &str,
    ) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let scope_id = normalized_plugin_storage_scope_id(scope, scope_id);
        let mut stmt = conn.prepare(
            "SELECT value FROM plugin_storage
             WHERE plugin_id = ?1 AND scope = ?2 AND scope_id = ?3 AND key = ?4",
        )?;
        let mut rows = stmt.query(rusqlite::params![plugin_id, scope, scope_id, key])?;

        match rows.next()? {
            Some(row) => Ok(Some(row.get(0)?)),
            None => Ok(None),
        }
    }

    pub fn set_plugin_storage(
        &self,
        plugin_id: &str,
        scope: &str,
        scope_id: Option<&str>,
        key: &str,
        value: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let scope_id = normalized_plugin_storage_scope_id(scope, scope_id);
        conn.execute(
            "INSERT INTO plugin_storage (plugin_id, scope, scope_id, key, value)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(plugin_id, scope, scope_id, key) DO UPDATE SET value = excluded.value",
            rusqlite::params![plugin_id, scope, scope_id, key, value],
        )?;
        Ok(())
    }

    pub fn delete_plugin_storage(
        &self,
        plugin_id: &str,
        scope: &str,
        scope_id: Option<&str>,
        key: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let scope_id = normalized_plugin_storage_scope_id(scope, scope_id);
        conn.execute(
            "DELETE FROM plugin_storage
             WHERE plugin_id = ?1 AND scope = ?2 AND scope_id = ?3 AND key = ?4",
            rusqlite::params![plugin_id, scope, scope_id, key],
        )?;
        Ok(())
    }
}

fn normalized_plugin_storage_scope_id<'a>(scope: &str, scope_id: Option<&'a str>) -> &'a str {
    if scope == "global" {
        ""
    } else {
        scope_id.unwrap_or("")
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
        source_kind: row.get(10)?,
        source_spec: row.get(11)?,
        package_metadata: row.get(12)?,
        installed_at: row.get(13)?,
        is_builtin: row.get::<_, i64>(14)? != 0,
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
            source_kind: "legacy".to_string(),
            source_spec: "".to_string(),
            package_metadata: "{}".to_string(),
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
    fn install_and_get_plugin_persists_package_source_metadata() {
        let (db, _tmp) = make_test_db("plugins_install_metadata");
        let mut plugin = sample_plugin("pkg");
        plugin.source_kind = "npm".to_string();
        plugin.source_spec = "npm:@acme/openforge-plugin@1.2.3".to_string();
        plugin.package_metadata =
            r#"{"id":"pkg","apiVersion":1,"displayName":"Pkg","description":"Plugin"}"#.to_string();

        db.install_plugin(&plugin).unwrap();

        let got = db.get_plugin("pkg").unwrap().expect("plugin should exist");
        assert_eq!(got.source_kind, "npm");
        assert_eq!(got.source_spec, "npm:@acme/openforge-plugin@1.2.3");
        assert_eq!(got.package_metadata, plugin.package_metadata);
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
    fn is_plugin_enabled_propagates_query_errors() {
        let (db, _tmp) = make_test_db("plugins_enabled_query_error");
        {
            let conn = db.connection();
            let conn = conn.lock().unwrap();
            conn.execute("DROP TABLE project_plugins", []).unwrap();
        }

        assert!(db.is_plugin_enabled("proj1", "missing").is_err());
    }

    #[test]
    fn reinstall_plugin_preserves_project_enabled_state() {
        let (db, _tmp) = make_test_db("plugins_reinstall_preserves_enabled");
        let mut plugin = sample_plugin("upgraded");
        db.install_plugin(&plugin).unwrap();
        db.set_plugin_enabled("proj1", "upgraded", true).unwrap();

        plugin.version = "2.0.0".to_string();
        plugin.installed_at = 2000;
        db.install_plugin(&plugin).unwrap();

        assert!(db.is_plugin_enabled("proj1", "upgraded").unwrap());
        assert_eq!(db.get_plugin("upgraded").unwrap().unwrap().version, "2.0.0");
    }

    #[test]
    fn plugin_storage_round_trip() {
        let (db, _tmp) = make_test_db("plugins_storage_round_trip");
        db.install_plugin(&sample_plugin("plugin-a")).unwrap();
        db.install_plugin(&sample_plugin("plugin-b")).unwrap();

        assert!(db
            .get_plugin_storage("plugin-a", "global", None, "settings")
            .unwrap()
            .is_none());

        db.set_plugin_storage(
            "plugin-a",
            "global",
            None,
            "settings",
            "{\"theme\":\"dark\"}",
        )
        .unwrap();
        db.set_plugin_storage(
            "plugin-a",
            "project",
            Some("project-1"),
            "repo",
            "{\"name\":\"app\"}",
        )
        .unwrap();
        db.set_plugin_storage(
            "plugin-a",
            "task",
            Some("task-1"),
            "reviewState",
            "{\"viewedFiles\":[]}",
        )
        .unwrap();
        db.set_plugin_storage(
            "plugin-b",
            "global",
            None,
            "settings",
            "{\"theme\":\"light\"}",
        )
        .unwrap();

        assert_eq!(
            db.get_plugin_storage("plugin-a", "global", None, "settings")
                .unwrap(),
            Some("{\"theme\":\"dark\"}".to_string())
        );
        assert_eq!(
            db.get_plugin_storage("plugin-a", "project", Some("project-1"), "repo")
                .unwrap(),
            Some("{\"name\":\"app\"}".to_string())
        );
        assert!(db
            .get_plugin_storage("plugin-a", "project", Some("project-2"), "repo")
            .unwrap()
            .is_none());
        assert!(db
            .get_plugin_storage("plugin-b", "global", None, "repo")
            .unwrap()
            .is_none());

        db.delete_plugin_storage("plugin-a", "project", Some("project-1"), "repo")
            .unwrap();
        assert!(db
            .get_plugin_storage("plugin-a", "project", Some("project-1"), "repo")
            .unwrap()
            .is_none());
    }
}
