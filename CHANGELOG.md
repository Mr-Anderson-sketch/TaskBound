# Changelog

All notable changes to TimeBound. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow SemVer.

## [Unreleased]

### Data (2026-09-15)
- Data: export and import JSON or Markdown, keep your data in any folder (even a synced one), and restore from daily backups.

### Windows integration (2026-09-15)
- Windows: optionally reserve screen space for the strip, and hide it over full-screen apps.

### Planner (2026-09-15)
- The planner window is now the real thing: a rail (Today, Upcoming, Inbox, your lists, tags used by open tasks, and the Logbook, each with counts) next to a task list. Today shows Current/Up next/Done; Upcoming groups what's due over the next two weeks by date; the Logbook (done tasks, newest first) virtualises so it stays fast at any size. The title bar's capture field expands inline to the same live-parsed capture as the hotkey, defaulting new tasks to whatever list you're looking at.
- The planner is now fully keyboard-driven: `j`/`k` (or arrows) move the selection, `Space` completes, `e` edits the title inline, `t` toggles today, `x`/`Delete` deletes (with an Undo toast), `s` snoozes, `d` sets a due date, `m` moves to another list, `Shift+↑/↓` reorders, `g` then `t`/`u`/`i`/`l` jumps to a view, and `Ctrl+K`/`⌘K` opens an in-planner command palette (fuzzy search over views, lists, tags, the selected task's actions, and theme/appearance).

### Timers (2026-09-15)
- Timers: start and pause from the panel, tray, or Ctrl+Alt+Shift+Enter; a notification when time is up; optional pomodoro breaks; timers pause when you step away or the computer sleeps.

### Recurrence (2026-09-15)
- Repeating tasks: completing one schedules the next occurrence.

### Undo (2026-09-15)
- Undo from the strip, the planner, and Ctrl+Alt+Backspace, with a confirmation toast.

### Daily ritual (2026-09-15)
- The day now rolls over at 4 AM local (immediately on launch too, and again on system resume/unlock), carrying open tasks still marked Today forward and recording how many rolled over. "Plan today" (tray, or the strip's plan chip) lists what rolled over, what's due or overdue, and up to 10 Inbox tasks — arrow keys/j·k to move, Space to check, Enter to commit. "Close the day" (tray) shows today's completed count, focus time, and rolled-over count, with an optional note.

### Capture (2026-09-15)
- Quick capture now parses as you type: dates/times, `#tags`, `/list`, durations (`25m`, `1h30`), and repeats show up as live token chips beneath the input. Escape once keeps whatever you typed as a literal title (wraps it in quotes); Escape again closes. Pasting several lines adds one task per line.

### Focus strip (2026-09-15)
- The app now launches straight into a 32 px focus strip docked to the bottom of your screen — the old sticky-note main window is gone.
- The strip shows your current task, a running/paused/overtime timer chip, and a hairline progress bar for today; hover it to open a panel with today's next few tasks (complete, skip, or snooze without leaving the strip).
- `Ctrl+Alt+Space` opens a one-line capture field anywhere; `Enter` adds it to Today, `Shift+Enter` also makes it current.
- `Ctrl+Alt+Shift+Space` shows/hides the strip, `Ctrl+Alt+Enter` completes the current task, `Ctrl+Alt+Backspace` undoes the last change — all customizable in Settings (Slice 2).
- A tray icon shows the current task and offers Complete, Quick capture, Show/Hide strip, and Open planner.
- A placeholder planner window (double-click the strip title, or the tray's "Open planner") lists today's tasks; the full planner arrives in Slice 4.
- Ledger (light/dark) is the default theme and now follows the OS light/dark setting automatically.

### Setup (2026-09-14)
- Captured the pre-rebuild app in `docs/BASELINE.md` with screenshots and a code audit.
- Wrote the focus-first spec, three independent reviews with every decision recorded, `DESIGN.md`, and `docs/PLAN.md`.
- Added four OKLCH themes (Ledger, Kraft, Phosphor, Slate) in light and dark, generated to CSS and verified for AA contrast by `scripts/check-contrast.mjs`.
- Upgraded Electron and electron-builder; added Vitest (two time zones), Playwright for Electron with an isolated-data launcher, zod, immer, date-fns, react-virtual, bundled fonts.
- Added the Sonnet implementer agent definition and `CLAUDE.md`.
- Retired the `pwa/` tree (a focus strip cannot exist in a browser).

## [1.0.0] — 2025-12
- Original timeboxing sticky-note app: countdown per task, score, reminder popup, bulk import, focus spotlight.
