// main/boot — small, Electron-free pieces of app startup, injected with their Electron
// calls so they can be unit-tested (tests/main/boot.test.ts):
//  - final-review fix 3: what happens when boot throws (error box, lock release, exit 1)
//  - final-review fix 5: whether and when to register TimeBound as a login item

export interface BootFailureDeps {
  log: (message: string, err: unknown) => void;
  showErrorBox: (title: string, content: string) => void;
  releaseSingleInstanceLock: () => void;
  exit: (code: number) => void;
}

export const BOOT_ERROR_TITLE = 'TimeBound could not start';

/** The error box body: what went wrong, where the data lives, and that it's untouched. */
export function bootErrorMessage(err: unknown, dataDir: string): string {
  const detail = err instanceof Error ? err.message : String(err);
  return `Something went wrong while TimeBound was starting:\n\n${detail}\n\nYour data folder is ${dataDir}\nYour data has not been changed.`;
}

/**
 * Boot failed: log it, tell the user, release the single-instance lock (so a retry
 * isn't blocked by this dying process), and exit with code 1. Each step runs even if
 * an earlier one throws — a failing error box must never leave a headless process
 * holding the lock.
 */
export function handleBootFailure(err: unknown, dataDir: string, deps: BootFailureDeps): void {
  const attempt = (fn: () => void): void => {
    try {
      fn();
    } catch {
      // Nothing more useful to do; keep going so the process still exits.
    }
  };
  attempt(() => deps.log('boot failed', err));
  attempt(() => deps.showErrorBox(BOOT_ERROR_TITLE, bootErrorMessage(err, dataDir)));
  attempt(() => deps.releaseSingleInstanceLock());
  deps.exit(1);
}

const LOGIN_ITEM_BLOCKING_ENV = ['TIMEBOUND_E2E', 'TIMEBOUND_DATA_DIR', 'TIMEBOUND_USERDATA_DIR'] as const;

/** Only a packaged build, not running under tests or a redirected data/userData
 * folder, may register itself to start at login — a dev or e2e run must never leave
 * a login item pointing at electron.exe. */
export function shouldRegisterLoginItem(opts: { isPackaged: boolean; env: Record<string, string | undefined> }): boolean {
  if (!opts.isPackaged) return false;
  return LOGIN_ITEM_BLOCKING_ENV.every((key) => !opts.env[key]);
}

export interface LoginItemSyncDeps {
  shouldRegister: boolean;
  setLoginItemSettings: (openAtLogin: boolean) => void;
  log: (message: string) => void;
}

/**
 * Returns a function to call with `settings.startOnLogin` at startup and on every
 * store change: it calls `setLoginItemSettings` the first time and whenever the value
 * changes. When registration isn't allowed it only logs, once.
 */
export function createLoginItemSync(deps: LoginItemSyncDeps): (openAtLogin: boolean) => void {
  let applied: boolean | undefined;
  let loggedSkip = false;
  return (openAtLogin) => {
    if (!deps.shouldRegister) {
      if (!loggedSkip) {
        loggedSkip = true;
        deps.log('start on login: not registering (unpackaged build or test/data-folder override)');
      }
      return;
    }
    if (applied === openAtLogin) return;
    applied = openAtLogin;
    try {
      deps.setLoginItemSettings(openAtLogin);
    } catch (err) {
      deps.log(`start on login: setLoginItemSettings failed (${err instanceof Error ? err.message : String(err)})`);
    }
  };
}
