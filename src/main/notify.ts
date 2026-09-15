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
  // Task 3.2 fix round 1, item 2 (fix round 2, item 1: moved the add earlier — see
  // `notify` below): with nothing keeping a strong reference to it, Electron/the OS
  // can garbage-collect a Notification instance while it is still showing — the
  // click handler then silently never fires. Kept live from just before `show()`
  // (not the `'show'` event: nothing held it between construction and that event
  // firing, or ever if it never fires) until the OS reports it `close`d, `click`ed,
  // or `failed`.
  private readonly live = new Set<Electron.Notification>();

  constructor(private readonly deps: NotifierDeps) {}

  timerDone(task: Task): void {
    this.notify("Time's up", task.title);
  }

  breakDone(): void {
    this.notify("Break's over", 'Pick up where you left off');
  }

  /** Test-only visibility into how many notifications are currently kept referenced. */
  get liveCount(): number {
    return this.live.size;
  }

  private notify(title: string, body: string): void {
    if (!this.deps.getSettings().notifications) return;
    if (!this.deps.isSupported()) return;
    const n = new this.deps.NotificationCtor({ title, body, silent: false });
    const release = (): void => {
      this.live.delete(n);
    };
    n.on('click', () => {
      this.deps.onClick();
      release();
    });
    n.on('close', release);
    n.on('failed', release);
    this.live.add(n);
    n.show();
  }
}
