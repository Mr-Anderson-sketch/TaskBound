// main/tray — the system tray icon and its context menu. Rebuilt from the current
// Store snapshot on every store change so the disabled "current title" row and the
// tooltip always reflect what's on the strip. See
// .superpowers/sdd/PLAN/task-1.8-1.9-brief.md Part C; Task 6.1 (spec Part 5.1
// "Zero-pixel mode") adds darwin-only menu bar mode: the status item's own title
// (via `TrayTitleUpdater`, see trayTitle.ts) substitutes for the strip, and a plain
// click opens the planner instead of the context menu.
import { Menu, Tray, nativeImage } from 'electron';
import type { Store } from './store';
import { TrayTitleUpdater } from './trayTitle';

export interface AppTrayDeps {
  store: Store;
  iconPath: string;
  /** Task 6.1: darwin-only template image (black-with-alpha, `setTemplateImage`)
   * used for the status item instead of a resized copy of the colour app icon —
   * Electron picks up a same-directory `<name>@2x.<ext>` automatically for Retina.
   * Falls back to `iconPath` when omitted (dev/test convenience; not template-safe
   * on a colour icon, but harmless). */
  templateIconPath?: string;
  onComplete: () => void;
  onToggleTimer: () => void;
  onCapture: () => void;
  onToggleStrip: () => void;
  onOpenPlanner: () => void;
  onPlanToday: () => void;
  onCloseDay: () => void;
  onQuit: () => void;
}

export class AppTray {
  private readonly tray: Tray;
  private readonly unsubscribe: () => void;
  /** Task 6.1: darwin only — `undefined` on every other platform, so `render()`'s
   * `titleUpdater?.sync()` is simply a no-op there and `settings.strip.menuBarMode`
   * is otherwise ignored. */
  private readonly titleUpdater: TrayTitleUpdater | undefined;
  private menu: Menu | undefined;

  constructor(private readonly deps: AppTrayDeps) {
    const image = nativeImage.createFromPath(deps.iconPath);
    if (process.platform === 'darwin') {
      const template = nativeImage.createFromPath(deps.templateIconPath ?? deps.iconPath);
      template.setTemplateImage(true);
      this.tray = new Tray(template);

      this.titleUpdater = new TrayTitleUpdater(
        () => {
          const snapshot = this.deps.store.get();
          const current = snapshot.today.current;
          const menuBarMode = snapshot.data.settings.strip.menuBarMode;
          return { currentTitle: menuBarMode ? current?.title : undefined, timer: current?.timer };
        },
        Date.now,
        (text) => {
          if (!this.tray.isDestroyed()) this.tray.setTitle(text);
        }
      );

      // Task 6.1: "Clicking the tray icon in menu bar mode opens the planner."
      // `setContextMenu` alone would make every click (macOS treats left- and
      // right-click on a status item the same way) open the context menu instead —
      // so in menu bar mode this skips `setContextMenu` (see `render()`) and
      // handles both buttons itself: left-click opens the planner, right-click
      // still reaches the full menu via `popUpContextMenu`. Registered once here
      // (not per-render) to avoid stacking listeners; reads live state at click
      // time so it always reflects the current `menuBarMode` setting.
      this.tray.on('click', () => {
        if (this.deps.store.get().data.settings.strip.menuBarMode) {
          this.deps.onOpenPlanner();
        } else if (this.menu) {
          this.tray.popUpContextMenu(this.menu);
        }
      });
      this.tray.on('right-click', () => {
        if (this.menu) this.tray.popUpContextMenu(this.menu);
      });
    } else {
      this.tray = new Tray(image);
    }
    this.render();
    this.unsubscribe = deps.store.subscribe(() => this.render());
  }

  private render(): void {
    const snapshot = this.deps.store.get();
    const current = snapshot.today.current;
    const title = current?.title;
    this.tray.setToolTip(title ?? 'TimeBound');
    const running = current?.timer?.runningSince !== undefined;
    const menuBarMode = process.platform === 'darwin' && snapshot.data.settings.strip.menuBarMode;

    this.menu = Menu.buildFromTemplate([
      { label: title ?? 'TimeBound', enabled: false },
      { type: 'separator' },
      { label: 'Complete', click: () => this.deps.onComplete() },
      { label: running ? 'Pause timer' : 'Start timer', enabled: !!current, click: () => this.deps.onToggleTimer() },
      { label: 'Quick capture', click: () => this.deps.onCapture() },
      { label: 'Plan today', click: () => this.deps.onPlanToday() },
      { label: 'Close the day', click: () => this.deps.onCloseDay() },
      { label: 'Show/Hide strip', click: () => this.deps.onToggleStrip() },
      { label: 'Open planner', click: () => this.deps.onOpenPlanner() },
      { type: 'separator' },
      { label: 'Quit', click: () => this.deps.onQuit() }
    ]);
    // Task 6.1: in darwin menu bar mode, a plain click is handled by the 'click'
    // listener above (opens the planner) instead of the context menu — leaving
    // `setContextMenu` wired would make macOS show the menu on every click
    // regardless of that listener. `this.menu` stays set either way so both the
    // 'click' fallback (menu bar mode off) and 'right-click' can still reach it.
    if (!menuBarMode) {
      this.tray.setContextMenu(this.menu);
    } else {
      this.tray.setContextMenu(null);
    }

    this.titleUpdater?.sync();
  }

  destroy(): void {
    this.unsubscribe();
    this.titleUpdater?.stop();
    if (!this.tray.isDestroyed()) this.tray.destroy();
  }
}
