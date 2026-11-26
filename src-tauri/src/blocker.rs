//! Distraction blocker — soft enforcement: no root, no system extension.
//!
//! The renderer pushes a `BlockConfig` whenever tasks or settings change. A dedicated thread
//! re-evaluates it every couple of seconds against the local clock and, while blocking is on,
//! closes browser tabs whose address is on the block list (over Apple Events) and hides
//! blocked apps. It never quits a browser: only the offending tab goes.
//!
//! Everything that decides *whether* and *what* to block is pure and unit-tested below; the
//! `mac` module only talks to the OS.

// objc 0.2's msg_send! expands a `cfg(feature = "cargo-clippy")` check into this crate.
#![allow(unexpected_cfgs)]

use chrono::{Datelike, Local, NaiveDate, NaiveDateTime, NaiveTime, Timelike};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

/// How often the blocker looks at open tabs and apps while blocking is on.
pub const POLL_INTERVAL: Duration = Duration::from_millis(2500);

// ============================================================================
// CONFIG & STATUS
// ============================================================================

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BlockWindow {
    pub id: String,
    /// 0 = Sunday … 6 = Saturday, the days the window *starts* on.
    pub days: Vec<u32>,
    pub start: String,
    pub end: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CurrentTask {
    pub title: String,
    /// The timer is counting down (has time, not paused).
    pub running: bool,
    /// Entries the user paid to let through for this task.
    pub allowed_sites: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BlockConfig {
    pub during_tasks: bool,
    pub sites: Vec<String>,
    /// Bundle identifiers.
    pub apps: Vec<String>,
    pub windows: Vec<BlockWindow>,
    pub current_task: Option<CurrentTask>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockStatus {
    pub active: bool,
    /// "task" when a running task turned blocking on, "window" for a scheduled window.
    pub reason: Option<String>,
    pub task_title: Option<String>,
    pub window_id: Option<String>,
    /// Local time the active window ends, "YYYY-MM-DDTHH:MM:SS" (no offset, so JS reads it as local).
    pub window_until: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockedEvent {
    /// "site" or "app".
    pub kind: String,
    /// The block-list entry that matched, or the app's name.
    pub target: String,
    pub url: Option<String>,
    /// The browser (for a site) or the app itself.
    pub bundle_id: String,
    pub app_name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserAccess {
    pub bundle_id: String,
    pub name: String,
    /// "granted" | "denied" | "needsConsent" | "notRunning" | "unsupported" | "error"
    pub access: String,
    pub detail: Option<String>,
}

// ============================================================================
// SCHEDULE (pure)
// ============================================================================

/// Minutes past midnight for a strict "HH:MM".
pub fn parse_clock(s: &str) -> Option<u32> {
    let (h, m) = s.split_once(':')?;
    if h.len() != 2 || m.len() != 2 {
        return None;
    }
    let (h, m): (u32, u32) = (h.parse().ok()?, m.parse().ok()?);
    if h > 23 || m > 59 {
        return None;
    }
    Some(h * 60 + m)
}

fn at_minutes(date: NaiveDate, minutes: u32) -> NaiveDateTime {
    date.and_time(NaiveTime::from_hms_opt(minutes / 60, minutes % 60, 0).expect("minutes < 1440"))
}

/// When `window` covers `now`, the local time it ends. An `end` at or before `start` runs
/// past midnight into the next day (equal start and end is a full 24 hours).
pub fn window_end(window: &BlockWindow, now: NaiveDateTime) -> Option<NaiveDateTime> {
    if !window.enabled {
        return None;
    }
    let start = parse_clock(&window.start)?;
    let end = parse_clock(&window.end)?;
    let today = now.date();
    let minute = now.hour() * 60 + now.minute();
    let weekday = today.weekday().num_days_from_sunday();
    let starts_on = |day: u32| window.days.contains(&day);

    if end > start {
        return (starts_on(weekday) && minute >= start && minute < end).then(|| at_minutes(today, end));
    }
    if starts_on(weekday) && minute >= start {
        return today.succ_opt().map(|tomorrow| at_minutes(tomorrow, end));
    }
    let yesterday = (weekday + 6) % 7;
    (starts_on(yesterday) && minute < end).then(|| at_minutes(today, end))
}

/// Whether blocking is on right now, and why.
pub fn evaluate(config: &BlockConfig, now: NaiveDateTime) -> BlockStatus {
    let task = config.current_task.as_ref().filter(|task| config.during_tasks && task.running);
    // With overlapping windows, report the one that lasts longest.
    let window = config
        .windows
        .iter()
        .filter_map(|w| window_end(w, now).map(|end| (w, end)))
        .max_by_key(|(_, end)| *end);
    let until = |end: NaiveDateTime| end.format("%Y-%m-%dT%H:%M:%S").to_string();
    match (task, window) {
        (None, None) => BlockStatus::default(),
        (Some(task), window) => BlockStatus {
            active: true,
            reason: Some("task".into()),
            task_title: Some(task.title.clone()),
            window_id: window.map(|(w, _)| w.id.clone()),
            window_until: window.map(|(_, end)| until(end)),
        },
        (None, Some((w, end))) => BlockStatus {
            active: true,
            reason: Some("window".into()),
            task_title: None,
            window_id: Some(w.id.clone()),
            window_until: Some(until(end)),
        },
    }
}

// ============================================================================
// SITE MATCHING (pure)
// ============================================================================

/// Same rules as `normalizeSite` in src/shared/blocking.ts: lowercase host without scheme,
/// "www.", port, query or fragment, plus an optional path prefix without a trailing slash.
pub fn normalize_site(input: &str) -> Option<String> {
    let mut text = input.trim().to_ascii_lowercase();
    if let Some(i) = text.find("://") {
        text = text[i + 3..].to_string();
    }
    if let Some(i) = text.find(|c| c == '?' || c == '#') {
        text.truncate(i);
    }
    let (host, path) = match text.find('/') {
        Some(i) => (text[..i].to_string(), text[i..].to_string()),
        None => (text.clone(), String::new()),
    };
    let host = host.rsplit('@').next().unwrap_or("");
    let host = host.split(':').next().unwrap_or("");
    let host = host.trim_end_matches('.');
    let host = host.strip_prefix("www.").unwrap_or(host);
    let labels: Vec<&str> = host.split('.').collect();
    let valid = labels.len() >= 2
        && labels.iter().all(|label| {
            !label.is_empty()
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        });
    valid.then(|| format!("{}{}", host, path.trim_end_matches('/')))
}

/// Host (lowercase, no "www.") and path (no query or fragment) of an http(s) URL.
pub fn url_parts(url: &str) -> Option<(String, String)> {
    let trimmed = url.trim();
    let lower = trimmed.to_ascii_lowercase();
    let rest = if lower.starts_with("https://") {
        &lower[8..]
    } else if lower.starts_with("http://") {
        &lower[7..]
    } else {
        return None;
    };
    let end = rest.find(|c| c == '/' || c == '?' || c == '#').unwrap_or(rest.len());
    let mut path = &rest[end..];
    if let Some(i) = path.find(|c| c == '?' || c == '#') {
        path = &path[..i];
    }
    let host = rest[..end].rsplit('@').next()?.split(':').next()?.trim_end_matches('.');
    let host = host.strip_prefix("www.").unwrap_or(host);
    if host.is_empty() {
        return None;
    }
    Some((host.to_string(), path.to_string()))
}

/// "youtube.com" matches youtube.com and any subdomain; "youtube.com/shorts" also needs the
/// path to be /shorts or below it (not /shortsfoo).
pub fn site_matches(host: &str, path: &str, site: &str) -> bool {
    let (site_host, site_path) = match site.find('/') {
        Some(i) => (&site[..i], &site[i..]),
        None => (site, ""),
    };
    let host_ok = host == site_host
        || (host.len() > site_host.len()
            && host.ends_with(site_host)
            && host.as_bytes()[host.len() - site_host.len() - 1] == b'.');
    if !host_ok {
        return false;
    }
    site_path.is_empty() || path == site_path || path.starts_with(&format!("{}/", site_path))
}

/// The block-list entry `url` falls under, unless an allowed entry covers it.
pub fn blocked_by(url: &str, sites: &[String], allowed: &[String]) -> Option<String> {
    let (host, path) = url_parts(url)?;
    if allowed.iter().any(|site| site_matches(&host, &path, site)) {
        return None;
    }
    sites.iter().find(|site| site_matches(&host, &path, site)).cloned()
}

// ============================================================================
// BROWSERS (pure)
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Engine {
    /// Chrome's scripting dictionary: windows and tabs have stable integer ids.
    Chromium,
    /// Safari: windows have ids, tabs only an index.
    Safari,
}

pub struct Browser {
    pub bundle_id: &'static str,
    pub name: &'static str,
    pub engine: Engine,
}

/// Browsers whose tabs we can read and close. Chromium forks share Chrome's dictionary
/// (checked for Chrome and Opera with `sdef`).
pub const BROWSERS: &[Browser] = &[
    Browser { bundle_id: "com.google.Chrome", name: "Google Chrome", engine: Engine::Chromium },
    Browser { bundle_id: "com.google.Chrome.beta", name: "Chrome Beta", engine: Engine::Chromium },
    Browser { bundle_id: "com.google.Chrome.dev", name: "Chrome Dev", engine: Engine::Chromium },
    Browser { bundle_id: "com.google.Chrome.canary", name: "Chrome Canary", engine: Engine::Chromium },
    Browser { bundle_id: "org.chromium.Chromium", name: "Chromium", engine: Engine::Chromium },
    Browser { bundle_id: "com.brave.Browser", name: "Brave", engine: Engine::Chromium },
    Browser { bundle_id: "com.microsoft.edgemac", name: "Microsoft Edge", engine: Engine::Chromium },
    Browser { bundle_id: "com.vivaldi.Vivaldi", name: "Vivaldi", engine: Engine::Chromium },
    Browser { bundle_id: "com.operasoftware.Opera", name: "Opera", engine: Engine::Chromium },
    Browser { bundle_id: "com.apple.Safari", name: "Safari", engine: Engine::Safari },
    Browser { bundle_id: "com.apple.SafariTechnologyPreview", name: "Safari Technology Preview", engine: Engine::Safari },
];

/// Browsers we recognise but cannot read tabs from yet (no usable AppleScript tab URLs).
pub const UNSUPPORTED_BROWSERS: &[(&str, &str)] = &[
    ("org.mozilla.firefox", "Firefox"),
    ("org.mozilla.firefoxdeveloperedition", "Firefox Developer Edition"),
    ("org.mozilla.nightly", "Firefox Nightly"),
    ("company.thebrowser.Browser", "Arc"),
    ("app.zen-browser.zen", "Zen"),
];

pub fn browser(bundle_id: &str) -> Option<&'static Browser> {
    BROWSERS.iter().find(|b| b.bundle_id == bundle_id)
}

// `tab` is a class inside these tell blocks, so the tab character lives in a variable
// set outside them. Numbers are coerced with `as text` because `1 & "a"` makes a list.
const CHROMIUM_LIST: &str = r#"set TB to character id 9
set LF to character id 10
set out to ""
tell application id "BUNDLE"
	repeat with w in every window
		try
			set wid to id of w
			set tids to id of every tab of w
			set turls to URL of every tab of w
			repeat with i from 1 to count of tids
				set out to out & (wid as text) & TB & ((item i of tids) as text) & TB & ((item i of turls) as text) & LF
			end repeat
		end try
	end repeat
end tell
return out"#;

// argv: window id, tab id, expected URL, repeated. A tab is closed only if it still shows
// the URL we matched, so a tab that navigated away in the meantime is left alone.
const CHROMIUM_CLOSE: &str = r#"on run argv
	set n to count of argv
	set closed to 0
	tell application id "BUNDLE"
		repeat with k from 1 to n by 3
			try
				set t to tab id ((item (k + 1) of argv) as integer) of window id ((item k of argv) as integer)
				if ((URL of t) as text) is (item (k + 2) of argv) then
					close t
					set closed to closed + 1
				end if
			end try
		end repeat
	end tell
	return closed
end run"#;

const SAFARI_LIST: &str = r#"set TB to character id 9
set LF to character id 10
set out to ""
tell application id "BUNDLE"
	repeat with w in every window
		try
			set wid to id of w
			set turls to URL of every tab of w
			repeat with i from 1 to count of turls
				set out to out & (wid as text) & TB & (i as text) & TB & ((item i of turls) as text) & LF
			end repeat
		end try
	end repeat
end tell
return out"#;

// argv as above with tab indexes. Rust sends each window's tabs highest index first so
// closing one does not shift the ones still to close.
const SAFARI_CLOSE: &str = r#"on run argv
	set n to count of argv
	set closed to 0
	tell application id "BUNDLE"
		repeat with k from 1 to n by 3
			try
				set t to tab ((item (k + 1) of argv) as integer) of window id ((item k of argv) as integer)
				if ((URL of t) as text) is (item (k + 2) of argv) then
					close t
					set closed to closed + 1
				end if
			end try
		end repeat
	end tell
	return closed
end run"#;

/// The list and close scripts for a browser. Only bundle ids from `BROWSERS` are ever
/// substituted, never anything a user typed.
pub fn scripts(browser: &Browser) -> (String, String) {
    let (list, close) = match browser.engine {
        Engine::Chromium => (CHROMIUM_LIST, CHROMIUM_CLOSE),
        Engine::Safari => (SAFARI_LIST, SAFARI_CLOSE),
    };
    (list.replace("BUNDLE", browser.bundle_id), close.replace("BUNDLE", browser.bundle_id))
}

#[derive(Debug, Clone, PartialEq)]
pub struct OpenTab {
    pub window: String,
    pub tab: String,
    pub url: String,
}

pub fn parse_tab_list(output: &str) -> Vec<OpenTab> {
    output
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(3, '\t');
            let window = parts.next()?.trim();
            let tab = parts.next()?.trim();
            let url = parts.next()?.trim_end_matches('\r');
            (!window.is_empty() && !tab.is_empty()).then(|| OpenTab { window: window.into(), tab: tab.into(), url: url.into() })
        })
        .collect()
}

/// Tabs to close, as (tab, matched entry), ordered so Safari's indexes stay valid while closing.
pub fn tabs_to_close(tabs: Vec<OpenTab>, sites: &[String], allowed: &[String], engine: Engine) -> Vec<(OpenTab, String)> {
    let mut hits: Vec<(OpenTab, String)> = tabs
        .into_iter()
        .filter_map(|tab| blocked_by(&tab.url, sites, allowed).map(|site| (tab, site)))
        .collect();
    if engine == Engine::Safari {
        hits.sort_by(|(a, _), (b, _)| {
            let index = |t: &OpenTab| t.tab.parse::<u32>().unwrap_or(0);
            a.window.cmp(&b.window).then(index(b).cmp(&index(a)))
        });
    }
    hits
}

// ============================================================================
// SHARED STATE & COMMANDS
// ============================================================================

#[derive(Default)]
struct Inner {
    config: Option<BlockConfig>,
    status: BlockStatus,
    generation: u64,
}

#[derive(Default)]
pub struct BlockerShared {
    inner: Mutex<Inner>,
    wake: Condvar,
}

#[derive(Default, Clone)]
pub struct BlockerState(pub Arc<BlockerShared>);

#[tauri::command]
pub fn set_block_config(state: State<'_, BlockerState>, mut config: BlockConfig) -> Result<(), String> {
    config.sites = config.sites.iter().filter_map(|s| normalize_site(s)).collect();
    if let Some(task) = config.current_task.as_mut() {
        task.allowed_sites = task.allowed_sites.iter().filter_map(|s| normalize_site(s)).collect();
    }
    let mut inner = state.0.inner.lock().map_err(|e| e.to_string())?;
    inner.config = Some(config);
    inner.generation += 1;
    state.0.wake.notify_all();
    Ok(())
}

#[tauri::command]
pub fn get_block_status(state: State<'_, BlockerState>) -> Result<BlockStatus, String> {
    Ok(state.0.inner.lock().map_err(|e| e.to_string())?.status.clone())
}

/// Every known browser that is installed, with its Automation permission. With `ask`, macOS
/// shows its "TimeBound wants to control …" prompt for running browsers that have not
/// been asked yet.
#[tauri::command]
pub async fn check_browser_access(ask: bool) -> Result<Vec<BrowserAccess>, String> {
    tauri::async_runtime::spawn_blocking(move || platform::browser_access(ask))
        .await
        .map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub bundle_id: String,
    pub name: String,
}

/// Regular (Dock) apps that are running now, for the "Add app" picker.
#[tauri::command]
pub async fn list_running_apps() -> Result<Vec<AppInfo>, String> {
    tauri::async_runtime::spawn_blocking(platform::list_apps).await.map_err(|e| e.to_string())
}

fn valid_bundle_id(id: &str) -> bool {
    !id.is_empty() && id.len() < 256 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
}

/// Reopens a tab the blocker closed, in the same browser, after the user allowed it.
#[tauri::command]
pub fn reopen_url(url: String, bundle_id: String) -> Result<(), String> {
    if url_parts(&url).is_none() || !valid_bundle_id(&bundle_id) {
        return Err("Refusing to open that address".into());
    }
    platform::open_in(&url, &bundle_id)
}

#[tauri::command]
pub fn open_automation_settings() -> Result<(), String> {
    platform::open_automation_settings()
}

// ============================================================================
// LOOP
// ============================================================================

pub fn spawn(app: AppHandle, state: BlockerState) {
    std::thread::Builder::new()
        .name("timebound-blocker".into())
        .spawn(move || run_loop(app, state.0))
        .expect("failed to start the blocker thread");
}

fn run_loop(app: AppHandle, shared: Arc<BlockerShared>) {
    let mut enforcer = platform::Enforcer::default();
    let mut seen_generation = 0;
    loop {
        let config = {
            let guard = match shared.inner.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };
            let (guard, _) = shared
                .wake
                .wait_timeout_while(guard, POLL_INTERVAL, |inner| inner.generation == seen_generation)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            seen_generation = guard.generation;
            guard.config.clone()
        };

        let status = config.as_ref().map(|c| evaluate(c, Local::now().naive_local())).unwrap_or_default();
        let changed = {
            let mut inner = match shared.inner.lock() {
                Ok(inner) => inner,
                Err(_) => return,
            };
            let changed = inner.status != status;
            inner.status = status.clone();
            changed
        };
        if changed {
            let _ = app.emit_all("blocker-status", &status);
        }

        match (&config, status.active) {
            (Some(config), true) => {
                for event in enforcer.enforce(config, &app) {
                    let _ = app.emit_all("blocker-blocked", &event);
                }
            }
            _ => enforcer.idle(),
        }
    }
}

// ============================================================================
// PLATFORM
// ============================================================================

#[cfg(target_os = "macos")]
use mac as platform;

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::{AppInfo, BlockConfig, BlockedEvent, BrowserAccess};
    use tauri::AppHandle;

    #[derive(Default)]
    pub struct Enforcer;

    impl Enforcer {
        pub fn enforce(&mut self, _config: &BlockConfig, _app: &AppHandle) -> Vec<BlockedEvent> {
            Vec::new()
        }
        pub fn idle(&mut self) {}
    }

    pub fn browser_access(_ask: bool) -> Vec<BrowserAccess> {
        Vec::new()
    }
    pub fn list_apps() -> Vec<AppInfo> {
        Vec::new()
    }
    pub fn open_in(_url: &str, _bundle_id: &str) -> Result<(), String> {
        Err("Only available on macOS".into())
    }
    pub fn open_automation_settings() -> Result<(), String> {
        Err("Only available on macOS".into())
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use super::{
        browser, parse_tab_list, scripts, tabs_to_close, AppInfo, BlockConfig, BlockedEvent, BrowserAccess, BROWSERS,
        UNSUPPORTED_BROWSERS,
    };
    use cocoa::base::{id, nil};
    use cocoa::foundation::{NSAutoreleasePool, NSString};
    use objc::runtime::{BOOL, YES};
    use objc::{class, msg_send, sel, sel_impl};
    use std::collections::HashMap;
    use std::ffi::CStr;
    use std::io::{Read, Write};
    use std::os::raw::{c_char, c_void};
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};
    use tauri::{AppHandle, Manager};

    const LIST_TIMEOUT: Duration = Duration::from_secs(5);
    const RECHECK_DENIED: Duration = Duration::from_secs(10);

    // ---------- running apps ----------

    pub struct RunningApp {
        pub bundle_id: String,
        pub name: String,
        pub pid: i32,
        pub hidden: bool,
        pub regular: bool,
    }

    unsafe fn ns_string(ns: id) -> Option<String> {
        if ns == nil {
            return None;
        }
        let ptr: *const c_char = msg_send![ns, UTF8String];
        (!ptr.is_null()).then(|| CStr::from_ptr(ptr).to_string_lossy().into_owned())
    }

    pub fn running_apps() -> Vec<RunningApp> {
        unsafe {
            let pool = NSAutoreleasePool::new(nil);
            let workspace: id = msg_send![class!(NSWorkspace), sharedWorkspace];
            let apps: id = msg_send![workspace, runningApplications];
            let count: usize = msg_send![apps, count];
            let mut out = Vec::with_capacity(count);
            for i in 0..count {
                let app: id = msg_send![apps, objectAtIndex: i];
                let bundle: id = msg_send![app, bundleIdentifier];
                let bundle_id = match ns_string(bundle) {
                    Some(bundle_id) => bundle_id,
                    None => continue,
                };
                let localized: id = msg_send![app, localizedName];
                let name = ns_string(localized).unwrap_or_else(|| bundle_id.clone());
                let pid: i32 = msg_send![app, processIdentifier];
                let hidden: BOOL = msg_send![app, isHidden];
                let policy: isize = msg_send![app, activationPolicy];
                out.push(RunningApp { bundle_id, name, pid, hidden: hidden == YES, regular: policy == 0 });
            }
            pool.drain();
            out
        }
    }

    fn hide_app(pid: i32) -> bool {
        unsafe {
            let pool = NSAutoreleasePool::new(nil);
            let app: id = msg_send![class!(NSRunningApplication), runningApplicationWithProcessIdentifier: pid];
            let hidden = if app == nil {
                false
            } else {
                let ok: BOOL = msg_send![app, hide];
                ok == YES
            };
            pool.drain();
            hidden
        }
    }

    fn is_installed(bundle_id: &str) -> bool {
        unsafe {
            let pool = NSAutoreleasePool::new(nil);
            let workspace: id = msg_send![class!(NSWorkspace), sharedWorkspace];
            let ns_id = NSString::alloc(nil).init_str(bundle_id);
            let url: id = msg_send![workspace, URLForApplicationWithBundleIdentifier: ns_id];
            let _: () = msg_send![ns_id, release];
            pool.drain();
            url != nil
        }
    }

    /// Keeps App Nap from throttling the process while blocking is on.
    fn begin_activity() -> usize {
        // NSActivityUserInitiatedAllowingIdleSystemSleep
        const OPTIONS: u64 = 0x00FF_FFFF & !(1 << 20);
        unsafe {
            let pool = NSAutoreleasePool::new(nil);
            let info: id = msg_send![class!(NSProcessInfo), processInfo];
            let reason = NSString::alloc(nil).init_str("Blocking distractions during a focus block");
            let token: id = msg_send![info, beginActivityWithOptions: OPTIONS reason: reason];
            let _: id = msg_send![token, retain];
            let _: () = msg_send![reason, release];
            pool.drain();
            token as usize
        }
    }

    fn end_activity(token: usize) {
        unsafe {
            let pool = NSAutoreleasePool::new(nil);
            let info: id = msg_send![class!(NSProcessInfo), processInfo];
            let token = token as id;
            let _: () = msg_send![info, endActivity: token];
            let _: () = msg_send![token, release];
            pool.drain();
        }
    }

    // ---------- Automation permission ----------

    #[repr(C)]
    struct AEDesc {
        descriptor_type: u32,
        data_handle: *mut c_void,
    }

    #[link(name = "CoreServices", kind = "framework")]
    extern "C" {
        fn AECreateDesc(type_code: u32, data_ptr: *const c_void, data_size: isize, result: *mut AEDesc) -> i16;
        fn AEDisposeDesc(desc: *mut AEDesc) -> i16;
        fn AEDeterminePermissionToAutomateTarget(target: *const AEDesc, event_class: u32, event_id: u32, ask_user_if_needed: u8) -> i32;
    }

    const TYPE_APPLICATION_BUNDLE_ID: u32 = u32::from_be_bytes(*b"bund");
    const TYPE_WILD_CARD: u32 = u32::from_be_bytes(*b"****");

    #[derive(Debug, Clone, Copy, PartialEq)]
    pub enum Permission {
        Granted,
        Denied,
        NeedsConsent,
        NotRunning,
        Other(i32),
    }

    /// Whether TimeBound may send Apple Events to `bundle_id`. With `ask`, macOS prompts if the
    /// user has not decided yet, and this blocks until they answer, so never call it with
    /// `ask` on the main thread.
    pub fn automation_permission(bundle_id: &str, ask: bool) -> Permission {
        let bytes = bundle_id.as_bytes();
        let mut desc = AEDesc { descriptor_type: 0, data_handle: std::ptr::null_mut() };
        unsafe {
            let err = AECreateDesc(TYPE_APPLICATION_BUNDLE_ID, bytes.as_ptr() as *const c_void, bytes.len() as isize, &mut desc);
            if err != 0 {
                return Permission::Other(err as i32);
            }
            let status = AEDeterminePermissionToAutomateTarget(&desc, TYPE_WILD_CARD, TYPE_WILD_CARD, ask as u8);
            AEDisposeDesc(&mut desc);
            match status {
                0 => Permission::Granted,
                -1743 => Permission::Denied,
                -1744 => Permission::NeedsConsent,
                -600 => Permission::NotRunning,
                other => Permission::Other(other),
            }
        }
    }

    fn access_label(permission: Permission) -> (&'static str, Option<String>) {
        match permission {
            Permission::Granted => ("granted", None),
            Permission::Denied => ("denied", None),
            Permission::NeedsConsent => ("needsConsent", None),
            Permission::NotRunning => ("notRunning", None),
            Permission::Other(code) => ("error", Some(format!("macOS error {}", code))),
        }
    }

    // ---------- osascript ----------

    #[derive(Debug)]
    pub enum ScriptError {
        Denied,
        Timeout,
        Failed(String),
    }

    /// Runs an AppleScript from stdin; `args` reach its `on run argv` handler untouched, so
    /// URLs are never spliced into script text.
    pub fn osascript(script: &str, args: &[String], timeout: Duration) -> Result<String, ScriptError> {
        let mut child = Command::new("/usr/bin/osascript")
            .arg("-")
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| ScriptError::Failed(e.to_string()))?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(script.as_bytes()).map_err(|e| ScriptError::Failed(e.to_string()))?;
        }
        // Drain the pipes on their own threads so a long tab list cannot fill a pipe and stall.
        let mut stdout = child.stdout.take().expect("piped stdout");
        let mut stderr = child.stderr.take().expect("piped stderr");
        let out = std::thread::spawn(move || {
            let mut s = String::new();
            let _ = stdout.read_to_string(&mut s);
            s
        });
        let err = std::thread::spawn(move || {
            let mut s = String::new();
            let _ = stderr.read_to_string(&mut s);
            s
        });
        let deadline = Instant::now() + timeout;
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) if Instant::now() >= deadline => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(ScriptError::Timeout);
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(20)),
                Err(e) => return Err(ScriptError::Failed(e.to_string())),
            }
        };
        let out = out.join().unwrap_or_default();
        let err = err.join().unwrap_or_default();
        if status.success() {
            Ok(out)
        } else if err.contains("-1743") {
            Err(ScriptError::Denied)
        } else if err.contains("-1712") {
            Err(ScriptError::Timeout)
        } else {
            Err(ScriptError::Failed(err.trim().to_string()))
        }
    }

    // ---------- enforcement ----------

    #[derive(Default)]
    struct BrowserState {
        permission: Option<Permission>,
        checked_at: Option<Instant>,
        asked: bool,
    }

    #[derive(Default)]
    pub struct Enforcer {
        browsers: HashMap<String, BrowserState>,
        last_access: Vec<BrowserAccess>,
        activity: Option<usize>,
    }

    impl Enforcer {
        pub fn idle(&mut self) {
            if let Some(token) = self.activity.take() {
                end_activity(token);
            }
        }

        pub fn enforce(&mut self, config: &BlockConfig, app: &AppHandle) -> Vec<BlockedEvent> {
            if self.activity.is_none() {
                self.activity = Some(begin_activity());
            }
            let own_pid = std::process::id() as i32;
            let running = running_apps();
            let mut events = Vec::new();

            for blocked in running.iter().filter(|a| a.pid != own_pid && !a.hidden && config.apps.contains(&a.bundle_id)) {
                if hide_app(blocked.pid) {
                    events.push(BlockedEvent {
                        kind: "app".into(),
                        target: blocked.name.clone(),
                        url: None,
                        bundle_id: blocked.bundle_id.clone(),
                        app_name: blocked.name.clone(),
                    });
                }
            }

            let mut access = Vec::new();
            if !config.sites.is_empty() {
                let allowed = config.current_task.as_ref().map(|t| t.allowed_sites.clone()).unwrap_or_default();
                for running_app in &running {
                    if let Some(b) = browser(&running_app.bundle_id) {
                        let (state, detail) = self.enforce_browser(b, &config.sites, &allowed, &mut events);
                        access.push(BrowserAccess { bundle_id: b.bundle_id.into(), name: b.name.into(), access: state.into(), detail });
                    } else if let Some((bundle_id, name)) = UNSUPPORTED_BROWSERS.iter().find(|(id, _)| *id == running_app.bundle_id) {
                        access.push(BrowserAccess { bundle_id: (*bundle_id).into(), name: (*name).into(), access: "unsupported".into(), detail: None });
                    }
                }
            }
            if access != self.last_access {
                let _ = app.emit_all("blocker-access", &access);
                self.last_access = access;
            }
            events
        }

        fn enforce_browser(&mut self, b: &crate::blocker::Browser, sites: &[String], allowed: &[String], events: &mut Vec<BlockedEvent>) -> (&'static str, Option<String>) {
            let state = self.browsers.entry(b.bundle_id.to_string()).or_default();
            let stale = state.checked_at.map_or(true, |at| at.elapsed() >= RECHECK_DENIED);
            if state.permission != Some(Permission::Granted) && stale {
                let mut permission = automation_permission(b.bundle_id, false);
                if permission == Permission::NeedsConsent && !state.asked {
                    // First time blocking meets this browser: let macOS ask. This waits for the answer.
                    state.asked = true;
                    permission = automation_permission(b.bundle_id, true);
                }
                state.permission = Some(permission);
                state.checked_at = Some(Instant::now());
            }
            let permission = state.permission.unwrap_or(Permission::Other(0));
            if permission != Permission::Granted {
                return access_label(permission);
            }

            let (list, close) = scripts(b);
            let tabs = match osascript(&list, &[], LIST_TIMEOUT) {
                Ok(out) => parse_tab_list(&out),
                Err(ScriptError::Denied) => {
                    state.permission = Some(Permission::Denied);
                    state.checked_at = Some(Instant::now());
                    return ("denied", None);
                }
                Err(ScriptError::Timeout) => return ("granted", Some("Didn’t answer in time".into())),
                Err(ScriptError::Failed(message)) => {
                    eprintln!("blocker: listing {} tabs failed: {}", b.name, message);
                    return ("error", Some(message));
                }
            };
            let hits = tabs_to_close(tabs, sites, allowed, b.engine);
            if hits.is_empty() {
                return ("granted", None);
            }
            let args: Vec<String> = hits.iter().flat_map(|(t, _)| [t.window.clone(), t.tab.clone(), t.url.clone()]).collect();
            match osascript(&close, &args, LIST_TIMEOUT) {
                Ok(_) => {
                    for (tab, site) in hits {
                        events.push(BlockedEvent {
                            kind: "site".into(),
                            target: site,
                            url: Some(tab.url),
                            bundle_id: b.bundle_id.into(),
                            app_name: b.name.into(),
                        });
                    }
                }
                Err(e) => eprintln!("blocker: closing {} tabs failed: {:?}", b.name, e),
            }
            ("granted", None)
        }
    }

    // ---------- commands ----------

    pub fn browser_access(ask: bool) -> Vec<BrowserAccess> {
        let running = running_apps();
        let is_running = |bundle_id: &str| running.iter().any(|a| a.bundle_id == bundle_id);
        let mut out = Vec::new();
        for b in BROWSERS {
            if !is_running(b.bundle_id) && !is_installed(b.bundle_id) {
                continue;
            }
            let (access, detail) = if is_running(b.bundle_id) {
                access_label(automation_permission(b.bundle_id, ask))
            } else {
                ("notRunning", None)
            };
            out.push(BrowserAccess { bundle_id: b.bundle_id.into(), name: b.name.into(), access: access.into(), detail });
        }
        for (bundle_id, name) in UNSUPPORTED_BROWSERS {
            if is_running(bundle_id) || is_installed(bundle_id) {
                out.push(BrowserAccess { bundle_id: (*bundle_id).into(), name: (*name).into(), access: "unsupported".into(), detail: None });
            }
        }
        out
    }

    pub fn list_apps() -> Vec<AppInfo> {
        let own_pid = std::process::id() as i32;
        let mut apps: Vec<AppInfo> = running_apps()
            .into_iter()
            .filter(|a| a.regular && a.pid != own_pid && a.bundle_id != "com.apple.finder")
            .map(|a| AppInfo { bundle_id: a.bundle_id, name: a.name })
            .collect();
        apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        apps.dedup_by(|a, b| a.bundle_id == b.bundle_id);
        apps
    }

    pub fn open_in(url: &str, bundle_id: &str) -> Result<(), String> {
        Command::new("/usr/bin/open")
            .args(["-b", bundle_id, url])
            .status()
            .map_err(|e| e.to_string())
            .and_then(|s| if s.success() { Ok(()) } else { Err(format!("open exited with {}", s)) })
    }

    pub fn open_automation_settings() -> Result<(), String> {
        Command::new("/usr/bin/open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Automation")
            .status()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn dt(y: i32, m: u32, d: u32, h: u32, min: u32) -> NaiveDateTime {
        NaiveDate::from_ymd_opt(y, m, d).unwrap().and_hms_opt(h, min, 0).unwrap()
    }
    // 2026-11-23 is a Monday.
    fn win(days: &[u32], start: &str, end: &str) -> BlockWindow {
        BlockWindow { id: "w".into(), days: days.to_vec(), start: start.into(), end: end.into(), enabled: true }
    }
    fn sites(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn clock_is_strict() {
        assert_eq!(parse_clock("09:30"), Some(570));
        assert_eq!(parse_clock("23:59"), Some(1439));
        assert_eq!(parse_clock("9:30"), None);
        assert_eq!(parse_clock("24:00"), None);
        assert_eq!(parse_clock("12:60"), None);
    }

    #[test]
    fn same_day_window_covers_start_but_not_end() {
        let w = win(&[1, 2, 3, 4, 5], "09:00", "12:00");
        assert_eq!(window_end(&w, dt(2026, 11, 23, 9, 0)), Some(dt(2026, 11, 23, 12, 0)));
        assert_eq!(window_end(&w, dt(2026, 11, 23, 11, 59)), Some(dt(2026, 11, 23, 12, 0)));
        assert_eq!(window_end(&w, dt(2026, 11, 23, 12, 0)), None);
        assert_eq!(window_end(&w, dt(2026, 11, 23, 8, 59)), None);
        assert_eq!(window_end(&w, dt(2026, 11, 22, 10, 0)), None, "Sunday is not listed");
    }

    #[test]
    fn overnight_window_belongs_to_the_day_it_starts() {
        // Friday 22:00 to Saturday 02:00, listed on Friday only.
        let w = win(&[5], "22:00", "02:00");
        assert_eq!(window_end(&w, dt(2026, 11, 27, 23, 0)), Some(dt(2026, 11, 28, 2, 0)));
        assert_eq!(window_end(&w, dt(2026, 11, 28, 1, 30)), Some(dt(2026, 11, 28, 2, 0)));
        assert_eq!(window_end(&w, dt(2026, 11, 28, 2, 0)), None);
        assert_eq!(window_end(&w, dt(2026, 11, 28, 23, 0)), None, "Saturday night is not listed");
        assert_eq!(window_end(&w, dt(2026, 11, 27, 1, 0)), None, "Thursday night is not listed");
    }

    #[test]
    fn overnight_window_wraps_saturday_into_sunday() {
        let w = win(&[6], "23:00", "01:00");
        assert_eq!(window_end(&w, dt(2026, 11, 29, 0, 30)), Some(dt(2026, 11, 29, 1, 0)));
    }

    #[test]
    fn equal_start_and_end_is_a_full_day() {
        let w = win(&[1], "06:00", "06:00");
        assert_eq!(window_end(&w, dt(2026, 11, 23, 6, 0)), Some(dt(2026, 11, 24, 6, 0)));
        assert_eq!(window_end(&w, dt(2026, 11, 24, 5, 59)), Some(dt(2026, 11, 24, 6, 0)));
        assert_eq!(window_end(&w, dt(2026, 11, 23, 5, 59)), None);
    }

    #[test]
    fn disabled_or_malformed_windows_never_block() {
        let mut w = win(&[1], "09:00", "12:00");
        w.enabled = false;
        assert_eq!(window_end(&w, dt(2026, 11, 23, 10, 0)), None);
        assert_eq!(window_end(&win(&[1], "9:00", "12:00"), dt(2026, 11, 23, 10, 0)), None);
    }

    #[test]
    fn evaluate_prefers_a_running_task_and_reports_the_window_too() {
        let now = dt(2026, 11, 23, 10, 0);
        let mut config = BlockConfig { during_tasks: true, windows: vec![win(&[1], "09:00", "12:00")], ..Default::default() };
        let status = evaluate(&config, now);
        assert_eq!(status.reason.as_deref(), Some("window"));
        assert_eq!(status.window_until.as_deref(), Some("2026-11-23T12:00:00"));

        config.current_task = Some(CurrentTask { title: "Deep work".into(), running: true, allowed_sites: vec![] });
        let status = evaluate(&config, now);
        assert!(status.active);
        assert_eq!(status.reason.as_deref(), Some("task"));
        assert_eq!(status.task_title.as_deref(), Some("Deep work"));
        assert_eq!(status.window_until.as_deref(), Some("2026-11-23T12:00:00"));
    }

    #[test]
    fn evaluate_ignores_paused_tasks_and_the_during_tasks_switch() {
        let now = dt(2026, 11, 23, 10, 0);
        let task = |running| Some(CurrentTask { title: "T".into(), running, allowed_sites: vec![] });
        let paused = BlockConfig { during_tasks: true, current_task: task(false), ..Default::default() };
        assert!(!evaluate(&paused, now).active);
        let off = BlockConfig { during_tasks: false, current_task: task(true), ..Default::default() };
        assert!(!evaluate(&off, now).active);
        assert_eq!(evaluate(&BlockConfig::default(), now), BlockStatus::default());
    }

    #[test]
    fn evaluate_reports_the_longest_of_overlapping_windows() {
        let mut long = win(&[1], "08:00", "18:00");
        long.id = "long".into();
        let config = BlockConfig { windows: vec![win(&[1], "09:00", "12:00"), long], ..Default::default() };
        let status = evaluate(&config, dt(2026, 11, 23, 10, 0));
        assert_eq!(status.window_id.as_deref(), Some("long"));
    }

    #[test]
    fn site_normalization_matches_the_typescript_rules() {
        assert_eq!(normalize_site("https://www.YouTube.com/").as_deref(), Some("youtube.com"));
        assert_eq!(normalize_site("http://m.facebook.com/home.php?x=1#top").as_deref(), Some("m.facebook.com/home.php"));
        assert_eq!(normalize_site("www.youtube.com/shorts/").as_deref(), Some("youtube.com/shorts"));
        assert_eq!(normalize_site("youtube.com:443/watch").as_deref(), Some("youtube.com/watch"));
        for bad in ["", "youtube", "not a site", "-bad.com", "bad-.com", "a..com"] {
            assert_eq!(normalize_site(bad), None, "{bad}");
        }
    }

    #[test]
    fn domains_match_themselves_and_subdomains_only() {
        let list = sites(&["x.com", "youtube.com"]);
        assert_eq!(blocked_by("https://x.com/home", &list, &[]).as_deref(), Some("x.com"));
        assert_eq!(blocked_by("https://mobile.x.com/", &list, &[]).as_deref(), Some("x.com"));
        assert_eq!(blocked_by("https://www.youtube.com/watch?v=1", &list, &[]).as_deref(), Some("youtube.com"));
        assert_eq!(blocked_by("HTTPS://M.YOUTUBE.COM", &list, &[]).as_deref(), Some("youtube.com"));
        assert_eq!(blocked_by("https://box.com/", &list, &[]), None, "suffix but not a subdomain");
        assert_eq!(blocked_by("https://notyoutube.com/", &list, &[]), None);
        assert_eq!(blocked_by("https://example.com/?u=https://x.com", &list, &[]), None, "only the host counts");
        assert_eq!(blocked_by("https://user:pw@x.com:8443/a", &list, &[]).as_deref(), Some("x.com"));
    }

    #[test]
    fn only_web_pages_are_checked() {
        let list = sites(&["x.com"]);
        for url in ["chrome://settings", "file:///x.com", "about:blank", "missing value", ""] {
            assert_eq!(blocked_by(url, &list, &[]), None, "{url}");
        }
    }

    #[test]
    fn path_entries_match_that_section_only() {
        let list = sites(&["youtube.com/shorts"]);
        assert!(blocked_by("https://www.youtube.com/shorts", &list, &[]).is_some());
        assert!(blocked_by("https://www.youtube.com/shorts/abc?x=1", &list, &[]).is_some());
        assert!(blocked_by("https://www.youtube.com/shortsfoo", &list, &[]).is_none());
        assert!(blocked_by("https://www.youtube.com/watch?v=1", &list, &[]).is_none());
    }

    #[test]
    fn allowed_entries_let_a_site_through() {
        let list = sites(&["youtube.com", "x.com"]);
        let allowed = sites(&["youtube.com"]);
        assert_eq!(blocked_by("https://youtube.com/shorts/1", &list, &allowed), None);
        assert_eq!(blocked_by("https://x.com", &list, &allowed).as_deref(), Some("x.com"));
    }

    #[test]
    fn tab_lists_parse_and_tolerate_noise() {
        let out = "101\t7\thttps://x.com/home\n101\t8\tchrome://newtab/\n\ngarbage\n202\t3\thttps://a.com/p\tq\r\n";
        let tabs = parse_tab_list(out);
        assert_eq!(tabs.len(), 3);
        assert_eq!(tabs[0], OpenTab { window: "101".into(), tab: "7".into(), url: "https://x.com/home".into() });
        assert_eq!(tabs[2].url, "https://a.com/p\tq", "only the first two tabs split");
    }

    #[test]
    fn safari_closes_from_the_highest_tab_index_down() {
        let tab = |w: &str, t: &str| OpenTab { window: w.into(), tab: t.into(), url: "https://x.com".into() };
        let tabs = vec![tab("1", "2"), tab("1", "10"), tab("2", "1"), tab("1", "3")];
        let order: Vec<String> = tabs_to_close(tabs.clone(), &sites(&["x.com"]), &[], Engine::Safari)
            .into_iter()
            .map(|(t, _)| format!("{}:{}", t.window, t.tab))
            .collect();
        assert_eq!(order, ["1:10", "1:3", "1:2", "2:1"]);
        assert_eq!(tabs_to_close(tabs, &sites(&["x.com"]), &[], Engine::Chromium).len(), 4);
    }

    #[test]
    fn scripts_target_the_browser_and_never_embed_urls() {
        let (list, close) = scripts(browser("com.operasoftware.Opera").unwrap());
        assert!(list.contains(r#"tell application id "com.operasoftware.Opera""#));
        assert!(close.contains("on run argv"));
        assert!(!list.contains("BUNDLE") && !close.contains("BUNDLE"));
        let (safari_list, _) = scripts(browser("com.apple.Safari").unwrap());
        assert!(!safari_list.contains("id of every tab"), "Safari tabs have no id");
    }

    #[test]
    fn reopen_only_accepts_web_urls_and_plain_bundle_ids() {
        assert!(valid_bundle_id("com.google.Chrome"));
        assert!(!valid_bundle_id("com.google.Chrome; rm -rf /"));
        assert!(!valid_bundle_id(""));
        assert!(url_parts("javascript:alert(1)").is_none());
    }
}
