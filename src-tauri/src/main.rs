// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use anyhow::{Context, Result};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, PhysicalSize, Window};
use tokio::time::interval;

// ============================================================================
// STATE TYPES
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppState {
    score: i32,
    tasks: Vec<Task>,
    stats: Stats,
    meta: Meta,
    preferences: Preferences,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Task {
    id: String,
    title: String,
    created_at: String,
    updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    time_assigned_seconds: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    remaining_seconds: Option<i32>,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    is_paused: Option<bool>,
    history: Vec<TaskHistoryEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskHistoryEntry {
    r#type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    amount_seconds: Option<i32>,
    at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Stats {
    total_completed: i32,
    today_completed: i32,
    last_completion_date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Meta {
    last_saved_at: String,
    app_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Preferences {
    always_on_top: bool,
}

// ============================================================================
// STATE PERSISTENCE
// ============================================================================

fn get_state_file_path() -> Result<PathBuf> {
    let app_data_dir = tauri::api::path::data_dir()
        .context("Failed to get app data directory")?
        .join("timebound");

    // Create directory if it doesn't exist
    fs::create_dir_all(&app_data_dir).context("Failed to create app data directory")?;

    Ok(app_data_dir.join("state.json"))
}

fn create_empty_state() -> AppState {
    let now = Utc::now().to_rfc3339();
    AppState {
        score: 0,
        tasks: vec![],
        stats: Stats {
            total_completed: 0,
            today_completed: 0,
            last_completion_date: String::new(),
        },
        meta: Meta {
            last_saved_at: now.clone(),
            app_version: "1.0.0".to_string(),
        },
        preferences: Preferences {
            always_on_top: true,
        },
    }
}

fn load_state_from_disk() -> Result<AppState> {
    let state_path = get_state_file_path()?;

    if !state_path.exists() {
        println!("State file does not exist, creating new state");
        return Ok(create_empty_state());
    }

    // Try to load main state file
    match fs::read_to_string(&state_path) {
        Ok(contents) => {
            match serde_json::from_str::<AppState>(&contents) {
                Ok(state) => {
                    println!("Successfully loaded state from disk");
                    Ok(state)
                }
                Err(e) => {
                    eprintln!("Failed to parse state file: {}", e);
                    // Try backup file
                    let backup_path = state_path.with_extension("json.bak");
                    if backup_path.exists() {
                        println!("Attempting to load from backup");
                        let backup_contents = fs::read_to_string(&backup_path)?;
                        let backup_state = serde_json::from_str::<AppState>(&backup_contents)
                            .context("Failed to parse backup state file")?;
                        println!("Successfully loaded state from backup");
                        Ok(backup_state)
                    } else {
                        println!("No backup available, creating new state");
                        Ok(create_empty_state())
                    }
                }
            }
        }
        Err(e) => {
            eprintln!("Failed to read state file: {}", e);
            Ok(create_empty_state())
        }
    }
}

fn save_state_to_disk(state: &AppState) -> Result<AppState> {
    let state_path = get_state_file_path()?;
    let temp_path = state_path.with_extension("json.tmp");
    let backup_path = state_path.with_extension("json.bak");

    // Update meta with current timestamp
    let mut state_to_save = state.clone();
    state_to_save.meta.last_saved_at = Utc::now().to_rfc3339();
    state_to_save.meta.app_version = "1.0.0".to_string();

    // Serialize state with pretty printing
    let json = serde_json::to_string_pretty(&state_to_save)
        .context("Failed to serialize state")?;

    // Atomic write pattern:
    // 1. Write to temp file
    fs::write(&temp_path, &json).context("Failed to write temp state file")?;

    // 2. If main file exists, back it up
    if state_path.exists() {
        fs::copy(&state_path, &backup_path).context("Failed to create backup")?;
    }

    // 3. Rename temp to main (atomic operation)
    fs::rename(&temp_path, &state_path).context("Failed to rename temp file to state file")?;

    println!("State saved successfully");
    Ok(state_to_save)
}

// ============================================================================
// TAURI COMMANDS
// ============================================================================

#[tauri::command]
async fn load_state() -> Result<AppState, String> {
    load_state_from_disk().map_err(|e| format!("Failed to load state: {}", e))
}

#[tauri::command]
async fn save_state(state: AppState) -> Result<AppState, String> {
    save_state_to_disk(&state).map_err(|e| format!("Failed to save state: {}", e))
}

#[tauri::command]
async fn set_always_on_top(window: Window, enabled: bool) -> Result<(), String> {
    window
        .set_always_on_top(enabled)
        .map_err(|e| format!("Failed to set always on top: {}", e))?;

    // Apply window size constraints based on always-on-top setting
    apply_window_constraints(&window, enabled)?;

    Ok(())
}

const FOCUS_MODE_WIDTH: f64 = 260.0;
const FOCUS_MODE_HEIGHT: f64 = 92.0;

#[tauri::command]
async fn enable_focus_mode(window: Window) -> Result<(), String> {
    // Set window to a slim compact bar (logical pixels)
    window
        .set_size(LogicalSize::new(FOCUS_MODE_WIDTH, FOCUS_MODE_HEIGHT))
        .map_err(|e| format!("Failed to set window size: {}", e))?;

    // Move to top-right corner
    if let Some(monitor) = window
        .current_monitor()
        .map_err(|e| format!("Failed to get current monitor: {}", e))?
    {
        let size = monitor.size();
        let scale_factor = monitor.scale_factor();
        let logical_width = size.width as f64 / scale_factor;
        let x = logical_width - FOCUS_MODE_WIDTH;
        let y = 0.0;
        window
            .set_position(LogicalPosition::new(x, y))
            .map_err(|e| format!("Failed to set window position: {}", e))?;
    }

    // Enable always on top
    window
        .set_always_on_top(true)
        .map_err(|e| format!("Failed to set always on top: {}", e))?;

    println!("Focus mode enabled");
    Ok(())
}

#[tauri::command]
async fn disable_focus_mode(window: Window) -> Result<(), String> {
    // Disable always on top
    window
        .set_always_on_top(false)
        .map_err(|e| format!("Failed to disable always on top: {}", e))?;

    // Center the window
    window
        .center()
        .map_err(|e| format!("Failed to center window: {}", e))?;

    // Apply normal window constraints
    apply_window_constraints(&window, false)?;

    println!("Focus mode disabled");
    Ok(())
}


// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

fn apply_window_constraints(window: &Window, _always_on_top: bool) -> Result<(), String> {
    // Remove any max size constraint to allow users to resize freely
    window
        .set_max_size(None::<PhysicalSize<u32>>)
        .map_err(|e| format!("Failed to remove max size constraint: {}", e))?;

    println!("Window constraints removed - window can be resized freely");
    Ok(())
}

// ============================================================================
// TIMER SYSTEM
// ============================================================================

async fn start_timer_loop(app_handle: AppHandle) {
    let mut interval = interval(Duration::from_secs(1));

    loop {
        interval.tick().await;
        let timestamp = chrono::Utc::now().timestamp_millis();

        // Emit timer-tick event to frontend
        if let Err(e) = app_handle.emit_all("timer-tick", timestamp) {
            eprintln!("Failed to emit timer tick: {}", e);
        }
    }
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            load_state,
            save_state,
            set_always_on_top,
            enable_focus_mode,
            disable_focus_mode
        ])
        .setup(|app| {
            let app_handle = app.handle();

            // Get main window and apply constraints
            if let Some(window) = app.get_window("main") {
                // NOTE: NOT applying vibrancy - using pure window transparency + CSS backdrop-filter instead
                // This gives us clean transparency without macOS vibrancy's built-in gray tinting

                // Apply window constraints
                if let Err(e) = apply_window_constraints(&window, false) {
                    eprintln!("Failed to apply initial window constraints: {}", e);
                }

                println!("Window initialized with pure transparency (no vibrancy material)");
            }

            // Start timer loop in background using Tauri's async runtime
            tauri::async_runtime::spawn(async move {
                start_timer_loop(app_handle).await;
            });

            println!("TimeBound Tauri backend initialized");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
