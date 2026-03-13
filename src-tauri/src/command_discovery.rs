use std::path::{Path, PathBuf};

/// Represents an installed Claude Code plugin with its metadata.
pub struct InstalledPlugin {
    pub full_key: String, // "everything-claude-code@everything-claude-code"
    pub name: String,     // "everything-claude-code" (for command namespacing)
    pub install_path: PathBuf,
}

/// Represents an active (enabled + installed) Claude Code plugin.
pub struct ActivePlugin {
    pub name: String,       // plugin name for namespacing commands
    pub cache_dir: PathBuf, // resolved install path directory
}

/// Cached result of a full command/agent discovery scan.
pub struct CachedDiscovery {
    pub commands: Vec<crate::opencode_client::CommandInfo>,
    pub agents: Vec<crate::opencode_client::AgentInfo>,
}

/// Parse SKILL.md frontmatter to extract name and description.
/// Frontmatter is YAML between `---` delimiters at the start of the file.
pub fn parse_skill_frontmatter(content: &str) -> (Option<String>, Option<String>) {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return (None, None);
    }
    // Find the closing ---
    let after_first = &trimmed[3..];
    let end_idx = match after_first.find("\n---") {
        Some(idx) => idx,
        None => return (None, None),
    };
    let frontmatter = &after_first[..end_idx];

    let mut name: Option<String> = None;
    let mut description = String::new();
    let mut in_description = false;

    for line in frontmatter.lines() {
        let trimmed_line = line.trim();
        if trimmed_line.starts_with("name:") {
            name = Some(trimmed_line.trim_start_matches("name:").trim().to_string());
            in_description = false;
        } else if trimmed_line.starts_with("description:") {
            let val = trimmed_line.trim_start_matches("description:").trim();
            if val == "|" || val == ">" || val.is_empty() {
                // Multi-line description follows
                in_description = true;
            } else {
                description = val.to_string();
            }
        } else if in_description {
            if !trimmed_line.is_empty() && (line.starts_with(' ') || line.starts_with('\t')) {
                if !description.is_empty() {
                    description.push(' ');
                }
                description.push_str(trimmed_line);
            } else {
                in_description = false;
            }
        }
    }

    let desc = if description.is_empty() {
        None
    } else {
        Some(description)
    };
    (name, desc)
}

/// Scan a skills directory (e.g. `.claude/skills/` or `.opencode/skills/`) for SKILL.md files.
/// Returns a Vec of SkillInfo with the given level and source_dir.
pub fn scan_skills_directory(dir: &Path, level: &str, source_dir: &str) -> Vec<crate::opencode_client::SkillInfo> {
    let mut skills = Vec::new();
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return skills,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let skill_file = path.join("SKILL.md");
        if !skill_file.exists() {
            continue;
        }
        let content = match std::fs::read_to_string(&skill_file) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let dir_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        let (fm_name, fm_desc) = parse_skill_frontmatter(&content);
        let name = fm_name.unwrap_or(dir_name);
        skills.push(crate::opencode_client::SkillInfo {
            name,
            description: fm_desc,
            agent: None,
            template: Some(content),
            level: level.to_string(),
            source_dir: source_dir.to_string(),
        });
    }
    skills
}

/// Scan a commands directory (e.g. `.claude/commands/`) for `.md` files.
/// Each `.md` file is a Claude Code custom command.
/// Returns a Vec of CommandInfo with source="command".
pub fn scan_commands_directory(dir: &Path) -> Vec<crate::opencode_client::CommandInfo> {
    let mut commands = Vec::new();
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return commands,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or_default();
        if ext != "md" {
            continue;
        }
        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let file_stem = match path.file_stem().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        let (fm_name, fm_desc) = parse_skill_frontmatter(&content);
        let name = fm_name.unwrap_or(file_stem);
        commands.push(crate::opencode_client::CommandInfo {
            name,
            description: fm_desc,
            source: Some("command".to_string()),
            agent: None,
            extra: serde_json::Map::new(),
        });
    }
    commands
}

/// Search tracked files in a git repository by path substring (case-insensitive).
/// Returns up to `limit` matching file paths.
pub fn search_project_files(project_path: &str, query: &str, limit: usize) -> Vec<String> {
    let repo = match git2::Repository::open(project_path) {
        Ok(r) => r,
        Err(_) => return vec![],
    };
    let index = match repo.index() {
        Ok(i) => i,
        Err(_) => return vec![],
    };
    let lower_query = query.to_lowercase();
    let mut results = Vec::new();
    for entry in index.iter() {
        if results.len() >= limit {
            break;
        }
        let path = std::str::from_utf8(&entry.path).unwrap_or_default();
        if path.to_lowercase().contains(&lower_query) {
            results.push(path.to_string());
        }
    }
    results
}

/// Parse installed plugins from Claude Code's installed_plugins.json format.
/// Returns empty vec on any parse error (malformed JSON, missing keys, etc).
pub fn parse_installed_plugins(json_str: &str) -> Vec<InstalledPlugin> {
    let value: serde_json::Value = match serde_json::from_str(json_str) {
        Ok(v) => v,
        Err(_) => return vec![],
    };

    let plugins_obj = match value.get("plugins").and_then(|v| v.as_object()) {
        Some(obj) => obj,
        None => return vec![],
    };

    let mut result = Vec::new();
    for (full_key, installations) in plugins_obj {
        let installations_array = match installations.as_array() {
            Some(arr) => arr,
            None => continue,
        };

        if installations_array.is_empty() {
            continue;
        }

        let first_install = &installations_array[0];
        let install_path = match first_install.get("installPath").and_then(|v| v.as_str()) {
            Some(path) => PathBuf::from(path),
            None => continue,
        };

        let name = full_key.split('@').next().unwrap_or("").to_string();
        if name.is_empty() {
            continue;
        }

        result.push(InstalledPlugin {
            full_key: full_key.clone(),
            name,
            install_path,
        });
    }

    result
}

/// Get enabled plugin keys from Claude Code's settings.json.
/// Returns keys where enabledPlugins[key] == true.
/// Returns empty vec on any parse error.
pub fn get_enabled_plugins(settings_json: &str) -> Vec<String> {
    let value: serde_json::Value = match serde_json::from_str(settings_json) {
        Ok(v) => v,
        Err(_) => return vec![],
    };

    let enabled_obj = match value.get("enabledPlugins").and_then(|v| v.as_object()) {
        Some(obj) => obj,
        None => return vec![],
    };

    let mut result = Vec::new();
    for (key, val) in enabled_obj {
        if val.as_bool() == Some(true) {
            result.push(key.clone());
        }
    }

    result
}

/// Resolve active plugins by reading installed_plugins.json and settings.json from home_dir.
/// Returns only plugins that are both installed AND enabled.
/// Returns empty vec if either file is missing or unreadable.
pub fn resolve_active_plugins(home_dir: &Path) -> Vec<ActivePlugin> {
    let installed_file = home_dir
        .join(".claude")
        .join("plugins")
        .join("installed_plugins.json");
    let settings_file = home_dir.join(".claude").join("settings.json");

    let installed_json = match std::fs::read_to_string(&installed_file) {
        Ok(content) => content,
        Err(_) => return vec![],
    };

    let settings_json = match std::fs::read_to_string(&settings_file) {
        Ok(content) => content,
        Err(_) => return vec![],
    };

    let installed = parse_installed_plugins(&installed_json);
    let enabled_keys = get_enabled_plugins(&settings_json);

    let enabled_set: std::collections::HashSet<_> = enabled_keys.into_iter().collect();

    let mut result = Vec::new();
    for plugin in installed {
        if enabled_set.contains(&plugin.full_key) {
            result.push(ActivePlugin {
                name: plugin.name,
                cache_dir: plugin.install_path,
            });
        }
    }

    result
}

/// Returns a static curated list of built-in Claude Code slash commands.
pub fn builtin_claude_commands() -> Vec<crate::opencode_client::CommandInfo> {
    let commands = [
        ("compact", "Compact conversation to reduce context usage"),
        ("init", "Initialize project with CLAUDE.md"),
        ("review", "Review current changes"),
        ("bug", "Report a bug in Claude Code"),
        ("config", "Open Claude Code configuration"),
        ("cost", "Show token usage and cost"),
        ("clear", "Clear conversation history"),
        ("help", "Show available commands"),
        ("vim", "Toggle vim mode"),
        ("model", "Switch AI model"),
        ("permissions", "View and manage tool permissions"),
        ("memory", "Edit CLAUDE.md memory file"),
        ("doctor", "Check health of your Claude Code installation"),
        (
            "terminal-setup",
            "Install shift+enter key binding for terminal",
        ),
        ("login", "Login to your Anthropic account"),
        ("logout", "Logout from your Anthropic account"),
    ];
    commands
        .iter()
        .map(|(name, desc)| crate::opencode_client::CommandInfo {
            name: name.to_string(),
            description: Some(desc.to_string()),
            source: Some("builtin".to_string()),
            agent: None,
            extra: serde_json::Map::new(),
        })
        .collect()
}

/// Scan plugin directories for command definitions.
/// For each plugin, looks in {cache_dir}/commands/ for .md files.
/// Returns CommandInfo with namespaced names: "{plugin_name}:{filename_stem}".
/// Returns empty vec if commands/ directory doesn't exist.
pub fn scan_plugin_commands(
    active_plugins: &[ActivePlugin],
) -> Vec<crate::opencode_client::CommandInfo> {
    let mut commands = Vec::new();
    for plugin in active_plugins {
        let commands_dir = plugin.cache_dir.join("commands");
        let entries = match std::fs::read_dir(&commands_dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or_default();
            if ext != "md" {
                continue;
            }
            let content = match std::fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue,
            };
            let file_stem = match path.file_stem().and_then(|n| n.to_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };
            let (_, fm_desc) = parse_skill_frontmatter(&content);
            let name = format!("{}:{}", plugin.name, file_stem);
            commands.push(crate::opencode_client::CommandInfo {
                name,
                description: fm_desc,
                source: Some("plugin".to_string()),
                agent: None,
                extra: serde_json::Map::new(),
            });
        }
    }
    commands.sort_by(|a, b| a.name.cmp(&b.name));
    commands
}

/// Scan plugin directories for agent definitions.
/// For each plugin, looks in {cache_dir}/agents/ for .md files.
/// Returns AgentInfo with names from frontmatter or filename stem (NOT namespaced).
/// Returns empty vec if agents/ directory doesn't exist.
pub fn scan_plugin_agents(
    active_plugins: &[ActivePlugin],
) -> Vec<crate::opencode_client::AgentInfo> {
    let mut agents = Vec::new();
    for plugin in active_plugins {
        let agents_dir = plugin.cache_dir.join("agents");
        let entries = match std::fs::read_dir(&agents_dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or_default();
            if ext != "md" {
                continue;
            }
            let content = match std::fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue,
            };
            let file_stem = match path.file_stem().and_then(|n| n.to_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };
            let (fm_name, _) = parse_skill_frontmatter(&content);
            let name = fm_name.unwrap_or(file_stem);
            agents.push(crate::opencode_client::AgentInfo {
                name,
                hidden: None,
                mode: None,
                extra: serde_json::Map::new(),
            });
        }
    }
    agents.sort_by(|a, b| a.name.cmp(&b.name));
    agents
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Test fixtures ────────────────────────────────────────────────────────

    const SAMPLE_INSTALLED: &str = r#"{
  "version": 2,
  "plugins": {
    "everything-claude-code@everything-claude-code": [
      {
        "installPath": "/fake/cache/everything-claude-code/everything-claude-code/1.8.0",
        "version": "1.8.0"
      }
    ],
    "typescript-lsp@claude-plugins-official": [
      {
        "installPath": "/fake/cache/claude-plugins-official/typescript-lsp/1.0.0",
        "version": "1.0.0"
      }
    ]
  }
}"#;

    const SAMPLE_SETTINGS: &str = r#"{
  "enabledPlugins": {
    "everything-claude-code@everything-claude-code": true,
    "typescript-lsp@claude-plugins-official": false
  }
}"#;

    // ── parse_installed_plugins ──────────────────────────────────────────────

    #[test]
    fn test_parse_installed_plugins_happy_path() {
        let plugins = parse_installed_plugins(SAMPLE_INSTALLED);
        assert_eq!(plugins.len(), 2);

        // Sort by name for consistent ordering
        let mut plugins = plugins;
        plugins.sort_by(|a, b| a.name.cmp(&b.name));

        // First plugin: everything-claude-code
        assert_eq!(plugins[0].name, "everything-claude-code");
        assert_eq!(
            plugins[0].full_key,
            "everything-claude-code@everything-claude-code"
        );
        assert_eq!(
            plugins[0].install_path,
            PathBuf::from("/fake/cache/everything-claude-code/everything-claude-code/1.8.0")
        );

        // Second plugin: typescript-lsp
        assert_eq!(plugins[1].name, "typescript-lsp");
        assert_eq!(
            plugins[1].full_key,
            "typescript-lsp@claude-plugins-official"
        );
        assert_eq!(
            plugins[1].install_path,
            PathBuf::from("/fake/cache/claude-plugins-official/typescript-lsp/1.0.0")
        );
    }

    #[test]
    fn test_parse_installed_plugins_empty_json() {
        let result = parse_installed_plugins("{}");
        assert!(result.is_empty());
    }

    #[test]
    fn test_parse_installed_plugins_malformed_json() {
        let result = parse_installed_plugins("not json");
        assert!(result.is_empty());
    }

    #[test]
    fn test_parse_installed_plugins_missing_plugins_key() {
        let result = parse_installed_plugins(r#"{"version": 1}"#);
        assert!(result.is_empty());
    }

    // ── get_enabled_plugins ──────────────────────────────────────────────────

    #[test]
    fn test_get_enabled_plugins_happy_path() {
        let enabled = get_enabled_plugins(SAMPLE_SETTINGS);
        assert_eq!(enabled.len(), 1);
        assert_eq!(enabled[0], "everything-claude-code@everything-claude-code");
    }

    #[test]
    fn test_get_enabled_plugins_empty_object() {
        let result = get_enabled_plugins(r#"{"enabledPlugins": {}}"#);
        assert!(result.is_empty());
    }

    #[test]
    fn test_get_enabled_plugins_malformed() {
        let result = get_enabled_plugins("not json");
        assert!(result.is_empty());
    }

    #[test]
    fn test_get_enabled_plugins_missing_key() {
        let result = get_enabled_plugins("{}");
        assert!(result.is_empty());
    }

    // ── resolve_active_plugins ───────────────────────────────────────────────

    #[test]
    fn test_resolve_active_plugins_filters_by_enabled() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();

        // Create .claude/plugins/ directory structure
        let plugins_dir = home.join(".claude").join("plugins");
        std::fs::create_dir_all(&plugins_dir).unwrap();

        // Write installed_plugins.json
        let installed_file = plugins_dir.join("installed_plugins.json");
        std::fs::write(&installed_file, SAMPLE_INSTALLED).unwrap();

        // Write settings.json
        let settings_file = home.join(".claude").join("settings.json");
        std::fs::write(&settings_file, SAMPLE_SETTINGS).unwrap();

        let active = resolve_active_plugins(home);

        // Only "everything-claude-code@everything-claude-code" is enabled (true)
        // "typescript-lsp@claude-plugins-official" is disabled (false)
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].name, "everything-claude-code");
        assert_eq!(
            active[0].cache_dir,
            PathBuf::from("/fake/cache/everything-claude-code/everything-claude-code/1.8.0")
        );
    }

    #[test]
    fn test_resolve_active_plugins_missing_installed_file() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();

        // Create .claude/ but no installed_plugins.json
        std::fs::create_dir_all(home.join(".claude")).unwrap();

        // Write settings.json
        let settings_file = home.join(".claude").join("settings.json");
        std::fs::write(&settings_file, SAMPLE_SETTINGS).unwrap();

        let active = resolve_active_plugins(home);
        assert!(active.is_empty());
    }

    #[test]
    fn test_resolve_active_plugins_missing_settings_file() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();

        // Create .claude/plugins/ with installed_plugins.json
        let plugins_dir = home.join(".claude").join("plugins");
        std::fs::create_dir_all(&plugins_dir).unwrap();
        let installed_file = plugins_dir.join("installed_plugins.json");
        std::fs::write(&installed_file, SAMPLE_INSTALLED).unwrap();

        // No settings.json

        let active = resolve_active_plugins(home);
        assert!(active.is_empty());
    }

    // ── scan_commands_directory ──────────────────────────────────────────────

    #[test]
    fn test_scan_commands_directory_happy_path() {
        let dir = tempfile::tempdir().unwrap();

        // File 1: frontmatter with name + description
        let file1 = dir.path().join("my-command.md");
        std::fs::write(
            &file1,
            "---\nname: custom-name\ndescription: A custom description\n---\n# Body",
        )
        .unwrap();

        // File 2: frontmatter with only description (name falls back to filename)
        let file2 = dir.path().join("another-cmd.md");
        std::fs::write(&file2, "---\ndescription: Another description\n---\n# Body").unwrap();

        let mut commands = scan_commands_directory(dir.path());
        commands.sort_by(|a, b| a.name.cmp(&b.name));

        assert_eq!(commands.len(), 2);

        // "another-cmd" (filename fallback)
        assert_eq!(commands[0].name, "another-cmd");
        assert_eq!(
            commands[0].description,
            Some("Another description".to_string())
        );
        assert_eq!(commands[0].source, Some("command".to_string()));

        // "custom-name" (from frontmatter)
        assert_eq!(commands[1].name, "custom-name");
        assert_eq!(
            commands[1].description,
            Some("A custom description".to_string())
        );
        assert_eq!(commands[1].source, Some("command".to_string()));
    }

    #[test]
    fn test_scan_commands_directory_nonexistent() {
        let result = scan_commands_directory(Path::new("/nonexistent/path/that/does/not/exist"));
        assert!(result.is_empty());
    }

    #[test]
    fn test_scan_commands_frontmatter_name_fallback() {
        let dir = tempfile::tempdir().unwrap();

        // File with no `name:` in frontmatter — should use filename stem
        let file = dir.path().join("fallback-name.md");
        std::fs::write(&file, "---\ndescription: Some desc\n---\n# Content").unwrap();

        let commands = scan_commands_directory(dir.path());
        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].name, "fallback-name");
        assert_eq!(commands[0].description, Some("Some desc".to_string()));
        assert_eq!(commands[0].source, Some("command".to_string()));
    }

    // ── search_project_files ─────────────────────────────────────────────────

    #[test]
    fn test_search_project_files_happy_path() {
        let dir = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(dir.path()).unwrap();

        // Create a file and add it to the index
        let file_path = dir.path().join("src").join("main.rs");
        std::fs::create_dir_all(file_path.parent().unwrap()).unwrap();
        std::fs::write(&file_path, "fn main() {}").unwrap();

        let mut index = repo.index().unwrap();
        index.add_path(Path::new("src/main.rs")).unwrap();
        index.write().unwrap();

        let results = search_project_files(dir.path().to_str().unwrap(), "main", 10);
        assert!(!results.is_empty());
        assert!(results.iter().any(|p| p.contains("main.rs")));
    }

    #[test]
    fn test_search_project_files_limit() {
        let dir = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(dir.path()).unwrap();

        // Add 5 matching files
        let mut index = repo.index().unwrap();
        for i in 0..5 {
            let file_path = dir.path().join(format!("file_{}.rs", i));
            std::fs::write(&file_path, "// content").unwrap();
            index
                .add_path(Path::new(&format!("file_{}.rs", i)))
                .unwrap();
        }
        index.write().unwrap();

        let results = search_project_files(dir.path().to_str().unwrap(), "file_", 2);
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn test_search_project_files_nonexistent() {
        let results = search_project_files("/nonexistent/path/that/does/not/exist", "query", 10);
        assert!(results.is_empty());
    }

    #[test]
    fn test_search_project_files_case_insensitive() {
        let dir = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(dir.path()).unwrap();

        // File with uppercase letters in name
        let file_path = dir.path().join("MyComponent.tsx");
        std::fs::write(&file_path, "// component").unwrap();

        let mut index = repo.index().unwrap();
        index.add_path(Path::new("MyComponent.tsx")).unwrap();
        index.write().unwrap();

        // Query with lowercase — should still find it
        let results = search_project_files(dir.path().to_str().unwrap(), "mycomponent", 10);
        assert!(!results.is_empty());
        assert!(results.iter().any(|p| p.contains("MyComponent.tsx")));
    }

    // ── builtin_claude_commands ──────────────────────────────────────────────

    #[test]
    fn test_builtin_claude_commands() {
        let commands = builtin_claude_commands();

        // Count is between 10 and 20
        assert!(
            commands.len() >= 10,
            "Expected at least 10 commands, got {}",
            commands.len()
        );
        assert!(
            commands.len() <= 20,
            "Expected at most 20 commands, got {}",
            commands.len()
        );

        for cmd in &commands {
            // All have non-empty name
            assert!(!cmd.name.is_empty(), "Command name should not be empty");
            // No slash prefix
            assert!(
                !cmd.name.starts_with('/'),
                "Command name should not start with '/': {}",
                cmd.name
            );
            // All have Some(description)
            assert!(
                cmd.description.is_some(),
                "Command '{}' should have a description",
                cmd.name
            );
            assert!(
                !cmd.description.as_ref().unwrap().is_empty(),
                "Command '{}' description should not be empty",
                cmd.name
            );
            // All have source=Some("builtin")
            assert_eq!(
                cmd.source,
                Some("builtin".to_string()),
                "Command '{}' should have source='builtin'",
                cmd.name
            );
        }
    }

    // ── scan_plugin_commands ─────────────────────────────────────────────

    #[test]
    fn test_scan_plugin_commands_happy_path() {
        let dir = tempfile::tempdir().unwrap();
        let cache_dir = dir.path();

        // Create commands/ directory
        let commands_dir = cache_dir.join("commands");
        std::fs::create_dir_all(&commands_dir).unwrap();

        // File 1: plan.md with frontmatter
        let file1 = commands_dir.join("plan.md");
        std::fs::write(
            &file1,
            "---\nname: plan\ndescription: Create a plan\n---\n# Body",
        )
        .unwrap();

        // File 2: review.md with only description
        let file2 = commands_dir.join("review.md");
        std::fs::write(&file2, "---\ndescription: Review code\n---\n# Body").unwrap();

        let plugins = vec![ActivePlugin {
            name: "everything-claude-code".to_string(),
            cache_dir: cache_dir.to_path_buf(),
        }];

        let mut commands = scan_plugin_commands(&plugins);
        commands.sort_by(|a, b| a.name.cmp(&b.name));

        assert_eq!(commands.len(), 2);

        // "everything-claude-code:plan"
        assert_eq!(commands[0].name, "everything-claude-code:plan");
        assert_eq!(commands[0].description, Some("Create a plan".to_string()));
        assert_eq!(commands[0].source, Some("plugin".to_string()));

        // "everything-claude-code:review"
        assert_eq!(commands[1].name, "everything-claude-code:review");
        assert_eq!(commands[1].description, Some("Review code".to_string()));
        assert_eq!(commands[1].source, Some("plugin".to_string()));
    }

    #[test]
    fn test_scan_plugin_commands_missing_dir() {
        let dir = tempfile::tempdir().unwrap();
        let cache_dir = dir.path();

        // Don't create commands/ directory

        let plugins = vec![ActivePlugin {
            name: "everything-claude-code".to_string(),
            cache_dir: cache_dir.to_path_buf(),
        }];

        let commands = scan_plugin_commands(&plugins);
        assert!(commands.is_empty());
    }

    #[test]
    fn test_scan_plugin_commands_empty_dir() {
        let dir = tempfile::tempdir().unwrap();
        let cache_dir = dir.path();

        // Create empty commands/ directory
        let commands_dir = cache_dir.join("commands");
        std::fs::create_dir_all(&commands_dir).unwrap();

        let plugins = vec![ActivePlugin {
            name: "everything-claude-code".to_string(),
            cache_dir: cache_dir.to_path_buf(),
        }];

        let commands = scan_plugin_commands(&plugins);
        assert!(commands.is_empty());
    }

    #[test]
    fn test_scan_plugin_commands_multiple_plugins() {
        let dir1 = tempfile::tempdir().unwrap();
        let dir2 = tempfile::tempdir().unwrap();

        // Plugin 1: everything-claude-code with plan.md
        let commands_dir1 = dir1.path().join("commands");
        std::fs::create_dir_all(&commands_dir1).unwrap();
        let file1 = commands_dir1.join("plan.md");
        std::fs::write(&file1, "---\ndescription: Create a plan\n---\n# Body").unwrap();

        // Plugin 2: typescript-lsp with format.md
        let commands_dir2 = dir2.path().join("commands");
        std::fs::create_dir_all(&commands_dir2).unwrap();
        let file2 = commands_dir2.join("format.md");
        std::fs::write(&file2, "---\ndescription: Format code\n---\n# Body").unwrap();

        let plugins = vec![
            ActivePlugin {
                name: "everything-claude-code".to_string(),
                cache_dir: dir1.path().to_path_buf(),
            },
            ActivePlugin {
                name: "typescript-lsp".to_string(),
                cache_dir: dir2.path().to_path_buf(),
            },
        ];

        let mut commands = scan_plugin_commands(&plugins);
        commands.sort_by(|a, b| a.name.cmp(&b.name));

        assert_eq!(commands.len(), 2);

        // "everything-claude-code:plan"
        assert_eq!(commands[0].name, "everything-claude-code:plan");
        assert_eq!(commands[0].description, Some("Create a plan".to_string()));

        // "typescript-lsp:format"
        assert_eq!(commands[1].name, "typescript-lsp:format");
        assert_eq!(commands[1].description, Some("Format code".to_string()));
    }

    // ── scan_plugin_agents ───────────────────────────────────────────────

    #[test]
    fn test_scan_plugin_agents_happy_path() {
        let dir = tempfile::tempdir().unwrap();
        let cache_dir = dir.path();

        // Create agents/ directory
        let agents_dir = cache_dir.join("agents");
        std::fs::create_dir_all(&agents_dir).unwrap();

        // File 1: oracle.md with name in frontmatter
        let file1 = agents_dir.join("oracle.md");
        std::fs::write(
            &file1,
            "---\nname: oracle\ndescription: Expert consultant\n---\n# Body",
        )
        .unwrap();

        // File 2: researcher.md with only description
        let file2 = agents_dir.join("researcher.md");
        std::fs::write(&file2, "---\ndescription: Research expert\n---\n# Body").unwrap();

        let plugins = vec![ActivePlugin {
            name: "everything-claude-code".to_string(),
            cache_dir: cache_dir.to_path_buf(),
        }];

        let mut agents = scan_plugin_agents(&plugins);
        agents.sort_by(|a, b| a.name.cmp(&b.name));

        assert_eq!(agents.len(), 2);

        // "oracle" (from frontmatter name)
        assert_eq!(agents[0].name, "oracle");

        // "researcher" (from filename stem)
        assert_eq!(agents[1].name, "researcher");
    }

    #[test]
    fn test_scan_plugin_agents_missing_dir() {
        let dir = tempfile::tempdir().unwrap();
        let cache_dir = dir.path();

        // Don't create agents/ directory

        let plugins = vec![ActivePlugin {
            name: "everything-claude-code".to_string(),
            cache_dir: cache_dir.to_path_buf(),
        }];

        let agents = scan_plugin_agents(&plugins);
        assert!(agents.is_empty());
    }

    #[test]
    fn test_scan_plugin_agents_multiple_plugins() {
        let dir1 = tempfile::tempdir().unwrap();
        let dir2 = tempfile::tempdir().unwrap();

        // Plugin 1: everything-claude-code with oracle.md
        let agents_dir1 = dir1.path().join("agents");
        std::fs::create_dir_all(&agents_dir1).unwrap();
        let file1 = agents_dir1.join("oracle.md");
        std::fs::write(&file1, "---\nname: oracle\n---\n# Body").unwrap();

        // Plugin 2: typescript-lsp with linter.md
        let agents_dir2 = dir2.path().join("agents");
        std::fs::create_dir_all(&agents_dir2).unwrap();
        let file2 = agents_dir2.join("linter.md");
        std::fs::write(&file2, "---\nname: linter\n---\n# Body").unwrap();

        let plugins = vec![
            ActivePlugin {
                name: "everything-claude-code".to_string(),
                cache_dir: dir1.path().to_path_buf(),
            },
            ActivePlugin {
                name: "typescript-lsp".to_string(),
                cache_dir: dir2.path().to_path_buf(),
            },
        ];

        let mut agents = scan_plugin_agents(&plugins);
        agents.sort_by(|a, b| a.name.cmp(&b.name));

        assert_eq!(agents.len(), 2);

        // "linter"
        assert_eq!(agents[0].name, "linter");

        // "oracle"
        assert_eq!(agents[1].name, "oracle");
    }
}
