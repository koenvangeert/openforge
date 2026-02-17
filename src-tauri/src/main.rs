// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod opencode_manager;
mod opencode_client;

use std::sync::Mutex;
use tauri::{Manager, State};
use opencode_manager::OpenCodeManager;
use opencode_client::OpenCodeClient;

// ============================================================================
// Tauri Commands
// ============================================================================

/// Get OpenCode server status and API URL
#[tauri::command]
async fn get_opencode_status(
    manager: State<'_, OpenCodeManager>,
    client: State<'_, OpenCodeClient>,
) -> Result<OpenCodeStatus, String> {
    let api_url = manager.api_url();
    
    // Check health via API client
    let health = client
        .health()
        .await
        .map_err(|e| format!("Health check failed: {}", e))?;
    
    Ok(OpenCodeStatus {
        api_url,
        healthy: health.healthy,
        version: health.version,
    })
}

/// Create a new OpenCode session
#[tauri::command]
async fn create_session(
    client: State<'_, OpenCodeClient>,
    title: String,
) -> Result<String, String> {
    client
        .create_session(title)
        .await
        .map_err(|e| format!("Failed to create session: {}", e))
}

/// Send a prompt to an OpenCode session
#[tauri::command]
async fn send_prompt(
    client: State<'_, OpenCodeClient>,
    session_id: String,
    text: String,
) -> Result<serde_json::Value, String> {
    client
        .send_prompt(&session_id, text)
        .await
        .map_err(|e| format!("Failed to send prompt: {}", e))
}

// ============================================================================
// Response Types
// ============================================================================

#[derive(serde::Serialize)]
struct OpenCodeStatus {
    api_url: String,
    healthy: bool,
    version: Option<String>,
}

// ============================================================================
// Main
// ============================================================================

#[tokio::main]
async fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // Get app data directory and initialize database
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");

            let db_path = app_data_dir.join("ai_command_center.db");

            println!("Initializing database at: {:?}", db_path);

            let database = db::Database::new(db_path).expect("Failed to initialize database");

            // Store database in app state for access from commands
            app.manage(Mutex::new(database));

            println!("Database initialized successfully");

            // Start OpenCode server and wait for it to be healthy
            let opencode_manager = tauri::async_runtime::block_on(async {
                OpenCodeManager::start().await
            })
            .expect("Failed to start OpenCode server");

            println!("OpenCode server started at: {}", opencode_manager.api_url());

            // Create OpenCode API client
            let opencode_client = OpenCodeClient::with_base_url(opencode_manager.api_url());

            // Store OpenCode manager and client in app state
            app.manage(opencode_manager);
            app.manage(opencode_client);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_opencode_status,
            create_session,
            send_prompt
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
