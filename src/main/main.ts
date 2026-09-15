// main/main — app entry point. Boots CSP, persistence, the Store, every window
// manager, hotkeys, and the tray, then wires the Store <-> IPC <-> renderer loop.
// See .superpowers/sdd/PLAN/task-1.8-1.9-brief.md Part C for the exact wiring this
// follows; CLAUDE.md ("the store lives in the main process; renderers are views").
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { app, session, nativeTheme, ipcMain, shell, globalShortcut, powerMonitor, Notification } from 'electron';
import type { WebContents } from 'electron';
import { load, save } from './persist';
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
import { Clock } from './clock';
import { Notifier } from './notify';
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

    const result = await load({ dir: dataDir, now: Date.now }, app.getVersion(), legacyPath);

    const store = new Store(result.data, {
      save: (d) => save({ dir: dataDir, now: Date.now }, d),
      now: Date.now,
      appVersion: app.getVersion(),
      platform: process.platform,
      systemDark: () => nativeTheme.shouldUseDarkColors
    });

    const strip = new StripWindow({ store, preloadPath, rendererUrl, isDev });
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

    // --- notifications (Task 3.2) -----------------------------------------------------

    const notifier = new Notifier({
      NotificationCtor: Notification,
      isSupported: () => Notification.isSupported(),
      getSettings: () => store.get().data.settings,
      onClick: () => plannerWindow.show()
    });

    // --- daily rollover + timer clock (Task 2.3, extended Task 3.2) ------------------

    const clock = new Clock({
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

    function toggleTimer(): void {
      const current = store.get().today.current;
      if (!current) return;
      const running = current.timer?.runningSince !== undefined;
      if (running) {
        store.dispatch({ type: 'timer/pause', id: current.id, now: Date.now() });
        return;
      }
      // Task 3.2 addendum ruling 3: in pomodoro mode, starting a task with no
      // plannedSeconds yet first gets one work session's worth of planned time.
      const settings = store.get().data.settings;
      if (settings.timer.pomodoro && current.timer?.plannedSeconds === undefined) {
        store.dispatch({ type: 'timer/addTime', id: current.id, now: Date.now(), seconds: settings.timer.workMinutes * 60 });
      }
      store.dispatch({ type: 'timer/start', id: current.id, now: Date.now() });
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
        // Slice 5: data export/import/choose-dir are not implemented yet.
        dataExport: () => ({}),
        dataImport: () => ({ error: 'not yet' }),
        dataChooseDir: () => ({}),
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
        notifier
      };
    }
  });
}
