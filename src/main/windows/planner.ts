// main/windows/planner — the back-office window (Slice 4 builds out its content; this
// task ships a placeholder React app plus the window shell). Created lazily on first
// `show()`. See .superpowers/sdd/PLAN/task-1.8-1.9-brief.md Part C.
import { BrowserWindow } from 'electron';

const WIDTH = 1000;
const HEIGHT = 640;
const MIN_WIDTH = 720;
const MIN_HEIGHT = 480;

export interface PlannerWindowDeps {
  preloadPath: string;
  rendererUrl: (route: 'planner') => string;
}

export class PlannerWindow {
  private win: BrowserWindow | undefined;
  private quitting = false;

  constructor(private readonly deps: PlannerWindowDeps) {}

  /** Called from `before-quit`: lets the window's own `close` handler tell a
   * user-initiated close (hide) apart from the app actually shutting down. */
  setQuitting(quitting: boolean): void {
    this.quitting = quitting;
  }

  get webContents() {
    return this.win?.webContents;
  }

  create(): void {
    if (this.win) return;

    this.win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      frame: process.platform === 'darwin' ? true : false,
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
      show: false,
      webPreferences: {
        preload: this.deps.preloadPath,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    const win = this.win;
    win.setMenu(null);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.on('close', (event) => {
      if (this.quitting) return;
      event.preventDefault();
      win.hide();
    });
    win.on('closed', () => {
      if (this.win === win) this.win = undefined;
    });

    void win.loadURL(this.deps.rendererUrl('planner'));
  }

  show(): void {
    this.create();
    if (!this.win || this.win.isDestroyed()) return;
    this.win.show();
    this.win.focus();
  }

  hide(): void {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.hide();
  }

  destroy(): void {
    const win = this.win;
    this.win = undefined;
    if (win && !win.isDestroyed()) win.destroy();
  }
}
