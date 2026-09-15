// main/windows/palette — the keyboard-sheets window (capture, plan, close, commands,
// onboarding). Mouse/keyboard focus IS supposed to land here (unlike the strip), so it
// hides itself on blur. See .superpowers/sdd/PLAN/task-1.8-1.9-brief.md Part C.
import { BrowserWindow, screen } from 'electron';
import type { PaletteMode } from '../../shared/ipc';

const WIDTH = 560;
const HEIGHT = 132;
const VERTICAL_FRACTION = 0.28;
// Fix round 1, reviewer point 5: a per-mode estimate applied to the INITIAL show()
// bounds, so plan/close no longer paint their first frame at capture's 132 px height
// and visibly grow — the renderer's ResizeObserver (-> palette:reportSize ->
// setContentHeight) still refines this down/up to the sheet's real content height
// once it actually paints.
const MODE_CONTENT_HEIGHT: Record<PaletteMode, number> = {
  capture: HEIGHT,
  plan: 360,
  close: 260,
  commands: HEIGHT,
  // Task 5.4: onboarding's three cards run noticeably taller than capture's fixed
  // 132 px (spacious density, a title, body copy, and an embedded control) — 320 px
  // pre-sizes close to the real content so the ResizeObserver-driven
  // `palette:reportSize` refinement below only has to make a small correction.
  onboarding: 320
};
// Task 2.3, addendum ruling 9b: a `blur` that lands within this window of `show()`
// is treated as the stray tail of a `hide()` that happened earlier in the same tick
// (Windows can deliver it just after the new `show()`), not a real "user clicked
// away" — ignoring it stops the freshly-shown palette from hiding itself.
const BLUR_GRACE_MS = 150;

export interface PaletteWindowDeps {
  preloadPath: string;
  rendererUrl: (route: 'palette') => string;
}

export class PaletteWindow {
  private win: BrowserWindow | undefined;
  private loaded = false;
  private pendingMode: PaletteMode | undefined;
  private lastShownAt: number | undefined;

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
    win.on('blur', () => {
      if (this.lastShownAt !== undefined && Date.now() - this.lastShownAt < BLUR_GRACE_MS) return;
      this.hide();
    });
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

    // Addendum ruling 9b(a): switching modes on an already-visible palette (the tray's
    // "Plan today"/"Close the day" items, or the strip's plan chip, while the palette
    // is already open) just re-sends the mode and refocuses — it must NOT re-position
    // or re-size the window, which would fight the mode's own ResizeObserver-driven
    // `setContentHeight` and could retrigger the blur-hides-the-window quirk this same
    // ruling fixes below.
    if (win.isVisible()) {
      if (this.loaded) {
        win.webContents.send('palette:mode', mode);
      } else {
        this.pendingMode = mode;
      }
      win.focus();
      this.lastShownAt = Date.now();
      return;
    }

    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const { workArea } = display;
    const x = Math.round(workArea.x + (workArea.width - WIDTH) / 2);
    const y = Math.round(workArea.y + workArea.height * VERTICAL_FRACTION);
    win.setBounds({ x, y, width: WIDTH, height: MODE_CONTENT_HEIGHT[mode] });

    if (this.loaded) {
      win.webContents.send('palette:mode', mode);
    } else {
      this.pendingMode = mode;
    }

    win.show();
    win.focus();
    this.lastShownAt = Date.now();
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

  /** Task 2.3, addendum ruling 6: resizes the content area to the height the
   * renderer's ResizeObserver reported for the current mode (132 for capture; up to
   * 480 for the plan sheet, whose own `.list` scrolls internally beyond that),
   * keeping `x` and the top `y` fixed — the window grows/shrinks downward from where
   * it was shown, never re-centring or drifting off the display. */
  setContentHeight(height: number): void {
    if (!this.win || this.win.isDestroyed()) return;
    const { x, y } = this.win.getBounds();
    this.win.setContentSize(WIDTH, height);
    this.win.setPosition(x, y);
  }

  destroy(): void {
    const win = this.win;
    this.win = undefined;
    this.loaded = false;
    this.pendingMode = undefined;
    if (win && !win.isDestroyed()) win.destroy();
  }
}
