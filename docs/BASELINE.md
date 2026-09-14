# TimeBound — Baseline (2026-09-14)

State of the product at the start of the focus-first rebuild. Screenshots in `docs/baseline/`.

## What exists

**Stack.** Electron 28.2 + React 18 + TypeScript 5.6 + Vite 5 + Tailwind 3. `@dnd-kit` for reorder, `uuid`, `fs-extra`. Packaged with electron-builder (NSIS). ~2,700 lines of renderer TypeScript, no tests, no linter beyond `tsc --noEmit`. A parallel `pwa/` tree duplicates most of the renderer.

**Build and run.** `npm run build` succeeds (tsc main, tsc preload, vite). The app launches from `dist/` with no console errors. One Electron security warning: no Content-Security-Policy.

**Data.** `%APPDATA%\TimeBound\state.json` with `.bak`. The real file on this machine has 26 tasks (all completed), score 12, 123 lifetime completions. Atomic write is temp → move → copy-to-bak on every save, pretty-printed.

**Window.** Frameless, transparent, custom title bar. Default size is a third of the screen wide by half tall. Always-on-top is a "PIN" toggle, off by default in the saved preferences. A "Focus Mode" button shrinks the window to 340×240 at the top-right corner and shows a single-task "spotlight" overlay.

### Screens captured

| Screen | File |
|---|---|
| Main, no active task, 455×360 default on a 1366×768 desktop | `main-default-455x360.png` |
| Main, tall | `main-empty.png` |
| Main with an active task and running timer | `main-active.png` |
| Add task modal | `add-task.png` |
| Edit task modal | `edit-task.png` |
| Add time modal | `add-time.png` |
| Upload dropdown | `upload-menu.png` |
| Row context menu | `context-menu.png` |
| "Focus mode" (340×240 spotlight) | `focus-mode-340x240.png` |

### Feature inventory (working)

- Add task via modal with required hours/minutes for the first task; edit via double-click; delete via context menu or Delete key; multi-select with Shift/Ctrl; bulk delete with confirm.
- Drag reorder (`@dnd-kit`).
- Countdown on the first open task; pause/resume; auto-strike at 0:00 with +1 score; manual complete with +2; add-time with −1.
- Score, lifetime and today counters in the header.
- Bulk import from `.txt`/`.csv` and from a paste modal.
- Reminder popup every 3 minutes when the active task has no time ("Set Time / Remind Later / Close App").
- Focus Spotlight overlay after 40 s of inactivity, or on demand.
- "Minimal mode": after 30 s with zero open tasks and pin on, window collapses to 340×80.
- Restart recovery: elapsed time since `lastSavedAt` is burned down through the queue on load.

## What is broken

Numbered findings from the code audit, all verified by reading the source.

1. **"Make Active" does not make a task active** (`App.tsx:398-411`). It re-inserts the task *after* the active one.
2. **Active task hidden when more than five tasks exist.** List is newest-first but the active task is the oldest open one, so it sits behind "Show More" (`App.tsx:131-137`).
3. **Paused tasks burn time across restarts.** `autoAdvance` ignores `isPaused` (`stateHelpers.ts:66-122`).
4. **Offline auto-completion awards no score** while live auto-completion awards +1.
5. **"Today" counter uses UTC** (`state.ts:29`, `stateHelpers.ts:5`) and **never resets on a new day** until the next completion.
6. **Two 1 Hz tick sources** (renderer interval + main IPC) feed one delta ref; an out-of-order tick produces a negative delta and a spurious one-second credit (`state.ts:490-493`).
7. **Add Time silently clamps** to 180 min after letting the user type 3h59m; Edit caps at 240 min. Inconsistent.
8. **Score-penalty warnings fire when no penalty applies** (`App.tsx:472-477`, `AddTimeModal.tsx:63`).
9. **Single delete is silent and unrecoverable.** No undo anywhere.
10. **CSV import drops any first row containing "task" or "time"**; naive `split(',')`.
11. **Bulk import bypasses the time requirement**, immediately triggering the nag loop.
12. **`formatSeconds` has no hours field**: a 4-hour task renders as `240:00`.
13. **Title bar responsive classes are inverted** (`TitleBar.tsx:34,38`): the logo is largest in the narrowest window.
14. **Every save rewrites the whole pretty-printed file three times**; `history` is never pruned; every tick deep-clones every task.
15. **Renderer reload skips elapsed-time replay** (`main.ts:151-154` returns the cache untouched).
16. **No schema version or migration path.**
17. **`uuid()` called inside the reducer** under StrictMode.
18. **Reminder timer restarts on any state change**, so the nag can be deferred forever; spotlight (`z-50`) covers the reminder (`z-40`).
19. **Escape does not close modals.** No `role="dialog"`, no focus trap, no autofocus.
20. **Context menu can render off-screen**, has no ARIA, no keyboard.
21. **Toast has no `aria-live`** and uses the error colour for success.
22. **Contrast failures** on disabled buttons (`text-brand-ice/30`) and "Close App" (`/40`).
23. **The whole root is an OS drag region**, so text cannot be selected and stray clicks move the window.
24. **Dead code**: unused `uuid` import in App, 55 lines of `.modern-range` CSS, five unused theme tokens, unreachable fallbacks, duplicate "+ Add Task" buttons, copy-pasted bulk parser.

## What is missing (against the mission)

**Focus mode.** The current "focus mode" is a 340×240 window (81,600 px², 240 px tall). The target is a strip under 40 px tall, edge-dockable, per-monitor position memory, never covers the taskbar, never steals keyboard focus, hover/hotkey expand, auto-hide with edge peek, optional click-through and transparency, and a collapsed pill. None of this exists.

**Global hotkeys.** None. No quick capture, no toggle-focus, no complete-and-advance.

**Natural-language capture.** None. Tasks are added through a modal with hour/minute number inputs.

**Task model.** No projects/lists, tags, sub-tasks, recurrence, snooze, due dates, or keyboard reorder. No command palette. No single-key actions.

**Daily ritual.** No planning, rollover, or day-close review.

**Timeboxing polish.** No pomodoro, no time-in-strip (the strip does not exist).

**Notifications, login, tray.** No native notifications, no start-on-login, no tray icon.

**Data.** No import/export (JSON or Markdown), no automatic dated backups (one `.bak` only), no migrations, no schema version.

**Accessibility.** No screen-reader labels on modals, no reduced-motion handling, no text-scaling awareness.

**Design.** No `DESIGN.md`. No declared typeface (falls to the OS sans). One dark navy/coral theme, no light variant, no OKLCH, no contrast verification. Generic "dark dashboard" look.

**Selling.** No onboarding, no settings screen, no README with screenshots, no licensing seam.

**Quality.** No unit tests, no Playwright tests, no CI, no lint.

## Measured footprint (baseline)

| Mode | Size | Area | Notes |
|---|---|---|---|
| Default window on 1366×768 | 455×360 | 163,800 px² | ~17% of the desktop |
| "Focus mode" | 340×240 | 81,600 px² | 240 px tall, 6× the 40 px target |
| "Minimal mode" | 340×80 | 27,200 px² | only when zero open tasks and pinned |

## Toolchain on this machine

Node 22.17, npm 10.9, Playwright 1.59 (global), two 1366×768 displays at 96 DPI. Larger desktops (1920×1080, 2560×1440) are not physically available; strip footprint will be measured in absolute pixels and reported as a percentage of those desktops.
