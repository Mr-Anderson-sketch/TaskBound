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
