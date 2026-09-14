# TimeBound Focus-First Rebuild — Design Spec

Date: 2026-09-14. Author: founder/lead engineer (self-answered brainstorm; no human questions per mission rules).

## Part 1 — Brainstorm: questions and founder answers

**Q1. Who is the customer, concretely?**
A Windows 11 knowledge worker who already keeps a task list and hates that it lives in a tab they never look at. They run one task at a time, like keyboard shortcuts, and will pay a one-time price for something that feels crafted. Secondary: macOS users of the same type, as long as it costs little to keep working.

**Q2. What is the one job?**
Keep the current task in front of the user without getting in the way. The strip is the product. The full window is the back office where you plan; the strip is where you live.

**Q3. Does TimeBound stay a timeboxing game (PRD) or become a task app with timers?**
Task app with first-class timers. The timer runs on the current task when the user wants it. The score system becomes an opt-in "Score" setting, off by default, kept for existing users. The three-minute nag popup is removed; a timeless current task shows a quiet hint in the strip instead. Rationale: the mission names non-intrusiveness as the key factor, and a nag is the opposite.

**Q4. Why not a browser/PWA?**
A strip that sits above every window, never takes focus, can be click-through, docks to an edge, and reacts to global hotkeys cannot exist in a browser. The `pwa/` tree is retired.

**Q5. What does the strip show?**
Expanded strip (default, ≤ 36 px tall): a status dot, the current task title, a timer chip when a timer runs, a dim "next: …" title, and a tiny "3/7" counter. Pill (collapsed): one line, current title truncated at a user-set width, timer if running. Hover or hotkey opens a drop-down "short list" of the next few tasks with complete/skip/snooze actions. Pointer leaving collapses it after a short delay.

**Q6. What does "never steals focus" mean in practice?**
The strip window is created `focusable: false` and `skipTaskbar: true`. Every strip action goes through IPC to the main process without focusing the window. Quick capture is a separate, focusable palette window that hides on submit, blur, or Escape. When a window hides, Windows activates the next window in Z-order, which is the app the user was in, so focus returns without a native module. This is verified in the Playwright suite; if a case fails, the gap is documented.

**Q7. What task model does a productivity nerd expect in v1?**
Lists (a.k.a. projects), tags, one level of sub-tasks, due date + optional time, recurrence (daily, weekdays, weekly on days, monthly on day N, every N days/weeks), snooze (until a time or tomorrow), notes, a "today" flag, ordering by drag or keyboard. No priorities beyond order plus the today flag. No dependencies, no attachments.

**Q8. What is the daily ritual?**
Morning: a "Plan today" sheet lists yesterday's leftovers and due-or-overdue tasks; the user toggles what goes into Today with space/enter and confirms. Under a minute. Evening (or when the last today task completes): a "Close day" card shows done count, focus time, what rolled over, with one optional note. Both are dismissible and never modal over other apps.

**Q9. Timeboxing?**
Start/pause/stop a timer on the current task. Optional pomodoro mode (25/5 default, configurable). Time remaining or elapsed shows in the strip. Timer state survives restart. Native notification at zero.

**Q10. Which hotkeys?**
Defaults, all rebindable in settings: `Ctrl+Alt+Space` quick capture, `Ctrl+Alt+F` toggle focus mode, `Ctrl+Alt+Enter` complete current and advance, `Ctrl+Alt+T` start/pause timer. Registered with Electron `globalShortcut`; conflicts are shown in settings.

**Q11. Where does data live?**
`%APPDATA%\TimeBound\data.json`, schema-versioned, atomic write (temp → rename), dated backups in `backups/` rolling 30, plus a legacy import of `state.json` on first run (never deleted). Export/import JSON and Markdown. No account, no network.

**Q12. Cloud sync?**
Out of scope. Proposal recorded in DECISIONS.md: file-based sync via a user-chosen folder (OneDrive/Dropbox/Syncthing) with last-writer-wins and a conflict copy. Free and private. Not built now.

**Q13. Themes?**
Four named themes, each light and dark, built in OKLCH, AA-verified by a script. Direction chosen in DESIGN.md via the design-consultation skill. Inspiration: stationery and classic hardware, not dashboards.

**Q14. Accessibility floor?**
Every control reachable by keyboard; ARIA names on all icon buttons; dialogs are real dialogs with focus traps; `prefers-reduced-motion` disables non-essential motion; type in rem so OS text scaling applies; strip contrast AA in every theme.

**Q15. Licensing?**
A `src/main/licensing/` module with one exported `getLicenseStatus()` that returns `{ tier: 'free' }`. UI reads it through one hook. Nothing else knows about licensing.

**Q16. Name?**
TimeBound stays.

## Part 2 — Approaches considered

**A. Bolt a strip window onto the existing renderer store.** Two renderers each holding state, synced through IPC broadcasts. Fastest start; guaranteed divergence bugs, and the existing store already has the timer-drift and persistence problems in BASELINE.md.

**B. Move the store to the main process; renderers are views.** (Recommended.) One source of truth, pure reducers in a `core/` package testable with Vitest, IPC is `dispatch(action)` in and `state` snapshots out. Strip, main window, capture palette, and tray all read the same state. Undo is a command log in core. Timer ticks live in main, so the strip stays correct even when the main window is closed.

**C. Rewrite in Tauri.** Smaller binary, but click-through, per-monitor work areas, and global shortcuts are less mature, and the team knows Electron. Rejected.

## Part 3 — Design

### 3.1 Process and window topology

- **Main process** owns: store (`core` reducers + persistence), timer clock, global shortcuts, tray, notifications, window manager, licensing seam.
- **Windows:**
  - `strip` — frameless, transparent, always-on-top (`screen-saver` level), `focusable: false`, `skipTaskbar`, `resizable: false`, size set programmatically. One per app (docked to one display at a time; position remembered per display id).
  - `main` — normal framed-less window with custom title bar; the planner. Closing it hides to tray; the app keeps running for the strip.
  - `capture` — small centred palette window, `alwaysOnTop`, focusable, hides on blur/Escape.
- **Renderer** is one Vite app with three entry routes (`#/strip`, `#/main`, `#/capture`) sharing components and theme.

### 3.2 Data model (schema v2)

```ts
interface Data {
  schemaVersion: 2;
  tasks: Task[];
  lists: List[];
  tags: string[];            // derived cache, rebuilt on load
  days: DayRecord[];         // one per calendar day with activity
  settings: Settings;
  meta: { createdAt: string; lastSavedAt: string; appVersion: string };
}
interface Task {
  id: string; title: string; notes?: string;
  listId: string;            // default list 'inbox'
  parentId?: string;         // one level only
  tags: string[];
  order: number;             // fractional ordering within list/parent
  today: boolean;
  dueAt?: string;            // ISO date or datetime, local
  snoozedUntil?: string;
  recurrence?: Rule;         // { kind:'daily'|'weekdays'|'weekly'|'monthly'|'everyN', days?, dayOfMonth?, n?, unit? }
  timer?: { plannedSeconds?: number; spentSeconds: number; runningSince?: string };
  status: 'open' | 'done';
  createdAt: string; updatedAt: string; completedAt?: string;
}
interface DayRecord { date: string; completed: number; focusSeconds: number; rolledOver: number; note?: string; closedAt?: string }
interface Settings {
  theme: { name: string; mode: 'light'|'dark'|'system' };
  strip: { enabled: boolean; edge: 'top'|'bottom'|'left'|'right'; width: number; collapsed: boolean; autoHide: boolean; clickThrough: boolean; opacity: number; positions: Record<displayId, {x:number;y:number}> };
  hotkeys: Record<'capture'|'toggleFocus'|'completeAdvance'|'toggleTimer', string>;
  pomodoro: { enabled: boolean; work: number; break: number };
  score: { enabled: boolean; value: number };   // legacy game, opt-in
  startOnLogin: boolean; notifications: boolean; reducedMotion: 'system'|'on'|'off';
  onboardingDone: boolean;
}
```

**Current task** = first open task with `today` (ordered), else first open task in the "Today" view order. Explicit, derived, tested.

**Migration v1 → v2.** Legacy `state.json` tasks become tasks in list `inbox` with `timer.plannedSeconds = timeAssignedSeconds`, `spentSeconds = timeAssigned − remaining`, status mapped `completed|struck → done`. Score and counters move into `settings.score.value` and `days`. The legacy file is left in place and a copy stored in `backups/legacy-state.json`.

### 3.3 Core package (`src/core/`)

Pure TypeScript, no Electron imports. Modules: `reducer.ts` (actions), `select.ts` (current/next/today views), `parse.ts` (natural-language capture), `recur.ts` (next occurrence), `timer.ts` (tick math from wall clock, drift-free), `undo.ts` (inverse-action stack, 50 deep), `migrate.ts`, `export.ts` (JSON/Markdown). All unit-tested with Vitest.

**Parser grammar (v1):** trailing/embedded tokens: `#tag`, `@list` or `/list`, dates (`today`, `tomorrow`, `mon…sun`, `next week`, `in 3 days`, `sep 20`, `20/9`), times (`3pm`, `15:00`, `at 9`), durations (`25m`, `1h30`, `for 45 min`), recurrence (`every day`, `every weekday`, `every monday`, `every 2 weeks`, `monthly`). Everything unconsumed is the title. Deterministic, English only, documented.

### 3.4 IPC contract

`invoke('store:dispatch', action)`, `invoke('store:get')`, `on('store:changed', snapshot)`. Window commands: `strip:setEdge`, `strip:setCollapsed`, `strip:expandList`, `capture:show/hide`, `main:show`. The preload exposes exactly this typed surface and nothing else. CSP set in `index.html`.

### 3.5 Strip behaviour

- Height 32 px expanded row, 24 px pill. Width default 420 px, user-drag-resizable via a grip (min 160, max 1200).
- Docks flush to the chosen edge inside the display work area (never over the taskbar). Drag to move along the edge; dragging near another edge re-docks. Position saved per display id; on display change, re-validated against current bounds.
- Hover ≥ 150 ms or hotkey expands a list panel below/above (depending on edge) with the next 5 tasks; pointer leave + 300 ms collapses. Panel is part of the same window (window grows), still `focusable: false`.
- Auto-hide: strip slides to a 4 px sliver on the edge after 3 s without pointer; hover the edge to peek.
- Click-through: `setIgnoreMouseEvents(true, { forward: true })`, with a 20 px "handle" zone that stays interactive so it can be turned off.
- Opacity slider 40–100 %.
- Strip content: dot (colour by state), title, timer chip, "next" title, counter. Long titles ellipsise; a title over the width fades at the edge rather than wraps.

### 3.6 Main window

Left rail: Today, Upcoming, Inbox, lists, tags. Centre: task list with inline editing, keyboard navigation (j/k or arrows, space toggles done, e edit, t today, s snooze, d due, x delete with undo toast, Enter opens). Top: capture bar (same parser). Command palette `Ctrl+K`. Right-side detail pane for notes, sub-tasks, recurrence, timer. Plan-today and close-day appear as sheets in this window.

### 3.7 Error handling

- Corrupt data file → try latest backup, then previous backups in order; if all fail, start empty and keep the corrupt file as `data.corrupt-<ts>.json`, show a banner.
- Write failures → retry once, then notify, keep in-memory state, keep retrying on next change.
- Hotkey registration failure → settings shows the conflict; app keeps running.
- Display removed → strip re-docks to primary display work area.

### 3.8 Testing

- Vitest: parser (table-driven), recurrence (incl. month-end, DST), reducer + undo (property: undo(do(x)) = x), migrate (real legacy fixture), timer math, export/import round-trip.
- Playwright (Electron): capture → task appears in strip; complete-and-advance; focus toggle hotkey; theme switch persists; restart persistence; strip footprint measured and asserted < 40 px.
- A ten-minute scripted session checking zero console errors.

### 3.9 Out of scope for this cycle

Cloud sync, mobile, calendar integration, attachments, collaboration, payments.
