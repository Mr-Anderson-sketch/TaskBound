# TimeBound Focus-First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementation subagents run on the **Sonnet** model (see `.claude/agents/implementer.md`); the lead reviews every task.

**Goal:** Turn TimeBound into a desktop app whose 32 px focus strip keeps the current task on screen at all times, backed by a planner, natural-language capture, timers, and four themes, on Windows 11 and macOS.

**Architecture:** The main process owns a single store built from pure reducers in `src/core/` and persists it atomically with daily backups. Three renderer routes (strip, palette, planner) are views over IPC snapshots. Timers never tick the store; one armed timeout in main handles expiry. Windows-only optional FFI adds screen-space reservation and fullscreen detection.

**Tech Stack:** Electron (current major), React 18, TypeScript 5, Vite 5, Tailwind 3 (utilities only; tokens from DESIGN.md), zod, immer, date-fns, @tanstack/react-virtual, @fontsource (IBM Plex Sans/Mono, Instrument Serif), Vitest, fast-check, @playwright/test, electron-builder, koffi (Windows, optional).

**Spec:** `docs/superpowers/specs/2026-09-14-focus-first-design.md` (Parts 1–5, including every reviewed decision D1–D34, C1–C17, E1–E27). Design law: `DESIGN.md`. Decisions: `docs/DECISIONS.md`.

## Global Constraints

- Windows 11 is the primary target and the only one verifiable on the build machine; macOS is first-class and verified by `docs/RELEASE-CHECKLIST.md` on a Mac.
- Strip height ≤ 40 DIP at text size M (32 target); collapsed pill 24 DIP. Measured in e2e as `BrowserWindow.getBounds().height`.
- The strip window is `focusable: false` and never calls `focus()`; use `showInactive()` only.
- `src/core/` imports nothing from Electron or Node; reducers take `now` and ids inside actions.
- The store never ticks. No `setInterval` in main that dispatches.
- Every IPC payload is zod-validated in main with `.strict()` schemas; `sandbox: true`, `contextIsolation: true`, CSP set.
- Persistence: temp → rename with retry (50/200/800 ms), zod on load, backups rotate once per local day, rolling 30; legacy `state.json` is never modified.
- Hotkey defaults: `CommandOrControl+Alt+Space` capture · `CommandOrControl+Alt+Shift+Space` toggle strip · `CommandOrControl+Alt+Enter` complete and advance · `CommandOrControl+Alt+Shift+Enter` start/pause timer · `CommandOrControl+Alt+Backspace` undo. (Electron `CommandOrControl` = Ctrl on Windows, Cmd on macOS; the spec's "Ctrl+Alt" family renders as ⌘⌥ on macOS. Decision: use `Control+Alt` literally on both platforms so glyphs read ⌃⌥ on macOS, which the OS leaves free. Accelerator strings below use `Control+Alt`.)
- Fonts are bundled; no network requests of any kind. No telemetry.
- Every dependency added gets a line in `docs/DECISIONS.md`.
- Every task ends with `npm run build` succeeding and the app launching (`npm run e2e:smoke`).
- Data directory: `app.getPath('userData')` (`TimeBound` packaged, `TimeBound-dev` in dev); `TIMEBOUND_DATA_DIR` env overrides.
- Copy rules: sentence case everywhere; the strip never shows more than title + one chip; no exclamation marks; the word "task" is never capitalised mid-sentence.
- Commit after every task with a conventional prefix (`feat:`, `fix:`, `test:`, `chore:`, `docs:`); update `CHANGELOG.md` at the end of every slice.

---

## File structure (target)

```
src/
  core/                      pure TS, Vitest
    types.ts                 Data, Task, List, Settings, Action (discriminated union)
    schema.ts                zod schemas for Data and every Action
    defaults.ts              createEmptyData(now), default settings, default list 'inbox'
    reducer.ts               reduce(data, action) → Data (immer)
    select.ts                currentTask, nextTasks, todayView, counts, isSnoozed
    timer.ts                 elapsedSeconds(timer, now), remaining, expiryAt, sleep gap rule
    recur.ts                 nextOccurrence(rule, fromDate) in local time
    parse.ts                 parseCapture(text, now, lists) → ParsedCapture
    undo.ts                  UndoStack (ring of 50 Data refs)
    migrate.ts               migrateLegacy(stateJson, now) → Data
    export.ts                toJson, fromJson, toMarkdown, fromMarkdown
    dates.ts                 local date helpers (ymd, parseYmd, addDays…)
  main/
    main.ts                  app lifecycle only
    store.ts                 Store: dispatch, get, subscribe, rev, undo/redo
    persist.ts               load/save/backups/watcher
    ipc.ts                   registers handlers, validates, routes to store/windows
    clock.ts                 timer expiry timeout, powerMonitor idle/suspend
    hotkeys.ts               register/validate/conflicts
    tray.ts                  tray/menu-bar item
    notify.ts                notifications with AUMID
    paths.ts                 data dir resolution
    windows/
      strip.ts               create/dock/expand/collapse/autohide/clickthrough
      palette.ts             create/show/hide
      planner.ts             create/show/hide-to-tray
      displays.ts            work-area math, position memory
      csp.ts                 CSP headers
    win32/
      index.ts               lazy koffi loader with capability flags
      appbar.ts              reserve/release
      fullscreen.ts          foreground fullscreen detection
    licensing/
      index.ts               getLicenseStatus()
    preload.ts               typed bridge
  shared/
    ipc.ts                   channel map types
    platform.ts              isMac/isWin, key glyphs
  renderer/
    index.html               routes by hash
    main.tsx                 mounts StripApp / PaletteApp / PlannerApp
    lib/
      useStore.ts            snapshot subscription with rev guard
      useDisplayTime.ts      local 1 s derivation while a timer runs
      keys.ts                accelerator → glyphs
    theme/                   themes.json, themes.css (generated), ThemeProvider.tsx
    strip/                   StripApp.tsx, Strip.tsx, Pill.tsx, Panel.tsx, PanelRow.tsx
    palette/                 PaletteApp.tsx, Capture.tsx, TokenChips.tsx, PlanToday.tsx, CloseDay.tsx, Commands.tsx, Onboarding.tsx
    planner/                 PlannerApp.tsx, TitleBar.tsx, Rail.tsx, TaskList.tsx, TaskRow.tsx, Detail.tsx, EmptyState.tsx, Toast.tsx
    settings/                Settings.tsx, sections/*.tsx, KeyRecorder.tsx
    ui/                      Button.tsx, Toggle.tsx, Segmented.tsx, Chip.tsx, Dialog.tsx
    styles/app.css           base + component CSS from DESIGN.md
tests/
  core/*.test.ts
  main/*.test.ts
  fixtures/legacy-state.json
e2e/
  launch.ts                  shared Electron launcher (strips ELECTRON_RUN_AS_NODE, sets TIMEBOUND_DATA_DIR)
  *.spec.ts
scripts/
  check-contrast.mjs, build-theme-css.mjs, measure-strip.mjs, soak.mjs
```

---

## Slice 0 — Setup (executed by the lead; already in progress)

Deliverable: upgraded toolchain, test harness, skeleton, agent definition. The old app still builds and launches. **Done 2026-09-14** (fs-extra/uuid kept until Slice 1; see DECISIONS.md). See `CHANGELOG.md` "Unreleased / Setup".

### Task 0.1: Dependencies and scripts

**Files:** Modify `package.json`; Create `vitest.config.ts`, `playwright.config.ts`, `e2e/launch.ts`, `.claude/agents/implementer.md`, `CHANGELOG.md`.

- [x] Upgrade `electron` to the current major and `electron-builder` to a matching version; add `zod`, `immer`, `date-fns`, `@tanstack/react-virtual`, `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono`, `@fontsource/instrument-serif`; dev: `vitest`, `fast-check`, `@playwright/test`, `playwright`; optional: `koffi`. Remove `fs-extra`, `uuid`, `@types/fs-extra`, `@types/uuid`. Move `sharp` to `optionalDependencies` (icon script only).
- [x] Scripts: `test` (vitest, two TZ runs), `e2e`, `e2e:smoke`, `theme:build`, `theme:check`, `package`, `package:mac`, `typecheck`.
- [x] `npm run build` and `npm run e2e:smoke` pass on the old app.
- [x] Commit `chore: upgrade toolchain, add test harness`.

### Task 0.2: Skeleton and configs

- [x] Create empty module files per the file structure with a one-line header comment and `export {}` so `tsc` is happy; do not wire them.
- [x] Add `src/renderer/index.html` CSP meta (dev variant allows `ws://localhost:5173`).
- [x] Retire `pwa/` (`git rm -r pwa PWA_VS_ELECTRON.md`).
- [x] Commit `chore: scaffold focus-first module layout`.

---

## Slice 1 — Focus strip (first shippable: the strip replaces the old window)

Deliverable: launch → migrated tasks → 32 px strip docked bottom, hover panel, pill, hotkeys (toggle, complete, undo), tray, minimal capture (title only), planner placeholder listing Today. Old renderer removed. e2e: `focus.spec.ts`, `restart.spec.ts`, `capture.spec.ts` (title-only).

### Task 1.1: Core types and schema

**Files:** Create `src/core/types.ts`, `src/core/schema.ts`, `src/core/defaults.ts`, `src/core/dates.ts`; Test `tests/core/schema.test.ts`, `tests/core/dates.test.ts`.

**Interfaces (produces):**

```ts
// src/core/types.ts
export type Id = string;
export type Ymd = string;   // 'YYYY-MM-DD' local
export type Hm = string;    // 'HH:mm' local

export interface Due { date: Ymd; time?: Hm }

export type Rule =
  | { kind: 'daily' }
  | { kind: 'weekdays' }
  | { kind: 'weekly'; days: number[] }            // 0=Sun … 6=Sat, non-empty, sorted
  | { kind: 'monthly'; dayOfMonth: number }       // 1..31, clamped to month length
  | { kind: 'everyN'; n: number; unit: 'day' | 'week'; anchor: Ymd };

export interface TaskTimer { plannedSeconds?: number; spentSeconds: number; runningSince?: number /* epoch ms */; pausedAtSuspend?: number }

export interface Task {
  id: Id; title: string; notes?: string;
  listId: Id; parentId?: Id; tags: string[];
  order: number; today: boolean;
  due?: Due; snoozedUntil?: number; recurrence?: Rule;
  timer?: TaskTimer;
  status: 'open' | 'done'; completedBy?: 'user' | 'timer';
  createdAt: number; updatedAt: number; completedAt?: number;
}
export interface List { id: Id; name: string; order: number; createdAt: number }
export interface DayRecord { date: Ymd; completed: number; focusSeconds: number; rolledOver: number; note?: string; closedAt?: number }

export type Edge = 'top' | 'bottom';
export interface StripPosition { x: number; y: number }
export interface Settings {
  theme: { name: 'ledger' | 'kraft' | 'phosphor' | 'slate'; mode: 'light' | 'dark' | 'system' };
  textSize: 'S' | 'M' | 'L';
  strip: { enabled: boolean; edge: Edge; width: number; collapsed: boolean; autoHide: boolean; clickThrough: boolean; opacity: number /* 0.4..1 */;
           reserveSpace: boolean; hideOverFullscreen: boolean; hideFromCapture: boolean; menuBarMode: boolean;
           positions: Record<string, StripPosition> };
  hotkeys: { capture: string; toggleStrip: string; completeAdvance: string; toggleTimer: string; undo: string };
  timer: { pomodoro: boolean; workMinutes: number; breakMinutes: number; idlePauseMinutes: number; awayThresholdMinutes: number; defaultPlannedMinutes: number };
  score: { enabled: boolean; value: number };
  startOnLogin: boolean; notifications: boolean; reducedMotion: 'system' | 'on' | 'off';
  dataDir?: string; onboardingDone: boolean;
}
export interface Data {
  schemaVersion: 2; tasks: Task[]; lists: List[]; days: DayRecord[]; settings: Settings;
  meta: { createdAt: number; lastSavedAt: number; appVersion: string; legacyImportedAt?: number };
}

export type Action =
  | { type: 'task/add'; id: Id; now: number; title: string; listId?: Id; parentId?: Id; tags?: string[]; due?: Due; recurrence?: Rule; plannedSeconds?: number; today?: boolean; makeCurrent?: boolean }
  | { type: 'task/edit'; id: Id; now: number; patch: Partial<Pick<Task, 'title' | 'notes' | 'listId' | 'tags' | 'due' | 'recurrence' | 'today'>> & { plannedSeconds?: number | null } }
  | { type: 'task/complete'; id: Id; now: number; by: 'user' | 'timer'; spawnId?: Id }
  | { type: 'task/uncomplete'; id: Id; now: number }
  | { type: 'task/delete'; id: Id; now: number }
  | { type: 'task/move'; id: Id; now: number; listId?: Id; parentId?: Id | null; afterId?: Id | null }
  | { type: 'task/makeCurrent'; id: Id; now: number }
  | { type: 'task/skip'; id: Id; now: number }
  | { type: 'task/snooze'; id: Id; now: number; until: number }
  | { type: 'task/setToday'; ids: Id[]; now: number; today: boolean }
  | { type: 'timer/start'; id: Id; now: number }
  | { type: 'timer/pause'; id: Id; now: number; at?: number }
  | { type: 'timer/stop'; id: Id; now: number }
  | { type: 'timer/addTime'; id: Id; now: number; seconds: number }
  | { type: 'list/add'; id: Id; now: number; name: string }
  | { type: 'list/rename'; id: Id; now: number; name: string }
  | { type: 'list/delete'; id: Id; now: number; moveTasksTo: Id }
  | { type: 'day/rollover'; now: number; date: Ymd }
  | { type: 'day/close'; now: number; date: Ymd; note?: string }
  | { type: 'settings/patch'; now: number; patch: DeepPartial<Settings> }
  | { type: 'data/replace'; now: number; data: Data };

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
```

`src/core/schema.ts` exports `DataSchema`, `ActionSchema` (a `z.discriminatedUnion('type', [...])` with `.strict()` on every member, titles `max(200)`, tags `max(20)` of `max(40)`, arrays `max(10000)`), and `parseData(unknown): Data` which throws `DataInvalidError` with the zod issues. `src/core/defaults.ts` exports `INBOX_ID = 'inbox'`, `defaultSettings()`, `createEmptyData(now, appVersion)`. `src/core/dates.ts` exports `ymd(ms: number): Ymd`, `parseYmd(s: Ymd): Date /* local midnight */`, `addDays(s: Ymd, n: number): Ymd`, `startOfLocalDay(ms): number`, `isSameLocalDay(a, b)`, `dayKeyForRollover(ms, cutoffHour = 4)` (a day starts at 4 AM local per D17).

- [ ] **Step 1: Write failing tests**

```ts
// tests/core/dates.test.ts
import { describe, it, expect } from 'vitest';
import { ymd, parseYmd, addDays, dayKeyForRollover } from '../../src/core/dates';
describe('dates (local)', () => {
  it('ymd uses the local calendar, not UTC', () => {
    const d = new Date(2026, 8, 20, 0, 30); // 20 Sep local 00:30
    expect(ymd(d.getTime())).toBe('2026-09-20');
  });
  it('parseYmd returns local midnight', () => {
    const d = parseYmd('2026-09-20');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 8, 20, 0]);
  });
  it('addDays crosses month ends and DST', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08'); // US DST start day
  });
  it('day key rolls at 4 AM', () => {
    expect(dayKeyForRollover(new Date(2026, 8, 15, 3, 59).getTime())).toBe('2026-09-14');
    expect(dayKeyForRollover(new Date(2026, 8, 15, 4, 0).getTime())).toBe('2026-09-15');
  });
});
```

```ts
// tests/core/schema.test.ts
import { describe, it, expect } from 'vitest';
import { parseData, ActionSchema } from '../../src/core/schema';
import { createEmptyData } from '../../src/core/defaults';
describe('schema', () => {
  it('round-trips empty data', () => {
    const d = createEmptyData(1_000, '2.0.0');
    expect(parseData(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });
  it('rejects unknown keys and bad versions', () => {
    const d: any = createEmptyData(1_000, '2.0.0');
    expect(() => parseData({ ...d, schemaVersion: 3 })).toThrow();
    expect(() => parseData({ ...d, extra: 1 })).toThrow();
  });
  it('rejects a task/add with a 201-char title and unknown fields', () => {
    expect(ActionSchema.safeParse({ type: 'task/add', id: 'a', now: 1, title: 'x'.repeat(201) }).success).toBe(false);
    expect(ActionSchema.safeParse({ type: 'task/add', id: 'a', now: 1, title: 'ok', bogus: true }).success).toBe(false);
    expect(ActionSchema.safeParse({ type: 'task/add', id: 'a', now: 1, title: 'ok' }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/core` → FAIL (modules missing).
- [ ] **Step 3: Implement** the four files exactly per the interfaces above. `ymd` must use `getFullYear/getMonth/getDate`, never `toISOString`.
- [ ] **Step 4: Run** `npm test` → PASS under both time zones.
- [ ] **Step 5: Commit** `feat(core): data types, zod schema, local date helpers`.

### Task 1.2: Reducer and selectors (the subset the strip needs)

**Files:** Create `src/core/reducer.ts`, `src/core/select.ts`; Test `tests/core/reducer.test.ts`, `tests/core/select.test.ts`.

**Interfaces (produces):**

```ts
// reducer.ts
export function reduce(data: Data, action: Action): Data;   // immer produce; unknown action → returns data unchanged
// select.ts
export interface TodayView { current?: Task; next: Task[]; done: number; total: number; unplanned: boolean /* Today empty, current came from Inbox */ }
export function todayView(data: Data, now: number): TodayView;     // excludes snoozed (snoozedUntil > now) and done; ordered by `order`
export function currentTask(data: Data, now: number): Task | undefined;
export function tasksInList(data: Data, listId: Id): Task[];       // open, top-level, ordered
export function isSnoozed(t: Task, now: number): boolean;
export function nextOrder(tasks: Task[]): number;                  // max(order)+1000 or 1000
export function orderBetween(a?: number, b?: number): number;      // fractional insert
```

Rules implemented in this task: `task/add` (order = nextOrder within list; `today` defaults true when `makeCurrent`; `makeCurrent` sets order = min(order)−1000 among Today), `task/complete` (status done, completedAt, completedBy, stops timer folding elapsed into spentSeconds; if `recurrence` present and `spawnId` given, create the next occurrence via `nextOccurrence` from Task 3.3 — until then, a stub that copies `due.date` forward one day for `daily` only and is replaced in Task 3.3), `task/uncomplete`, `task/delete` (also deletes children), `task/makeCurrent`, `task/skip` (order = nextOrder among Today), `task/snooze`, `task/setToday`, `settings/patch` (deep merge), `data/replace`.

- [ ] **Step 1: Tests**

```ts
// tests/core/reducer.test.ts
import { describe, it, expect } from 'vitest';
import { reduce } from '../../src/core/reducer';
import { createEmptyData, INBOX_ID } from '../../src/core/defaults';
import { todayView } from '../../src/core/select';
const t0 = 1_700_000_000_000;
const add = (d: any, id: string, title: string, extra = {}) => reduce(d, { type: 'task/add', id, now: t0, title, today: true, ...extra });
describe('reducer: tasks', () => {
  it('adds to inbox with increasing order', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A'); d = add(d, 'b', 'B');
    expect(d.tasks.map(t => [t.id, t.listId, t.order])).toEqual([['a', INBOX_ID, 1000], ['b', INBOX_ID, 2000]]);
  });
  it('makeCurrent moves a task to the front of Today', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A'); d = add(d, 'b', 'B');
    d = reduce(d, { type: 'task/makeCurrent', id: 'b', now: t0 });
    expect(todayView(d, t0).current?.id).toBe('b');
  });
  it('complete records who completed and advances', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A'); d = add(d, 'b', 'B');
    d = reduce(d, { type: 'task/complete', id: 'a', now: t0 + 5, by: 'user' });
    const a = d.tasks.find(t => t.id === 'a')!;
    expect([a.status, a.completedBy, a.completedAt]).toEqual(['done', 'user', t0 + 5]);
    expect(todayView(d, t0 + 5).current?.id).toBe('b');
    expect(todayView(d, t0 + 5)).toMatchObject({ done: 1, total: 2 });
  });
  it('snoozed tasks are skipped until the time passes', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A'); d = add(d, 'b', 'B');
    d = reduce(d, { type: 'task/snooze', id: 'a', now: t0, until: t0 + 60_000 });
    expect(todayView(d, t0).current?.id).toBe('b');
    expect(todayView(d, t0 + 60_001).current?.id).toBe('a');
  });
  it('falls back to Inbox when Today is empty and flags unplanned', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A', { today: false });
    expect(todayView(d, t0)).toMatchObject({ unplanned: true });
    expect(todayView(d, t0).current?.id).toBe('a');
  });
  it('delete removes children', () => {
    let d = createEmptyData(t0, '2.0.0');
    d = add(d, 'a', 'A'); d = add(d, 'a1', 'A1', { parentId: 'a' });
    d = reduce(d, { type: 'task/delete', id: 'a', now: t0 });
    expect(d.tasks).toHaveLength(0);
  });
  it('unknown actions are a no-op', () => {
    const d = createEmptyData(t0, '2.0.0');
    expect(reduce(d, { type: 'nope' } as any)).toBe(d);
  });
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** with `produce` from immer; export `reduce` only. **Step 4: Run** → PASS. **Step 5: Commit** `feat(core): reducer and today selectors`.

### Task 1.3: Undo ring

**Files:** Create `src/core/undo.ts`; Test `tests/core/undo.test.ts` (fast-check).

```ts
export class UndoStack {
  constructor(private limit = 50) {}
  push(prev: Data, label: string): void;      // called before applying an undoable action
  undo(current: Data): { data: Data; label: string } | undefined;   // moves current onto redo
  redo(current: Data): { data: Data; label: string } | undefined;
  clearRedo(): void; get canUndo(): boolean; get canRedo(): boolean;
}
export const UNDOABLE = new Set<Action['type']>(['task/add','task/edit','task/complete','task/uncomplete','task/delete','task/move','task/makeCurrent','task/skip','task/snooze','task/setToday','timer/stop','timer/addTime','list/add','list/rename','list/delete','day/close']);
export function labelFor(action: Action, data: Data): string;   // e.g. 'Completed "Email update"'
```

- [ ] **Step 1: Test** property: for any sequence of ≤ 20 `task/add`/`task/complete`/`task/delete` actions, applying then undoing all returns a `Data` deep-equal to the start; redo all returns the end state; ring never exceeds 50.

```ts
import { fc, it } from '@fast-check/vitest'; // or import fc from 'fast-check' and vitest it
```

Use `fc.array(fc.oneof(addArb, completeArb, deleteArb), { maxLength: 20 })`, ids from `fc.constantFrom('a','b','c','d')`, and `now` increasing.

- [ ] **Step 2–5:** FAIL → implement (arrays of `{data,label}`, `shift()` when over limit) → PASS → commit `feat(core): undo ring with property tests`.

### Task 1.4: Legacy migration

**Files:** Create `src/core/migrate.ts`; Test `tests/core/migrate.test.ts`; Fixture `tests/fixtures/legacy-state.json` (copy the real 26-task file from `%APPDATA%\TimeBound\state.json` with titles unchanged; it is the owner's own data and lives in the repo as a fixture).

```ts
export interface LegacyState { score?: number; tasks?: LegacyTask[]; stats?: {...}; preferences?: { alwaysOnTop?: boolean }; meta?: {...} }
export function migrateLegacy(raw: unknown, now: number, appVersion: string): Data;  // never throws on shape drift; skips invalid tasks and reports count in meta? No: returns Data; invalid tasks are dropped and counted via a second return → use { data, dropped }
```

Rules (E18): read raw, never replay time; `completed|struck → done` with `completedBy: 'timer'` for `struck` and `auto_complete` history, `'user'` otherwise; `timer = { plannedSeconds: timeAssignedSeconds, spentSeconds: max(0, assigned − remaining) }`, never running; `today: false`, `listId: 'inbox'`, order by original array index × 1000; `days` derived from each `completedAt` in local time; `settings.score = { enabled: score !== undefined && score !== 0, value: score ?? 0 }`; `meta.legacyImportedAt = now`.

- [ ] Tests: fixture yields 26 tasks all done; a `struck` task has `completedBy 'timer'`; a task with `remainingSeconds 600, timeAssignedSeconds 1500` yields `spentSeconds 900`; `days` has the right per-day counts for `2025-12-16` (compute from fixture, local); garbage input (`{}` and `null`) yields empty data with `dropped 0`.
- [ ] Commit `feat(core): migrate legacy state.json`.

### Task 1.5: Persistence (main)

**Files:** Create `src/main/paths.ts`, `src/main/persist.ts`; Test `tests/main/persist.test.ts` (uses a temp dir via `fs.mkdtemp`, injectable `fs` and clock).

```ts
// paths.ts
export function resolveDataDir(opts: { userData: string; env?: string; settingsDataDir?: string }): string;
// persist.ts
export interface PersistDeps { dir: string; now: () => number; fs?: typeof import('node:fs/promises'); log?: (m: string) => void }
export interface LoadResult { data: Data; source: 'data' | 'backup' | 'legacy' | 'empty'; recoveredFrom?: string; corruptSavedAs?: string; legacyDropped?: number }
export function load(deps: PersistDeps, appVersion: string, legacyPath?: string): Promise<LoadResult>;
export function save(deps: PersistDeps, data: Data): Promise<void>;   // temp→rename, retry 50/200/800, daily backup rotation, keep 30
export function listBackups(deps: PersistDeps): Promise<string[]>;
export function cleanOrphans(deps: PersistDeps): Promise<void>;     // *.tmp older than 1 min
```

Layout in `dir`: `data.json`, `data.tmp-<pid>-<ts>.json`, `backups/data-YYYY-MM-DD.json`, `data.corrupt-<ts>.json`, `legacy-state.json` (copy of the imported legacy file).

- [ ] Tests: save then load equals; corrupt `data.json` + valid backup → `source 'backup'` and corrupt file renamed; both corrupt → `'empty'`; `rename` throwing `EPERM` twice then succeeding → save succeeds and `log` shows two retries; two saves on the same local day produce one backup file; 31 backups → oldest removed; legacy path present and no `data.json` → `'legacy'` with 26 tasks and `legacy-state.json` copied, original untouched (`stat.mtime` equal).
- [ ] Commit `feat(main): atomic persistence with backups and recovery`.

### Task 1.6: Store, IPC contract, preload

**Files:** Create `src/main/store.ts`, `src/main/ipc.ts`, `src/shared/ipc.ts`, `src/shared/platform.ts`; Rewrite `src/main/preload.ts`; Test `tests/main/store.test.ts`, `tests/main/ipc.test.ts`.

```ts
// shared/ipc.ts
export interface Snapshot { rev: number; data: Data; today: TodayView; canUndo: boolean; canRedo: boolean; lastUndoLabel?: string; platform: 'win32' | 'darwin' | 'linux'; capabilities: { appBar: boolean; fullscreenDetect: boolean } }
export type InvokeMap = {
  'store:get': () => Snapshot;
  'store:dispatch': (action: Action) => { rev: number };
  'store:undo': () => { rev: number; label?: string };
  'store:redo': () => { rev: number; label?: string };
  'strip:expand': (open: boolean) => void;
  'strip:reportSize': (size: { width: number; height: number }) => void;
  'strip:setEdge': (edge: Edge) => void;
  'strip:dragStart': () => void;
  'strip:hover': (inside: boolean) => void;
  'palette:show': (mode: 'capture' | 'plan' | 'close' | 'commands' | 'onboarding') => void;
  'palette:hide': () => void;
  'planner:show': () => void;
  'planner:hide': () => void;
  'app:openExternal': (url: string) => void;
  'app:quit': () => void;
  'data:export': (format: 'json' | 'md') => { path?: string };
  'data:import': () => { imported?: number; error?: string };
  'data:chooseDir': () => { dir?: string };
  'hotkeys:test': (accelerator: string) => { ok: boolean; reason?: string };
};
export type EventMap = { 'store:changed': Snapshot; 'palette:mode': 'capture' | 'plan' | 'close' | 'commands' | 'onboarding'; 'strip:state': { expanded: boolean; hidden: boolean } };
export interface Bridge {
  invoke<K extends keyof InvokeMap>(channel: K, ...args: Parameters<InvokeMap[K]>): Promise<ReturnType<InvokeMap[K]>>;
  on<K extends keyof EventMap>(channel: K, cb: (payload: EventMap[K]) => void): () => void;
}
declare global { interface Window { tb: Bridge } }
```

```ts
// main/store.ts
export class Store {
  constructor(initial: Data, deps: { save: (d: Data) => Promise<void>; now: () => number; appVersion: string; platform: NodeJS.Platform })
  get(): Snapshot; dispatch(action: Action): number /* rev */; undo(): string | undefined; redo(): string | undefined;
  subscribe(cb: (s: Snapshot) => void): () => void;     // also used by tray/clock
  replace(data: Data): void;                              // from file watcher / import
}
```

`dispatch` validates nothing (ipc.ts validates), pushes to `UndoStack` when `UNDOABLE.has(type)`, reduces, bumps `rev`, debounces `save` 250 ms (flush on `before-quit`), notifies subscribers. `ipc.ts` registers every `InvokeMap` channel with `ipcMain.handle`, validates `action` with `ActionSchema`, checks `event.senderFrame.url` starts with the app origin, and throws `IpcRejected` otherwise. Preload exposes exactly `window.tb` with a channel allowlist.

- [ ] Tests: store bumps `rev` and calls `save` once for three rapid dispatches; undo returns label and restores; ipc rejects `{type:'task/add', title:'x'.repeat(201)}` and a payload from `senderFrame.url = 'https://evil'` (mock `ipcMain`).
- [ ] Commit `feat(main): store, typed IPC, sandboxed preload`.

### Task 1.7: Strip window manager

**Files:** Create `src/main/windows/displays.ts`, `src/main/windows/strip.ts`, `src/main/windows/csp.ts`; Test `tests/main/displays.test.ts`.

```ts
// displays.ts (pure functions over Electron's Display shape; no Electron import — pass displays in)
export interface DisplayLike { id: number; bounds: Rect; workArea: Rect; scaleFactor: number }
export function displayKey(d: DisplayLike): string;              // `${id}` primary key; signature fallback `${w}x${h}@${scale}`
export function dockBounds(d: DisplayLike, edge: Edge, size: { width: number; height: number }, along?: number, taskbarAutoHide?: boolean): Rect;  // flush to edge inside workArea; reserve 2 px when workArea==bounds on that edge
export function clampAlong(d: DisplayLike, x: number, width: number): number;
export function panelBounds(strip: Rect, edge: Edge, panelHeight: number): Rect;  // grows away from the edge
```

`strip.ts` exports `class StripWindow` with `create(store)`, `show()`, `hide()`, `toggle()`, `setEdge(edge)`, `expand(open)`, `applySettings(s: Settings['strip'])`, `handleReportedSize({width,height})`, `beginDrag()`, `destroy()`. Rules: `new BrowserWindow({ frame:false, transparent:true, alwaysOnTop:true, focusable:false, skipTaskbar:true, resizable:false, hasShadow:false, show:false, type: process.platform==='darwin' ? 'panel' : undefined, webPreferences:{ preload, sandbox:true, contextIsolation:true } })`; on macOS also `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` and `setAlwaysOnTop(true, 'floating')`; `showInactive()` after the first `store:changed` is delivered; `setContentProtection(settings.hideFromCapture)`; position memory keyed by `displayKey`; re-dock on `screen` events `display-added`, `display-removed`, `display-metrics-changed`; drag = 60 Hz `setInterval` reading `screen.getCursorScreenPoint()` until the renderer reports mouseup or 10 s; hover poll = 100 ms `setInterval` comparing cursor to `getBounds()` while expanded or clickThrough, collapsing 300 ms after leaving; click-through = `setIgnoreMouseEvents(true, { forward: true })` except when the cursor is inside the 24×24 handle rect; auto-hide = after 3 s without hover and no running timer, `setBounds` to a 4 px sliver; panel expand = one `setBounds(panelBounds(...), false)`.

- [ ] Tests for `displays.ts`: bottom dock on a 1366×768 display with 48 px taskbar gives `y = 720−32`; `taskbarAutoHide` reserves 2 px; `clampAlong` keeps the strip inside; panel above a bottom strip has `y = strip.y − panelHeight`.
- [ ] Commit `feat(main): strip window manager with docking and per-display memory`.

### Task 1.8: Strip renderer

**Files:** Create `src/renderer/index.html` (routes), `src/renderer/main.tsx`, `src/renderer/lib/useStore.ts`, `src/renderer/lib/useDisplayTime.ts`, `src/renderer/theme/ThemeProvider.tsx`, `src/renderer/strip/StripApp.tsx`, `Strip.tsx`, `Pill.tsx`, `Panel.tsx`, `PanelRow.tsx`, `src/renderer/styles/app.css`; Delete the old renderer (`App.tsx`, `components/*`, `store/*`, `utils/*`, `types.d.ts`).

Build exactly the DESIGN.md strip spec: root `<div class="strip" data-state=…>` with `.handle` (24×24, `onMouseDown` → `tb.invoke('strip:dragStart')` after 6 px / 200 ms rule, `onMouseEnter/Leave` for click-through), `.dot`, `.title` (fade mask), `.chip`, `.progress`. `ResizeObserver` on the root reports `strip:reportSize`. Hover 150 ms stationary rule → `strip:expand(true)`; the panel renders inside the same window above/below the strip per `edge`. `useDisplayTime` derives `remaining/elapsed` from `timer.runningSince` with a 1 s interval only while running. Completion animation: 1.2 s `.strike` then title swap; respects `prefers-reduced-motion` and the setting. `aria-hidden="true"` on the strip root (D30).

- [ ] e2e `e2e/focus.spec.ts`: launch → exactly one visible window with URL hash `#/strip`; `bounds.height <= 40`; `bounds` inside the matching display's `workArea`; `isFocusable() === false`; `isAlwaysOnTop() === true`; title text equals the current task; `store:dispatch task/complete` via `app.evaluate` → title changes to the next task within 1.5 s.
- [ ] e2e `e2e/restart.spec.ts`: add two tasks, move strip edge to top, quit, relaunch → same tasks, same edge, same position.
- [ ] Commit `feat(strip): strip, pill, hover panel renderer`.

### Task 1.9: Hotkeys, tray, palette shell, planner placeholder, app wiring

**Files:** Create `src/main/hotkeys.ts`, `src/main/tray.ts`, `src/main/windows/palette.ts`, `src/main/windows/planner.ts`, `src/main/licensing/index.ts`, `src/renderer/palette/PaletteApp.tsx`, `Capture.tsx` (title-only for now), `src/renderer/planner/PlannerApp.tsx` (Today list, read-only rows + complete), `src/renderer/ui/*`; Rewrite `src/main/main.ts`; Test `tests/main/hotkeys.test.ts`.

```ts
// hotkeys.ts
export function validateAccelerator(acc: string): { ok: true } | { ok: false; reason: 'no-modifier' | 'denylisted' | 'unparseable' };
export const DENYLIST = ['Alt+F4', 'Control+C', 'Control+V', 'Control+X', 'Control+Z', 'Control+A', 'Control+S', 'Control+W', 'Control+Tab', 'Alt+Tab', 'CommandOrControl+Q'];
export class Hotkeys { apply(settings: Settings['hotkeys'], handlers: Record<keyof Settings['hotkeys'], () => void>): Record<string, boolean /* registered */>; unregisterAll(): void }
```

`main.ts`: single-instance lock; `app.setAppUserModelId('com.timebound.app')`; `app.whenReady` → CSP → `load` → `Store` → windows → hotkeys → tray → `showInactive` strip; `window-all-closed` does nothing (tray app); `before-quit` flushes save and `unregisterAll`. Tray: icon from `build/icon-16x16.png` (template PNG on macOS), tooltip = current title, menu: current title (disabled) · Complete · Quick capture · Show/Hide strip · Open planner · Quit. Palette window: `alwaysOnTop`, `frame:false`, `transparent:false`, 560×auto, centred on the display with the cursor, hides on blur/Escape, `app.hide()` on macOS after hide. Planner window: frameless (Windows) / `hiddenInset` (macOS), 1000×640 default, `close` → hide.

- [ ] e2e `e2e/capture.spec.ts`: `palette:show('capture')` → window `#/palette` visible and focused; type "Write the baseline doc" + Enter → strip title updates; palette hidden; strip still not focused.
- [ ] Tests: `validateAccelerator('Space')` → no-modifier; `'Alt+F4'` → denylisted; `'Control+Alt+Space'` ok.
- [ ] `npm run build && npm run e2e` green; app launches from a clean data dir showing the empty-state strip ("Nothing yet · Ctrl+Alt+Space to add a task").
- [ ] Update `CHANGELOG.md` ("Focus strip"), commit `feat: focus strip slice — hotkeys, tray, capture shell, planner placeholder`.


---

## Slice 2 — Capture and the keyboard sheets

Deliverable: natural-language capture with live token chips, multi-line paste, plan-today and close-day sheets, undo toast, day rollover. e2e: `capture.spec.ts` extended with parsed tokens.

### Task 2.1: Natural-language parser

**Files:** Create `src/core/parse.ts`; Test `tests/core/parse.test.ts` (table-driven, ≥ 40 rows).

```ts
export interface ParsedCapture { title: string; due?: Due; plannedSeconds?: number; tags: string[]; listName?: string; recurrence?: Rule; tokens: Array<{ kind: 'when' | 'timer' | 'tag' | 'list' | 'repeat'; text: string; label: string }> }
export function parseCapture(input: string, now: number, listNames: string[]): ParsedCapture;
```

Grammar (v1, English, deterministic; every rule is a regex tried right-to-left over whitespace-separated tokens, consumed tokens removed from the title, remaining text trimmed and whitespace-collapsed):
- Tags: `#word` (letters, digits, `-`, `_`), lowercase, deduplicated.
- List: `/word` or `@word`; case-insensitive match against `listNames`; unknown names are kept as `listName` for creation.
- Dates: `today`, `tomorrow`, `tmrw`, `yesterday` (→ today, flagged), weekday names and 3-letter forms (next occurrence, today if today's weekday and time not passed), `next week` (next Monday), `next month` (1st), `in N days|weeks`, `sep 20`, `20 sep`, `20/9`, `2026-09-20`, `eom`.
- Times: `3pm`, `3:30pm`, `15:00`, `at 9`, `noon`, `midnight`, `morning` (9:00), `evening` (18:00). A time without a date implies today, or tomorrow if the time has passed.
- Durations (timer): `25m`, `1h`, `1h30`, `1h30m`, `for 45 min`, `90 min`.
- Recurrence: `every day|daily`, `every weekday|weekdays`, `every monday|mon`, `every mon,wed,fri`, `weekly` (same weekday as due or today), `every 2 weeks`, `every 3 days`, `monthly`, `every month on the 15th`.
- Ambiguity rules: a bare number is never a time or date (`buy 9 apples` keeps 9 in the title; `at 9` is a time); `for` only starts a duration when followed by a number and a unit; `eat at joes` keeps `at joes`.

- [ ] **Step 1: Table test**

```ts
const now = new Date(2026, 8, 14, 10, 0).getTime(); // Mon 14 Sep 2026 10:00
const rows: Array<[string, Partial<ParsedCapture>]> = [
  ['call bank tomorrow 3pm #finance', { title: 'call bank', due: { date: '2026-09-15', time: '15:00' }, tags: ['finance'] }],
  ['call bank at 9', { title: 'call bank', due: { date: '2026-09-15', time: '09:00' } }],   // 9:00 has passed today
  ['buy 9 apples', { title: 'buy 9 apples', due: undefined }],
  ['deep work 1h30 /work', { title: 'deep work', plannedSeconds: 5400, listName: 'work' }],
  ['standup every weekday 9:30', { title: 'standup', recurrence: { kind: 'weekdays' }, due: { date: '2026-09-15', time: '09:30' } }],
  ['pay rent monthly on the 1st', { title: 'pay rent', recurrence: { kind: 'monthly', dayOfMonth: 1 }, due: { date: '2026-10-01' } }],
  ['gym every mon,wed,fri 7am', { recurrence: { kind: 'weekly', days: [1, 3, 5] } }],
  ['review every 2 weeks', { recurrence: { kind: 'everyN', n: 2, unit: 'week', anchor: '2026-09-14' } }],
  ['eat at joes', { title: 'eat at joes' }],
  ['report fri', { due: { date: '2026-09-18' } }],
  ['taxes sep 20', { due: { date: '2026-09-20' } }],
  ['taxes 20/9', { due: { date: '2026-09-20' } }],
  ['  spaced   title  #a #a', { title: 'spaced title', tags: ['a'] }],
];
it.each(rows)('%s', (input, expected) => expect(parseCapture(input, now, ['Work', 'Home'])).toMatchObject(expected));
```

- [ ] Steps 2–5 as usual; commit `feat(core): natural-language capture parser`.

### Task 2.2: Capture UI with token chips and paste

**Files:** Modify `src/renderer/palette/Capture.tsx`; Create `src/renderer/palette/TokenChips.tsx`; Test `tests/renderer/capture.test.tsx` (Vitest + @testing-library/react, add as dev dep with a DECISIONS line).

Behaviour: input value → `parseCapture` on every change (debounce 0; it is cheap) → chips per DESIGN.md; `Enter` dispatches `task/add` with `today: true` (and `makeCurrent` when `Shift+Enter`); `Escape` once clears tokens by wrapping the raw text in quotes (`"…"` disables parsing), twice closes; pasting text with ≥ 2 lines adds one task per non-empty line through the parser and shows "Added 5 tasks"; unknown `/list` creates the list first (`list/add` then `task/add`).

- [ ] Commit `feat(palette): live-parsed capture with token chips and multi-line paste`.

### Task 2.3: Day rollover, plan today, close day

**Files:** Modify `src/core/reducer.ts` (`day/rollover`, `day/close`), `src/core/select.ts` (`rolloverCandidates(data, date)`, `dayStats(data, date)`); Create `src/renderer/palette/PlanToday.tsx`, `CloseDay.tsx`; Modify `src/main/clock.ts` (schedule a `day/rollover` at the next 4 AM local; also on `resume`/`unlock`), `src/main/windows/strip.ts` (plan chip → `palette:show('plan')`).

`day/rollover`: for every open task with `today: true` created before `date`, increment `days[date−1].rolledOver` and keep `today: true` (tasks stay until the user unplans them); ensure a `DayRecord` for `date`. Plan today lists: rolled-over tasks, tasks due `date` or earlier, then Inbox top 10; space toggles `today`, Enter confirms via one `task/setToday` and closes; footer shows selected count and summed `plannedSeconds`. Close day: `dayStats` (completed, focusSeconds, rolledOver) plus an optional note → `day/close`; strip shows the done-for-today state when `today` total > 0 and done === total.

- [ ] Tests: rollover increments `rolledOver` once per task per day and is idempotent for the same date; `dayStats` sums `spentSeconds` deltas recorded that day (store per-task `focusByDay`? No: record focus into `DayRecord.focusSeconds` at `timer/pause|stop|complete` time in the reducer using `ymd(now)`).
- [ ] e2e: with two rolled-over tasks, `palette:show('plan')` lists them; Enter keeps the first only; strip shows it.
- [ ] Commit `feat: day rollover, plan today, close day`.

### Task 2.4: Undo everywhere

**Files:** Modify `src/main/ipc.ts`, `src/renderer/strip/Panel.tsx` (undo row), `src/renderer/planner/Toast.tsx` (`role="status"`), hotkeys handler for `undo`.

- [ ] e2e: complete via hotkey handler (call the registered handler through `app.evaluate` on the Hotkeys instance exposed for tests as `globalThis.__tb.hotkeys`), then `store:undo` → previous task current again; toast text "Undid: Completed …".
- [ ] Update `CHANGELOG.md`; commit `feat: undo from strip, planner, and hotkey`.

---

## Slice 3 — Timers, pomodoro, idle and sleep

Deliverable: start/pause/stop on the current task from strip, panel, hotkey, and tray; time in the strip; overtime; pomodoro; native notification at zero; idle pause; sleep gap rule; recurrence engine (needed by completion). e2e: `timer.spec.ts`.

### Task 3.1: Timer math

**Files:** Create `src/core/timer.ts`; Test `tests/core/timer.test.ts`.

```ts
export function elapsedSeconds(t: TaskTimer, now: number): number;   // spent + (running ? max(0, now − runningSince)/1000 : 0)
export function remainingSeconds(t: TaskTimer, now: number): number | undefined; // planned − elapsed, may be negative (overtime)
export function expiryAt(t: TaskTimer): number | undefined;          // runningSince + (planned − spent)*1000
export function applySleepGap(t: TaskTimer, suspendedAt: number, resumedAt: number, thresholdMs: number): TaskTimer; // if gap > threshold: pause at suspendedAt
export function fmtClock(seconds: number): string;                     // 24:59 · 1:04:00 · +02:14 for negatives
```

Reducer: `timer/start` (stops any other running timer, folding its elapsed into spent; sets `runningSince = now`), `timer/pause` (`at ?? now`, folds elapsed, clears `runningSince`, records focus into the day), `timer/stop`, `timer/addTime` (planned += seconds; score −1 if `settings.score.enabled`), `task/complete` folds the running timer.

- [ ] Tests: elapsed with clock moved backwards clamps to spent; expiry math; sleep gap over threshold pauses at suspend instant; under threshold keeps running; `fmtClock(-134)` → `'+02:14'`; `fmtClock(3840)` → `'1:04:00'`.
- [ ] Commit `feat(core): timer math`.

### Task 3.2: Clock in main, notifications, tray/strip controls

**Files:** Create `src/main/clock.ts`, `src/main/notify.ts`; Modify `src/main/tray.ts`, `src/renderer/strip/*` (chip states per DESIGN.md), `src/renderer/strip/Panel.tsx` (timer buttons in the head row), hotkey `toggleTimer`.

`clock.ts`: subscribes to the store; whenever the current running timer changes, clears and re-arms one `setTimeout` for `expiryAt` (cap at 2^31−1 ms, re-arm if beyond); at expiry dispatch nothing to the store but call `notify.timerDone(task)` and, if pomodoro is on, dispatch `timer/pause` and start a break (`settings.timer.breakMinutes`) tracked in memory with its own timeout and a strip "Break · 4:32" state via `strip:state`; `powerMonitor` `suspend|lock-screen` → remember instant; `resume|unlock` → `applySleepGap` through a `timer/pause` with `at`; idle: every 60 s while running, `powerMonitor.getSystemIdleTime() ≥ idlePauseMinutes*60` → pause with `at = now − idle`. `notify.ts`: `new Notification({ title, body, silent: false })` if `settings.notifications`; on Windows requires `setAppUserModelId` (already set in main); clicking the notification opens the planner.

- [ ] Tests (`tests/main/clock.test.ts` with fake timers): arming, re-arming on change, expiry fires once, idle pause dispatch, suspend/resume over threshold.
- [ ] e2e `timer.spec.ts`: start a 2 s planned timer via dispatch → strip chip counts down → after expiry the dot turns `warn` and chip shows `+00:0x`.
- [ ] Commit `feat: timers in main with expiry, idle, sleep handling; pomodoro`.

### Task 3.3: Recurrence engine

**Files:** Create `src/core/recur.ts`; Modify `src/core/reducer.ts` (`task/complete` spawns via `nextOccurrence`); Test `tests/core/recur.test.ts`.

```ts
export function nextOccurrence(rule: Rule, after: Ymd): Ymd;    // strictly after `after`
export function describeRule(rule: Rule): string;                // 'Every weekday', 'Every Mon, Wed', 'Monthly on the 31st', 'Every 2 weeks'
```

Rules: `daily` +1; `weekdays` Fri→Mon, Sat→Mon; `weekly` next listed day; `monthly` uses `dayOfMonth` from the rule clamped to the target month's length (31 Jan → 28 Feb → 31 Mar); `everyN` steps from `anchor` in `n`-unit multiples to the first date after `after`. Spawned task copies title, notes, list, tags, `recurrence`, `plannedSeconds`, sets `due.date = nextOccurrence(rule, completedDate)` keeping `due.time`, `today: false`, new id = `spawnId`.

- [ ] Tests: the month-end chain above; Feb 29 2028 monthly on the 29th → Mar 29; `everyN` anchor arithmetic; DST-crossing dates under both TZ runs; `task/complete` with `spawnId` creates exactly one open task with the new due date and the same recurrence; undo of that completion removes the spawn.
- [ ] Update `CHANGELOG.md`; commit `feat(core): recurrence engine wired into completion`.

---

## Slice 4 — Planner

Deliverable: full main window per DESIGN.md: rail, virtualised list with sections, keyboard navigation and single-key actions, drag reorder, detail pane, sub-tasks, tags, lists, due, snooze, recurrence editor, command palette. e2e: `planner.spec.ts`.

### Task 4.1: Planner shell and Today list

**Files:** Create `src/renderer/planner/TitleBar.tsx`, `Rail.tsx`, `TaskList.tsx`, `TaskRow.tsx`, `EmptyState.tsx`; Modify `PlannerApp.tsx`.

Views: Today (Current / Up next / Done sections), Upcoming (grouped by due date, 14 days), Inbox, each list, each tag, Logbook (done, newest first, virtualised). Rows per DESIGN.md (34 px, 16 px radio, tag, due, timer). `@tanstack/react-virtual` for lists over 60 rows. Title bar: brand, capture field (focus → opens inline capture using the same `Capture` component), `Ctrl+K`, window controls (Windows) / 78 px traffic-light gap (macOS).

- [ ] e2e: with 500 generated tasks the Logbook renders under 200 ms after navigation (measure with `performance.now()` inside `page.evaluate`) and scrolls to the end.
- [ ] Commit `feat(planner): shell, rail, virtualised lists`.

### Task 4.2: Keyboard model and command palette

**Files:** Create `src/renderer/planner/keys.ts`, `src/renderer/palette/Commands.tsx`; Modify `PlannerApp.tsx`.

Keys (when no input is focused): `j`/`k` or arrows move selection; `Space` toggles done; `Enter` opens the detail pane; `e` edit title inline; `t` toggle today; `s` snooze menu (1 h, this evening, tomorrow, next week, pick); `d` due picker (same parser as capture, text field); `x` delete with undo toast; `m` move to list; `Shift+↑/↓` reorder (dispatch `task/move` with `afterId`); `Ctrl+K` command palette (commands: every action above, "Go to …" for views, theme switch, settings sections). Focus ring per DESIGN.md (`accent-tint` row + 1 px `line`). All icon buttons have `aria-label`.

- [ ] e2e: keyboard-only flow: open planner → `j` twice → `Space` → the third task is done; `Shift+Up` reorders; `Ctrl+K` "Go to Inbox".
- [ ] Commit `feat(planner): keyboard model and command palette`.

### Task 4.3: Drag reorder, sub-tasks, detail pane, lists and tags

**Files:** Create `src/renderer/planner/Detail.tsx`, `RecurrenceEditor.tsx`, `DuePicker.tsx`; Modify `TaskList.tsx` (dnd-kit sortable, vertical axis, 6 px activation), `Rail.tsx` (add/rename/delete lists via inline edit).

Detail pane: title (editable), list, tags (chip input), due, repeats (`describeRule` + editor: daily / weekdays / weekly with day toggles / monthly day / every N), snooze, notes (textarea, autosave 500 ms), timer block (big clock, Pause/Stop, "of 25 min", planned editor), sub-tasks (one level; adding uses `task/add` with `parentId`; completing all children does not complete the parent).

- [ ] e2e: drag the third row above the first → order persists after relaunch; add a sub-task from the detail pane → appears indented under its parent.
- [ ] Update `CHANGELOG.md`; commit `feat(planner): drag reorder, detail pane, sub-tasks, lists, tags`.

---

## Slice 5 — Settings, themes, onboarding, data

Deliverable: the settings screen per DESIGN.md, theme switching with system mode, text size, hotkey recorder with conflicts, start on login, notifications toggle, data folder + watcher, export/import JSON and Markdown, backups list, onboarding. e2e: `theme.spec.ts`, `settings.spec.ts`, `data.spec.ts`.

### Task 5.1: Theme provider and settings shell

**Files:** Modify `src/renderer/theme/ThemeProvider.tsx` (sets `data-theme`/`data-mode` on `<html>` in every window; `system` follows `nativeTheme` via a `store:changed` field `systemDark`), Create `src/renderer/settings/Settings.tsx`, `sections/Strip.tsx`, `sections/Theme.tsx`, `sections/Timer.tsx`, `sections/Startup.tsx`, `sections/Score.tsx`, `src/renderer/ui/Segmented.tsx`, `Toggle.tsx`, `Range.tsx`.

- [ ] e2e `theme.spec.ts`: switch to Kraft dark in settings → strip `<html data-theme="kraft" data-mode="dark">` within 100 ms → relaunch → persists.
- [ ] Commit `feat(settings): settings shell, theme, strip, timer, startup sections`.

### Task 5.2: Hotkey recorder

**Files:** Create `src/renderer/settings/KeyRecorder.tsx`, `sections/Hotkeys.tsx`; Modify `src/main/hotkeys.ts` (`hotkeys:test` re-registers and reports).

Recorder: focus → "Press keys…" → builds an accelerator from `KeyboardEvent` (`Control`, `Alt`, `Shift`, `Super` + key), validates with `validateAccelerator`, shows the reason inline ("Needs Ctrl, Alt or ⌘", "Reserved by the system", "In use by another app"), Escape cancels, Backspace resets to default. Glyphs per platform from `src/renderer/lib/keys.ts`.

- [ ] Tests: recorder maps `{ctrlKey, altKey, key:' '}` → `'Control+Alt+Space'`; rejects `{key:'a'}`.
- [ ] Commit `feat(settings): hotkey recorder with conflict display`.

### Task 5.3: Data section: folder, watcher, export/import, backups

**Files:** Create `src/core/export.ts`, `src/renderer/settings/sections/Data.tsx`; Modify `src/main/persist.ts` (watcher: `fs.watch` on `data.json`, debounce 500 ms, reload if the file's `meta.lastSavedAt` is newer than the in-memory base and not our own write; on divergence write `data.conflict-<ts>.json` and keep the newer), `src/main/ipc.ts` (`data:*` handlers using `dialog`).

```ts
export function toJson(data: Data): string;                       // pretty, stable key order
export function fromJson(text: string): Data;                     // parseData; throws DataInvalidError
export function toMarkdown(data: Data): string;                   // '# List' headings, '- [ ] title (due 2026-09-20 15:00) #tag' lines, '  - [ ] sub' for children
export function fromMarkdown(text: string, now: number, idGen: () => Id): { tasks: Task[]; lists: List[] };
```

- [ ] Tests: JSON round-trip equality; Markdown round-trip keeps titles, done state, due, tags, hierarchy; import rejects > 20 MB and malformed; watcher test with a temp dir.
- [ ] e2e `data.spec.ts`: export JSON → file exists and `fromJson` equals store; import a fixture → task count increases.
- [ ] Commit `feat(data): export/import JSON and Markdown, data folder with watcher, backups list`.

### Task 5.4: Onboarding

**Files:** Create `src/renderer/palette/Onboarding.tsx`; Modify `src/main/main.ts` (first run: `!settings.onboardingDone` → show palette in `onboarding` mode after the strip appears; no planner window).

Three cards per DESIGN.md renders (`docs/design/onboarding.png`): add first task (embeds `Capture`), pick an edge (segmented; the strip moves live), five keys (platform glyphs). Skip anywhere. Existing-data first run shows "Imported N tasks from your previous TimeBound" in card 1 instead of the capture prompt. Sets `onboardingDone`.

- [ ] e2e: clean data dir → after launch, palette in onboarding mode is visible; type a task + Enter → strip shows it; card 2 Top → strip bounds at `workArea.y`.
- [ ] Update `CHANGELOG.md`; commit `feat: onboarding`.

---

## Slice 6 — macOS

Deliverable: panel-type strip, menu bar mode, DMG packaging, mac release checklist. Verified on a Mac by the owner or a mac agent; the Windows lead verifies that nothing regresses on Windows.

### Task 6.1: Panel window and menu bar mode

**Files:** Modify `src/main/windows/strip.ts` (already `type: 'panel'` on darwin; add `setWindowButtonVisibility(false)`), `src/main/tray.ts` (darwin: `tray.setTitle(truncate(currentTitle, settings.strip.menuBarTitleLength ?? 28) + (running ? ' ' + fmtClock(remaining) : ''))` updated at most once per second while running; template image `build/trayTemplate.png` and `@2x`), `src/renderer/settings/sections/Strip.tsx` (macOS-only "Menu bar mode" toggle: hides the strip window, keeps the item), `src/main/windows/palette.ts` (`app.hide()` after hide on darwin so focus returns).
- [ ] Unit: title truncation; tray title update throttle (fake timers).
- [ ] Commit `feat(mac): panel strip, menu bar mode, focus return`.

### Task 6.2: Packaging and checklist

**Files:** Modify `package.json` (`build.mac`: `category public.app-category.productivity`, `target: dmg`, `arch: [universal]`, `hardenedRuntime: false` until signing, `icon: build/icon.icns` generated by `scripts/generate-icons.js` from the 1024 png), Create `docs/RELEASE-CHECKLIST.md` (Windows focus matrix from C11 + macOS list from spec 5.3), `.github/workflows/build.yml` (matrix windows-latest/macos-latest, `npm ci && npm test && npm run build`; not enabled: file present, owner decides).
- [ ] Commit `chore(mac): dmg packaging config, release checklist, CI workflow file`.

---

## Slice 7 — Windows integration (optional FFI)

Deliverable: "Reserve screen space" (AppBar), "Hide over fullscreen apps", foreground restore after capture, all behind capability flags; "Hide from screen sharing" already first-party (Task 1.7). App is complete without this slice.

### Task 7.1: koffi loader with capabilities

**Files:** Create `src/main/win32/index.ts`, `appbar.ts`, `fullscreen.ts`; Test `tests/main/win32.test.ts` (loader returns `{ appBar:false, fullscreenDetect:false }` when `require('koffi')` throws; pure helpers tested).

`index.ts`: `export async function loadWin32(): Promise<Win32 | undefined>` — `process.platform === 'win32'` and dynamic `import('koffi')` in a try/catch; declares `SHAppBarMessage`, `GetForegroundWindow`, `GetWindowRect`, `MonitorFromWindow`, `GetMonitorInfoW`, `SetForegroundWindow`, `GetWindowLongW`. `appbar.ts`: `reserve(hwnd, edge, height)` / `release(hwnd)` implementing `ABM_NEW`, `ABM_QUERYPOS`, `ABM_SETPOS`, `ABM_REMOVE`. `fullscreen.ts`: `isForegroundFullscreen(): boolean` (foreground window rect equals its monitor rect and it is not the desktop/shell window); polled every 2 s only when `hideOverFullscreen`.
- [ ] Manual verification recorded in `docs/RELEASE-CHECKLIST.md`; Playwright asserts capabilities are reported in the snapshot.
- [ ] `docs/DECISIONS.md` line for `koffi`; commit `feat(win32): optional AppBar reservation and fullscreen detection`.

---

## Slice 8 — Ship

### Task 8.1: Quality gates
- [ ] `npm test`, `npm run e2e`, `node scripts/check-contrast.mjs`, `npm run typecheck` green.
- [ ] `scripts/soak.mjs`: ten-minute scripted session (capture, complete, timer, theme switch, panel open/close every 5 s) asserting zero console errors in all three windows; record the RSS of each process at the end (`process.getProcessMemoryInfo` via `app.evaluate` + `app.getAppMetrics()`).
- [ ] `scripts/measure-strip.mjs`: launch, read strip bounds, compute footprint on 1366×768 (actual), 1920×1080 and 2560×1440 (computed), write `docs/FOOTPRINT.md` with screenshots from the real desktop.
- [ ] Run the `design-review` and `qa` skills against the built app; fix findings; run `health` and `cso` (daily mode); fix everything flagged.

### Task 8.2: Installer, docs, release
- [ ] `npm run package` → `release/TimeBound Setup x.y.z.exe` (unsigned); install on this machine into a temp profile and launch.
- [ ] `README.md`: one-paragraph pitch, screenshots of every screen and theme (`docs/screenshots/`), install and build commands, hotkey table, data location, privacy statement.
- [ ] `CHANGELOG.md` finalised for `2.0.0`; `docs/DECISIONS.md` and `docs/PLAN.md` checkboxes current; `document-release` skill run.
- [ ] Final report per the mission's definition of done, including money/security questions (code signing, Apple notarization).

---

## Self-review

**Spec coverage.** Strip anatomy and states D1–D13 → 1.7, 1.8; onboarding D14 → 5.4; hotkeys D15/E11 → 1.9, 5.2; capture feedback D16 → 2.2; plan/close day D17/D18 → 2.3; settings D19 → 5.x; tray D20 → 1.9, 6.1; edges D21/D26 → 1.7; drag/click-through/handle D22–D24 → 1.7, 1.8; DPI D25 → 1.7; fullscreen D27/C3 → 7.1; auto-hide D28/D29 → 1.7; a11y D30–D34 → 1.8, 4.2, 5.1; C2 content protection/idle/title/zero-CPU → 1.7, 3.2, 1.9; C4 bottom default → 1.7; C8 data folder → 5.3; C9 budgets → 8.1; C14 make current/skip → 1.2, 1.8; C15 first run → 5.4; C16 seam → 1.9; E1–E5 → 1.6, 1.3, 3.2; E7 → 1.7; E9 → 1.7; E10 → 1.8, 5.1; E12 → 1.9, 3.2; E13 → 4.1; E14/E15 → 3.1, 3.2; E16/E17 → 1.1, 3.3; E18/E19 → 1.4, 1.5; E20 → 1.5; E21 → 0.1; E22 → e2e/launch.ts; E23–E26 → 1.6, 1.7, 5.3; macOS Part 5 → 6.x; score C6 → 3.1 (addTime), 5.1 (section). Recurrence and everyN anchors → 3.3. Import/export → 5.3. Licensing seam → 1.9. Gaps: none found.

**Placeholders.** Task 1.2 names a temporary daily-only spawn stub explicitly replaced in 3.3; Task 2.3 resolves its own open question inline (focus recorded into `DayRecord` at pause/stop/complete). No "TBD".

**Type consistency.** `Snapshot`, `TodayView`, `Action` names are used identically across 1.2, 1.6, 1.8, 2.x, 3.x; `fmtClock` is defined in 3.1 and used in 6.1; `validateAccelerator` defined in 1.9, used in 5.2; `nextOccurrence`/`describeRule` defined in 3.3, used in 4.3.
