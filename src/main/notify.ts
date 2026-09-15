// main/notify — desktop notifications for timer expiry and pomodoro breaks. No
// top-level `electron` value import (only `import type`), same discipline as
// clock.ts/hotkeys.ts, so this runs under Vitest without Electron: the Notification
// constructor, `isSupported()`, current settings, and the click handler are all
// injected. See .superpowers/sdd/PLAN/task-3.2-addendum.md ruling 6.
import type * as Electron from 'electron';
import type { Settings, Task } from '../core/types';

export interface NotifierDeps {
  NotificationCtor: typeof Electron.Notification;
  isSupported: () => boolean;
  getSettings: () => Settings;
  /** Called when the user clicks a notification — main wires this to `planner.show()`. */
  onClick: () => void;
}

/** Wraps `new Notification(...)` behind `settings.notifications` and platform support,
 * with the two copies this app ever shows. Sentence case, no exclamation marks (per
 * the addendum's exact wording). */
export class Notifier {
  constructor(private readonly deps: NotifierDeps) {}

  timerDone(task: Task): void {
    this.notify("Time's up", task.title);
  }

  breakDone(): void {
    this.notify("Break's over", 'Pick up where you left off');
  }

  private notify(title: string, body: string): void {
    if (!this.deps.getSettings().notifications) return;
    if (!this.deps.isSupported()) return;
    const n = new this.deps.NotificationCtor({ title, body, silent: false });
    n.on('click', () => this.deps.onClick());
    n.show();
  }
}
