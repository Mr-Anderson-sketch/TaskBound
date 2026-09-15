import { describe, it, expect, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import { registerIpc, IpcRejected } from '../../src/main/ipc';
import type { WindowCommands } from '../../src/main/ipc';
import { Store } from '../../src/main/store';
import { createEmptyData } from '../../src/core/defaults';

const APP_VERSION = '2.0.0';
const ALLOWED_ORIGIN = 'https://timebound.local/';

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

function makeFakeIpcMain() {
  const handlers = new Map<string, Handler>();
  return {
    ipcMain: {
      handle(channel: string, listener: Handler) {
        handlers.set(channel, listener);
      }
    },
    handlers
  };
}

function eventFrom(url: string | undefined): IpcMainInvokeEvent {
  return { senderFrame: url ? { url } : null } as unknown as IpcMainInvokeEvent;
}

function makeWindows(): WindowCommands {
  return {
    stripExpand: vi.fn(),
    stripReportSize: vi.fn(),
    stripSetEdge: vi.fn(),
    stripDragStart: vi.fn(),
    stripDragEnd: vi.fn(),
    stripHover: vi.fn(),
    paletteShow: vi.fn(),
    paletteHide: vi.fn(),
    paletteReportSize: vi.fn(),
    plannerShow: vi.fn(),
    plannerHide: vi.fn(),
    plannerMinimize: vi.fn(),
    openExternal: vi.fn(),
    quit: vi.fn(),
    dataExport: vi.fn(async () => ({})),
    dataImport: vi.fn(async () => ({})),
    dataChooseDir: vi.fn(async () => ({})),
    hotkeysTest: vi.fn(() => ({ ok: true })),
    hotkeysStatus: vi.fn(() => ({
      capture: true,
      toggleStrip: true,
      completeAdvance: true,
      toggleTimer: true,
      undo: true
    })),
    timerToggle: vi.fn()
  };
}

function makeStore(): Store {
  const data = createEmptyData(1000, APP_VERSION);
  return new Store(data, {
    save: vi.fn(async () => {}),
    now: () => 1000,
    appVersion: APP_VERSION,
    platform: 'win32',
    systemDark: () => false
  });
}

function setup(allowedOrigins: string[] = [ALLOWED_ORIGIN]) {
  const { ipcMain, handlers } = makeFakeIpcMain();
  const store = makeStore();
  const windows = makeWindows();
  registerIpc({ ipcMain, store, allowedOrigins, windows });
  return { handlers, store, windows };
}

// One valid payload (or none) per InvokeMap channel — used by the table-driven sender
// guard test below, so a rejection there is provably caused by the origin check and
// not by payload validation.
const VALID_PAYLOADS: Record<string, unknown[]> = {
  'store:get': [],
  'store:dispatch': [{ type: 'task/add', id: 'x', now: 1000, title: 'Valid' }],
  'store:undo': [],
  'store:redo': [],
  'strip:expand': [true],
  'strip:reportSize': [{ width: 100, height: 32 }],
  'strip:setEdge': ['top'],
  'strip:dragStart': [],
  'strip:dragEnd': [],
  'strip:hover': [true],
  'palette:show': ['capture'],
  'palette:hide': [],
  'palette:reportSize': [{ height: 132 }],
  'planner:show': [],
  'planner:hide': [],
  'planner:minimize': [],
  'app:openExternal': ['https://example.com/'],
  'app:quit': [],
  'data:export': ['json'],
  'data:import': [],
  'data:chooseDir': [],
  'hotkeys:test': ['Control+Alt+Space'],
  'hotkeys:status': [],
  'timer:toggle': []
};

describe('registerIpc', () => {
  it('registers every InvokeMap channel', () => {
    const { handlers } = setup();
    expect([...handlers.keys()].sort()).toEqual(
      [
        'store:get',
        'store:dispatch',
        'store:undo',
        'store:redo',
        'strip:expand',
        'strip:reportSize',
        'strip:setEdge',
        'strip:dragStart',
        'strip:dragEnd',
        'strip:hover',
        'palette:show',
        'palette:hide',
        'palette:reportSize',
        'planner:show',
        'planner:hide',
        'planner:minimize',
        'app:openExternal',
        'app:quit',
        'data:export',
        'data:import',
        'data:chooseDir',
        'hotkeys:test',
        'hotkeys:status',
        'timer:toggle'
      ].sort()
    );
  });

  it('forwards hotkeys:status to windows', async () => {
    const { handlers, windows } = setup();

    const result = await handlers.get('hotkeys:status')!(eventFrom(ALLOWED_ORIGIN));

    expect(windows.hotkeysStatus).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ capture: true, toggleStrip: true, completeAdvance: true, toggleTimer: true, undo: true });
  });

  it('forwards timer:toggle to windows', async () => {
    const { handlers, windows } = setup();

    await handlers.get('timer:toggle')!(eventFrom(ALLOWED_ORIGIN));

    expect(windows.timerToggle).toHaveBeenCalledTimes(1);
  });

  it('forwards planner:minimize to windows', async () => {
    const { handlers, windows } = setup();

    await handlers.get('planner:minimize')!(eventFrom(ALLOWED_ORIGIN));

    expect(windows.plannerMinimize).toHaveBeenCalledTimes(1);
  });

  it('rejects store:dispatch with a title over 200 chars', async () => {
    const { handlers } = setup();
    const badAction = { type: 'task/add', id: 'a', now: 1000, title: 'x'.repeat(201) };

    await expect(handlers.get('store:dispatch')!(eventFrom(ALLOWED_ORIGIN), badAction)).rejects.toThrow(IpcRejected);
  });

  it('rejects any channel when the sender frame is untrusted', async () => {
    const { handlers } = setup();
    const action = { type: 'task/add', id: 'a', now: 1000, title: 'Valid title' };

    await expect(handlers.get('store:dispatch')!(eventFrom('https://evil'), action)).rejects.toThrow(IpcRejected);
  });

  it('rejects when the sender frame is missing entirely', async () => {
    const { handlers } = setup();
    await expect(handlers.get('store:get')!(eventFrom(undefined))).rejects.toThrow(IpcRejected);
  });

  it('rejects every registered channel when the sender is untrusted, even with an otherwise-valid payload', async () => {
    const { handlers } = setup();
    expect(Object.keys(VALID_PAYLOADS).sort()).toEqual([...handlers.keys()].sort());

    for (const [channel, args] of Object.entries(VALID_PAYLOADS)) {
      const handler = handlers.get(channel)!;
      await expect(handler(eventFrom('https://evil/'), ...args)).rejects.toThrow(IpcRejected);
    }
  });

  it('throws at registration time when an allowedOrigins entry lacks a trailing slash', () => {
    const { ipcMain } = makeFakeIpcMain();
    const store = makeStore();
    const windows = makeWindows();

    expect(() =>
      registerIpc({ ipcMain, store, allowedOrigins: ['https://timebound.local'], windows })
    ).toThrow(/must end with/);
  });

  it('does not treat a same-prefix sibling origin as trusted (origin-prefix check is slash-anchored)', async () => {
    const { handlers } = setup(['file:///D:/app/']);

    // Sibling directory sharing the 'file:///D:/app' text prefix, but not the '/'-anchored one.
    await expect(handlers.get('store:get')!(eventFrom('file:///D:/app-evil/index.html'))).rejects.toThrow(
      IpcRejected
    );

    // A real sub-path/fragment of the trusted directory is accepted.
    const snapshot = await handlers.get('store:get')!(eventFrom('file:///D:/app/index.html#/strip'));
    expect(snapshot).toMatchObject({ rev: 0 });
  });

  // Fix round 1, finding 13.
  it('accepts a sender whose file: URL drive letter differs in case from the allowed origin', async () => {
    const { handlers } = setup(['file:///D:/app/']);

    const snapshot = await handlers.get('store:get')!(eventFrom('file:///d:/app/index.html#/strip'));

    expect(snapshot).toMatchObject({ rev: 0 });
  });

  it('applies a valid task/add from an allowed origin and returns the new rev', async () => {
    const { handlers, store } = setup();
    const action = { type: 'task/add', id: 'a', now: 1000, title: 'Buy milk' };

    const result = await handlers.get('store:dispatch')!(eventFrom(ALLOWED_ORIGIN), action);

    expect(result).toEqual({ rev: 1 });
    expect(store.get().data.tasks).toHaveLength(1);
  });

  it('rejects app:openExternal with a file: URL', async () => {
    const { handlers, windows } = setup();

    await expect(handlers.get('app:openExternal')!(eventFrom(ALLOWED_ORIGIN), 'file:///etc/passwd')).rejects.toThrow(
      IpcRejected
    );
    expect(windows.openExternal).not.toHaveBeenCalled();
  });

  it('accepts app:openExternal with an https: URL and forwards it to windows', async () => {
    const { handlers, windows } = setup();

    await handlers.get('app:openExternal')!(eventFrom(ALLOWED_ORIGIN), 'https://example.com/');

    expect(windows.openExternal).toHaveBeenCalledWith('https://example.com/');
  });

  it('rejects strip:reportSize with a non-integer size payload', async () => {
    const { handlers, windows } = setup();

    await expect(
      handlers.get('strip:reportSize')!(eventFrom(ALLOWED_ORIGIN), { width: 100.5, height: 32 })
    ).rejects.toThrow(IpcRejected);
    expect(windows.stripReportSize).not.toHaveBeenCalled();
  });

  it('rejects palette:reportSize with a height outside 60..640', async () => {
    const { handlers, windows } = setup();

    await expect(handlers.get('palette:reportSize')!(eventFrom(ALLOWED_ORIGIN), { height: 59 })).rejects.toThrow(IpcRejected);
    await expect(handlers.get('palette:reportSize')!(eventFrom(ALLOWED_ORIGIN), { height: 641 })).rejects.toThrow(IpcRejected);
    expect(windows.paletteReportSize).not.toHaveBeenCalled();
  });

  it('accepts a valid palette:reportSize and forwards it to windows', async () => {
    const { handlers, windows } = setup();

    await handlers.get('palette:reportSize')!(eventFrom(ALLOWED_ORIGIN), { height: 300 });

    expect(windows.paletteReportSize).toHaveBeenCalledWith({ height: 300 });
  });

  it('rejects strip:setEdge with a value outside the Edge enum', async () => {
    const { handlers } = setup();

    await expect(handlers.get('strip:setEdge')!(eventFrom(ALLOWED_ORIGIN), 'left')).rejects.toThrow(IpcRejected);
  });

  it('forwards store:undo/redo results from the Store', async () => {
    const { handlers, store } = setup();
    store.dispatch({ type: 'task/add', id: 'a', now: 1000, title: 'One' });

    const undone = await handlers.get('store:undo')!(eventFrom(ALLOWED_ORIGIN));
    expect(undone).toEqual({ rev: 2, label: 'Added "One"' });

    const redone = await handlers.get('store:redo')!(eventFrom(ALLOWED_ORIGIN));
    expect(redone).toEqual({ rev: 3, label: 'Added "One"' });
  });
});
