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

---

## Part 4 — Review record (autoplan, single-model mode: Codex not installed)

### 4.0 CEO Step 0 — founder analysis

**0A Premise challenge**

| Premise | Stated? | Verdict |
|---|---|---|
| P1 A ≤ 40 px strip is what "tasks always in front of you" means | Stated in mission | Accepted. The old 340×240 window proves the failure mode: too big, so users pin it off (the saved preference on this machine has `alwaysOnTop: false`). |
| P2 Non-intrusive beats gamified | Stated in mission | Accepted. Score kept opt-in so nothing existing users had is lost. |
| P3 Electron is the right stack | Assumed | Accepted with evidence: click-through, focusable:false, globalShortcut, per-display work areas are all first-party Electron APIs. |
| P4 Lists + tags + subtasks + recurrence is the right v1 model | Assumed | Challenged. Each is cheap in a pure reducer, but each adds UI surface to the planner. Kept because "productivity nerd" buyers screen on this checklist before trying the strip. Priority stays out (order is priority). |
| P5 No cloud sync is fine for a paid app | Assumed | Accepted for v1; folder-sync proposal recorded. Risk noted in 6-month regret. |
| P6 One focus strip is enough (no per-list strips, no widgets) | Assumed | Accepted. One strip is the product; more is dilution. |

**0B Existing code leverage map**

| Sub-problem | Existing code | Reuse? |
|---|---|---|
| Atomic write + backup | `src/main/stateManager.ts:41-47` | Pattern reused; rewritten to temp→rename only, dated backups added |
| Elapsed-time replay on restart | `src/shared/stateHelpers.ts:66-122` | Replaced by wall-clock timer model (`runningSince`); no replay loop needed |
| Legacy schema | `src/shared/types.ts` | Becomes the v1 input type for `migrate.ts` |
| Drag reorder | `@dnd-kit` usage in `App.tsx:1065-1090` | Library kept; component rewritten |
| Bulk import parser | `App.tsx:516-616` | Replaced by `core/parse.ts` + `core/import.ts` with tests |
| Custom title bar | `TitleBar.tsx` | Rewritten to the new design system |
| Icons/branding | `build/icon*.png`, `public/Logos` | Kept |

**0C Dream state**

```
CURRENT                     THIS PLAN                          12-MONTH IDEAL
340×240 "focus mode"   →    32 px strip, hover list,      →    strip + optional folder sync,
window, nag popup,          global hotkeys, tray, NL           calendar overlay (read-only ICS),
one theme, no tests         capture, 4×2 themes, tests,        macOS parity, Markdown vault
                            installer                          import, per-list strips (maybe)
```

**0C-bis Implementation alternatives**

| Approach | Effort (CC) | Risk | Pros | Cons |
|---|---|---|---|---|
| A Bolt strip onto renderer store | 1 day | High | Fast | Two sources of truth; inherits tick drift |
| B Main-process store, core package (chosen) | 3–4 days | Medium | One truth, testable, tray/strip work without main window | Larger rewrite |
| C Tauri rewrite | 1–2 weeks | High | Small binary | Immature click-through/edge APIs on Windows; migration cost |

**0D Mode: SELECTIVE EXPANSION.** Scope held to the spec; expansions approved only if in blast radius and < 1 day: (1) tray menu with next three tasks (approved, in `tray.ts`), (2) Markdown export (already in), (3) "Focus stats" week view (deferred to TODOS), (4) per-list strips (rejected, dilutes).

**0E Temporal interrogation**

- Hour 1: user installs, onboarding asks for one task, strip appears docked top-centre, hotkeys shown once. Risk: SmartScreen warning on unsigned installer.
- Hour 2: user tries to drag the strip; it must move without stealing focus. Risk: drag on `focusable:false` window.
- Hour 6+: user opens a fullscreen video; strip must not overlay it. Windows hides always-on-top over exclusive fullscreen; borderless-fullscreen games will still show it. Auto-hide covers most of it; a "hide when a fullscreen app is active" toggle is deferred.
- Day 2: Plan-today sheet appears in the main window when the strip is clicked or on first hotkey; never as a popup over other apps.
- Week 2: 300 tasks; strip reads only derived `current/next`, list is virtualised.

**0F Mode confirmation.** SELECTIVE EXPANSION, confirmed by the founder.

**NOT in scope (deferred to TODOS.md):** cloud/folder sync, focus stats, fullscreen-app detection toggle, calendar overlay, macOS-specific polish beyond "builds and runs", Markdown vault import, per-list strips.

**Error & Rescue Registry**

| Error | Where | Rescue | User sees |
|---|---|---|---|
| `data.json` unparsable | `persist.ts` load | Try `backups/` newest→oldest; else start empty, keep corrupt file as `data.corrupt-<ts>.json` | Banner in main window: "Restored from backup taken <time>" or "Could not read your data; a copy was kept at …" |
| Write fails (disk full, locked) | `persist.ts` save | Retry once after 500 ms; keep in-memory; retry on next change; log | Toast after 2 failures: "Changes are not being saved: <reason>" |
| Legacy `state.json` invalid | `migrate.ts` | Skip import, keep file, log | Onboarding notes "No previous data found" |
| Global hotkey registration fails | `hotkeys.ts` | Keep running; mark conflict | Settings shows "In use by another app" next to the binding |
| Display removed while strip docked there | `strip.ts` on `display-removed` | Re-dock to primary work area | Strip moves; no message |
| Renderer crashes (`render-process-gone`) | `windows.ts` | Reload window once; if again, show error window | "TimeBound hit a problem and reloaded" |
| Import file malformed (JSON/MD) | `core/import.ts` | Validate with schema; reject whole file; no partial writes | Dialog: "Could not import: line N …" |
| Notification API unavailable | `notify.ts` | Fall back to strip flash | none |
| Timer `runningSince` in the future (clock moved back) | `core/timer.ts` | Clamp elapsed to ≥ 0; re-anchor `runningSince = now` | none |

**Failure Modes Registry**

| Failure mode | Likelihood | Impact | Mitigation | Critical gap? |
|---|---|---|---|---|
| Strip steals focus on click (Windows activates window) | Medium | High (core promise) | `focusable:false` + `setSkipTaskbar` + `show` with `inactive`; Playwright asserts `isFocused()===false` after click | Verify in slice 1 spike |
| Click-through leaves user unable to reach the strip | Medium | Medium | 20 px handle zone always interactive; tray + hotkey can disable | No |
| Strip covers taskbar when taskbar auto-hides | Low | Medium | Dock inside `workArea`; re-check on `display-metrics-changed` | No |
| Two instances | Low | Medium | `requestSingleInstanceLock` already present (`main.ts:217`) | No |
| DST/clock change corrupts timer | Low | Medium | Wall-clock timer with clamp | No |
| 500 tasks slow the strip | Low | Low | Strip subscribes to derived `{current,next,counts}` only | No |
| Data loss on crash mid-write | Low | High | temp→rename; dated backups every save-day; rolling 30 | No |
| Migration mangles legacy data | Medium | High | Fixture test with the real 26-task file; legacy file never touched | No |

### 4.2 Design review (Claude subagent, independent) — findings and decisions

Reviewer verdict: the architecture was more specified than the product; the strip needed pixel-level anatomy and every state. All findings below were auto-decided by the founder using the autoplan principles (completeness, explicit over clever, bias to action). Rejections are marked.

| # | Finding | Sev | Decision |
|---|---|---|---|
| D1 | Five elements in a 420×32 strip leaves ~170 px for the title | high | **Accept.** Strip = dot + title + timer chip. "Next" and counter move to the panel's first row. Today progress becomes a 2 px hairline along the strip's outer edge. |
| D2 | "3/7" ambiguous | med | **Accept.** Hairline = done/total for Today; text form only in the panel ("3 of 7 done"). |
| D3 | Pill defined by width, not content | med | **Accept.** Pill = title only, max 240 px; running timer replaces the title's tail. |
| D4 | Loading state shows a blank rectangle | med | **Accept.** Strip window `show:false` until the first snapshot. |
| D5 | No-tasks state unspecified | crit | **Accept.** Strip shows "Nothing yet · Ctrl+Alt+Space to add". This is onboarding. |
| D6 | Today empty, Inbox not: current-task rule circular | high | **Accept.** Fallback = first open Inbox task, dot in "unplanned" colour, "Plan today" chip in panel. |
| D7 | All Today done: nothing visible in the strip | high | **Accept.** Strip shows "Done for today · 7/7" with a check; close-day card opens from the strip. |
| D8 | Error banner location unspecified while main window hidden | high | **Accept.** Dot turns warning colour with tooltip; banner in panel; native notification on corrupt-data recovery. |
| D9 | Hotkey completion has no feedback and no undo | crit | **Accept.** 1.2 s strike on the outgoing title then the new title slides in; panel shows Undo for 5 s; `Ctrl+Alt+Backspace` undoes the last action globally. |
| D10 | Timer states undifferentiated | high | **Accept.** Remaining when planned, else elapsed. Paused: chip dims with "‖". Overtime: "+2:14" warning colour, unclamped. Break: "Break · 4:32", dot green. |
| D11 | Snoozed tasks not excluded from current/next | high | **Accept.** Excluded until `snoozedUntil`; return at original order with a one-time dot pulse. |
| D12 | Overdue not reflected | med | **Accept.** Dot colour = overdue; due chip in panel rows. |
| D13 | Click-through has no visual indicator | crit | **Accept.** Dashed border + lock glyph in the handle; 3 s toast on enable. |
| D14 | Onboarding absent | crit | **Accept.** First run opens no main window: strip docks top-centre with the D5 prompt; capture palette; title settles in with a 600 ms animation. Existing users see "Imported N tasks". |
| D15 | `Ctrl+Alt+<letter>` is AltGr on many layouts | crit | **Accept, different fix.** Keep the `Ctrl+Alt` family but only on non-character keys, which AltGr never maps: `Ctrl+Alt+Space` capture, `Ctrl+Alt+Shift+Space` toggle strip, `Ctrl+Alt+Enter` complete and advance, `Ctrl+Alt+Shift+Enter` start/pause timer, `Ctrl+Alt+Backspace` undo. Arrows avoided (Intel display-rotation hotkeys). All rebindable; conflicts shown. |
| D16 | Capture parser gives no feedback | high | **Accept.** Live token chips under the input; Escape twice keeps raw text. |
| D17 | Plan-today has no trigger; user never opens the main window | high | **Accept, refined.** The non-focusable hover panel cannot take keyboard input, so keyboard sheets live in the focusable **palette** window (the same window as quick capture): capture, plan today, close day, command palette. The strip shows a "Plan today (5 leftover)" chip on the first interaction after 4 AM on a new day; clicking it opens the palette in plan mode. |
| D18 | Close-day arc is flat | med | **Accept.** The strip celebrates (D7); the card is optional and opened from the strip. Nothing pops. |
| D19 | Settings screen undefined | high | **Accept.** Sections: Strip, Hotkeys (record-to-rebind, conflict display), Timer & Pomodoro, Theme, Data (export/import/backups), Startup & notifications, Score (legacy). |
| D20 | Tray menu undefined | med | **Accept.** Current task (disabled label), Complete, Quick capture, Show/Hide strip, Open planner, Quit. |
| D21 | Left/right edges with a horizontal strip | high | **Accept.** v1 docks to top or bottom; "left/right" = anchoring to that corner along the top or bottom edge. No vertical text. |
| D22 | Panel growth at bottom edge causes a one-frame jump; pre-size window and clip | med | **Reject the pre-size fix.** On Windows a transparent Electron window still captures clicks in its transparent area, so a pre-sized window would block the desktop under the hidden panel. Use `setBounds(bounds, false)` atomically; accept a one-frame jump at the bottom edge; top edge has none. |
| D23 | Drag vs click on a non-focusable window | high | **Accept.** No `app-region: drag` anywhere. Grip on the left end; drag = mousedown on grip or 6 px movement within 200 ms anywhere; main process moves the window by polling `screen.getCursorScreenPoint` at 60 Hz until mouseup. Click on title toggles panel; double-click opens planner. |
| D24 | Click-through handle location | crit | **Accept.** Left end, 24×24, behind the dot; cursor polled against its rect to toggle `setIgnoreMouseEvents`. |
| D25 | DPI: state units | high | **Accept.** All sizes are DIPs; Playwright asserts DIPs; re-apply bounds on `display-metrics-changed` and after cross-display moves. |
| D26 | Taskbar auto-hide | high | **Accept.** If `workArea` equals display `bounds` on the docked edge, reserve 2 px and prefer the top edge by default. |
| D27 | Strip shows over borderless-fullscreen games/video | high | **Defer (TODOS).** No first-party Electron API for the foreground window; needs a native FFI. Documented gap. |
| D28 | Auto-hide spec | high | **Accept.** 4 px sliver in accent at 60 %; peek after 200 ms at the edge; retreat 1 s after leave; disabled while a timer runs. |
| D29 | Hover expand while crossing the strip | med | **Accept.** Expand only if the pointer travelled < 4 px during the 150 ms. |
| D30 | Screen readers cannot reach a non-focusable window | crit | **Accept.** Strip is `aria-hidden` presentation; the planner is the accessible surface; every strip action has a hotkey; when `app.accessibilitySupportEnabled` is true, hotkey results are announced with a native notification ("Completed: … Now: …"). |
| D31 | OS text scaling breaks the fixed height | high | **Accept.** Strip height = clamp(32, lineHeight + 12, 44) DIP; the "< 40 px" promise is stated at 100 % text scaling. |
| D32 | AA contrast at 40 % opacity is meaningless | high | **Accept.** Opacity applies to the backplate only, text stays opaque, backplate floor 70 % under the text run. |
| D33 | Reduced motion needs a list | med | **Accept.** Instant: auto-hide slide, panel expand, title slide-in, dot pulse. Completion feedback becomes a colour change. |
| D34 | Hit targets under 24 px | med | **Accept.** Grip 24 px tall regardless of strip height; handle 24×24; panel row actions 24×24. |

**Design litmus scorecard (single voice):** hierarchy 4→8 after D1–D3; states 2→8 after D4–D13; journey 3→8 after D14–D18; specificity 3→7 (DESIGN.md and the pixel diagram still to come); interaction 4→8; accessibility 3→7.

### 4.1 CEO review (Claude subagent, independent) — findings and decisions

Reviewer verdict: architecture sound; product definition inverted (a generic task manager with a strip attached). The defensible position is a strip that behaves like part of Windows. Decisions:

| # | Finding | Sev | Decision |
|---|---|---|---|
| C1 | Strip gets 20 % of the spec; planner gets 80 % | crit | **Accept.** Slices reordered: strip, capture, palette rituals, tray, then planner last. Planner is built to feed the strip, not to compete with Todoist. |
| C2 | The 10-star strip is undefined; five OS behaviours would define it | high | **Accept four now, one gated.** (a) `setContentProtection(true)` toggle "Hide from screen share" — one line. (b) Idle detection via `powerMonitor.getSystemIdleTime()`: pause timer after N idle minutes (setting), show drift ("47 min on a 25 min plan"). (c) Main window title and tray tooltip = current task. (d) Zero-CPU idle: no 1 Hz tick unless a timer runs; strip repaints only on change; RSS budget recorded in the final report. (e) AppBar work-area reservation and fullscreen-app detection need Win32 calls → see C3. |
| C3 | "No native modules" treated as law | high | **Accept with a boundary.** One optional FFI module `src/main/win32/` using `koffi` (prebuilt, N-API, no toolchain), loaded lazily, every feature behind a capability check with graceful fallback. Powers: AppBar "Reserve screen space" (opt-in), "Hide over fullscreen apps" (default on when available), foreground-window restore after capture. Ships in a late slice; the app is complete without it. Dependency justified in DECISIONS.md. |
| C4 | Top-docked strip covers browser tab bars | crit | **Accept.** Default dock = bottom edge (above the taskbar, "second taskbar" metaphor). Top edge available; "Reserve screen space" (C3) makes either edge non-occluding. |
| C5 | Ctrl+Alt is AltGr | med | **Accepted in D15** (non-character keys only). |
| C6 | Delete the score | med | **Keep opt-in, minimal.** Value migrates; a single Settings → Score toggle shows it in the planner header. No score UI anywhere else. Cost is ~40 lines. |
| C7 | Recurrence DST/month-end is a bug well | high | **Keep the full set** (brief requires recurring tasks); it lives in pure `core/recur.ts` with table tests for month-end clamp and DST. Local-date arithmetic, never UTC. |
| C8 | No sync is a refund generator; folder sync is cheap | high | **USER CHALLENGE #1** (brief says "write a proposal and move on"). Founder's compromise shipped: Settings → Data → "Data folder" (any path, e.g. inside OneDrive), a file watcher that reloads on external change, and a conflict copy when the on-disk version is newer than the in-memory base. This is folder sync in all but name. You can cut it. |
| C9 | Electron footprint unexamined | med | **Accept.** Budgets: idle CPU 0 % (no timer), strip repaint ≤ 1/s with timer, total RSS target ≤ 180 MB; measured in the final report. |
| C10 | Unsigned installer kills sellability | crit | **Money question for the founder.** Recommendation: Azure Trusted Signing (monthly fee, no hardware token) or MSIX via Store. Build stays unsigned until answered. |
| C11 | Focus-stealing can't be verified by Playwright alone | high | **Accept.** Manual release gate: matrix of VS Code, Chrome, Terminal, Explorer, an elevated app, RDP, Teams share, borderless-fullscreen video; results recorded in the final report. |
| C12 | Markdown-file source ("watch a .md, first unchecked line is current") | high | **Defer (TODOS).** Same `select.ts` seam; v1.1. |
| C13 | Build the planner last; maybe not at all | high | **Order accepted, existence kept.** The brief requires command palette, projects, settings; they ship, but last. |
| C14 | Hover panel needs "make current"; "skip" undefined | med | **Accept.** Panel rows: click title = make current; actions: done, skip, snooze. Skip = move to the end of Today's order. |
| C15 | Three-screen first run | med | **Accept.** Palette shows: (1) capture your first task, (2) pick edge top/bottom and see the strip move, (3) the five hotkeys. Skippable. |
| C16 | Offline licence key path | med | **Seam only.** Brief says no licence integration without asking. `getLicenseStatus()` seam plus a documented plan for offline Ed25519 keys in the report. |
| C17 | Cut tags, sub-tasks, monthly recurrence, MD export, detail pane, two of four themes, close-day, opacity, bulk import | high | **USER CHALLENGE #2**: all except bulk import are explicitly in the brief, so they stay. Bulk CSV/paste import is cut in favour of multi-line paste in the capture palette (each line goes through the parser). |

**Competitive position recorded:** Akiflow, TickTick, Focus To-Do and Sunsama each have a floating widget; none has AppBar reservation, capture exclusion, fullscreen/idle awareness, click-through and per-monitor memory. Those five OS behaviours are the moat and are now in scope (C2, C3).

**CEO consensus (single voice, Codex unavailable):** premises 4/6 accepted as stated, 2 revised (dock default, native boundary); right problem: yes after rebalancing; scope: rebalanced; alternatives: two added to TODOS; competitive: covered; 6-month trajectory: sound if C2–C4 ship.

### 4.3 Engineering review (Claude subagent, independent) — findings and decisions

Reviewer verdict: architecture sound; one design line (1 Hz ticks through the store) would sink it; Windows specifics and timer semantics need explicit rules. All accepted unless marked.

| # | Finding | Sev | Decision |
|---|---|---|---|
| E1 | 1 Hz store ticks broadcast full snapshots to three windows | high | **Accept.** The store never ticks. Main dispatches only at timer boundaries (start/pause/stop/expire) with one `setTimeout` armed to the expiry instant, re-armed on `powerMonitor` resume. Renderers derive display time from `runningSince` with a local 1 s interval, only while a timer runs. |
| E2 | Full vs patched snapshots; two delivery paths race | med | **Accept.** Full snapshots with monotonic `rev`; renderers drop stale revs; `store:dispatch` returns `{ rev }` only; `store:changed` is the single delivery path. |
| E3 | Optional-method IPC type led to `?.` guards | med | **Accept.** Channel map types (`Invoke`, `Events`), one generic `invoke<K>` in preload, `Action` discriminated union exported from core, zod-validated in main. |
| E4 | Core needs `now` and ids | high | **Accept.** Every action carries `now` (epoch ms) and any new `id`, generated in main at dispatch. Makes reducers pure and redo deterministic. |
| E5 | Inverse-action undo cannot invert recurrence spawn or timer stop | high | **Accept.** Undo = ring of 50 previous `Data` references (immer structural sharing). Global stack in main; each window's toast names what was undone. Text edits inside inputs are renderer-local. |
| E6 | `show()` on a non-focusable transparent window may not paint | med | **Accept.** `showInactive()` only; never `focus()`. Hover panel is mouse-only; hotkeys route through main. |
| E7 | `mouseleave` unreliable on frameless transparent windows | high | **Accept.** Handle zone toggles `setIgnoreMouseEvents` on `mouseenter`/`mouseleave`, with a 100 ms `getCursorScreenPoint` vs `getBounds` poll in main while expanded or click-through. The same poll drives the 300 ms collapse. |
| E8 | `level` is ignored on Windows; topmost shows over borderless fullscreen | med | **Accept.** Level language removed. Gap recorded; C3's gated FFI is the only path to fullscreen detection. |
| E9 | Primary-display-only code; unstable `display.id` | high | **Accept.** `getDisplayMatching(bounds)`, `workArea` in DIP, revalidate on `display-added/removed/metrics-changed`; positions keyed by `id` with a `${w}x${h}@${scale}` signature fallback; one `setBounds` call per move. |
| E10 | Windows "Text size" is not applied to web content | med | **Accept.** In-app text size setting (S/M/L). Strip height comes from a `ResizeObserver` report (`strip:reportSize`), capped at 44 DIP. D31 amended accordingly. |
| E11 | Hotkey lifecycle and validation | high | **Accept.** `unregisterAll` on `will-quit`; accelerator grammar requiring Ctrl/Alt/Super; denylist (`Alt+F4`, `Ctrl+C`, `Ctrl+V`, …); conflicts surfaced in Settings. Defaults per D15. |
| E12 | `setAppUserModelId` missing; Focus Assist suppresses toasts | med | **Accept.** Set to `com.timebound.app`; timer expiry also changes the strip's dot and chip colour. |
| E13 | Planner list needs virtualisation | med | **Accept.** `@tanstack/react-virtual` (small, headless). |
| E14 | Sleep credits 8 h to a task | high | **Accept.** On `suspend`/`lock-screen` record the instant; on `resume`/`unlock`, if the gap > "away threshold" (default 5 min) pause the timer at the suspend instant and show "paused while away". Pairs with C2(b) idle detection. |
| E15 | Clock can go backwards | med | **Accept.** Clamp elapsed ≥ 0; `performance.now()` for in-session spans; persist wall-clock only. |
| E16 | `dueAt` mixing date and datetime parses as UTC | high | **Accept.** `due?: { date: 'YYYY-MM-DD'; time?: 'HH:mm' }`; all calendar math in local time via `date-fns`. |
| E17 | Month-end drift, `everyN` anchor, Feb 29, weekday wrap | high | **Accept.** Next occurrence computed from the rule (`dayOfMonth` clamped), `everyN` carries `anchor`, tests for Feb 29 and Fri→Mon. |
| E18 | Migration must not replay time; `struck` ≠ done | high | **Accept.** Read raw; never call the legacy rehydrate; timers migrate stopped with `spentSeconds = assigned − remaining`; `completedBy: 'user' | 'timer'`; `days` derived from `completedAt` in local time. |
| E19 | Parse-success ≠ valid; `rename` EPERM under Defender/OneDrive | high | **Accept.** zod after parse; backups rotate on first save of each local day; rename retry 3× (50/200/800 ms); orphan `*.tmp` cleaned at start. |
| E20 | Dev and packaged builds share the data dir | med | **Accept.** Dev uses `TimeBound-dev`; `TIMEBOUND_DATA_DIR` env overrides (tests, portable use). |
| E21 | Test gaps and vacuous DST tests on an IST machine | high | **Accept.** Vitest runs the suite under `TZ=America/New_York` and `TZ=Asia/Kolkata`; all listed cases added to the test plan. |
| E22 | Playwright cannot prove "never steals focus" or fire global hotkeys | high | **Accept.** Enumerate windows by URL hash; `workers: 1`; hotkey handlers tested via IPC plus `register()` return values; one OS-level focus test via a PowerShell `SendInput` script, marked flaky-tolerant; manual matrix (C11) is the gate. |
| E23 | `sandbox: false` | high | **Accept.** `sandbox: true`; preload uses only `ipcRenderer`. |
| E24 | CSP, navigation, window.open | med | **Accept.** CSP via `onHeadersReceived` (dev variant for HMR) plus `<meta>`; `will-navigate` and `setWindowOpenHandler` deny; `shell.openExternal` only for validated `http(s)`. |
| E25 | IPC sender validation | high | **Accept.** zod `.strict()` per action, bounded strings/arrays, `senderFrame.url` must be one of the three routes. |
| E26 | Import hardening | med | **Accept.** 20 MB cap, zod strict, no CSV (cut in C17). |
| E27 | Dependencies | — | **Accept.** Add: vitest, @playwright/test, zod, immer, fast-check (dev), date-fns, @tanstack/react-virtual, koffi (optional, gated). Remove: fs-extra, uuid; sharp moves to an optional script. Upgrade electron and electron-builder. No chrono-node, no electron-store. |

### 4.4 Architecture

```
+---------------------------- main process ------------------------------+
|  core/ (pure TS, no Electron)                                          |
|   reducer - select - parse - recur - timer - undo - migrate - export   |
|        ^                                                               |
|  store.ts --> persist.ts (atomic write, daily backups, zod, watcher)   |
|     |  rev, snapshot                                                   |
|     +--> hotkeys.ts  (globalShortcut, validation)                      |
|     +--> tray.ts     (tooltip = current task, menu)                    |
|     +--> notify.ts   (Notification, AppUserModelId)                    |
|     +--> clock.ts    (timer expiry timeout, powerMonitor idle/suspend) |
|     +--> windows/strip.ts  main.ts  palette.ts  (bounds, docking)      |
|     +--> win32/ (optional koffi: AppBar, fullscreen, foreground)       |
|     +--> licensing/ (getLicenseStatus seam)                            |
|  ipc.ts: invoke('store:dispatch'|'store:get'|'strip:*'|'palette:*')    |
|          send('store:changed', snapshot)                               |
+---------------+-----------------------+-------------------+------------+
        preload (sandboxed)      preload              preload
+---------------v-----+ +---------------v-----+ +---------v-----------+
| #/strip             | | #/palette           | | #/main (planner)    |
| focusable:false     | | focusable, on blur  | | normal, hides to    |
| dot.title.timer     | | capture / plan day  | | tray; rail + list + |
| hover panel         | | close day / Ctrl+K  | | detail; settings    |
+---------------------+ +---------------------+ +---------------------+
```

### 4.5 Test map

| Codepath | Test type | Location |
|---|---|---|
| Parser tokens (dates, times, durations, tags, lists, recurrence, ambiguity "at 9" vs "9 tasks") | unit, table-driven | `core/parse.test.ts` |
| Recurrence next occurrence (daily, weekdays, weekly-on-days, monthly clamp, everyN anchor, Feb 29, DST both TZs) | unit | `core/recur.test.ts` |
| Reducer: every action; snoozed exclusion; current/next selection; today rollover | unit | `core/reducer.test.ts`, `core/select.test.ts` |
| Undo/redo property: apply then undo restores, redo re-applies with same ids | property (fast-check) | `core/undo.test.ts` |
| Timer: start/pause/stop, overtime, clock backwards, sleep gap rule | unit | `core/timer.test.ts` |
| Migration of real legacy fixture (26 tasks, struck, paused) | unit | `core/migrate.test.ts` |
| Export/import JSON and Markdown round-trip; import rejects malformed | unit | `core/export.test.ts` |
| Persistence: atomic write, EPERM retry, backup rotation across local midnight, corrupt fallback chain | unit with mocked fs/clock | `main/persist.test.ts` |
| Action schema validation, hotkey accelerator validation | unit | `main/ipc.test.ts`, `main/hotkeys.test.ts` |
| Capture then strip shows task | e2e | `e2e/capture.spec.ts` |
| Complete-and-advance via IPC; undo toast | e2e | `e2e/complete.spec.ts` |
| Focus toggle: strip window created/hidden; bounds inside workArea; height < 40 DIP | e2e | `e2e/focus.spec.ts` |
| Theme switch persists across restart | e2e | `e2e/theme.spec.ts` |
| Restart persistence (tasks, timer state, strip position) | e2e | `e2e/restart.spec.ts` |
| Ten-minute scripted session, zero console errors | e2e | `e2e/soak.spec.ts` |
| Never-steals-focus across foreign apps | manual matrix (C11) + one `SendInput` script | `docs/RELEASE-CHECKLIST.md` |

### 4.6 Cross-phase themes

- **Hotkey defaults (design D15, CEO C5, eng E11):** three independent voices flagged `Ctrl+Alt+<letter>`. High-confidence; fixed with non-character keys.
- **Fullscreen and foreground detection (design D27, CEO C2/C3, eng E8):** all three agree Electron alone cannot do it. Resolved by the gated koffi module.
- **Focus-stealing verification (CEO C11, eng E22):** Playwright cannot prove it; manual matrix is the gate.
- **Strip mechanics are the risk centre (design section 5, eng section 6):** slice 1 gets the budget.

### 4.7 Final gate (founder, self-approved per mission autonomy rules)

Decisions: 78 total (74 auto-decided, 2 taste choices resolved by the founder: D22 window pre-sizing rejected, C6 score kept minimal; 2 user challenges recorded for the owner: C8 data folder, C17 task-model cuts). Status: **APPROVED** as amended above. Next: DESIGN.md, then PLAN.md.

## Part 5 — macOS as a first-class target (added 2026-09-14 after owner direction)

The owner confirmed TimeBound ships on macOS too. Windows 11 stays the primary target and the only one that can be verified on the build machine; macOS is designed in, built in CI-style configuration, and verified with a checklist on a Mac.

### 5.1 What differs on macOS

| Concern | Windows 11 | macOS |
|---|---|---|
| Strip window | `focusable:false`, `skipTaskbar`, transparent, topmost | Same plus `type: 'panel'`, `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`, level `floating`. Panels float over full-screen apps and follow the user across Spaces, so the "fullscreen gap" recorded for Windows (E8, D27) does not exist on macOS. |
| Docking | Inside `workArea` above/below taskbar | Inside `workArea` below the menu bar; Dock position (bottom/left/right) shifts `workArea` and is handled by the same code. |
| Zero-pixel mode | Tray tooltip = current task | **Menu bar mode**: the status item title shows the current task (truncated to a setting, default 28 chars) and the running timer; clicking it opens the hover panel as a popover. Strip can be hidden entirely in this mode. |
| Tray | System tray icon + menu | Status bar item (same `Tray` API); template image for light/dark menu bars. |
| Hotkeys | `Ctrl+Alt+Space` family | Same accelerators, rendered as ⌃⌥Space. Control+Option chords are free of OS defaults. Capture palette gets focus via `app.focus({ steal: true })`. |
| Focus return after capture | Windows re-activates the previous window on hide | `app.hide()` after the palette closes returns focus to the previous app reliably. |
| Notifications | `setAppUserModelId` required | Permission prompt on first notification; no AUMID. |
| Start on login | Registry Run entry via `setLoginItemSettings` | Login item via the same API; on macOS 13+ the user sees it in System Settings → Login Items. |
| Window chrome | Frameless with custom controls | `titleBarStyle: 'hiddenInset'` keeps native traffic lights; planner header leaves 78 px on the left for them. |
| Text scaling | In-app text size setting | Same setting; macOS does not scale web content either. |
| Packaging | NSIS installer, unsigned until decided | DMG (arm64 + x64 universal). Signing + notarization need an Apple Developer account (money question). Unsigned DMGs trigger Gatekeeper "unidentified developer". |
| Global shortcut permissions | none | None for `globalShortcut`; if the FFI-free path is kept, no Accessibility permission is needed. |
| Click-through | `setIgnoreMouseEvents` | Same API, same handle-zone poll. |
| Data dir | `%APPDATA%\TimeBound` | `~/Library/Application Support/TimeBound` via `app.getPath('userData')`; `TIMEBOUND_DATA_DIR` overrides on both. |

### 5.2 Design consequences

- Key glyphs: settings and onboarding render accelerators per platform (Ctrl/Alt vs ⌃⌥).
- The strip's corner radius and shadow follow the platform: 6 px on Windows, 8 px on macOS to sit with native panels.
- Fonts are bundled, so rendering is identical on both; line-height is set explicitly to avoid the macOS/Windows metric drift.
- The planner's custom title bar reserves traffic-light space on macOS and renders its own minimise/close on Windows.

### 5.3 Verification on macOS

The build machine is Windows; macOS cannot be launched here. The plan includes:
- `npm run package:mac` producing a DMG (electron-builder `mac` target, `hardenedRuntime` off until signing exists).
- Playwright e2e runs unchanged on macOS (`_electron.launch` is cross-platform); CI matrix entry provided as a GitHub Actions workflow file, not enabled until the owner wants it.
- `docs/RELEASE-CHECKLIST.md` gains a macOS section: panel over full-screen app, Spaces switching, menu bar mode, Dock at left/right, notification permission, login item, DMG mounts and launches.

### 5.4 Decisions added

- Menu bar mode is macOS-only in v1; Windows keeps the tray tooltip. Rationale: Windows has no reliable equivalent of a text status item.
- Hotkey defaults stay `Ctrl+Alt`-based on both platforms so documentation, tests, and onboarding share one table.
- No `koffi` usage on macOS in v1: the panel window type covers the fullscreen and Spaces cases natively.
