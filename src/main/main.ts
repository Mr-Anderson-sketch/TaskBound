// main/main — app entry point. Boots CSP, persistence, the Store, every window
// manager, hotkeys, and the tray, then wires the Store <-> IPC <-> renderer loop.
// See .superpowers/sdd/PLAN/task-1.8-1.9-brief.md Part C for the exact wiring this
// follows; CLAUDE.md ("the store lives in the main process; renderers are views").
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import { app, session, nativeTheme, ipcMain, shell, dialog, globalShortcut, powerMonitor, Notification, BrowserWindow } from 'electron';
import type { WebContents } from 'electron';
import { load, save, listBackups, watchDataFile } from './persist';
import type { PersistDeps, DataWatcher } from './persist';
import { resolveDataDir } from './paths';
import { Store } from './store';
import { registerIpc } from './ipc';
import { installCsp } from './windows/csp';
import { StripWindow } from './windows/strip';
import { PaletteWindow } from './windows/palette';
import { PlannerWindow } from './windows/planner';
import { Hotkeys, validateAccelerator } from './hotkeys';
import type { HotkeyHandlers } from './hotkeys';
import { AppTray } from './tray';
import { Clock, resolveToggleTimerAction } from './clock';
import { Notifier } from './notify';
import { loadWin32 } from './win32';
import { FullscreenWatcher } from './win32/watcher';
import { toJson, toMarkdown, fromJson, fromMarkdown, importPlan } from '../core/export';
import { ymd } from '../core/dates';
import type { Snapshot } from '../shared/ipc';
import type { Settings } from '../core/types';

type Route = 'strip' | 'palette' | 'planner';

const isDev = !app.isPackaged && !!process.env.VITE_DEV_SERVER_URL;

// --- paths (must run before whenReady) ------------------------------------------

if (!app.isPackaged && !process.env.TIMEBOUND_DATA_DIR) {
  app.setPath('userData', path.join(app.getPath('appData'), 'TimeBound-dev'));
}
app.setAppUserModelId('com.timebound.app');

const dataDir = resolveDataDir({ userData: app.getPath('userData'), env: process.env.TIMEBOUND_DATA_DIR });
const legacyPath = process.env.TIMEBOUND_DATA_DIR
  ? path.join(dataDir, 'state.json')
  : path.join(app.getPath('appData'), 'TimeBound', 'state.json');

function rendererUrl(route: Route): string {
  if (isDev) {
    return `${process.env.VITE_DEV_SERVER_URL}#/${route}`;
  }
  return `${pathToFileURL(path.join(__dirname, '../../renderer/index.html')).href}#/${route}`;
}

const allowedOrigins = isDev
  ? [process.env.VITE_DEV_SERVER_URL!.replace(/\/?$/, '/')]
  : [pathToFileURL(path.join(__dirname, '../../renderer')).href + '/'];

const preloadPath = path.join(__dirname, '../../preload/main/preload.js');

// --- single instance --------------------------------------------------------------

let planner: PlannerWindow | undefined;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    planner?.show();
  });

  app.whenReady().then(async () => {
    installCsp(session.defaultSession, isDev);

    // Task 3.2 fix round 1, minor "break replay" (fix round 2, item 2: `.once` ->
    // `.on` — a reload, including the automatic one `render-process-gone` below
    // triggers, is ANOTHER `did-finish-load` on the SAME webContents, not a new one,
    // so a one-shot listener only ever replayed the break to a window's very first
    // load): every window replays the CURRENT pomodoro break state (if any) on EVERY
    // `did-finish-load` — covers a renderer reload and covers a window
    // (palette/planner are created lazily, on first show) that comes into existence
    // after a break already started. Registered before ANY BrowserWindow exists
    // (strip.create() below is the first) so it never misses that window's own
    // webContents. `clock` is assigned further down, but this listener's body only
    // ever runs later, asynchronously, once a page actually finishes loading —
    // always after `clock` is set.
    let clock!: Clock;
    app.on('web-contents-created', (_event, contents) => {
      contents.on('did-finish-load', () => {
        if (!contents.isDestroyed()) contents.send('timer:break', clock.getCurrentBreak());
      });
    });

    // Task 5.3: the data dir can move at runtime (data:chooseDir). `currentDataDir`
    // is the one mutable source of truth every persist call below reads fresh via
    // `persistDeps()` — never capture `dataDir` directly again below this point.
    let currentDataDir = dataDir;
    function persistDeps(): PersistDeps {
      return { dir: currentDataDir, now: Date.now };
    }

    let result = await load(persistDeps(), app.getVersion(), legacyPath);

    // A previous session's data:chooseDir persisted the new folder into
    // settings.dataDir. Honor it on the NEXT launch too (unless TIMEBOUND_DATA_DIR
    // forces a specific dir, e.g. under test) — resolveDataDir already documents this
    // precedence; this is where it's actually applied. Falls back to the bootstrap
    // dir (logging, not crashing) if the saved folder is gone or unreadable.
    if (!process.env.TIMEBOUND_DATA_DIR && result.data.settings.dataDir) {
      const redirected = path.resolve(result.data.settings.dataDir);
      if (redirected !== currentDataDir) {
        try {
          const redirectedResult = await load({ dir: redirected, now: Date.now }, app.getVersion());
          currentDataDir = redirected;
          result = redirectedResult;
        } catch (err) {
          console.error(`main: failed to load data from settings.dataDir (${redirected}), staying on ${currentDataDir}`, err);
        }
      }
    }

    // Task 7.1: resolve the optional win32 integration (AppBar space reservation +
    // fullscreen detection) BEFORE the Store exists, so `capabilities` — reported
    // once in every `Snapshot` and never recomputed — is accurate from the very
    // first snapshot. `loadWin32()` returns `undefined` on every non-Windows
    // platform, when koffi (an optional dependency) is missing, or when any Win32
    // binding fails; every capability then simply stays false and the app runs
    // exactly as it did before this task.
    const win32 = await loadWin32();
    const capabilities = { appBar: !!win32, fullscreenDetect: !!win32 };

    const store = new Store(result.data, {
      save: (d) => save(persistDeps(), d),
      now: Date.now,
      appVersion: app.getVersion(),
      platform: process.platform,
      systemDark: () => nativeTheme.shouldUseDarkColors,
      capabilities
    });

    // --- data folder watcher (Task 5.3): reconciles external changes to data.json
    // (another instance, a synced folder, manual editing) against the live store. ---

    let watcher: DataWatcher | undefined;
    function startWatcher(): void {
      watcher?.stop();
      watcher = watchDataFile({ ...persistDeps(), getCurrentData: () => store.get().data }, (newData) => {
        store.replace(newData);
      });
    }
    startWatcher();

    // --- export / import / data folder / backups (Task 5.3) -----------------------
    // Factored out of the `windows.data*` thunks below so the e2e seam
    // (`globalThis.__tb.data`) can call the exact same code paths without going
    // through a real `dialog` — see main's "test seam" section further down.

    async function exportToFile(format: 'json' | 'md', filePath: string): Promise<{ path?: string }> {
      const data = store.get().data;
      const text = format === 'json' ? toJson(data) : toMarkdown(data);
      await fsp.writeFile(filePath, text, 'utf8');
      return { path: filePath };
    }

    async function importFromFile(filePath: string): Promise<{ imported?: number; error?: string }> {
      try {
        const text = await fsp.readFile(filePath, 'utf8');
        const isMarkdown = path.extname(filePath).toLowerCase() === '.md';
        const shape = isMarkdown
          ? fromMarkdown(text, Date.now(), randomUUID)
          : (({ tasks, lists }) => ({ tasks, lists }))(fromJson(text));
        const actions = importPlan(store.get().data, shape, Date.now(), randomUUID);
        for (const action of actions) store.dispatch(action);
        return { imported: actions.filter((a) => a.type === 'task/add').length };
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'Import failed' };
      }
    }

    async function switchDataDir(newDirRaw: string): Promise<{ dir?: string }> {
      const newDir = path.resolve(newDirRaw);
      if (newDir === currentDataDir) return { dir: newDir };
      // Save the CURRENT data into the new folder first — never deletes anything in
      // the old one — then flip persistence and the watcher over to it.
      await save({ dir: newDir, now: Date.now }, store.get().data);
      watcher?.stop();
      currentDataDir = newDir;
      startWatcher();
      store.dispatch({ type: 'settings/patch', now: Date.now(), patch: { dataDir: newDir } });
      return { dir: newDir };
    }

    async function restoreBackupFile(backupPath: string): Promise<{ ok: boolean; error?: string }> {
      const resolved = path.resolve(backupPath);
      const backupsRoot = path.join(currentDataDir, 'backups');
      const rel = path.relative(backupsRoot, resolved);
      if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
        return { ok: false, error: 'Backup path is outside the backups folder.' };
      }
      try {
        const text = await fsp.readFile(resolved, 'utf8');
        const data = fromJson(text); // same validation load() applies (parseData)
        store.replace(data);
        await save(persistDeps(), data);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Restore failed' };
      }
    }

    const strip = new StripWindow({ store, preloadPath, rendererUrl, isDev, win32 });
    strip.create();

    const palette = new PaletteWindow({ preloadPath, rendererUrl });
    const plannerWindow = new PlannerWindow({ preloadPath, rendererUrl });
    planner = plannerWindow;

    // --- broadcast: store changes and system theme changes reach every live window ---

    function liveWebContents(): WebContents[] {
      const list: WebContents[] = [];
      const s = strip.webContents;
      if (s && !s.isDestroyed()) list.push(s);
      const p = palette.webContents;
      if (p && !p.isDestroyed()) list.push(p);
      const pl = plannerWindow.webContents;
      if (pl && !pl.isDestroyed()) list.push(pl);
      return list;
    }

    function broadcast(snapshot: Snapshot): void {
      for (const wc of liveWebContents()) wc.send('store:changed', snapshot);
    }

    store.subscribe(broadcast);

    // Task 3.2 ruling 7: main broadcasts pomodoro break state to every live window.
    function broadcastBreak(b: { endsAt: number } | null): void {
      for (const wc of liveWebContents()) wc.send('timer:break', b);
    }

    // --- win32: fullscreen watcher (Task 7.1) -----------------------------------------

    // Every one of TimeBound's OWN windows, as raw native handles — the fullscreen
    // watcher must never mistake, say, the planner briefly covering the screen for
    // some OTHER app going fullscreen. Recomputed on every poll tick (not cached):
    // palette/planner are created lazily-shown but constructed up front, so their
    // `webContents` can start existing (and stop, on close) over the app's lifetime.
    function ownHwnds(): Buffer[] {
      const list: Buffer[] = [];
      for (const wc of liveWebContents()) {
        const bw = BrowserWindow.fromWebContents(wc);
        if (!bw || bw.isDestroyed()) continue;
        try {
          list.push(bw.getNativeWindowHandle());
        } catch {
          // A window mid-teardown can throw here; skip it, it can't be foreground.
        }
      }
      return list;
    }

    // e2e seam (ruling 7): lets e2e/win32.spec.ts stub `isFullscreen` and drive the
    // watcher's `tick()` directly instead of waiting out a real 2 s poll or needing a
    // real other app to actually go fullscreen. `undefined` (the default) means "use
    // the real win32 detection" — production code never sets this.
    let fullscreenStub: boolean | undefined;

    const fullscreenWatcher = win32
      ? new FullscreenWatcher({
          isFullscreen: () => (fullscreenStub !== undefined ? fullscreenStub : win32.fullscreen.isForegroundFullscreen(ownHwnds())),
          setInterval: (fn, ms) => setInterval(fn, ms),
          clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
          onEnter: () => strip.setAutoHidden('fullscreen', true),
          onExit: () => strip.setAutoHidden('fullscreen', false)
        })
      : undefined;

    // Addendum ruling 5: poll only while capabilities.fullscreenDetect (i.e. win32
    // is available) && settings.strip.hideOverFullscreen && the strip is enabled.
    function syncFullscreenWatcher(s: Settings): void {
      if (!fullscreenWatcher) return;
      if (s.strip.hideOverFullscreen && s.strip.enabled) {
        fullscreenWatcher.start(2000);
      } else {
        fullscreenWatcher.stop();
        // Stopping is a deliberate "stop caring", not an observed exit from
        // fullscreen (see watcher.ts's `stop()` doc comment) — un-hide for the
        // fullscreen reason explicitly so turning the setting off (or disabling the
        // strip) never leaves the strip stuck hidden.
        strip.setAutoHidden('fullscreen', false);
      }
    }
    syncFullscreenWatcher(store.get().data.settings);
    store.subscribe((s) => syncFullscreenWatcher(s.data.settings));

    // --- notifications (Task 3.2) -----------------------------------------------------

    const notifier = new Notifier({
      NotificationCtor: Notification,
      isSupported: () => Notification.isSupported(),
      getSettings: () => store.get().data.settings,
      onClick: () => plannerWindow.show()
    });

    // --- daily rollover + timer clock (Task 2.3, extended Task 3.2) ------------------

    clock = new Clock({
      store,
      powerMonitor,
      now: Date.now,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      notify: notifier,
      broadcastBreak
    });
    clock.start();

    // --- timer start/pause: shared by the toggleTimer hotkey, the panel's timer
    // button (IPC `timer:toggle`), and the tray's Start/Pause timer item -------------

    // Task 3.2 fix round 1 (supersedes addendum ruling 3): the actual decision logic
    // lives in `resolveToggleTimerAction` (main/clock.ts) — a pure function shared
    // with tests/main/clock.test.ts — so this is just "read the store, dispatch what
    // it says". In pomodoro mode, starting ALWAYS goes through timer/startSession
    // regardless of any existing plannedSeconds — a plain timer/start would expire
    // instantly once spentSeconds >= plannedSeconds from an earlier session, and the
    // old timer/addTime pre-step was undoable and cost a score point for something
    // that isn't a user edit.
    function toggleTimer(): void {
      const snapshot = store.get();
      const action = resolveToggleTimerAction(snapshot.today.current, snapshot.data.settings, Date.now());
      if (action) store.dispatch(action);
    }

    // nativeTheme changes are not a dispatch (no Data change), so they don't flow
    // through store.subscribe: broadcast a fresh snapshot (with the new systemDark)
    // directly. Never dispatch here, never add a method to Store for this.
    nativeTheme.on('updated', () => {
      broadcast(store.get());
    });

    strip.onState((st) => {
      strip.webContents?.send('strip:state', st);
    });

    // --- hotkeys -----------------------------------------------------------------

    const hotkeys = new Hotkeys(globalShortcut);

    // Kept in a variable (not inlined into hotkeys.apply()) so the exact record of
    // handlers can be exposed on the e2e seam below — Task 2.4's `undo.spec.ts` calls
    // `globalThis.__tb.hotkeyHandlers.completeAdvance()` / `.undo()` directly, since
    // the `Hotkeys` instance itself does not expose its registered handlers.
    // Definite-assignment: always set by applyHotkeys() below before this is read
    // again (called synchronously a few lines down, before any other code runs).
    let hotkeyHandlers!: HotkeyHandlers;

    function applyHotkeys(settings: Settings): void {
      hotkeyHandlers = {
        capture: () => palette.show('capture'),
        toggleStrip: () => strip.toggle(),
        completeAdvance: () => {
          const current = store.get().today.current;
          if (!current) return;
          // spawnId is harmless to include unconditionally (Task 3.3 ruling 3): the
          // reducer only spawns when the completed task actually has `recurrence`.
          store.dispatch({ type: 'task/complete', id: current.id, now: Date.now(), by: 'user', spawnId: randomUUID() });
        },
        toggleTimer,
        undo: () => {
          store.undo();
        }
      };
      hotkeys.apply(settings, hotkeyHandlers);
    }

    applyHotkeys(store.get().data.settings);
    let lastHotkeysJson = JSON.stringify(store.get().data.settings.hotkeys);
    store.subscribe((s) => {
      const json = JSON.stringify(s.data.settings.hotkeys);
      if (json !== lastHotkeysJson) {
        lastHotkeysJson = json;
        applyHotkeys(s.data.settings);
      }
    });

    // Strip settings (edge, width, autoHide, ...) are applied by StripWindow itself:
    // its own store.subscribe (set up in strip.create()) already calls
    // this.applySettings(snapshot.data.settings.strip) on every change.

    // --- tray ----------------------------------------------------------------------

    const tray = new AppTray({
      store,
      // Fix round 1, finding 11: app.getAppPath() points inside the asar in a
      // packaged build, where build/ isn't included — use the extraResources copy
      // (package.json's electron-builder config) there instead.
      iconPath: app.isPackaged
        ? path.join(process.resourcesPath, 'icons', 'icon-16x16.png')
        : path.join(app.getAppPath(), 'build', 'icon-16x16.png'),
      onComplete: () => {
        const current = store.get().today.current;
        if (!current) return;
        store.dispatch({ type: 'task/complete', id: current.id, now: Date.now(), by: 'user', spawnId: randomUUID() });
      },
      onToggleTimer: toggleTimer,
      onCapture: () => palette.show('capture'),
      onToggleStrip: () => strip.toggle(),
      onOpenPlanner: () => plannerWindow.show(),
      onPlanToday: () => palette.show('plan'),
      onCloseDay: () => palette.show('close'),
      onQuit: () => app.quit()
    });

    // --- ipc -------------------------------------------------------------------------

    registerIpc({
      ipcMain,
      store,
      allowedOrigins,
      windows: {
        stripExpand: (open) => strip.expand(open),
        stripReportSize: (size) => strip.handleReportedSize(size),
        stripSetEdge: (edge) => strip.setEdge(edge),
        stripDragStart: () => strip.beginDrag(),
        stripDragEnd: () => strip.endDrag(),
        stripHover: (inside) => strip.hover(inside),
        paletteShow: (mode) => palette.show(mode),
        paletteHide: () => palette.hide(),
        paletteReportSize: (size) => palette.setContentHeight(size.height),
        plannerShow: () => plannerWindow.show(),
        plannerHide: () => plannerWindow.hide(),
        plannerMinimize: () => plannerWindow.minimize(),
        openExternal: (url) => shell.openExternal(url),
        quit: () => app.quit(),
        dataExport: async (format) => {
          const result = await dialog.showSaveDialog({
            defaultPath: `TimeBound-${ymd(Date.now())}.${format}`,
            filters: [format === 'json' ? { name: 'JSON', extensions: ['json'] } : { name: 'Markdown', extensions: ['md'] }]
          });
          if (result.canceled || !result.filePath) return {};
          return exportToFile(format, result.filePath);
        },
        dataImport: async () => {
          const result = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: [{ name: 'TimeBound data', extensions: ['json', 'md'] }]
          });
          if (result.canceled || result.filePaths.length === 0) return {};
          return importFromFile(result.filePaths[0]);
        },
        dataChooseDir: async () => {
          const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
          if (result.canceled || result.filePaths.length === 0) return {};
          return switchDataDir(result.filePaths[0]);
        },
        dataListBackups: () => listBackups(persistDeps()),
        dataRestoreBackup: (backupPath) => restoreBackupFile(backupPath),
        hotkeysTest: (accelerator) => validateAccelerator(accelerator),
        timerToggle: () => toggleTimer()
      }
    });

    // --- lifecycle -------------------------------------------------------------------

    app.on('window-all-closed', () => {
      // Tray app: closing every window must not quit the app.
    });

    let quitting = false;
    app.on('before-quit', (event) => {
      if (quitting) return;
      event.preventDefault();
      quitting = true;
      // Task 7.1 ruling 4 ("release on ... app quit"): synchronous and first, before
      // anything async — a reservation left behind would shrink the user's desktop
      // work area until their next logout. `releaseAppBarReservation()` is a no-op
      // when there is no active reservation (win32 unavailable, reserveSpace off, or
      // it was never granted).
      strip.releaseAppBarReservation();
      fullscreenWatcher?.stop();
      watcher?.stop();
      plannerWindow.setQuitting(true);
      hotkeys.unregisterAll();
      clock.stop();
      // Fix round 1, finding 4: a rejected flush must not leave the app running with
      // an unhandled rejection and no quit — always quit once the flush SETTLES,
      // logging first if it failed. `quitting` (checked above) still guards against
      // the re-entrant before-quit this app.quit() call fires.
      store
        .flush()
        .catch((err: unknown) => console.error('before-quit: store.flush() failed', err))
        .finally(() => app.quit());
    });

    const reloadedOnce = new WeakSet<WebContents>();
    app.on('render-process-gone', (_event, webContents, details) => {
      console.error('render-process-gone', details);
      if (reloadedOnce.has(webContents)) return;
      reloadedOnce.add(webContents);
      webContents.reload();
    });

    // --- test seam ---------------------------------------------------------------

    if (process.env.TIMEBOUND_E2E === '1') {
      // e2e/timer.spec.ts counts Notifier calls without depending on real OS
      // notifications: wraps notifier.timerDone so each call also pushes onto
      // globalThis.__tbEvents, then still runs the real (Notification-gated) path.
      const events: unknown[] = [];
      (globalThis as unknown as { __tbEvents: unknown[] }).__tbEvents = events;
      const realTimerDone = notifier.timerDone.bind(notifier);
      notifier.timerDone = (task) => {
        events.push({ type: 'timerDone', taskId: task.id });
        realTimerDone(task);
      };

      (globalThis as unknown as { __tb: unknown }).__tb = {
        store,
        strip,
        palette,
        planner: plannerWindow,
        hotkeys,
        hotkeyHandlers,
        tray,
        clock,
        notifier,
        // Task 5.3: lets e2e/data.spec.ts exercise export/import/dir-switching without
        // a real OS `dialog` — the exact same code the real IPC handlers call.
        data: {
          exportTo: (format: 'json' | 'md', filePath: string) => exportToFile(format, filePath),
          importFrom: (filePath: string) => importFromFile(filePath),
          switchDir: (dir: string) => switchDataDir(dir)
        },
        // Task 7.1 (win32.spec.ts): capabilities are already in every Snapshot, but
        // the watcher itself needs a direct seam — `setFullscreenStub` overrides
        // `isForegroundFullscreen`'s result without a real other app going
        // fullscreen, and `tick()` drives the watcher's state machine synchronously
        // instead of waiting out a real 2s poll.
        win32: {
          capabilities,
          setFullscreenStub: (value: boolean | undefined) => {
            fullscreenStub = value;
          },
          tick: () => fullscreenWatcher?.tick()
        }
      };
    }
  });
}
