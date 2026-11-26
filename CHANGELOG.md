# Changelog

## Unreleased

### Block distractions (macOS)
- While a task's timer runs, TimeBound closes browser tabs on your block list and hides blocked apps. Only the matching tab closes; the browser and your other tabs stay open. Paused tasks don't block.
- Starts with X/Twitter, YouTube, Instagram, TikTok and Facebook. Add any site, or just part of one ("youtube.com/shorts").
- Scheduled blocks: "Weekdays 9:00–12:00" blocks on a schedule whether or not a task is running. Overnight windows work.
- Works in Chrome, Safari, Opera, Brave, Edge, Vivaldi and Chromium. Firefox and Arc can't be read yet; add them as blocked apps to hide them instead.
- When a tab is closed you can allow that site for the rest of the task. It costs a point, like adding time, and reopens the tab.
- The shield in the header shows when blocking is on and opens the settings, including which browsers TimeBound may control and a shortcut to System Settings if one was refused.

### Plan ahead
- Give a task a start time: type "Standup 9:30 15m", "Deep work 1h30 at 2pm" or "Gym tomorrow 6pm", or use "Start at a set time" when adding or editing. Hours without am/pm read as working hours (7–11 morning, 1–6 afternoon).
- Scheduled tasks wait in their own section. At their time they move to the front and start; whatever was running keeps its time and goes next.
- Right-click a scheduled task to start it now or unschedule it.

### Fixes
- Menus now open above notifications instead of underneath them.

## 1.2.0 — 2026-10-16

### New look
- Two themes with a toggle in the header: **Island** (dark) and **Frost** (light, native frosted glass on macOS).
- Focus mode is now a small widget instead of a big overlay. In dark mode it is a black pill in the menu bar that wraps around the notch; in light mode a frosted capsule above the Dock. Hover to open its controls; it shrinks back when you move away. Drag it anywhere and it remembers.
- Leaving focus mode puts the main window back exactly where it was.
- The task list reads in the order tasks will run. Finished tasks move to a "Done today" section.
- One Add field instead of two Add buttons, an edit pencil on hover, and a right-click menu with Start now, Do next, Edit, Add time and Delete.

### New features
- Quick add understands times: "Review deck 20m", "Deep work 1h30", "45 min".
- Countdown in the macOS menu bar (tray tooltip on Windows), with Pause, Complete and Focus in its menu.
- Time's up: a soft chime, a notification, and a choice of "+5 min" or "OK".
- ⌘⇧Space (Ctrl+Shift+Space on Windows) jumps to quick add from any app.
- Keyboard shortcuts: Space pause, ⌘↵ done, ⌘= +5 minutes, N add, F focus, Esc leave focus.
- Today summary: tasks done, time focused, early finishes, and how your estimates compared with the time spent.
- "Clear finished tasks" and "Reset focus position" in the menu.

### Fixes
- "Today" now follows your local calendar day (it used UTC) and reads 0 after midnight.
- Editing a task to give it more time works again (the confirmation dialog never appeared on macOS).
- Closing the lid or sleeping no longer burns through your tasks; that time isn't charged.
- "Keep on top" off is remembered after a restart.
- If saved tasks can't be read, the app no longer saves an empty list over them, and an unreadable file is kept aside.
- Saving no longer fails on a fresh install.

### Removed
- The full-window spotlight that appeared after 40 seconds of inactivity, the automatic "minimal mode" resize, and the 3-minute "time not set" popup (replaced by a "Set time" prompt on the current task).

## 1.0.0 — 2025-12
- Original timeboxing sticky-note app.
