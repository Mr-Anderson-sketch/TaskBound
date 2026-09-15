// main/windows/palette — the keyboard-sheets window (capture, plan, close, commands,
// onboarding). Mouse/keyboard focus IS supposed to land here (unlike the strip), so it
// hides itself on blur. See .superpowers/sdd/PLAN/task-1.8-1.9-brief.md Part C.
import { BrowserWindow, screen } from 'electron';
import type { PaletteMode } from '../../shared/ipc';

const WIDTH = 560;
const HEIGHT = 132;
const VERTICAL_FRACTION = 0.28;

export interface PaletteWindowDeps {
  preloadPath: string;
  rendererUrl: (route: 'palette') => string;
}

export class PaletteWindow {
  private win: BrowserWindow | undefined;
  private loaded = false;
  private pendingMode: PaletteMode | undefined;

  constructor(private readonly deps: PaletteWindowDeps) {}

  get webContents() {
    return this.win?.webContents;
  }

  create(): void {
    if (this.win) return;

    this.win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      useContentSize: true,
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      transparent: false,
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
    win.webContents.once('did-finish-load', () => {
      this.loaded = true;
      if (this.pendingMode !== undefined) {
        win.webContents.send('palette:mode', this.pendingMode);
        this.pendingMode = undefined;
      }
    });
    win.on('blur', () => this.hide());
    win.on('closed', () => {
      if (this.win === win) {
        this.win = undefined;
        this.loaded = false;
      }
    });

    void win.loadURL(this.deps.rendererUrl('palette'));
  }

  show(mode: PaletteMode): void {
    this.create();
    const win = this.win;
    if (!win || win.isDestroyed()) return;

    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const { workArea } = display;
    const x = Math.round(workArea.x + (workArea.width - WIDTH) / 2);
    const y = Math.round(workArea.y + workArea.height * VERTICAL_FRACTION);
    win.setBounds({ x, y, width: WIDTH, height: HEIGHT });

    if (this.loaded) {
      win.webContents.send('palette:mode', mode);
    } else {
      this.pendingMode = mode;
    }

    win.show();
    win.focus();
  }

  hide(): void {
    if (!this.win || this.win.isDestroyed()) return;
    if (!this.win.isVisible()) return;
    this.win.hide();
    // Fix round 1, finding 12: app.hide() (macOS) hides EVERY window of this app,
    // including the always-on-top strip — not just the palette. Known gap: focus
    // does not automatically return to the previously-active app on macOS after
    // quick capture (see docs/RELEASE-CHECKLIST.md M15); revisit in Slice 6.
  }

  destroy(): void {
    const win = this.win;
    this.win = undefined;
    this.loaded = false;
    this.pendingMode = undefined;
    if (win && !win.isDestroyed()) win.destroy();
  }
}
