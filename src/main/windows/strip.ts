// main/windows/strip — the strip's `BrowserWindow` lifecycle. All docking/geometry
// DECISIONS live in the pure `./displays` module; this file is a thin orchestrator:
// it owns the Electron window, timers, and a small state machine (collapsed /
// expanded / hidden-sliver), and calls into `./displays` for every rect it computes.
// See docs/PLAN.md Task 1.7 and the state-machine writeup in
// .superpowers/sdd/PLAN/task-1.7-report.md (plus its "Fix round 1" appendix).
import { BrowserWindow, screen } from 'electron';
import type { WebContents } from 'electron';
import type { Edge, Settings } from '../../core/types';
import type { Store } from '../store';
import {
  clampAlong,
  displayKey,
  displaySignature,
  dockBounds,
  handleRect,
  isTaskbarAutoHide,
  nextCollapsedSize,
  nextReportedWidth,
  panelBounds,
  pointIn,
  reanchorY,
  restorePosition,
  sliverBounds
} from './displays';
import type { DisplayLike, Rect } from './displays';
import { appBarRect, rectPxToDip } from '../win32/geometry';
import type { RectPx } from '../win32/geometry';
import type { Win32 } from '../win32';

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
  /** Task 7.1: the bound win32 API (AppBar reservation + fullscreen detection),
   * or `undefined` on every other platform, when koffi is unavailable, or when any
   * binding failed — the strip must dock and show/hide exactly as before in every
   * one of those cases. `main.ts` resolves this once via `loadWin32()` before the
   * `Store` (and its `capabilities`) is even created. */
  win32?: Win32;
}

type StripState = { expanded: boolean; hidden: boolean };
type Point = { x: number; y: number };

export class StripWindow {
  private win: BrowserWindow | undefined;
  private readonly stateListeners = new Set<(s: StripState) => void>();
  private unsubscribeStore: (() => void) | undefined;

  private settings: Settings['strip'];
  /** Content size while collapsed (dock/pill), as last reported by the renderer
   * (or the settings-configured width, before any report arrives). Always integers
   * (renderer reports are `Math.ceil`'d on intake — Electron's `setBounds` requires
   * integer `Rectangle`s). */
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

  // Hover/click-through/auto-hide poll (10 Hz, i.e. every 100 ms, while needed)
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private outsideSince: number | undefined; // expand -> collapse-on-leave
  private hideOutsideSince: number | undefined; // auto-hide countdown
  private sliverHoverSince: number | undefined; // auto-hide restore countdown
  private autoHideDelayMs = AUTO_HIDE_DELAY_MS;
  private clickThroughIgnoring: boolean | undefined;

  // C1 (fix round 1): the last rect WE requested via setBounds (our own source of
  // truth for change-detection — see setBoundsIfChanged's comment) and the last
  // `setShape` rect actually applied (or computed, on non-win32 where setShape is a
  // no-op), exposed read-only for the e2e seam (`globalThis.__tb.strip.lastShape`).
  private lastRequestedRect: Rect | undefined;
  private lastShapeRect: Rect | undefined;
  private shapeErrorLogged = false;

  // Task 7.1: AppBar reservation state. `appBarSignature` is `display id : edge :
  // content height` for whatever configuration is CURRENTLY reserved (or
  // `undefined` if nothing is) — `syncAppBar` only re-sends ABM_NEW/QUERYPOS/SETPOS
  // when this changes, so a redock triggered by an unrelated store notification (or
  // a 60 Hz drag tick) doesn't hammer `SHAppBarMessage`. `grantedRectDip`/
  // `grantedDisplayId` are the last GRANTED rect (converted to DIPs) and the display
  // it was granted for — `dockBounds` only uses it while docking onto that SAME
  // display (see `redock`'s doc comment on why a stale cross-monitor grant must
  // never be used).
  private appBarSignature: string | undefined;
  private grantedRectDip: Rect | undefined;
  private grantedDisplayId: number | undefined;

  // Task 7.1: strip visibility composes two independent "wants hidden" reasons —
  // the user (hotkey/tray toggle, or `settings.strip.enabled` turning off) and the
  // fullscreen watcher (`setAutoHidden('fullscreen', ...)`), matching the addendum's
  // "visible iff enabled && !userHidden && !fullscreenHidden" ruling. `hidden`
  // (declared above) is a THIRD, unrelated concept — the auto-hide-on-idle sliver —
  // and is intentionally not part of this composition (an auto-hidden sliver is
  // still a "shown" window, just clipped to 4px).
  private manuallyHidden = false;
  private fullscreenHidden = false;
  // Task 6.1 (darwin only, spec Part 5.1 "Zero-pixel mode"/"menu bar mode"): a
  // FOURTH "wants hidden" reason, composed into `applyVisibility` exactly like
  // `fullscreenHidden` — true while `settings.strip.menuBarMode` is on, so the
  // status item's title replaces the strip entirely. Never set on non-darwin
  // (`applySettings`/`create()` only ever touch it inside a `platform ===
  // 'darwin'` check) — `menuBarMode` is otherwise ignored there.
  private menuBarHidden = false;

  constructor(private readonly deps: StripWindowDeps) {
    const snapshot = deps.store.get();
    this.settings = snapshot.data.settings.strip;
    this.size = { width: this.settings.width, height: STRIP_HEIGHT_DEFAULT };
    this.dockedRect = { x: 0, y: 0, width: this.size.width, height: this.size.height };
  }

  /** Task 1.9 needs this to send `strip:state` (and other) events to the strip's
   * renderer. `undefined` before `create()` and after `destroy()`/an external close. */
  get webContents(): WebContents | undefined {
    return this.win?.webContents;
  }

  /** The content rect last clipped to via `setShape` (win32) — or, on platforms
   * where `setShape` is a no-op, the rect that WOULD be applied. Relative to the
   * window's own top-left, not the display. `undefined` before the first bounds
   * application. Read by the e2e seam to verify C1's flush-to-edge fix. */
  get lastShape(): Rect | undefined {
    return this.lastShapeRect;
  }

  /** Task 7.1: the AppBar's last GRANTED rect, in DIPs, for whichever display it was
   * granted on — `undefined` when there is no active reservation (win32 unavailable,
   * `reserveSpace` off, or the reservation failed). Read by e2e/win32.spec.ts to
   * assert the strip docks flush against it. */
  get grantedRect(): Rect | undefined {
    return this.grantedRectDip;
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
      // Task 6.1 (spec Part 5.1 "Window chrome"): the strip is frameless (no
      // traffic lights to begin with), but a `type: 'panel'` window can still
      // surface them if macOS ever decides to draw native window controls for it
      // (e.g. via Mission Control's window switcher chrome) — this is a defensive,
      // no-op-when-there's-nothing-there call, not a fix for an observed bug.
      win.setWindowButtonVisibility(false);
    }
    win.setContentProtection(this.settings.hideFromCapture);
    win.setMenu(null);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());

    // Position correctly (using whatever settings/positions we already have) before
    // the first paint, so there is no flash-then-jump when the window is later shown.
    this.redock();

    void win.loadURL(this.deps.rendererUrl('strip'));

    // Never call show()/focus() — only showInactive(), and only once the renderer has
    // actually painted (Store.subscribe does not replay the current state to a new
    // subscriber, so gating the first show on a store snapshot would mean it never
    // shows at all unless something happens to dispatch first).
    win.webContents.once('did-finish-load', () => {
      if (this.settings.enabled) this.showInactive();
    });

    // Guard against a stale `closed` event: if this window has already been
    // superseded (e.g. `destroy()` ran and a later `create()` made a new one before
    // this listener's queued callback fires), `this.win` no longer points at `win`
    // and this must not tear down the newer window's state.
    win.on('closed', () => {
      if (this.win === win) this.cleanup();
    });

    screen.on('display-added', this.onDisplaysChanged);
    screen.on('display-removed', this.onDisplaysChanged);
    screen.on('display-metrics-changed', this.onDisplaysChanged);

    this.unsubscribeStore = this.deps.store.subscribe((snapshot) => {
      this.applySettings(snapshot.data.settings.strip);
    });

    // Store.subscribe never replays, and click-through/auto-hide are otherwise only
    // ever applied from `applySettings`/`expand` — so a strip that starts already
    // configured with `clickThrough`/`autoHide` (loaded from disk) would show with
    // neither in effect (swallowing no clicks; never hiding) until the next
    // unrelated dispatch. Apply the just-loaded initial settings once, now that the
    // window exists.
    if (this.settings.clickThrough) {
      this.clickThroughIgnoring = true;
      win.setIgnoreMouseEvents(true, { forward: true });
    }
    // Task 6.1: same reasoning as the clickThrough block above — Store.subscribe
    // never replays, so a strip that starts already configured with menu bar mode
    // on (loaded from disk) needs this applied once now, before the first
    // `showInactive()` in the `did-finish-load` handler above runs.
    if (process.platform === 'darwin' && this.settings.menuBarMode) {
      this.menuBarHidden = true;
    }
    this.syncPollTimer();
  }

  destroy(): void {
    const win = this.win;
    this.cleanup();
    if (win && !win.isDestroyed()) {
      win.destroy();
    }
  }

  /** Shared by `destroy()` and the window's own `closed` event (the window can be
   * closed out from under us — e.g. the OS killing it during a display/session
   * change — so this must not assume `destroy()` is the only way out). Idempotent:
   * safe to run twice (once from `destroy()`, once more if `closed` then fires). */
  private cleanup(): void {
    // Task 7.1 ruling 4 ("release on ... strip destroy"): release BEFORE resetting
    // `this.win` below — `releaseAppBar` needs it to get the native window handle.
    this.releaseAppBar();
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
    // Reset per-create transient state so a later create() (if the app ever does
    // that) starts clean rather than inheriting a stale mid-gesture state.
    this.expanded = false;
    this.hidden = false;
    this.pointerInside = false;
    this.outsideSince = undefined;
    this.hideOutsideSince = undefined;
    this.sliverHoverSince = undefined;
    this.autoHideDelayMs = AUTO_HIDE_DELAY_MS;
    this.clickThroughIgnoring = undefined;
    this.panelHeight = DEFAULT_PANEL_HEIGHT;
    this.lastDisplay = undefined;
    this.lastRequestedRect = undefined;
    this.lastShapeRect = undefined;
    this.shapeErrorLogged = false;
    this.manuallyHidden = false;
    this.fullscreenHidden = false;
    this.menuBarHidden = false;
    this.win = undefined;
  }

  // --- visibility ------------------------------------------------------------------
  // Task 7.1: the window's ACTUAL Electron visibility is now a composition of two
  // independent "wants it hidden" reasons (`manuallyHidden`/`fullscreenHidden`),
  // recomputed by `applyVisibility` on every change to either — see the fields'
  // doc comment above.

  showInactive(): void {
    if (!this.win || this.win.isDestroyed()) return;
    this.manuallyHidden = false;
    this.applyVisibility();
  }

  hide(): void {
    if (!this.win || this.win.isDestroyed()) return;
    this.manuallyHidden = true;
    this.applyVisibility();
  }

  toggle(): void {
    if (!this.win || this.win.isDestroyed()) return;
    this.manuallyHidden = !this.manuallyHidden;
    this.applyVisibility();
  }

  isVisible(): boolean {
    if (!this.win || this.win.isDestroyed()) return false;
    return this.win.isVisible();
  }

  /** Task 7.1 addendum ruling 5: composes with the user's own show/hide — hiding for
   * a reason (currently only `'fullscreen'`) never overrides a user-driven hide, and
   * un-hiding for a reason never shows the strip if the user separately hid it (or
   * `settings.strip.enabled` is off): visible iff `enabled && !manuallyHidden &&
   * !fullscreenHidden`. Called by the `FullscreenWatcher` main.ts wires up (never
   * called on non-win32 or when `capabilities.fullscreenDetect` is false — there is
   * no watcher to call it there, so `fullscreenHidden` simply stays false forever). */
  setAutoHidden(reason: 'fullscreen', hidden: boolean): void {
    void reason; // only one reason exists today; kept for a readable call site and future reasons.
    if (!this.win || this.win.isDestroyed()) return;
    if (this.fullscreenHidden === hidden) return;
    this.fullscreenHidden = hidden;
    this.applyVisibility();
  }

  /** Task 6.1 (darwin only): composes with the other "wants hidden" reasons exactly
   * like `setAutoHidden` — called from `applySettings`/`create()` whenever
   * `settings.strip.menuBarMode` changes on darwin (never called at all on any
   * other platform, so `menuBarHidden` simply stays false forever there). */
  private setMenuBarHidden(hidden: boolean): void {
    if (!this.win || this.win.isDestroyed()) return;
    if (this.menuBarHidden === hidden) return;
    this.menuBarHidden = hidden;
    this.applyVisibility();
  }

  private applyVisibility(): void {
    if (!this.win || this.win.isDestroyed()) return;
    const shouldShow = this.settings.enabled && !this.manuallyHidden && !this.fullscreenHidden && !this.menuBarHidden;
    if (shouldShow) {
      this.win.showInactive();
    } else {
      this.win.hide();
    }
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

    const widthChanged = s.width !== prev.width;
    // Fix round 1, finding 9: while NOT collapsed, this.size.width always tracks
    // settings.strip.width — including the moment collapsed flips false→true, when
    // this.size.width is still whatever the pill last reported (stale) and nothing
    // has re-reported yet.
    if (!s.collapsed) {
      this.size = { ...this.size, width: s.width };
    }

    if (!this.win || this.win.isDestroyed()) return;

    if (prev.hideFromCapture !== s.hideFromCapture) {
      this.win.setContentProtection(s.hideFromCapture);
    }

    if (prev.clickThrough !== s.clickThrough) {
      // Apply synchronously rather than waiting for the next poll tick: leaving the
      // old ignore-state in place even one tick longer means a strip that just had
      // click-through turned off keeps swallowing clicks until the poll catches up
      // (or, if the poll was only running *because* of clickThrough, forever).
      this.clickThroughIgnoring = s.clickThrough;
      if (s.clickThrough) {
        this.win.setIgnoreMouseEvents(true, { forward: true });
      } else {
        this.win.setIgnoreMouseEvents(false);
      }
    }

    if (!s.autoHide && this.hidden) {
      this.doAutoRestore();
    }

    if (prev.enabled !== s.enabled) {
      if (s.enabled) {
        this.showInactive();
      } else {
        this.hide();
      }
    }

    // Task 6.1 (darwin only): a later toggle of menu bar mode (settings UI, once it
    // ships) hides/restores the strip the same way `enabled` does above.
    if (process.platform === 'darwin' && prev.menuBarMode !== s.menuBarMode) {
      this.setMenuBarHidden(s.menuBarMode);
    }

    // Only redock when something that actually affects docking changed — NOT on
    // every snapshot (most dispatches are unrelated task/list edits). This also
    // guards the earlier unconditional `this.size.width = s.width`, which used to
    // stomp a renderer-reported collapsed-pill width back to the full strip width
    // on every store notification.
    const dockingRelevantChanged =
      prev.edge !== s.edge ||
      widthChanged ||
      prev.positions !== s.positions ||
      prev.enabled !== s.enabled ||
      prev.collapsed !== s.collapsed ||
      prev.autoHide !== s.autoHide ||
      prev.clickThrough !== s.clickThrough ||
      prev.hideFromCapture !== s.hideFromCapture ||
      // Task 7.1: reserveSpace flipping needs a redock even though nothing else
      // changed — turning it on must claim the AppBar reservation (and dock against
      // the granted rect instead of workArea), turning it off must release it (and
      // fall back to plain workArea docking). `syncAppBar` (called from `redock`)
      // does the actual reserve/release; this only ensures redock() runs at all.
      prev.reserveSpace !== s.reserveSpace;

    if (dockingRelevantChanged) {
      this.redock();
    }

    this.syncPollTimer();
  }

  handleReportedSize(size: { width: number; height: number }): void {
    if (!this.win || this.win.isDestroyed()) return;
    // Electron's `Rectangle` requires integers; round up so the reported content
    // is never clipped by a downward round.
    const width = Math.ceil(size.width);
    const height = Math.ceil(size.height);
    if (this.expanded) {
      // While expanded, the reported height is the WHOLE window height (strip row +
      // panel content); only the width feeds back into the collapsed anchor rect.
      // Fix round 2, open item 2: this branch still adopted the raw reported width
      // even when NOT collapsed — the same nextReportedWidth rule as the collapsed
      // path below applies here too (the pill's content-driven width must never
      // leak into the full strip's width, expanded or not).
      const nextWidth = nextReportedWidth(width, this.settings.collapsed, this.settings.width);
      if (nextWidth !== this.size.width) {
        this.size = { ...this.size, width: nextWidth };
        this.redock();
      }
      this.panelHeight = Math.max(0, height - this.dockedRect.height);
      this.applyVisualBounds();
      return;
    }
    // Fix round 1, finding 9: only adopt the reported WIDTH while collapsed (the
    // pill is content-driven); otherwise width always tracks settings.strip.width,
    // or a stale pill-mode width reported right after un-collapsing would stick
    // forever (see nextCollapsedSize's doc comment in ./displays).
    this.size = nextCollapsedSize({ width, height }, this.settings.collapsed, this.settings.width, MAX_COLLAPSED_HEIGHT);
    this.redock();
  }

  // --- expand / hover ----------------------------------------------------------------

  expand(open: boolean): void {
    if (!this.win || this.win.isDestroyed() || this.hidden) return;
    // A drag interval is driving `dockedRect`/`win`'s bounds at 60 Hz; expanding
    // mid-drag would fight it every tick (and `beginDrag()` already collapses first,
    // so a request to expand while dragging is stale by construction). Collapsing
    // (`open === false`) is still allowed — `beginDrag()` itself relies on it.
    if (open && this.dragTimer) return;
    if (this.expanded === open) return;
    this.expanded = open;
    this.outsideSince = undefined;
    if (open) this.panelHeight = DEFAULT_PANEL_HEIGHT;
    this.applyVisualBounds();
    this.syncPollTimer();
    this.emitState();
  }

  hover(inside: boolean): void {
    if (!this.win || this.win.isDestroyed()) return;
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
    // An expanded panel must not get dragged around (and must not have its drag
    // ticks shrink it back to the collapsed strip's width/anchor mid-gesture):
    // collapse first, synchronously, before the drag interval starts.
    if (this.expanded) this.expand(false);
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
    if (!this.win || this.win.isDestroyed()) return;
    const d = this.lastDisplay ?? this.currentDisplay();
    this.persistDock(d);
    // Task 7.1: a drag can end on a different display than it started on, and drag
    // ticks themselves never reserve/re-reserve (60 Hz is far too hot a path for
    // `SHAppBarMessage`) — `redock()` here picks the reservation back up (or moves
    // it) for wherever the strip actually landed. A no-op when reserveSpace is off.
    this.redock();
  }

  // --- internals: docking ----------------------------------------------------------

  private currentDisplay(): DisplayLike {
    if (this.win && !this.win.isDestroyed()) {
      return screen.getDisplayMatching(this.win.getBounds());
    }
    return screen.getPrimaryDisplay();
  }

  /** The display whose `workArea` the sliver math should use "right now": the last
   * one we actually docked/dragged onto, falling back to a fresh lookup only if we
   * somehow don't have one yet (shouldn't happen once `create()` has run). The
   * sliver sits flush to the WORK AREA edge (see `sliverBounds`'s doc comment), not
   * the display's physical bounds — a normal taskbar occupies the gap between the
   * two, and a sliver at the physical edge would land inside it. */
  private currentWorkArea(): Rect {
    return (this.lastDisplay ?? this.currentDisplay()).workArea;
  }

  private redock(): void {
    // A drag interval is the source of truth for `dockedRect` while it's running
    // (60 Hz, tracking the live cursor); a redock triggered by a store notification
    // or a display event mid-drag would snap the strip back to its pre-drag/restored
    // position and fight the drag on every tick.
    if (!this.win || this.win.isDestroyed() || this.dragTimer) return;
    const d = this.currentDisplay();
    this.lastDisplay = d;
    this.syncAppBar(d);
    const auto = isTaskbarAutoHide(d, this.settings.edge);
    const remembered = restorePosition(this.settings.positions, d);
    // Task 7.1: only use the granted rect while docking onto the SAME display it was
    // granted for — `syncAppBar` releases/re-reserves as soon as the display used to
    // compute a NEW grant changes, but there is a one-redock window (e.g. right
    // after `onDisplaysChanged` fires) where `grantedRectDip` could still be a
    // moment stale; comparing display ids here is what actually prevents ever
    // docking against another display's granted rect.
    const grantedDip = this.grantedDisplayId === d.id ? this.grantedRectDip : undefined;
    this.dockedRect = dockBounds(d, this.settings.edge, this.size, remembered?.x, auto, grantedDip);
    this.applyVisualBounds();
  }

  /** Task 7.1 ruling 4: claims (or releases) the AppBar reservation for the CURRENT
   * `settings.reserveSpace`/`settings.enabled`/edge/display/content-height, and
   * records the granted rect (converted to DIPs) for `redock` to dock against.
   * Cheap to call on every `redock()` — it only actually talks to
   * `SHAppBarMessage` when the "reserve for exactly this configuration" signature
   * changes, so an unrelated redock (a different display's `display-metrics-changed`
   * event, say) is a no-op. */
  private syncAppBar(d: DisplayLike): void {
    if (!this.win || this.win.isDestroyed()) return;
    const w32 = this.deps.win32;
    const wantReserve = !!w32 && this.settings.enabled && this.settings.reserveSpace;
    if (!wantReserve) {
      this.releaseAppBar();
      return;
    }
    const sig = `${d.id}:${this.settings.edge}:${this.size.height}`;
    if (this.appBarSignature === sig) return;
    const rectPx = appBarRect(d, this.settings.edge, this.size.height);
    let result: { granted: RectPx } | undefined;
    try {
      result = w32!.appBar.reserve(this.win.getNativeWindowHandle(), this.settings.edge, rectPx);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('StripWindow: AppBar reserve failed; docking against the plain work area instead', err);
      result = undefined;
    }
    if (result) {
      // Only remember the signature on SUCCESS: a failed first-time registration
      // (ABM_NEW) must be retried on the next redock rather than permanently giving
      // up until something else (edge/display/height) happens to change the
      // signature. A hwnd that is already registered cannot fail this way — appbar.ts
      // only ever skips re-registering, never re-fails, once ABM_NEW has succeeded
      // once — so this only matters for that very first reservation attempt.
      this.appBarSignature = sig;
      this.grantedRectDip = rectPxToDip(result.granted, d.scaleFactor);
      this.grantedDisplayId = d.id;
    } else {
      this.grantedRectDip = undefined;
      this.grantedDisplayId = undefined;
    }
  }

  /** Task 7.1: releases any active AppBar reservation (idempotent — safe to call
   * whether or not one is currently held). Called from `syncAppBar` whenever
   * reservation is no longer wanted, from `cleanup()` (window destroy), and from
   * the public `releaseAppBarReservation()` main.ts calls on `before-quit`. */
  private releaseAppBar(): void {
    if (this.appBarSignature === undefined) return;
    const w32 = this.deps.win32;
    if (w32 && this.win && !this.win.isDestroyed()) {
      try {
        w32.appBar.release(this.win.getNativeWindowHandle());
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('StripWindow: AppBar release failed', err);
      }
    }
    this.appBarSignature = undefined;
    this.grantedRectDip = undefined;
    this.grantedDisplayId = undefined;
  }

  /** Task 7.1: the raw native window handle (win32 HWND, as Electron encodes it) —
   * used by main's `FullscreenWatcher` wiring to exclude the strip from "is some
   * OTHER app fullscreen" detection. `undefined` before `create()`/after
   * `destroy()`. Harmless (and never called) on non-win32. */
  nativeWindowHandle(): Buffer | undefined {
    if (!this.win || this.win.isDestroyed()) return undefined;
    return this.win.getNativeWindowHandle();
  }

  /** Task 7.1 ruling 4 ("release on ... app quit"): releases any active AppBar
   * reservation WITHOUT touching the rest of the window's lifecycle. `main.ts` calls
   * this synchronously at the start of its `before-quit` handler, before the
   * (asynchronous) store flush — `SHAppBarMessage(ABM_REMOVE)` is synchronous, so
   * the OS's own work-area bookkeeping is restored immediately, even if the process
   * then takes a moment to actually exit. A reservation left behind would otherwise
   * shrink the user's desktop work area until their next logout — see the e2e
   * safety note in e2e/win32.spec.ts. */
  releaseAppBarReservation(): void {
    this.releaseAppBar();
  }

  private applyVisualBounds(): void {
    if (!this.win || this.win.isDestroyed()) return;
    const rect = this.hidden
      ? sliverBounds(this.dockedRect, this.settings.edge, this.currentWorkArea())
      : this.expanded
        ? panelBounds(this.dockedRect, this.settings.edge, this.panelHeight)
        : this.dockedRect;
    this.setBoundsIfChanged(rect);
  }

  /** Every `setBounds` call (docked, expanded, sliver, or a live drag tick) routes
   * through here. C1 (fix round 1): dedup against `lastRequestedRect` — OUR own
   * record of what we last asked for — rather than `win.getBounds()`, because on
   * Windows the actual bounds can permanently differ from the requested ones (see
   * `reanchorAndClip`); comparing against actual bounds would defeat the dedup
   * (every call would look "changed" forever) and re-trigger a native `setBounds`
   * on every redock/drag tick even when nothing conceptually moved. */
  private setBoundsIfChanged(rect: Rect): void {
    if (!this.win || this.win.isDestroyed()) return;
    const unchanged =
      this.lastRequestedRect !== undefined &&
      this.lastRequestedRect.x === rect.x &&
      this.lastRequestedRect.y === rect.y &&
      this.lastRequestedRect.width === rect.width &&
      this.lastRequestedRect.height === rect.height;
    this.lastRequestedRect = rect;
    if (!unchanged) {
      this.win.setBounds(rect, false);
    }
    this.reanchorAndClip(rect);
  }

  /** C1 (fix round 1): on Windows, a transparent frameless `BrowserWindow` cannot be
   * shorter than ~39 DIP regardless of the requested height (verified by the
   * controller) — `setBounds({height: 32}, ...)` silently becomes `{height: 39}`.
   * Left uncorrected, the extra height was added BELOW a bottom-docked strip's `y`,
   * sitting the window (and, before this fix, its content) up to 7 px into the
   * taskbar instead of flush against the work area.
   *
   * Run after every `setBounds` (via `setBoundsIfChanged`, its only caller): reads
   * the ACTUAL resulting bounds; if the actual height differs from what was
   * requested, re-anchors via `reanchorY` so the requested content still sits flush
   * against the REQUESTED rect's own docked edge (fix round 2, open item 3: anchoring
   * to the raw work-area edge instead, as the first cut of this fix did, silently
   * discarded `dockBounds`'s deliberate 2 px "taskbar auto-hide" reserve baked into
   * `requested.y` — the always-on-top strip then covered the taskbar's reveal row,
   * off by the same 2 px `handleRect(dockedRect)` uses for hit-testing) — the window
   * is allowed to extend away from the edge into the desktop, never past the work
   * area on the docked side. Then (win32 only) clips hit-testing/paint down to the
   * requested content rect with `setShape`, so the extra, otherwise-invisible-but-
   * still-click-capturing window area (Electron transparent windows still capture
   * clicks in transparent pixels) never intercepts anything. `lastShapeRect` is
   * recorded on every platform (even where `setShape` is a no-op) so the e2e seam
   * can assert it. */
  private reanchorAndClip(requested: Rect): void {
    if (!this.win || this.win.isDestroyed()) return;
    let actual = this.win.getBounds();

    if (actual.height !== requested.height) {
      const correctedY = reanchorY(requested.y, requested.height, actual.height, this.settings.edge);
      if (actual.x !== requested.x || actual.y !== correctedY) {
        this.win.setBounds({ x: requested.x, y: correctedY, width: actual.width, height: actual.height }, false);
        actual = this.win.getBounds();
      }
    }

    const shape: Rect =
      requested.height >= actual.height
        ? { x: 0, y: 0, width: actual.width, height: actual.height }
        : this.settings.edge === 'top'
          ? { x: 0, y: 0, width: actual.width, height: requested.height }
          : { x: 0, y: actual.height - requested.height, width: actual.width, height: requested.height };

    const shapeChanged =
      !this.lastShapeRect ||
      this.lastShapeRect.x !== shape.x ||
      this.lastShapeRect.y !== shape.y ||
      this.lastShapeRect.width !== shape.width ||
      this.lastShapeRect.height !== shape.height;

    this.lastShapeRect = shape;
    if (shapeChanged && process.platform === 'win32') {
      try {
        this.win.setShape([shape]);
      } catch (err) {
        if (!this.shapeErrorLogged) {
          this.shapeErrorLogged = true;
          // eslint-disable-next-line no-console
          console.error('StripWindow: setShape failed; falling back to no clipping', err);
        }
      }
    }
  }

  private persistDock(d: DisplayLike): void {
    // Stored under both the stable id AND the resolution+scale signature, so
    // `restorePosition` can still find this display's remembered spot after an id
    // reassignment (driver update / reconnect) — see `displays.ts`.
    const entry = { x: this.dockedRect.x, y: this.dockedRect.y };
    const positions = {
      ...this.settings.positions,
      [displayKey(d)]: entry,
      [displaySignature(d)]: entry
    };
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
    this.setBoundsIfChanged(this.dockedRect);
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

    const sliver = sliverBounds(this.dockedRect, this.settings.edge, this.currentWorkArea());
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
