// main/windows/strip — the strip's `BrowserWindow` lifecycle. All docking/geometry
// DECISIONS live in the pure `./displays` module; this file is a thin orchestrator:
// it owns the Electron window, timers, and a small state machine (collapsed /
// expanded / hidden-sliver), and calls into `./displays` for every rect it computes.
// See docs/PLAN.md Task 1.7 and the state-machine writeup in
// .superpowers/sdd/PLAN/task-1.7-report.md.
import { BrowserWindow, screen } from 'electron';
import type { Edge, Settings } from '../../core/types';
import type { Store } from '../store';
import {
  clampAlong,
  displayKey,
  dockBounds,
  handleRect,
  isTaskbarAutoHide,
  panelBounds,
  pointIn,
  restorePosition,
  sliverBounds
} from './displays';
import type { DisplayLike, Rect } from './displays';

const STRIP_HEIGHT_DEFAULT = 32;
const MAX_COLLAPSED_HEIGHT = 44;
const DEFAULT_PANEL_HEIGHT = 200;

const DRAG_TICK_MS = Math.round(1000 / 60);
const DRAG_MAX_MS = 10_000;

const HOVER_POLL_MS = 100;
const EXPAND_COLLAPSE_DELAY_MS = 300;

const AUTO_HIDE_DELAY_MS = 3000;
const AUTO_HIDE_RESTORE_DELAY_MS = 200;
const AUTO_HIDE_RETREAT_MS = 1000;

export interface StripWindowDeps {
  store: Store;
  preloadPath: string;
  rendererUrl: (route: 'strip') => string;
  isDev: boolean;
}

type StripState = { expanded: boolean; hidden: boolean };
type Point = { x: number; y: number };

export class StripWindow {
  private win: BrowserWindow | undefined;
  private readonly stateListeners = new Set<(s: StripState) => void>();
  private unsubscribeStore: (() => void) | undefined;
  private firstSnapshotHandled = false;

  private settings: Settings['strip'];
  /** Content size while collapsed (dock/pill), as last reported by the renderer
   * (or the settings-configured width, before any report arrives). */
  private size: { width: number; height: number };
  /** The docked (collapsed) rect — the anchor every other state is computed from. */
  private dockedRect: Rect;
  private lastDisplay: DisplayLike | undefined;
  private panelHeight = DEFAULT_PANEL_HEIGHT;

  private expanded = false;
  private hidden = false;
  private pointerInside = false;

  // Drag (60 Hz while dragging)
  private dragTimer: ReturnType<typeof setInterval> | undefined;
  private dragTimeout: ReturnType<typeof setTimeout> | undefined;
  private dragGrabOffsetX = 0;

  // Hover/click-through/auto-hide poll (100 Hz.. 100 ms, i.e. 10 Hz, while needed)
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private outsideSince: number | undefined; // expand -> collapse-on-leave
  private hideOutsideSince: number | undefined; // auto-hide countdown
  private sliverHoverSince: number | undefined; // auto-hide restore countdown
  private autoHideDelayMs = AUTO_HIDE_DELAY_MS;
  private clickThroughIgnoring: boolean | undefined;

  constructor(private readonly deps: StripWindowDeps) {
    const snapshot = deps.store.get();
    this.settings = snapshot.data.settings.strip;
    this.size = { width: this.settings.width, height: STRIP_HEIGHT_DEFAULT };
    this.dockedRect = { x: 0, y: 0, width: this.size.width, height: this.size.height };
  }

  // --- lifecycle -----------------------------------------------------------------

  create(): void {
    if (this.win) return;

    this.win = new BrowserWindow({
      width: this.size.width,
      height: STRIP_HEIGHT_DEFAULT,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      focusable: false,
      skipTaskbar: true,
      resizable: false,
      hasShadow: false,
      show: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      type: process.platform === 'darwin' ? 'panel' : undefined,
      webPreferences: {
        preload: this.deps.preloadPath,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    const win = this.win;
    if (process.platform === 'darwin') {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      win.setAlwaysOnTop(true, 'floating');
    }
    win.setContentProtection(this.settings.hideFromCapture);
    win.setMenu(null);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());

    // Position correctly (using whatever settings/positions we already have) before
    // the first paint, so there is no flash-then-jump when the window is later shown.
    this.redock();

    void win.loadURL(this.deps.rendererUrl('strip'));

    screen.on('display-added', this.onDisplaysChanged);
    screen.on('display-removed', this.onDisplaysChanged);
    screen.on('display-metrics-changed', this.onDisplaysChanged);

    // Never call show()/focus() — only showInactive(), and only once the store has
    // delivered its first snapshot through this subscription.
    this.unsubscribeStore = this.deps.store.subscribe((snapshot) => {
      this.applySettings(snapshot.data.settings.strip);
      if (!this.firstSnapshotHandled) {
        this.firstSnapshotHandled = true;
        if (this.settings.enabled) this.showInactive();
      }
    });
  }

  destroy(): void {
    this.stopDragTimers();
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    if (this.unsubscribeStore) {
      this.unsubscribeStore();
      this.unsubscribeStore = undefined;
    }
    screen.removeListener('display-added', this.onDisplaysChanged);
    screen.removeListener('display-removed', this.onDisplaysChanged);
    screen.removeListener('display-metrics-changed', this.onDisplaysChanged);
    this.stateListeners.clear();
    if (this.win && !this.win.isDestroyed()) {
      this.win.destroy();
    }
    this.win = undefined;
  }

  // --- visibility ------------------------------------------------------------------

  showInactive(): void {
    this.win?.showInactive();
  }

  hide(): void {
    this.win?.hide();
  }

  toggle(): void {
    if (!this.win) return;
    if (this.win.isVisible()) {
      this.hide();
    } else {
      this.showInactive();
    }
  }

  isVisible(): boolean {
    return this.win?.isVisible() ?? false;
  }

  // --- docking / edge --------------------------------------------------------------

  setEdge(edge: Edge): void {
    if (!this.win || this.win.isDestroyed()) return;
    this.settings = { ...this.settings, edge };
    this.redock();
    if (this.lastDisplay) this.persistDock(this.lastDisplay);
  }

  applySettings(s: Settings['strip']): void {
    const prev = this.settings;
    this.settings = s;
    this.size = { ...this.size, width: s.width };
    if (!this.win || this.win.isDestroyed()) return;
    if (prev.hideFromCapture !== s.hideFromCapture) {
      this.win.setContentProtection(s.hideFromCapture);
    }
    if (!s.autoHide && this.hidden) {
      this.doAutoRestore();
    }
    this.redock();
    this.syncPollTimer();
  }

  handleReportedSize(size: { width: number; height: number }): void {
    if (!this.win || this.win.isDestroyed()) return;
    if (this.expanded) {
      // While expanded, the reported height is the WHOLE window height (strip row +
      // panel content); only the width feeds back into the collapsed anchor rect.
      if (size.width !== this.size.width) {
        this.size = { ...this.size, width: size.width };
        this.redock();
      }
      this.panelHeight = Math.max(0, size.height - this.dockedRect.height);
      this.applyVisualBounds();
      return;
    }
    this.size = { width: size.width, height: Math.min(size.height, MAX_COLLAPSED_HEIGHT) };
    this.redock();
  }

  // --- expand / hover ----------------------------------------------------------------

  expand(open: boolean): void {
    if (!this.win || this.win.isDestroyed() || this.hidden) return;
    if (this.expanded === open) return;
    this.expanded = open;
    this.outsideSince = undefined;
    if (open) this.panelHeight = DEFAULT_PANEL_HEIGHT;
    this.applyVisualBounds();
    this.syncPollTimer();
    this.emitState();
  }

  hover(inside: boolean): void {
    this.pointerInside = inside;
    if (inside) {
      this.outsideSince = undefined;
      this.hideOutsideSince = undefined;
      // A real hover (only possible when not click-through) is genuine engagement:
      // the next auto-hide countdown after this uses the normal 3 s delay, not the
      // 1 s "quick retreat" that follows an auto-hide sliver restore.
      this.autoHideDelayMs = AUTO_HIDE_DELAY_MS;
    }
  }

  // --- drag ----------------------------------------------------------------------

  beginDrag(): void {
    if (!this.win || this.win.isDestroyed() || this.dragTimer) return;
    const bounds = this.win.getBounds();
    const cursor = screen.getCursorScreenPoint();
    this.dragGrabOffsetX = cursor.x - bounds.x;
    this.dragTimer = setInterval(() => this.onDragTick(), DRAG_TICK_MS);
    this.dragTimeout = setTimeout(() => this.endDrag(), DRAG_MAX_MS);
  }

  /** Not (yet) reachable from IPC — `WindowCommands` has no drag-end channel; Task 1.9
   * wires the renderer's mouseup back to this (or a new channel). Until then, a drag
   * still ends on its own after `DRAG_MAX_MS`. Exposed now so that wiring is a pure
   * plumbing change, not new logic here. */
  endDrag(): void {
    if (!this.dragTimer && !this.dragTimeout) return;
    this.stopDragTimers();
    if (this.win && !this.win.isDestroyed()) {
      this.persistDock(this.lastDisplay ?? this.currentDisplay());
    }
  }

  // --- internals: docking ----------------------------------------------------------

  private currentDisplay(): DisplayLike {
    if (this.win && !this.win.isDestroyed()) {
      return screen.getDisplayMatching(this.win.getBounds());
    }
    return screen.getPrimaryDisplay();
  }

  private redock(): void {
    if (!this.win || this.win.isDestroyed()) return;
    const d = this.currentDisplay();
    this.lastDisplay = d;
    const auto = isTaskbarAutoHide(d, this.settings.edge);
    const remembered = restorePosition(this.settings.positions, d);
    this.dockedRect = dockBounds(d, this.settings.edge, this.size, remembered?.x, auto);
    this.applyVisualBounds();
  }

  private applyVisualBounds(): void {
    if (!this.win || this.win.isDestroyed()) return;
    const rect = this.hidden
      ? sliverBounds(this.dockedRect, this.settings.edge)
      : this.expanded
        ? panelBounds(this.dockedRect, this.settings.edge, this.panelHeight)
        : this.dockedRect;
    const current = this.win.getBounds();
    if (
      current.x === rect.x &&
      current.y === rect.y &&
      current.width === rect.width &&
      current.height === rect.height
    ) {
      return;
    }
    this.win.setBounds(rect, false);
  }

  private persistDock(d: DisplayLike): void {
    const positions = { ...this.settings.positions, [displayKey(d)]: { x: this.dockedRect.x, y: this.dockedRect.y } };
    this.deps.store.dispatch({
      type: 'settings/patch',
      now: Date.now(),
      patch: { strip: { edge: this.settings.edge, positions } }
    });
  }

  private readonly onDisplaysChanged = (): void => {
    this.redock();
  };

  private onDragTick(): void {
    if (!this.win || this.win.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();
    const d = screen.getDisplayNearestPoint(cursor);
    this.lastDisplay = d;
    const auto = isTaskbarAutoHide(d, this.settings.edge);
    const x = clampAlong(d, cursor.x - this.dragGrabOffsetX, this.size.width);
    this.dockedRect = dockBounds(d, this.settings.edge, this.size, x, auto);
    this.win.setBounds(this.dockedRect, false);
  }

  private stopDragTimers(): void {
    if (this.dragTimer) {
      clearInterval(this.dragTimer);
      this.dragTimer = undefined;
    }
    if (this.dragTimeout) {
      clearTimeout(this.dragTimeout);
      this.dragTimeout = undefined;
    }
  }

  // --- internals: hover / click-through / auto-hide poll ----------------------------

  private syncPollTimer(): void {
    const needed = this.expanded || this.settings.clickThrough || this.settings.autoHide;
    if (needed && !this.pollTimer) {
      this.pollTimer = setInterval(() => this.onPollTick(), HOVER_POLL_MS);
    } else if (!needed && this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private onPollTick(): void {
    if (!this.win || this.win.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();
    const now = Date.now();

    this.updateClickThrough(cursor);

    if (this.expanded) {
      this.updateExpandCollapse(cursor, now);
      return; // expand/collapse and auto-hide never apply at the same time
    }
    this.updateAutoHide(cursor, now);
  }

  private updateClickThrough(cursor: Point): void {
    if (!this.win) return;
    if (!this.settings.clickThrough || this.hidden) {
      if (this.clickThroughIgnoring) {
        this.clickThroughIgnoring = false;
        this.win.setIgnoreMouseEvents(false);
      }
      return;
    }
    const withinHandle = pointIn(handleRect(this.dockedRect), cursor);
    const shouldIgnore = !withinHandle;
    if (this.clickThroughIgnoring !== shouldIgnore) {
      this.clickThroughIgnoring = shouldIgnore;
      this.win.setIgnoreMouseEvents(shouldIgnore, { forward: true });
    }
  }

  private updateExpandCollapse(cursor: Point, now: number): void {
    if (!this.win) return;
    const bounds = this.win.getBounds();
    if (pointIn(bounds, cursor)) {
      this.outsideSince = undefined;
      return;
    }
    if (this.outsideSince === undefined) this.outsideSince = now;
    if (now - this.outsideSince >= EXPAND_COLLAPSE_DELAY_MS) this.expand(false);
  }

  private updateAutoHide(cursor: Point, now: number): void {
    const timerRunning = this.deps.store.get().today.current?.timer?.runningSince !== undefined;
    const armed = this.settings.autoHide && !timerRunning;

    if (!armed) {
      this.hideOutsideSince = undefined;
      if (this.hidden) this.doAutoRestore();
      return;
    }

    if (!this.hidden) {
      if (this.pointerInside || pointIn(this.dockedRect, cursor)) {
        this.hideOutsideSince = undefined;
        return;
      }
      if (this.hideOutsideSince === undefined) this.hideOutsideSince = now;
      if (now - this.hideOutsideSince >= this.autoHideDelayMs) this.doAutoHide();
      return;
    }

    const sliver = sliverBounds(this.dockedRect, this.settings.edge);
    if (pointIn(sliver, cursor)) {
      if (this.sliverHoverSince === undefined) this.sliverHoverSince = now;
      if (now - this.sliverHoverSince >= AUTO_HIDE_RESTORE_DELAY_MS) this.doAutoRestore();
    } else {
      this.sliverHoverSince = undefined;
    }
  }

  private doAutoHide(): void {
    this.hidden = true;
    this.hideOutsideSince = undefined;
    this.applyVisualBounds();
    this.emitState();
  }

  private doAutoRestore(): void {
    this.hidden = false;
    this.sliverHoverSince = undefined;
    // "retreat again 1 s after leave": the sliver was a quick peek, so the next
    // auto-hide countdown from this restored state is shortened. `hover(true)`
    // resets this back to the normal delay when the peek turns into real use.
    this.autoHideDelayMs = AUTO_HIDE_RETREAT_MS;
    this.applyVisualBounds();
    this.syncPollTimer();
    this.emitState();
  }

  // --- state events ------------------------------------------------------------------

  onState(cb: (s: StripState) => void): () => void {
    this.stateListeners.add(cb);
    return () => {
      this.stateListeners.delete(cb);
    };
  }

  private emitState(): void {
    const s: StripState = { expanded: this.expanded, hidden: this.hidden };
    for (const cb of this.stateListeners) cb(s);
  }
}
