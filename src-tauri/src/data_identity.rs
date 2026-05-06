use serde::Deserialize;
use std::sync::OnceLock;

const IDENTITY_MANIFEST: &str = include_str!("../../openforge-data-identity.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenForgeDataIdentity {
    data_identity: DataIdentity,
    legacy_sources: LegacySources,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DataIdentity {
    app_data_identifier: String,
    app_data_dir_env: String,
    database_filenames: BuildModeNames,
    keychain: KeychainIdentity,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KeychainIdentity {
    debug_service: String,
    release_service: String,
    secret_accounts: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacySources {
    home_dir_names: LegacyPair,
    data_dir_names: LegacyPair,
    app_identifiers: LegacyAppIdentifiers,
    database_filenames: BuildModeNames,
}

#[derive(Debug, Deserialize)]
struct LegacyPair {
    old: String,
    current: String,
}

#[derive(Debug, Deserialize)]
struct LegacyAppIdentifiers {
    old: String,
}

#[derive(Debug, Deserialize)]
struct BuildModeNames {
    debug: String,
    release: String,
}

static IDENTITY: OnceLock<OpenForgeDataIdentity> = OnceLock::new();

pub(crate) fn manifest() -> &'static OpenForgeDataIdentity {
    IDENTITY.get_or_init(|| {
        serde_json::from_str(IDENTITY_MANIFEST)
            .expect("openforge-data-identity.json must match OpenForgeDataIdentity schema")
    })
}

pub(crate) fn app_data_identifier() -> &'static str {
    &manifest().data_identity.app_data_identifier
}

pub(crate) fn app_data_dir_env() -> &'static str {
    &manifest().data_identity.app_data_dir_env
}

pub(crate) fn database_filename() -> &'static str {
    database_filename_for_build(cfg!(debug_assertions))
}

pub(crate) fn database_filename_for_build(debug: bool) -> &'static str {
    let names = &manifest().data_identity.database_filenames;
    if debug {
        &names.debug
    } else {
        &names.release
    }
}

pub(crate) fn keychain_service_name() -> &'static str {
    keychain_service_name_for_build(cfg!(debug_assertions))
}

pub(crate) fn keychain_service_name_for_build(debug: bool) -> &'static str {
    let keychain = &manifest().data_identity.keychain;
    if debug {
        &keychain.debug_service
    } else {
        &keychain.release_service
    }
}

pub(crate) fn is_secret_account(key: &str) -> bool {
    manifest()
        .data_identity
        .keychain
        .secret_accounts
        .iter()
        .any(|account| account == key)
}

pub(crate) fn legacy_home_dir_name() -> &'static str {
    &manifest().legacy_sources.home_dir_names.old
}

pub(crate) fn current_home_dir_name() -> &'static str {
    &manifest().legacy_sources.home_dir_names.current
}

pub(crate) fn legacy_data_dir_name() -> &'static str {
    &manifest().legacy_sources.data_dir_names.old
}

pub(crate) fn current_data_dir_name() -> &'static str {
    &manifest().legacy_sources.data_dir_names.current
}

pub(crate) fn legacy_app_identifier() -> &'static str {
    &manifest().legacy_sources.app_identifiers.old
}

pub(crate) fn legacy_database_filename_for_build(debug: bool) -> &'static str {
    let names = &manifest().legacy_sources.database_filenames;
    if debug {
        &names.debug
    } else {
        &names.release
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_identity_manifest_preserves_current_data_values() {
        assert_eq!(app_data_identifier(), "com.opencode.openforge");
        assert_eq!(app_data_dir_env(), "OPENFORGE_APP_DATA_DIR");
        assert_eq!(database_filename_for_build(false), "openforge.db");
        assert_eq!(database_filename_for_build(true), "openforge_dev.db");
        assert_eq!(keychain_service_name_for_build(false), "openforge");
        assert_eq!(keychain_service_name_for_build(true), "openforge-dev");
        assert!(is_secret_account("github_token"));
        assert!(!is_secret_account("github_username"));
    }

    #[test]
    fn data_identity_manifest_preserves_legacy_migration_sources() {
        assert_eq!(legacy_home_dir_name(), ".ai-command-center");
        assert_eq!(current_home_dir_name(), ".openforge");
        assert_eq!(legacy_data_dir_name(), "ai-command-center");
        assert_eq!(current_data_dir_name(), "openforge");
        assert_eq!(legacy_app_identifier(), "com.opencode.ai-command-center");
        assert_eq!(
            legacy_database_filename_for_build(false),
            "ai_command_center.db"
        );
        assert_eq!(
            legacy_database_filename_for_build(true),
            "ai_command_center_dev.db"
        );
    }

    #[test]
    fn data_identity_manifest_makes_package_identity_split_explicit() {
        let value: serde_json::Value = serde_json::from_str(IDENTITY_MANIFEST).unwrap();
        let package = &value["packageIdentity"];
        assert_eq!(package["appName"], "Open Forge");
        assert_eq!(package["electronAppPackageName"], "openforge-electron-app");
        assert_eq!(package["bundleIdentifier"], "com.openforge.app.electron");
        assert_eq!(package["electronTemplateAppName"], "Electron.app");
        assert_ne!(package["bundleIdentifier"], app_data_identifier());
    }
}
