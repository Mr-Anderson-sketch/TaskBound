// tests/main/notify — Task 3.2 addendum ruling 6/9: fake Notification constructor
// (no Electron), fake settings/support so behaviour is deterministic.
import { describe, it, expect, vi } from 'vitest';
import { Notifier } from '../../src/main/notify';
import type { Settings, Task } from '../../src/core/types';
import { defaultSettings } from '../../src/core/defaults';

interface FakeNotificationInstance {
  opts: { title: string; body: string; silent?: boolean };
  handlers: Map<string, () => void>;
  on: (event: string, cb: () => void) => void;
  show: () => void;
  fire: (event: string) => void;
}

function makeFakeNotificationCtor() {
  const instances: FakeNotificationInstance[] = [];
  class FakeNotification {
    opts: { title: string; body: string; silent?: boolean };
    handlers = new Map<string, () => void>();
    constructor(opts: { title: string; body: string; silent?: boolean }) {
      this.opts = opts;
      instances.push(this as unknown as FakeNotificationInstance);
    }
    on(event: string, cb: () => void): void {
      this.handlers.set(event, cb);
    }
    show(): void {}
    fire(event: string): void {
      this.handlers.get(event)?.();
    }
  }
  return { FakeNotification, instances };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Write the report',
    listId: 'inbox',
    tags: [],
    order: 0,
    today: true,
    status: 'open',
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  };
}

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return { ...defaultSettings(), ...overrides };
}

describe('Notifier', () => {
  it('does nothing when settings.notifications is off', () => {
    const { FakeNotification, instances } = makeFakeNotificationCtor();
    const notifier = new Notifier({
      NotificationCtor: FakeNotification as never,
      isSupported: () => true,
      getSettings: () => makeSettings({ notifications: false }),
      onClick: vi.fn()
    });

    notifier.timerDone(makeTask());

    expect(instances).toHaveLength(0);
  });

  it('does nothing when Notification is unsupported', () => {
    const { FakeNotification, instances } = makeFakeNotificationCtor();
    const notifier = new Notifier({
      NotificationCtor: FakeNotification as never,
      isSupported: () => false,
      getSettings: () => makeSettings({ notifications: true }),
      onClick: vi.fn()
    });

    notifier.timerDone(makeTask());
    notifier.breakDone();

    expect(instances).toHaveLength(0);
  });

  it('timerDone shows "Time\'s up" with the task title as the body, silent: false', () => {
    const { FakeNotification, instances } = makeFakeNotificationCtor();
    const notifier = new Notifier({
      NotificationCtor: FakeNotification as never,
      isSupported: () => true,
      getSettings: () => makeSettings({ notifications: true }),
      onClick: vi.fn()
    });

    notifier.timerDone(makeTask({ title: 'Write the report' }));

    expect(instances).toHaveLength(1);
    expect(instances[0].opts).toEqual({ title: "Time's up", body: 'Write the report', silent: false });
  });

  it('breakDone shows "Break\'s over" / "Pick up where you left off"', () => {
    const { FakeNotification, instances } = makeFakeNotificationCtor();
    const notifier = new Notifier({
      NotificationCtor: FakeNotification as never,
      isSupported: () => true,
      getSettings: () => makeSettings({ notifications: true }),
      onClick: vi.fn()
    });

    notifier.breakDone();

    expect(instances).toHaveLength(1);
    expect(instances[0].opts).toEqual({ title: "Break's over", body: 'Pick up where you left off', silent: false });
  });

  // Task 3.2 fix round 1, item 2 (Important): Notification objects must be kept
  // referenced or Electron/the OS can garbage-collect them mid-display, silently
  // dropping the click handler.
  it('keeps the Notification instance referenced from `show` until the OS reports it closed', () => {
    const { FakeNotification, instances } = makeFakeNotificationCtor();
    const notifier = new Notifier({
      NotificationCtor: FakeNotification as never,
      isSupported: () => true,
      getSettings: () => makeSettings({ notifications: true }),
      onClick: vi.fn()
    });

    notifier.timerDone(makeTask());
    expect(notifier.liveCount).toBe(0); // constructed, but the OS hasn't reported it shown yet

    instances[0].fire('show');
    expect(notifier.liveCount).toBe(1);

    instances[0].fire('close');
    expect(notifier.liveCount).toBe(0);
  });

  it('releases the reference when the notification is clicked', () => {
    const { FakeNotification, instances } = makeFakeNotificationCtor();
    const notifier = new Notifier({
      NotificationCtor: FakeNotification as never,
      isSupported: () => true,
      getSettings: () => makeSettings({ notifications: true }),
      onClick: vi.fn()
    });

    notifier.timerDone(makeTask());
    instances[0].fire('show');
    expect(notifier.liveCount).toBe(1);

    instances[0].fire('click');
    expect(notifier.liveCount).toBe(0);
  });

  it('releases the reference when showing the notification fails', () => {
    const { FakeNotification, instances } = makeFakeNotificationCtor();
    const notifier = new Notifier({
      NotificationCtor: FakeNotification as never,
      isSupported: () => true,
      getSettings: () => makeSettings({ notifications: true }),
      onClick: vi.fn()
    });

    notifier.timerDone(makeTask());
    instances[0].fire('show');
    expect(notifier.liveCount).toBe(1);

    instances[0].fire('failed');
    expect(notifier.liveCount).toBe(0);
  });

  it('clicking the notification calls onClick', () => {
    const { FakeNotification, instances } = makeFakeNotificationCtor();
    const onClick = vi.fn();
    const notifier = new Notifier({
      NotificationCtor: FakeNotification as never,
      isSupported: () => true,
      getSettings: () => makeSettings({ notifications: true }),
      onClick
    });

    notifier.timerDone(makeTask());
    instances[0].fire('click');

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
