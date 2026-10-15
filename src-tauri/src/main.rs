// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "macos")]
mod macos;

use anyhow::{Context, Result};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{
    AppHandle, CustomMenuItem, Manager, PhysicalSize, State, SystemTray, SystemTrayEvent,
    SystemTrayMenu, SystemTrayMenuItem, Window,
};
use tokio::time::interval;

// ============================================================================
// STATE TYPES
// ============================================================================
// Every struct keeps unknown keys in `extra` so fields added on the TS side
// survive a load/save round-trip instead of being silently dropped.

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct AppState {
    score: i32,
    tasks: Vec<Task>,
    stats: Stats,
    meta: Meta,
    preferences: Preferences,
    #[serde(flatten)]
    extra: Map<String, Value>,
}

impl Default for AppState {
    fn default() -> Self {
        AppState {
            score: 0,
            tasks: vec![],
            stats: Stats::default(),
            meta: Meta::default(),
            preferences: Preferences::default(),
            extra: Map::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Task {
    id: String,
    title: String,
    created_at: String,
    updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    completed_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    time_assigned_seconds: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    remaining_seconds: Option<i64>,
    #[serde(default = "default_status")]
    status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    is_paused: Option<bool>,
    #[serde(default)]
    history: Vec<TaskHistoryEntry>,
    #[serde(flatten)]
    extra: Map<String, Value>,
}

fn default_status() -> String {
    "pending".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskHistoryEntry {
    r#type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    amount_seconds: Option<i64>,
    at: String,
    #[serde(flatten)]
    extra: Map<String, Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Stats {
    total_completed: i32,
    today_completed: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_completion_date: Option<String>,
    #[serde(flatten)]
    extra: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Meta {
    last_saved_at: String,
    app_version: String,
    #[serde(flatten)]
    extra: Map<String, Value>,
}

impl Default for Meta {
    fn default() -> Self {
        Meta {
            last_saved_at: Utc::now().to_rfc3339(),
            app_version: String::new(),
            extra: Map::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pos {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct FocusPositions {
    #[serde(skip_serializing_if = "Option::is_none")]
    dark: Option<Pos>,
    #[serde(skip_serializing_if = "Option::is_none")]
    light: Option<Pos>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Preferences {
    always_on_top: bool,
    theme: String,
    menu_bar_timer: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    focus_positions: Option<FocusPositions>,
    #[serde(flatten)]
    extra: Map<String, Value>,
}

impl Default for Preferences {
    fn default() -> Self {
        Preferences {
            always_on_top: true,
            theme: "dark".to_string(),
            menu_bar_timer: true,
            focus_positions: None,
            extra: Map::new(),
        }
    }
}

// ============================================================================
// STATE PERSISTENCE
// ============================================================================

fn app_version(app: &AppHandle) -> String {
    app.package_info().version.to_string()
}

fn get_state_file_path() -> Result<PathBuf> {
    // TIMEBOUND_DATA_DIR lets a test run use its own copy of the data instead of the user's.
    let app_data_dir = match std::env::var_os("TIMEBOUND_DATA_DIR") {
        Some(dir) => PathBuf::from(dir),
        None => tauri::api::path::data_dir()
            .context("Failed to get app data directory")?
            .join("timebound"),
    };
    fs::create_dir_all(&app_data_dir).context("Failed to create app data directory")?;
    Ok(app_data_dir.join("state.json"))
}

fn create_empty_state(version: &str) -> AppState {
    let mut state = AppState::default();
    state.meta.app_version = version.to_string();
    state
}

fn parse_state_file(path: &PathBuf) -> Result<AppState> {
    let contents = fs::read_to_string(path).context("Failed to read state file")?;
    serde_json::from_str::<AppState>(&contents).context("Failed to parse state file")
}

fn load_state_from_disk(version: &str) -> Result<AppState> {
    let state_path = get_state_file_path()?;
    if !state_path.exists() {
        return Ok(create_empty_state(version));
    }

    match parse_state_file(&state_path) {
        Ok(state) => Ok(state),
        Err(main_err) => {
            eprintln!("{:#}", main_err);
            let backup_path = state_path.with_extension("json.bak");
            if let Ok(state) = parse_state_file(&backup_path) {
                println!("Loaded state from backup");
                return Ok(state);
            }
            // Neither file is usable. Move the broken file aside so the next save
            // cannot overwrite whatever the user might still be able to recover.
            let stamp = Utc::now().format("%Y%m%d%H%M%S");
            let corrupt_path = state_path.with_extension(format!("json.corrupt-{}", stamp));
            let _ = fs::rename(&state_path, &corrupt_path);
            Ok(create_empty_state(version))
        }
    }
}

fn save_state_to_disk(state: &AppState, version: &str) -> Result<AppState> {
    let state_path = get_state_file_path()?;
    let temp_path = state_path.with_extension("json.tmp");
    let backup_path = state_path.with_extension("json.bak");

    let mut state_to_save = state.clone();
    state_to_save.meta.last_saved_at = Utc::now().to_rfc3339();
    state_to_save.meta.app_version = version.to_string();

    let json = serde_json::to_string_pretty(&state_to_save).context("Failed to serialize state")?;
    fs::write(&temp_path, &json).context("Failed to write temp state file")?;
    if state_path.exists() {
        fs::copy(&state_path, &backup_path).context("Failed to create backup")?;
    }
    fs::rename(&temp_path, &state_path).context("Failed to rename temp file to state file")?;
    Ok(state_to_save)
}

// ============================================================================
// GEOMETRY
// ============================================================================

/// Rectangle in logical points, origin at the top-left of the primary screen.
#[derive(Debug, Clone, Copy, Default)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x < self.x + self.w && y >= self.y && y < self.y + self.h
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotchInfo {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy)]
pub struct ScreenInfo {
    /// Full screen bounds.
    pub frame: Rect,
    /// Bounds excluding the menu bar / Dock / taskbar.
    pub visible: Rect,
    pub menu_bar_height: f64,
    pub notch: Option<NotchInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FocusLayout {
    width: f64,
    height: f64,
    x: f64,
    y: f64,
    notch: Option<NotchInfo>,
    menu_bar_height: f64,
    placement: String,
    expanded: bool,
}

fn screen_for_point(screens: &[ScreenInfo], x: f64, y: f64) -> Option<ScreenInfo> {
    screens.iter().copied().find(|s| s.frame.contains(x, y))
}

fn clamp_to(r: Rect, bounds: Rect) -> Rect {
    let max_x = (bounds.x + bounds.w - r.w).max(bounds.x);
    let max_y = (bounds.y + bounds.h - r.h).max(bounds.y);
    Rect {
        x: r.x.clamp(bounds.x, max_x),
        y: r.y.clamp(bounds.y, max_y),
        ..r
    }
}

// ============================================================================
// FOCUS MODE STATE
// ============================================================================

const MAIN_MIN_WIDTH: f64 = 360.0;
const MAIN_MIN_HEIGHT: f64 = 480.0;
const DARK_FALLBACK_WIDTH: f64 = 340.0;
const NOTCH_SIDE_PADDING: f64 = 130.0;
const LIGHT_WIDTH: f64 = 300.0;
const LIGHT_HEIGHT: f64 = 52.0;
const LIGHT_MARGIN: f64 = 16.0;

#[derive(Debug, Clone, Copy)]
enum SavedBounds {
    #[cfg(target_os = "macos")]
    Logical(Rect),
    #[cfg(not(target_os = "macos"))]
    Physical {
        x: i32,
        y: i32,
        w: u32,
        h: u32,
    },
}

#[derive(Default)]
struct FocusInner {
    active: bool,
    saved_main: Option<SavedBounds>,
    #[cfg(target_os = "macos")]
    saved_native: Option<macos::NativeWindowState>,
    placement: String,
    notch: Option<NotchInfo>,
    menu_bar_height: f64,
    expanded: bool,
    grew_up: bool,
    delta: f64,
}

#[derive(Default)]
struct FocusState(Mutex<FocusInner>);

// ---------------------------------------------------------------------------
// Platform frame access. All of these run on the main thread (sync commands).
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
fn get_frame(window: &Window) -> Result<Rect, String> {
    let ns = window.ns_window().map_err(|e| e.to_string())?;
    Ok(unsafe { macos::frame(ns as _) })
}

#[cfg(target_os = "macos")]
fn set_frame(window: &Window, r: Rect) -> Result<Rect, String> {
    let ns = window.ns_window().map_err(|e| e.to_string())?;
    Ok(unsafe { macos::set_frame(ns as _, r) })
}

#[cfg(target_os = "macos")]
fn all_screens(_window: &Window) -> Result<Vec<ScreenInfo>, String> {
    Ok(unsafe { macos::screens() })
}

#[cfg(target_os = "macos")]
fn current_screen(window: &Window) -> Result<ScreenInfo, String> {
    let ns = window.ns_window().map_err(|e| e.to_string())?;
    Ok(unsafe { macos::window_screen(ns as _) })
}

#[cfg(not(target_os = "macos"))]
fn get_frame(window: &Window) -> Result<Rect, String> {
    let sf = window.scale_factor().map_err(|e| e.to_string())?;
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    Ok(Rect {
        x: pos.x as f64 / sf,
        y: pos.y as f64 / sf,
        w: size.width as f64 / sf,
        h: size.height as f64 / sf,
    })
}

#[cfg(not(target_os = "macos"))]
fn set_frame(window: &Window, r: Rect) -> Result<Rect, String> {
    window
        .set_size(tauri::LogicalSize::new(r.w, r.h))
        .map_err(|e| e.to_string())?;
    window
        .set_position(tauri::LogicalPosition::new(r.x, r.y))
        .map_err(|e| e.to_string())?;
    Ok(r)
}

#[cfg(not(target_os = "macos"))]
fn monitor_info(m: &tauri::Monitor) -> ScreenInfo {
    let sf = m.scale_factor();
    let frame = Rect {
        x: m.position().x as f64 / sf,
        y: m.position().y as f64 / sf,
        w: m.size().width as f64 / sf,
        h: m.size().height as f64 / sf,
    };
    // Tauri v1 has no work-area API; assume a bottom taskbar.
    let visible = Rect {
        h: (frame.h - 48.0).max(0.0),
        ..frame
    };
    ScreenInfo {
        frame,
        visible,
        menu_bar_height: 0.0,
        notch: None,
    }
}

#[cfg(not(target_os = "macos"))]
fn all_screens(window: &Window) -> Result<Vec<ScreenInfo>, String> {
    Ok(window
        .available_monitors()
        .map_err(|e| e.to_string())?
        .iter()
        .map(monitor_info)
        .collect())
}

#[cfg(not(target_os = "macos"))]
fn current_screen(window: &Window) -> Result<ScreenInfo, String> {
    if let Some(m) = window.current_monitor().map_err(|e| e.to_string())? {
        return Ok(monitor_info(&m));
    }
    if let Some(m) = window.primary_monitor().map_err(|e| e.to_string())? {
        return Ok(monitor_info(&m));
    }
    Err("No monitor available".to_string())
}

fn screen_containing(window: &Window, r: Rect) -> Result<ScreenInfo, String> {
    let screens = all_screens(window)?;
    match screen_for_point(&screens, r.x + r.w / 2.0, r.y + r.h / 2.0) {
        Some(s) => Ok(s),
        None => current_screen(window),
    }
}

fn layout_from(inner: &FocusInner, r: Rect) -> FocusLayout {
    FocusLayout {
        width: r.w,
        height: r.h,
        x: r.x,
        y: r.y,
        notch: inner.notch,
        menu_bar_height: inner.menu_bar_height,
        placement: inner.placement.clone(),
        expanded: inner.expanded,
    }
}

/// The collapsed rectangle, derived from the live frame so it follows user drags.
fn collapsed_rect(inner: &FocusInner, live: Rect) -> Rect {
    if !inner.expanded {
        return live;
    }
    Rect {
        y: if inner.grew_up { live.y + inner.delta } else { live.y },
        h: (live.h - inner.delta).max(1.0),
        ..live
    }
}

// ============================================================================
// TAURI COMMANDS
// ============================================================================

#[tauri::command]
async fn load_state(app: AppHandle) -> Result<AppState, String> {
    load_state_from_disk(&app_version(&app)).map_err(|e| format!("Failed to load state: {:#}", e))
}

#[tauri::command]
async fn save_state(app: AppHandle, state: AppState) -> Result<AppState, String> {
    save_state_to_disk(&state, &app_version(&app))
        .map_err(|e| format!("Failed to save state: {:#}", e))
}

#[tauri::command]
fn set_always_on_top(window: Window, enabled: bool) -> Result<(), String> {
    window
        .set_always_on_top(enabled)
        .map_err(|e| format!("Failed to set always on top: {}", e))?;
    apply_window_constraints(&window)
}

#[tauri::command]
fn enter_focus_mode(
    window: Window,
    focus: State<'_, FocusState>,
    theme: String,
    position: Option<Pos>,
) -> Result<FocusLayout, String> {
    let mut inner = focus.0.lock().map_err(|e| e.to_string())?;
    let is_dark = theme != "light";

    // Re-entering (e.g. a theme switch while focused) keeps the original main bounds.
    if !inner.active {
        #[cfg(target_os = "macos")]
        {
            let ns = window.ns_window().map_err(|e| e.to_string())?;
            inner.saved_main = Some(SavedBounds::Logical(get_frame(&window)?));
            inner.saved_native = Some(unsafe { macos::capture_native(ns as _) });
        }
        #[cfg(not(target_os = "macos"))]
        {
            let pos = window.outer_position().map_err(|e| e.to_string())?;
            let size = window.inner_size().map_err(|e| e.to_string())?;
            inner.saved_main = Some(SavedBounds::Physical {
                x: pos.x,
                y: pos.y,
                w: size.width,
                h: size.height,
            });
        }
    }

    let screens = all_screens(&window)?;
    let screen = match position {
        Some(p) => screen_for_point(&screens, p.x, p.y).map_or_else(|| current_screen(&window), Ok)?,
        None => current_screen(&window)?,
    };

    let (w, h) = if is_dark {
        if cfg!(target_os = "macos") {
            let width = screen
                .notch
                .map_or(DARK_FALLBACK_WIDTH, |n| n.width + 2.0 * NOTCH_SIDE_PADDING);
            (width, screen.menu_bar_height)
        } else {
            (DARK_FALLBACK_WIDTH, 40.0)
        }
    } else {
        (LIGHT_WIDTH, LIGHT_HEIGHT)
    };

    let default_origin = if is_dark {
        let y = if cfg!(target_os = "macos") {
            screen.frame.y
        } else {
            screen.frame.y + 8.0
        };
        (screen.frame.x + (screen.frame.w - w) / 2.0, y)
    } else {
        (
            screen.visible.x + screen.visible.w - w - LIGHT_MARGIN,
            screen.visible.y + screen.visible.h - h - LIGHT_MARGIN,
        )
    };

    let (x, y) = position.map_or(default_origin, |p| (p.x, p.y));
    let target = clamp_to(Rect { x, y, w, h }, screen.frame);

    let in_menu_bar = cfg!(target_os = "macos") && is_dark && target.y <= screen.frame.y + 0.5;
    inner.placement = if in_menu_bar { "menubar" } else { "floating" }.to_string();
    inner.notch = if is_dark { screen.notch } else { None };
    inner.menu_bar_height = screen.menu_bar_height;
    inner.expanded = false;
    inner.grew_up = false;
    inner.delta = 0.0;

    #[cfg(target_os = "macos")]
    let actual = {
        let ns = window.ns_window().map_err(|e| e.to_string())? as cocoa::base::id;
        unsafe {
            macos::set_min_size(ns, 1.0, 1.0);
            macos::set_focus_level(ns, is_dark);
        }
        set_frame(&window, target)?
    };

    #[cfg(not(target_os = "macos"))]
    let actual = {
        window
            .set_min_size(None::<tauri::LogicalSize<f64>>)
            .map_err(|e| e.to_string())?;
        window.set_always_on_top(true).map_err(|e| e.to_string())?;
        set_frame(&window, target)?
    };

    inner.active = true;
    Ok(layout_from(&inner, actual))
}

#[tauri::command]
fn set_focus_expanded(
    window: Window,
    focus: State<'_, FocusState>,
    expanded: bool,
    extra_height: f64,
) -> Result<FocusLayout, String> {
    let mut inner = focus.0.lock().map_err(|e| e.to_string())?;
    if !inner.active {
        return Err("Focus mode is not active".to_string());
    }

    let collapsed = collapsed_rect(&inner, get_frame(&window)?);

    let target = if expanded {
        let extra = extra_height.max(0.0);
        let screen = screen_containing(&window, collapsed)?;
        let grow_up = collapsed.y + collapsed.h / 2.0 > screen.frame.y + screen.frame.h / 2.0;
        inner.grew_up = grow_up;
        inner.delta = extra;
        Rect {
            y: if grow_up { collapsed.y - extra } else { collapsed.y },
            h: collapsed.h + extra,
            ..collapsed
        }
    } else {
        inner.grew_up = false;
        inner.delta = 0.0;
        collapsed
    };

    inner.expanded = expanded;
    let actual = set_frame(&window, target)?;
    Ok(layout_from(&inner, actual))
}

#[tauri::command]
fn get_focus_position(window: Window, focus: State<'_, FocusState>) -> Result<Option<Pos>, String> {
    let inner = focus.0.lock().map_err(|e| e.to_string())?;
    if !inner.active {
        return Ok(None);
    }
    let r = collapsed_rect(&inner, get_frame(&window)?);
    Ok(Some(Pos { x: r.x, y: r.y }))
}

#[tauri::command]
fn exit_focus_mode(
    window: Window,
    focus: State<'_, FocusState>,
    always_on_top: bool,
) -> Result<(), String> {
    let mut inner = focus.0.lock().map_err(|e| e.to_string())?;
    if !inner.active {
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let ns = window.ns_window().map_err(|e| e.to_string())? as cocoa::base::id;
        unsafe {
            if let Some(native) = inner.saved_native.take() {
                macos::restore_native(ns, native);
            } else {
                macos::set_min_size(ns, MAIN_MIN_WIDTH, MAIN_MIN_HEIGHT);
            }
            macos::set_always_on_top_level(ns, always_on_top);
        }
        if let Some(SavedBounds::Logical(r)) = inner.saved_main.take() {
            set_frame(&window, r)?;
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        window
            .set_min_size(Some(tauri::LogicalSize::new(MAIN_MIN_WIDTH, MAIN_MIN_HEIGHT)))
            .map_err(|e| e.to_string())?;
        if let Some(SavedBounds::Physical { x, y, w, h }) = inner.saved_main.take() {
            window
                .set_size(PhysicalSize::new(w, h))
                .map_err(|e| e.to_string())?;
            window
                .set_position(tauri::PhysicalPosition::new(x, y))
                .map_err(|e| e.to_string())?;
        }
        window
            .set_always_on_top(always_on_top)
            .map_err(|e| e.to_string())?;
    }

    *inner = FocusInner::default();
    Ok(())
}

#[tauri::command]
fn set_theme_effects(window: Window, theme: String, mode: String, radius: f64) -> Result<(), String> {
    let _ = &mode;
    #[cfg(target_os = "macos")]
    {
        let ns = window.ns_window().map_err(|e| e.to_string())? as cocoa::base::id;
        unsafe {
            if theme == "light" {
                macos::set_appearance(ns, false);
                macos::set_vibrancy(ns, radius);
            } else {
                macos::set_appearance(ns, true);
                macos::clear_vibrancy(ns);
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (&window, &theme, radius);
    }
    Ok(())
}

#[tauri::command]
fn update_tray(
    app: AppHandle,
    title: Option<String>,
    tooltip: String,
    has_task: bool,
    running: bool,
) -> Result<(), String> {
    let tray = app.tray_handle();
    #[cfg(target_os = "macos")]
    tray.set_title(title.as_deref().unwrap_or(""))
        .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    let _ = &title;
    // Tooltips are unsupported on Linux; ignore that error rather than fail the call.
    let _ = tray.set_tooltip(&tooltip);

    let pause = tray.get_item("pause");
    pause
        .set_title(if running { "Pause" } else { "Resume" })
        .map_err(|e| e.to_string())?;
    pause.set_enabled(has_task).map_err(|e| e.to_string())?;
    tray.get_item("complete")
        .set_enabled(has_task)
        .map_err(|e| e.to_string())?;
    tray.get_item("focus")
        .set_enabled(has_task)
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ============================================================================
// HELPERS
// ============================================================================

fn apply_window_constraints(window: &Window) -> Result<(), String> {
    window
        .set_max_size(None::<PhysicalSize<u32>>)
        .map_err(|e| format!("Failed to remove max size constraint: {}", e))
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn build_tray() -> SystemTray {
    let menu = SystemTrayMenu::new()
        .add_item(CustomMenuItem::new("show", "Show TimeBound"))
        .add_item(CustomMenuItem::new("focus", "Focus mode"))
        .add_item(CustomMenuItem::new("pause", "Pause"))
        .add_item(CustomMenuItem::new("complete", "Complete task"))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(CustomMenuItem::new("quit", "Quit TimeBound"));
    SystemTray::new().with_menu(menu)
}

fn handle_tray_event(app: &AppHandle, event: SystemTrayEvent) {
    match event {
        SystemTrayEvent::LeftClick { .. } => {
            if cfg!(not(target_os = "macos")) {
                show_main_window(app);
            }
        }
        SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
            "quit" => app.exit(0),
            "show" => {
                show_main_window(app);
                let _ = app.emit_all("tray-action", "show");
            }
            other => {
                let _ = app.emit_all("tray-action", other);
            }
        },
        _ => {}
    }
}

// ============================================================================
// TIMER SYSTEM
// ============================================================================

async fn start_timer_loop(app_handle: AppHandle) {
    let mut interval = interval(Duration::from_secs(1));

    loop {
        interval.tick().await;
        let timestamp = chrono::Utc::now().timestamp_millis();

        if let Err(e) = app_handle.emit_all("timer-tick", timestamp) {
            eprintln!("Failed to emit timer tick: {}", e);
        }
    }
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

#[cfg(debug_assertions)]
#[tauri::command]
fn selftest_log(message: String) {
    println!("SELFTEST {}", message);
}

#[cfg(debug_assertions)]
fn handlers() -> impl Fn(tauri::Invoke) + Send + Sync + 'static {
    tauri::generate_handler![
        load_state,
        save_state,
        set_always_on_top,
        enter_focus_mode,
        set_focus_expanded,
        get_focus_position,
        exit_focus_mode,
        set_theme_effects,
        update_tray,
        selftest_log
    ]
}

#[cfg(not(debug_assertions))]
fn handlers() -> impl Fn(tauri::Invoke) + Send + Sync + 'static {
    tauri::generate_handler![
        load_state,
        save_state,
        set_always_on_top,
        enter_focus_mode,
        set_focus_expanded,
        get_focus_position,
        exit_focus_mode,
        set_theme_effects,
        update_tray
    ]
}

fn main() {
    tauri::Builder::default()
        .manage(FocusState::default())
        .system_tray(build_tray())
        .on_system_tray_event(handle_tray_event)
        .invoke_handler(handlers())
        .setup(|app| {
            let app_handle = app.handle();

            if let Some(window) = app.get_window("main") {
                if let Err(e) = apply_window_constraints(&window) {
                    eprintln!("Failed to apply initial window constraints: {}", e);
                }
            }

            tauri::async_runtime::spawn(async move {
                start_timer_loop(app_handle).await;
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_state_loads_with_defaults() {
        let raw = r#"{"score":68,"tasks":[{"id":"a","title":"Call","createdAt":"t","updatedAt":"t","status":"struck","history":[]}],
            "stats":{"totalCompleted":82,"todayCompleted":5,"lastCompletionDate":"2026-10-15"},
            "meta":{"lastSavedAt":"t","appVersion":"1.0.0"},"preferences":{"alwaysOnTop":true}}"#;
        let s: AppState = serde_json::from_str(raw).unwrap();
        assert_eq!(s.score, 68);
        assert_eq!(s.preferences.theme, "dark");
        assert!(s.preferences.menu_bar_timer);
        assert!(s.preferences.focus_positions.is_none());
        assert_eq!(s.stats.last_completion_date.as_deref(), Some("2026-10-15"));
    }

    #[test]
    fn missing_fields_and_undefined_date_are_tolerated() {
        let s: AppState = serde_json::from_str(r#"{"stats":{"totalCompleted":1,"todayCompleted":1}}"#).unwrap();
        assert!(s.stats.last_completion_date.is_none());
        assert!(s.preferences.always_on_top);
        let out = serde_json::to_value(&s).unwrap();
        assert!(out["stats"].get("lastCompletionDate").is_none());
    }

    #[test]
    fn unknown_fields_round_trip() {
        let raw = r#"{"score":1,"tasks":[{"id":"a","title":"x","createdAt":"t","updatedAt":"t","status":"pending","history":[{"type":"add_time","at":"t","note":"n"}],"estimate":300}],
            "stats":{"totalCompleted":0,"todayCompleted":0,"days":{"2026-10-16":{"done":2}}},
            "meta":{"lastSavedAt":"t","appVersion":"1"},
            "preferences":{"alwaysOnTop":false,"theme":"light","menuBarTimer":false,"focusPositions":{"light":{"x":10.5,"y":20}},"hotkey":"Cmd+Shift+T"},
            "futureTopLevel":[1,2]}"#;
        let s: AppState = serde_json::from_str(raw).unwrap();
        let out = serde_json::to_value(&s).unwrap();
        assert_eq!(out["futureTopLevel"], serde_json::json!([1, 2]));
        assert_eq!(out["tasks"][0]["estimate"], 300);
        assert_eq!(out["tasks"][0]["history"][0]["note"], "n");
        assert_eq!(out["stats"]["days"]["2026-10-16"]["done"], 2);
        assert_eq!(out["preferences"]["hotkey"], "Cmd+Shift+T");
        assert_eq!(out["preferences"]["theme"], "light");
        assert_eq!(out["preferences"]["menuBarTimer"], false);
        assert_eq!(out["preferences"]["focusPositions"]["light"]["x"], 10.5);
        assert!(out["preferences"]["focusPositions"].get("dark").is_none());
    }

    #[test]
    fn clamp_keeps_rect_on_screen() {
        let screen = Rect { x: 0.0, y: 0.0, w: 1280.0, h: 832.0 };
        let r = clamp_to(Rect { x: 1250.0, y: -40.0, w: 300.0, h: 52.0 }, screen);
        assert_eq!((r.x, r.y), (980.0, 0.0));
    }

    #[test]
    fn collapsed_rect_undoes_upward_growth() {
        let inner = FocusInner { expanded: true, grew_up: true, delta: 120.0, ..Default::default() };
        let r = collapsed_rect(&inner, Rect { x: 5.0, y: 600.0, w: 300.0, h: 172.0 });
        assert_eq!((r.y, r.h), (720.0, 52.0));
    }
}
