# TimeBound 1.2 — Test plan

Three layers. Each later layer assumes the earlier ones pass.

| Layer | What it proves | How | Command |
|---|---|---|---|
| 1. Unit | Timer, scoring, dates, parsing are correct | Vitest, run in Asia/Kolkata so UTC/local mix-ups fail | `npm test` |
| 2. UI end-to-end | Every screen and flow works and looks right in both themes | Playwright drives the real React app in Chromium; native calls fall back to in-browser stand-ins | `npm run e2e` |
| 3. Native app | Window behaviour only the real app has | `tauri dev` with `VITE_SELFTEST=1` runs a scripted tour; screenshots of the real desktop are checked | see §3 |

## 1. Unit (automated)

- Tick counts down only the current task; paused and timeless tasks don't move.
- Timer hitting zero: task struck, +1 score, counters up, next task starts.
- Completion dates use the local calendar day; "today" resets on a new day and reads 0 after midnight.
- Sleep or clock jumps (>90 s gap) charge no time.
- Done early +2; adding time −1 only if the task already had time; editing time up −1, down 0.
- Time's up → +5 min undoes the automatic completion and makes the task current again.
- Reorder, multi-delete, clear finished, preferences, focus-position reset.
- 1.x state files load with new defaults; empty `lastCompletionDate` tolerated.
- Quick-add parser: `20m`, `20 min`, `2h`, `1.5 hours`, `1h30`, `1h 30m`, `[01:30]`, `Task; 15`, CSV; numbers inside titles untouched; caps and zero handling.
- Rust: legacy state loads, unknown fields round-trip, geometry clamps (`cargo test`).

## 2. UI end-to-end (automated, both themes)

| # | Flow | Expected |
|---|---|---|
| E1 | First launch, empty | "Nothing running" card; quick-add asks for a time if none given |
| E2 | Quick-add `Write intro 25m` | Duration chip shows while typing; task becomes Now with 25:00 |
| E3 | Timer runs | Now clock decreases each second; progress bar shrinks |
| E4 | Pause / Resume (button and Space) | Clock freezes, "Paused" shown; resumes |
| E5 | +5m | Clock +5:00, score −1, toast |
| E6 | Done (button and ⌘↵) | Score +2, today +1, next task becomes Now, appears in Done today |
| E7 | Up next ordering | Shown in run order; drag reorders; right-click Start now / Do next |
| E8 | Edit (double-click, pencil) | Sheet opens with values; raising time shows "costs 1 point" |
| E9 | Add time sheet | Presets work; −1 point |
| E10 | Add several tasks | All parsed and added |
| E11 | Multi-select + Delete | Confirm sheet for >1; tasks removed |
| E12 | Theme toggle | Island ↔ Frost restyle everything; persists after reload |
| E13 | Summary popover | Shows done, focused time, early finishes, time adds |
| E14 | Menu toggles | Keep on top, Timer in menu bar, Clear finished (confirm) |
| E15 | Focus mode (F / button) | Main UI replaced by the theme's widget; hover expands; controls work; Esc / expand button returns |
| E16 | Time's up | Toast with +5 min / OK; +5 min restores the task |
| E17 | Persistence | Reload keeps tasks, score, theme |
| E18 | Visual check | Screenshots of every state in both themes reviewed for layout, contrast, clipping |

## 3. Native app (macOS here; Windows via CI build + manual)

Self-test tour (`VITE_SELFTEST=1 npm run dev`) steps through these with pauses; a screenshot is taken at each:

| # | Check | Expected |
|---|---|---|
| N1 | Main window, dark | Opaque rounded panel, no ghosting |
| N2 | Focus, dark | Black pill flush in the menu bar, centred on the notch, text on both wings |
| N3 | Focus expanded, dark | Pill grows downward only; width unchanged |
| N4 | Exit focus | Window returns to the exact previous size and spot |
| N5 | Main window, light | Native frosted glass behind a light tint, rounded corners match |
| N6 | Focus, light | Frosted capsule bottom-right above the Dock |
| N7 | Focus expanded, light | Grows upward (bottom half of screen) and stays on screen |
| N8 | Menu bar timer | Tray shows the countdown next to the icon |

Manual (needs a person): drag the widget and re-enter focus (position remembered), tray menu items, the global quick-add hotkey from another app, the system notification and chime at time's up, sleep the Mac mid-task (no time lost).

Windows: CI builds the installer; then run E-flows and N2/N4/N6 by hand on a Windows 11 machine.
