//! Shared OpenCode provider DTOs.
//!
//! OpenForge no longer owns an `opencode serve` lifecycle after the plugin-hook
//! migration. OpenCode work runs through `opencode run` PTYs with events posted
//! by the installed OpenCode plugin hook, so this module intentionally contains
//! only the local discovery/model DTOs shared by providers and command discovery.

use serde::{Deserialize, Serialize};

/// Request to send a prompt asynchronously.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptModel {
    #[serde(rename = "providerID")]
    pub provider_id: String,
    #[serde(rename = "modelID")]
    pub model_id: String,
}

/// Agent information.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AgentInfo {
    pub name: String,
    #[serde(default)]
    pub hidden: Option<bool>,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ProviderModelInfo {
    pub provider_id: String,
    pub model_id: String,
    pub name: String,
}

/// Command information.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CommandInfo {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub agent: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

/// Skill information — enriched from CommandInfo with template content and level.
#[derive(Debug, Clone, Serialize)]
pub struct SkillInfo {
    pub name: String,
    pub description: Option<String>,
    pub agent: Option<String>,
    pub template: Option<String>,
    pub level: String,             // "project" or "user"
    pub source_dir: String,        // ".agents", ".claude", ".opencode", or ".pi"
    pub file_name: Option<String>, // direct root markdown file name for provider-specific skills
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_prompt_model_serialization() {
        let model = PromptModel {
            provider_id: "anthropic".to_string(),
            model_id: "claude-sonnet".to_string(),
        };

        let value = serde_json::to_value(&model).unwrap();
        assert_eq!(value["providerID"], "anthropic");
        assert_eq!(value["modelID"], "claude-sonnet");
        assert!(value.get("provider_id").is_none());
        assert!(value.get("model_id").is_none());
    }
}
