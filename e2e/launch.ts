import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export type Route = 'strip' | 'palette' | 'planner' | 'legacy';

export interface LaunchOptions {
  /** Directory to use as the app's data dir. A fresh temp dir when omitted. */
  dataDir?: string;
  /** Copy this file into the data dir as legacy `state.json` before launch. */
  legacyStateFixture?: string;
  /** Extra environment variables. */
  env?: Record<string, string>;
  /** Task 5.4: most specs launch a clean data dir and don't expect the first-run
   * onboarding palette to appear (it would steal the window they're about to assert
   * on). By default this launcher sets `TIMEBOUND_SKIP_ONBOARDING=1`, which main.ts
   * honours only under `TIMEBOUND_E2E=1` (inert in production), so onboarding never
   * shows unless a spec opts in with `onboarding: true` — e2e/onboarding.spec.ts is
   * the only one that does, to exercise the real first-run path. */
  onboarding?: boolean;
  /** Test-isolation bug fix: Electron's `app.getPath('appData')` on Windows does a
   * native OS lookup and ignores the `APPDATA` environment override this launcher
   * also sets below — so without pinning `userData` too, every e2e launch actually
   * used the real, shared `%APPDATA%\TimeBound-dev` folder (Chromium profile,
   * single-instance lock, and the data-location.json pointer), colliding with the
   * owner's own preview app and with other parallel test runs. This launcher
   * defaults `TIMEBOUND_USERDATA_DIR` to `<dataDir>/userData` (main.ts's
   * `app.setPath('userData', …)` test seam, see its comment) for every launch. Pass
   * `env: { TIMEBOUND_USERDATA_DIR: '...' }` to pin a spec's own value instead (e.g.
   * to share one userData folder across two sequential launches). */
}

export interface Launched {
  app: ElectronApplication;
  dataDir: string;
  /** Windows by route, resolved from each page's URL hash. */
  windows: () => Promise<Partial<Record<Route, Page>>>;
  /** Wait until a window with the given route exists and has loaded. */
  window: (route: Route, timeoutMs?: number) => Promise<Page>;
  /** Console errors collected from every window since launch. */
  errors: () => string[];
  close: () => Promise<void>;
}

const ROOT = path.resolve(__dirname, '..');

function routeOf(url: string): Route {
  if (url.includes('#/strip')) return 'strip';
  if (url.includes('#/palette')) return 'palette';
  if (url.includes('#/main') || url.includes('#/planner')) return 'planner';
  return 'legacy';
}

/**
 * Launches the built app. Strips ELECTRON_RUN_AS_NODE (set by some editor
 * shells; it makes Electron run as plain Node) and points the app at an
 * isolated data directory so tests never touch the user's real data.
 */
export async function launchApp(opts: LaunchOptions = {}): Promise<Launched> {
  const dataDir = opts.dataDir ?? (await mkdtemp(path.join(tmpdir(), 'timebound-e2e-')));
  if (opts.legacyStateFixture) {
    await cp(opts.legacyStateFixture, path.join(dataDir, 'state.json'));
  }
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k !== 'ELECTRON_RUN_AS_NODE' && v !== undefined) env[k] = v;
  }
  env.TIMEBOUND_DATA_DIR = dataDir;
  // The pre-rebuild app resolves %APPDATA%\TimeBound; keep it isolated too.
  env.APPDATA = dataDir;
  // See LaunchOptions.env doc above: pins Electron's actual userData folder (the
  // Chromium profile, single-instance lock, and data-location.json pointer) inside
  // this launch's own temp dir, since the `APPDATA` override above is ignored by
  // Electron on Windows. Placed before `Object.assign(env, opts.env ?? {})` below so
  // a spec that needs a specific/shared userData folder (e.g. two sequential
  // launches that must see the same data-location.json) can still override it.
  env.TIMEBOUND_USERDATA_DIR = path.join(dataDir, 'userData');
  // Exposes globalThis.__tb (store/strip/palette/planner/hotkeys/tray) for e2e specs.
  // Never set outside of tests — see main.ts's "test seam" comment.
  env.TIMEBOUND_E2E = '1';
  // See LaunchOptions.onboarding above: default on (skip), off only when opted in.
  if (!opts.onboarding) env.TIMEBOUND_SKIP_ONBOARDING = '1';
  Object.assign(env, opts.env ?? {});

  const executablePath = path.join(ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
  const app = await electron.launch({ executablePath, args: [ROOT], cwd: ROOT, env });

  const errors: string[] = [];
  const attach = (page: Page) => {
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`[${routeOf(page.url())}] ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(`[${routeOf(page.url())}] ${e.message}`));
  };
  app.windows().forEach(attach);
  app.on('window', attach);

  const windows = async () => {
    const out: Partial<Record<Route, Page>> = {};
    for (const p of app.windows()) out[routeOf(p.url())] = p;
    return out;
  };
  const window = async (route: Route, timeoutMs = 15_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = (await windows())[route];
      if (found) {
        await found.waitForLoadState('domcontentloaded');
        return found;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`No window with route "${route}" after ${timeoutMs} ms. Have: ${app.windows().map((p) => p.url()).join(', ')}`);
  };

  return { app, dataDir, windows, window, errors: () => [...errors], close: () => app.close() };
}

/**
 * Seeds a small, realistic Today set — a handful of believable tasks (one with a tag
 * and a list plus a running-sized plan, one due today, one with a sub-task, one already
 * done), a user list, and a tag — so rail counts, the Theme/Strip/Hotkeys/Data settings
 * panes, and similar screenshots show a lived-in day instead of a fresh empty install.
 * Kept separate from e2e/screens.spec.ts's own inline seed (used for planner-today.png)
 * because several specs assert exact rail/row counts against their own seeded set and
 * would break if this ran first; only call it from specs that don't depend on exact
 * counts (settings.spec.ts, settings-data.spec.ts, the screens.spec.ts settings-timer
 * capture).
 */
export async function seedRealisticToday(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    const tb = (globalThis as unknown as { __tb: { store: { dispatch: (a: unknown) => unknown } } }).__tb;
    const now = Date.now();
    const d = new Date();
    const todayYmd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    tb.store.dispatch({ type: 'list/add', id: 'seed-work', now, name: 'Work' });

    tb.store.dispatch({
      type: 'task/add',
      id: 'seed-roadmap',
      now: now + 1,
      title: 'Draft Q3 roadmap',
      today: true,
      listId: 'seed-work',
      tags: ['planning'],
      plannedSeconds: 3600
    });
    tb.store.dispatch({
      type: 'task/add',
      id: 'seed-priya',
      now: now + 2,
      title: 'Reply to Priya about invoices',
      today: true,
      tags: ['finance'],
      due: { date: todayYmd }
    });
    tb.store.dispatch({
      type: 'task/add',
      id: 'seed-pr182',
      now: now + 3,
      title: 'Review PR #182',
      today: true,
      listId: 'seed-work',
      tags: ['eng']
    });
    tb.store.dispatch({
      type: 'task/add',
      id: 'seed-pr182-sub',
      now: now + 4,
      title: 'Check the migration script',
      parentId: 'seed-pr182'
    });
    tb.store.dispatch({ type: 'task/add', id: 'seed-notes', now: now + 5, title: 'Write the standup notes', listId: 'seed-work' });
    tb.store.dispatch({
      type: 'task/add',
      id: 'seed-done',
      now: now + 6,
      title: 'Set up the shared repo',
      today: true,
      listId: 'seed-work'
    });
    tb.store.dispatch({ type: 'task/complete', id: 'seed-done', now: now + 7, by: 'user' });
  });
}

/** Reads every BrowserWindow's geometry and flags from the main process. */
export async function windowInfo(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow, screen }) =>
    BrowserWindow.getAllWindows().map((w) => {
      const bounds = w.getBounds();
      const display = screen.getDisplayMatching(bounds);
      return {
        url: w.webContents.getURL(),
        bounds,
        visible: w.isVisible(),
        focusable: w.isFocusable(),
        focused: w.isFocused(),
        alwaysOnTop: w.isAlwaysOnTop(),
        workArea: display.workArea,
        scaleFactor: display.scaleFactor
      };
    })
  );
}
