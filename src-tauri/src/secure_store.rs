const SERVICE_NAME: &str = "openforge";
const SECRET_KEYS: &[&str] = &["github_token", "jira_api_token"];

pub fn is_secret(key: &str) -> bool {
    SECRET_KEYS.contains(&key)
}

pub fn get_secret(key: &str) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(SERVICE_NAME, key)
        .map_err(|e| format!("Failed to create keyring entry for '{}': {}", key, e))?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!(
            "Failed to get secret '{}' from keychain: {}",
            key, e
        )),
    }
}

pub fn set_secret(key: &str, value: &str) -> Result<(), String> {
    if value.is_empty() {
        return delete_secret(key);
    }
    let entry = keyring::Entry::new(SERVICE_NAME, key)
        .map_err(|e| format!("Failed to create keyring entry for '{}': {}", key, e))?;
    entry
        .set_password(value)
        .map_err(|e| format!("Failed to store secret '{}' in keychain: {}", key, e))
}

pub fn delete_secret(key: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE_NAME, key)
        .map_err(|e| format!("Failed to create keyring entry for '{}': {}", key, e))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!(
            "Failed to delete secret '{}' from keychain: {}",
            key, e
        )),
    }
}

pub fn migrate_from_db(db: &crate::db::Database) -> Result<(), String> {
    for &key in SECRET_KEYS {
        let db_value = db
            .get_config(key)
            .map_err(|e| format!("Failed to read '{}' from DB during migration: {}", key, e))?;

        let value = match db_value {
            Some(v) if !v.is_empty() => v,
            _ => continue,
        };

        let existing = get_secret(key)?;
        if existing.is_none() {
            set_secret(key, &value)?;
            println!("[secure_store] Migrated '{}' from DB to keychain", key);
        }

        db.set_config(key, "")
            .map_err(|e| format!("Failed to clear '{}' from DB after migration: {}", key, e))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_key(suffix: &str) -> String {
        format!("test_openforge_{}_pid{}", suffix, std::process::id())
    }

    fn keychain_available() -> bool {
        let key = test_key("probe");
        let result = set_secret(&key, "probe");
        let _ = delete_secret(&key);
        result.is_ok()
    }

    #[test]
    fn test_is_secret() {
        assert!(is_secret("github_token"));
        assert!(is_secret("jira_api_token"));
        assert!(!is_secret("github_username"));
        assert!(!is_secret("jira_base_url"));
        assert!(!is_secret("jira_username"));
        assert!(!is_secret("opencode_port"));
        assert!(!is_secret(""));
    }

    #[test]
    fn test_set_and_get_secret() {
        if !keychain_available() {
            return;
        }

        let key = test_key("set_get");
        let _ = delete_secret(&key);

        set_secret(&key, "super_secret_value_abc123").expect("set_secret should succeed");
        let retrieved = get_secret(&key).expect("get_secret should succeed");
        assert_eq!(retrieved, Some("super_secret_value_abc123".to_string()));

        delete_secret(&key).expect("cleanup should succeed");
    }

    #[test]
    fn test_get_nonexistent_secret() {
        if !keychain_available() {
            return;
        }

        let key = test_key("nonexistent");
        let _ = delete_secret(&key);

        let result = get_secret(&key).expect("get_secret should succeed for nonexistent key");
        assert_eq!(result, None);
    }

    #[test]
    fn test_delete_secret() {
        if !keychain_available() {
            return;
        }

        let key = test_key("delete");
        set_secret(&key, "value_to_delete").expect("set_secret should succeed");

        let retrieved = get_secret(&key).expect("get_secret should succeed");
        assert!(retrieved.is_some());

        delete_secret(&key).expect("delete_secret should succeed");

        let retrieved = get_secret(&key).expect("get_secret should succeed after delete");
        assert_eq!(retrieved, None);
    }

    #[test]
    fn test_set_empty_deletes() {
        if !keychain_available() {
            return;
        }

        let key = test_key("empty_deletes");
        set_secret(&key, "initial_value").expect("set_secret should succeed");

        set_secret(&key, "").expect("set_secret with empty should succeed");

        let retrieved = get_secret(&key).expect("get_secret should succeed after empty set");
        assert_eq!(retrieved, None);

        let _ = delete_secret(&key);
    }

    #[test]
    fn test_delete_nonexistent_is_ok() {
        if !keychain_available() {
            return;
        }

        let key = test_key("delete_nonexistent");
        let _ = delete_secret(&key);

        let result = delete_secret(&key);
        assert!(
            result.is_ok(),
            "delete_secret on nonexistent key should be Ok, got: {:?}",
            result
        );
    }
}
