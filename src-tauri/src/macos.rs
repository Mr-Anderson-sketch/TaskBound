//! Direct AppKit access for focus-mode geometry and window chrome.
//!
//! Tao applies `set_position` / `set_always_on_top` asynchronously on macOS, which
//! would race with (and undo) a custom window level, so focus mode drives the
//! NSWindow directly. Every function here must run on the main thread; the
//! Tauri commands that call them are synchronous, which Tauri v1 runs there.

// objc 0.2's msg_send! expands a `cfg(feature = "cargo-clippy")` check into this crate.
#![allow(unexpected_cfgs)]

use crate::{NotchInfo, Rect, ScreenInfo};
use cocoa::base::{id, nil, YES};
use cocoa::foundation::{NSPoint, NSRect, NSSize, NSString};
use objc::runtime::BOOL;
use objc::{class, msg_send, sel, sel_impl};

const NS_NORMAL_WINDOW_LEVEL: isize = 0;
const NS_FLOATING_WINDOW_LEVEL: isize = 3;
const NS_STATUS_WINDOW_LEVEL: isize = 25;

const CAN_JOIN_ALL_SPACES: usize = 1 << 0;
const STATIONARY: usize = 1 << 4;
const IGNORES_CYCLE: usize = 1 << 6;
const FULL_SCREEN_AUXILIARY: usize = 1 << 8;

const VIBRANCY_ID: &str = "timebound-vibrancy";
const MATERIAL_POPOVER: isize = 6;
const BLENDING_BEHIND_WINDOW: isize = 0;
const STATE_ACTIVE: isize = 1;
const AUTORESIZE_WIDTH_HEIGHT: usize = 2 | 16;
const ORDER_BELOW: isize = -1;

const FALLBACK_MENU_BAR_HEIGHT: f64 = 24.0;

#[repr(C)]
#[derive(Clone, Copy)]
struct NSEdgeInsets {
    top: f64,
    left: f64,
    bottom: f64,
    right: f64,
}

#[derive(Clone, Copy)]
pub struct NativeWindowState {
    behavior: usize,
    min_size: NSSize,
    content_min_size: NSSize,
}

unsafe fn ns_string(s: &str) -> id {
    let value = NSString::alloc(nil).init_str(s);
    msg_send![value, autorelease]
}

unsafe fn responds(obj: id, selector: objc::runtime::Sel) -> bool {
    let r: BOOL = msg_send![obj, respondsToSelector: selector];
    r == YES
}

/// Height of the primary screen, used to flip Cocoa's bottom-left origin.
unsafe fn primary_height() -> f64 {
    let screens: id = msg_send![class!(NSScreen), screens];
    let count: usize = msg_send![screens, count];
    if count == 0 {
        return 0.0;
    }
    let primary: id = msg_send![screens, objectAtIndex: 0usize];
    let frame: NSRect = msg_send![primary, frame];
    frame.size.height
}

fn to_top_left(r: NSRect, primary_h: f64) -> Rect {
    Rect {
        x: r.origin.x,
        y: primary_h - (r.origin.y + r.size.height),
        w: r.size.width,
        h: r.size.height,
    }
}

fn to_cocoa(r: Rect, primary_h: f64) -> NSRect {
    NSRect::new(
        NSPoint::new(r.x, primary_h - (r.y + r.h)),
        NSSize::new(r.w, r.h),
    )
}

unsafe fn screen_info(screen: id, primary_h: f64) -> ScreenInfo {
    let frame_c: NSRect = msg_send![screen, frame];
    let visible_c: NSRect = msg_send![screen, visibleFrame];

    let mut safe_top = 0.0;
    if responds(screen, sel!(safeAreaInsets)) {
        let insets: NSEdgeInsets = msg_send![screen, safeAreaInsets];
        safe_top = insets.top;
    }

    let mut notch = None;
    if safe_top > 0.0
        && responds(screen, sel!(auxiliaryTopLeftArea))
        && responds(screen, sel!(auxiliaryTopRightArea))
    {
        let left: NSRect = msg_send![screen, auxiliaryTopLeftArea];
        let right: NSRect = msg_send![screen, auxiliaryTopRightArea];
        let width = frame_c.size.width - left.size.width - right.size.width;
        if width > 0.0 {
            notch = Some(NotchInfo {
                width,
                height: safe_top,
            });
        }
    }

    let frame_top = frame_c.origin.y + frame_c.size.height;
    let visible_top = visible_c.origin.y + visible_c.size.height;
    let mut menu_bar_height = frame_top - visible_top;
    if menu_bar_height < 1.0 {
        // Menu bar set to auto-hide: the visible frame reaches the top edge.
        menu_bar_height = if safe_top > 0.0 {
            safe_top
        } else {
            FALLBACK_MENU_BAR_HEIGHT
        };
    }

    ScreenInfo {
        frame: to_top_left(frame_c, primary_h),
        visible: to_top_left(visible_c, primary_h),
        menu_bar_height,
        notch,
    }
}

pub unsafe fn screens() -> Vec<ScreenInfo> {
    let primary_h = primary_height();
    let list: id = msg_send![class!(NSScreen), screens];
    let count: usize = msg_send![list, count];
    (0..count)
        .map(|i| {
            let s: id = msg_send![list, objectAtIndex: i];
            screen_info(s, primary_h)
        })
        .collect()
}

pub unsafe fn window_screen(ns_window: id) -> ScreenInfo {
    let mut screen: id = msg_send![ns_window, screen];
    if screen == nil {
        screen = msg_send![class!(NSScreen), mainScreen];
    }
    screen_info(screen, primary_height())
}

pub unsafe fn frame(ns_window: id) -> Rect {
    let r: NSRect = msg_send![ns_window, frame];
    to_top_left(r, primary_height())
}

/// Sets the frame in one call (no async hop, no separate move + resize flicker)
/// and returns the frame AppKit actually applied.
pub unsafe fn set_frame(ns_window: id, r: Rect) -> Rect {
    let target = to_cocoa(r, primary_height());
    let _: () = msg_send![ns_window, setFrame: target display: YES];
    frame(ns_window)
}

pub unsafe fn capture_native(ns_window: id) -> NativeWindowState {
    NativeWindowState {
        behavior: msg_send![ns_window, collectionBehavior],
        min_size: msg_send![ns_window, minSize],
        content_min_size: msg_send![ns_window, contentMinSize],
    }
}

pub unsafe fn restore_native(ns_window: id, state: NativeWindowState) {
    let _: () = msg_send![ns_window, setCollectionBehavior: state.behavior];
    let _: () = msg_send![ns_window, setContentMinSize: state.content_min_size];
    let _: () = msg_send![ns_window, setMinSize: state.min_size];
}

pub unsafe fn set_min_size(ns_window: id, w: f64, h: f64) {
    let size = NSSize::new(w, h);
    let _: () = msg_send![ns_window, setContentMinSize: size];
    let _: () = msg_send![ns_window, setMinSize: size];
}

/// The dark pill sits at status level so it can draw over the menu bar; the
/// light capsule only needs to float. Both follow the user across Spaces and
/// over full-screen apps.
pub unsafe fn set_focus_level(ns_window: id, menu_bar: bool) {
    let (level, behavior) = if menu_bar {
        (
            NS_STATUS_WINDOW_LEVEL,
            CAN_JOIN_ALL_SPACES | STATIONARY | FULL_SCREEN_AUXILIARY | IGNORES_CYCLE,
        )
    } else {
        (
            NS_FLOATING_WINDOW_LEVEL,
            CAN_JOIN_ALL_SPACES | FULL_SCREEN_AUXILIARY,
        )
    };
    let _: () = msg_send![ns_window, setCollectionBehavior: behavior];
    let _: () = msg_send![ns_window, setLevel: level];
}

pub unsafe fn set_always_on_top_level(ns_window: id, on_top: bool) {
    let level = if on_top {
        NS_FLOATING_WINDOW_LEVEL
    } else {
        NS_NORMAL_WINDOW_LEVEL
    };
    let _: () = msg_send![ns_window, setLevel: level];
}

pub unsafe fn set_appearance(ns_window: id, dark: bool) {
    let name = if dark {
        "NSAppearanceNameDarkAqua"
    } else {
        "NSAppearanceNameAqua"
    };
    let appearance: id = msg_send![class!(NSAppearance), appearanceNamed: ns_string(name)];
    if appearance != nil {
        let _: () = msg_send![ns_window, setAppearance: appearance];
    }
}

unsafe fn find_vibrancy_view(content: id) -> id {
    let key = ns_string(VIBRANCY_ID);
    let subviews: id = msg_send![content, subviews];
    let count: usize = msg_send![subviews, count];
    for i in 0..count {
        let view: id = msg_send![subviews, objectAtIndex: i];
        let ident: id = msg_send![view, identifier];
        if ident != nil {
            let same: BOOL = msg_send![ident, isEqualToString: key];
            if same == YES {
                return view;
            }
        }
    }
    nil
}

unsafe fn apply_corner_radius(view: id, radius: f64) {
    if responds(view, sel!(setCornerRadius:)) {
        let _: () = msg_send![view, setCornerRadius: radius];
        return;
    }
    let _: () = msg_send![view, setWantsLayer: YES];
    let layer: id = msg_send![view, layer];
    if layer != nil {
        let _: () = msg_send![layer, setCornerRadius: radius];
        let _: () = msg_send![layer, setMasksToBounds: YES];
    }
}

/// Adds (once) a behind-window NSVisualEffectView under the webview, or updates
/// its corner radius if it already exists.
pub unsafe fn set_vibrancy(ns_window: id, radius: f64) {
    let content: id = msg_send![ns_window, contentView];
    if content == nil {
        return;
    }
    let mut view = find_vibrancy_view(content);
    if view == nil {
        let bounds: NSRect = msg_send![content, bounds];
        let alloc: id = msg_send![class!(NSVisualEffectView), alloc];
        view = msg_send![alloc, initWithFrame: bounds];
        let _: () = msg_send![view, setIdentifier: ns_string(VIBRANCY_ID)];
        let _: () = msg_send![view, setMaterial: MATERIAL_POPOVER];
        let _: () = msg_send![view, setBlendingMode: BLENDING_BEHIND_WINDOW];
        let _: () = msg_send![view, setState: STATE_ACTIVE];
        let _: () = msg_send![view, setAutoresizingMask: AUTORESIZE_WIDTH_HEIGHT];
        let _: () = msg_send![content, addSubview: view positioned: ORDER_BELOW relativeTo: nil];
        // addSubview retains it; balance the alloc.
        let _: () = msg_send![view, release];
    }
    apply_corner_radius(view, radius);
}

pub unsafe fn clear_vibrancy(ns_window: id) {
    let content: id = msg_send![ns_window, contentView];
    if content == nil {
        return;
    }
    let view = find_vibrancy_view(content);
    if view != nil {
        let _: () = msg_send![view, removeFromSuperview];
    }
}
