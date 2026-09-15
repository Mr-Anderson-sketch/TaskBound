// main/ipc — registers every `InvokeMap` channel (src/shared/ipc.ts) on `ipcMain`,
// validating sender origin and payload shape before touching the Store or a window
// command. No Electron value import (only `import type`) so this runs under Vitest
// without Electron. See CLAUDE.md: "Every IPC payload is zod-validated in main."
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import type { ZodType } from 'zod';
import { ActionSchema } from '../core/schema';
import type { Action, Edge } from '../core/types';
import type { Store } from './store';
import type { PaletteMode } from '../shared/ipc';

export class IpcRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IpcRejected';
  }
}

/** Thunks the window layer implements; this task only wires the channels to them. */
export interface WindowCommands {
  stripExpand(open: boolean): void | Promise<void>;
  stripReportSize(size: { width: number; height: number }): void | Promise<void>;
  stripSetEdge(edge: Edge): void | Promise<void>;
  stripDragStart(): void | Promise<void>;
  stripDragEnd(): void | Promise<void>;
  stripHover(inside: boolean): void | Promise<void>;
  paletteShow(mode: PaletteMode): void | Promise<void>;
  paletteHide(): void | Promise<void>;
  paletteReportSize(size: { height: number }): void | Promise<void>;
  plannerShow(): void | Promise<void>;
  plannerHide(): void | Promise<void>;
  openExternal(url: string): void | Promise<void>;
  quit(): void | Promise<void>;
  dataExport(format: 'json' | 'md'): { path?: string } | Promise<{ path?: string }>;
  dataImport(): { imported?: number; error?: string } | Promise<{ imported?: number; error?: string }>;
  dataChooseDir(): { dir?: string } | Promise<{ dir?: string }>;
  hotkeysTest(accelerator: string): { ok: boolean; reason?: string } | Promise<{ ok: boolean; reason?: string }>;
}

export interface RegisterIpcDeps {
  ipcMain: Pick<IpcMain, 'handle'>;
  store: Store;
  /**
   * Trusted prefixes checked against `event.senderFrame.url` (a plain `startsWith`).
   * Each entry MUST end with '/' — e.g. `file:///D:/app/dist/renderer/` or
   * `http://localhost:5173/` — never a bare origin like `https://timebound.local`,
   * which would also match an attacker's `https://timebound.local.evil.com/` (and,
   * for `file:`, a sibling directory like `file:///D:/app-evil/`). `registerIpc`
   * throws at registration time if any entry lacks the trailing slash.
   */
  allowedOrigins: string[];
  windows: WindowCommands;
}

// --- small inline payload schemas (ActionSchema is imported from core/schema) --------

const BooleanSchema = z.boolean();
const SizeSchema = z
  .object({
    width: z.number().int().min(0).max(10000),
    height: z.number().int().min(0).max(10000)
  })
  .strict();
const EdgeSchema = z.enum(['top', 'bottom']);
const PaletteModeSchema = z.enum(['capture', 'plan', 'close', 'commands', 'onboarding']);
// Task 2.3 addendum ruling 6: the palette's own content height, reported by the
// renderer's ResizeObserver. 60 is a sane floor (never a collapsed-to-nothing
// window); 640 is a generous ceiling — the renderer itself caps the plan sheet at
// 480 (its own `overflow-y: auto` list keeps long lists from ever reporting past it).
const PaletteReportSizeSchema = z
  .object({
    height: z.number().int().min(60).max(640)
  })
  .strict();
const UrlSchema = z
  .string()
  .url()
  .max(2048)
  .refine((u) => u.startsWith('http:') || u.startsWith('https:'), 'url must be http: or https:');
const ExportFormatSchema = z.enum(['json', 'md']);
const AcceleratorSchema = z.string().max(64);

/** Normalises a `file:` URL's drive letter to uppercase before the trust-prefix
 * comparison (fix round 1, finding 13): Windows drive letters are case-insensitive,
 * but a plain `startsWith` isn't — `file:///d:/app/` (as some code paths spell it)
 * would otherwise fail to match an allowed origin spelled `file:///D:/app/` (as
 * `pathToFileURL` spells it), rejecting a perfectly legitimate sender. Non-`file:`
 * URLs (http/https in dev) pass through unchanged. */
function normalizeForTrustCompare(url: string): string {
  return url.replace(/^file:\/\/\/([a-zA-Z]):\//, (_match, letter: string) => `file:///${letter.toUpperCase()}:/`);
}

function assertTrustedSender(event: IpcMainInvokeEvent, allowedOrigins: string[]): void {
  const url = event.senderFrame?.url;
  if (!url) {
    throw new IpcRejected('untrusted sender');
  }
  const normalizedUrl = normalizeForTrustCompare(url);
  if (!allowedOrigins.some((origin) => normalizedUrl.startsWith(normalizeForTrustCompare(origin)))) {
    throw new IpcRejected('untrusted sender');
  }
}

function parse<T>(schema: ZodType<T>, payload: unknown): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new IpcRejected(result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  return result.data;
}

/**
 * Registers every `InvokeMap` channel on `ipcMain`. Every handler, in order: (1) checks
 * `event.senderFrame.url` against `allowedOrigins`, throwing `IpcRejected` if untrusted;
 * (2) validates its payload with zod, throwing `IpcRejected` on failure; (3) calls the
 * `Store` or the relevant `WindowCommands` thunk (implemented in later tasks).
 */
export function registerIpc(deps: RegisterIpcDeps): void {
  const { ipcMain, store, allowedOrigins, windows } = deps;

  for (const origin of allowedOrigins) {
    if (!origin.endsWith('/')) {
      throw new Error(`registerIpc: allowedOrigins entries must end with '/' (got ${JSON.stringify(origin)})`);
    }
  }

  const guard = (event: IpcMainInvokeEvent): void => assertTrustedSender(event, allowedOrigins);

  ipcMain.handle('store:get', async (event: IpcMainInvokeEvent) => {
    guard(event);
    return store.get();
  });

  ipcMain.handle('store:dispatch', async (event: IpcMainInvokeEvent, action: unknown) => {
    guard(event);
    const parsed: Action = parse(ActionSchema, action);
    const rev = store.dispatch(parsed);
    return { rev };
  });

  ipcMain.handle('store:undo', async (event: IpcMainInvokeEvent) => {
    guard(event);
    const label = store.undo();
    return { rev: store.get().rev, label };
  });

  ipcMain.handle('store:redo', async (event: IpcMainInvokeEvent) => {
    guard(event);
    const label = store.redo();
    return { rev: store.get().rev, label };
  });

  ipcMain.handle('strip:expand', async (event: IpcMainInvokeEvent, open: unknown) => {
    guard(event);
    return windows.stripExpand(parse(BooleanSchema, open));
  });

  ipcMain.handle('strip:reportSize', async (event: IpcMainInvokeEvent, size: unknown) => {
    guard(event);
    return windows.stripReportSize(parse(SizeSchema, size));
  });

  ipcMain.handle('strip:setEdge', async (event: IpcMainInvokeEvent, edge: unknown) => {
    guard(event);
    return windows.stripSetEdge(parse(EdgeSchema, edge));
  });

  ipcMain.handle('strip:dragStart', async (event: IpcMainInvokeEvent) => {
    guard(event);
    return windows.stripDragStart();
  });

  ipcMain.handle('strip:dragEnd', async (event: IpcMainInvokeEvent) => {
    guard(event);
    return windows.stripDragEnd();
  });

  ipcMain.handle('strip:hover', async (event: IpcMainInvokeEvent, inside: unknown) => {
    guard(event);
    return windows.stripHover(parse(BooleanSchema, inside));
  });

  ipcMain.handle('palette:show', async (event: IpcMainInvokeEvent, mode: unknown) => {
    guard(event);
    return windows.paletteShow(parse(PaletteModeSchema, mode));
  });

  ipcMain.handle('palette:hide', async (event: IpcMainInvokeEvent) => {
    guard(event);
    return windows.paletteHide();
  });

  ipcMain.handle('palette:reportSize', async (event: IpcMainInvokeEvent, size: unknown) => {
    guard(event);
    return windows.paletteReportSize(parse(PaletteReportSizeSchema, size));
  });

  ipcMain.handle('planner:show', async (event: IpcMainInvokeEvent) => {
    guard(event);
    return windows.plannerShow();
  });

  ipcMain.handle('planner:hide', async (event: IpcMainInvokeEvent) => {
    guard(event);
    return windows.plannerHide();
  });

  ipcMain.handle('app:openExternal', async (event: IpcMainInvokeEvent, url: unknown) => {
    guard(event);
    return windows.openExternal(parse(UrlSchema, url));
  });

  ipcMain.handle('app:quit', async (event: IpcMainInvokeEvent) => {
    guard(event);
    return windows.quit();
  });

  ipcMain.handle('data:export', async (event: IpcMainInvokeEvent, format: unknown) => {
    guard(event);
    return windows.dataExport(parse(ExportFormatSchema, format));
  });

  ipcMain.handle('data:import', async (event: IpcMainInvokeEvent) => {
    guard(event);
    return windows.dataImport();
  });

  ipcMain.handle('data:chooseDir', async (event: IpcMainInvokeEvent) => {
    guard(event);
    return windows.dataChooseDir();
  });

  ipcMain.handle('hotkeys:test', async (event: IpcMainInvokeEvent, accelerator: unknown) => {
    guard(event);
    return windows.hotkeysTest(parse(AcceleratorSchema, accelerator));
  });
}
