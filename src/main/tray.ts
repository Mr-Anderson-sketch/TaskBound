// main/tray — the system tray icon and its context menu. Rebuilt from the current
// Store snapshot on every store change so the disabled "current title" row and the
// tooltip always reflect what's on the strip. See
// .superpowers/sdd/PLAN/task-1.8-1.9-brief.md Part C.
import { Menu, Tray, nativeImage } from 'electron';
import type { Store } from './store';

export interface AppTrayDeps {
  store: Store;
  iconPath: string;
  onComplete: () => void;
  onToggleTimer: () => void;
  onCapture: () => void;
  onToggleStrip: () => void;
  onOpenPlanner: () => void;
  onOpenSettings: () => void;
  onPlanToday: () => void;
  onCloseDay: () => void;
  onQuit: () => void;
}

export class AppTray {
  private readonly tray: Tray;
  private readonly unsubscribe: () => void;

  constructor(private readonly deps: AppTrayDeps) {
    const image = nativeImage.createFromPath(deps.iconPath);
    if (process.platform === 'darwin') {
      const resized = image.resize({ width: 16 });
      resized.setTemplateImage(true);
      this.tray = new Tray(resized);
    } else {
      this.tray = new Tray(image);
    }
    // macOS menu bar mode (Slice 6) is not built yet: no `setTitle` call here.
    this.render();
    this.unsubscribe = deps.store.subscribe(() => this.render());
  }

  private render(): void {
    const snapshot = this.deps.store.get();
    const current = snapshot.today.current;
    const title = current?.title;
    this.tray.setToolTip(title ?? 'TimeBound');
    const running = current?.timer?.runningSince !== undefined;

    const menu = Menu.buildFromTemplate([
      { label: title ?? 'TimeBound', enabled: false },
      { type: 'separator' },
      { label: 'Complete', click: () => this.deps.onComplete() },
      { label: running ? 'Pause timer' : 'Start timer', enabled: !!current, click: () => this.deps.onToggleTimer() },
      { label: 'Quick capture', click: () => this.deps.onCapture() },
      { label: 'Plan today', click: () => this.deps.onPlanToday() },
      { label: 'Close the day', click: () => this.deps.onCloseDay() },
      { label: 'Show/Hide strip', click: () => this.deps.onToggleStrip() },
      { label: 'Open planner', click: () => this.deps.onOpenPlanner() },
      { label: 'Settings…', click: () => this.deps.onOpenSettings() },
      { type: 'separator' },
      { label: 'Quit', click: () => this.deps.onQuit() }
    ]);
    this.tray.setContextMenu(menu);
  }

  destroy(): void {
    this.unsubscribe();
    if (!this.tray.isDestroyed()) this.tray.destroy();
  }
}
