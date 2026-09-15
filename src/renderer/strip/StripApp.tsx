// renderer/strip/StripApp — the strip window's root component. Owns the snapshot,
// the strip:state (expanded/hidden) event, hover/drag gesture detection, the
// ResizeObserver that reports content size to main, and completion feedback. See
// .superpowers/sdd/PLAN/task-1.8-1.9-brief.md Part B "Strip".
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEventHandler } from 'react';
import { INBOX_ID } from '../../core/defaults';
import { isSnoozed } from '../../core/select';
import type { Task } from '../../core/types';
import { keyGlyphs } from '../../shared/platform';
import type { Snapshot } from '../../shared/ipc';
import { fmtClock, fmtDuration } from '../lib/format';
import { useDisplayTime } from '../lib/useDisplayTime';
import { dispatch, useSnapshot } from '../lib/useStore';
import { useApplyTheme } from '../theme/ThemeProvider';
import { Panel } from './Panel';
import { Pill } from './Pill';
import { Strip } from './Strip';
import type { StripChip } from './Strip';

const HOVER_STATIONARY_MS = 150;
const HOVER_MOVE_TOLERANCE_PX = 4;
const DRAG_MOVE_PX = 6;
const DRAG_MOVE_MS = 200;
const COMPLETION_HOLD_MS = 1200;
const UNDO_ROW_MS = 5000;

interface StripView {
  state: string;
  title: string;
  dim?: string;
  titleAllDim?: boolean;
  strike?: boolean;
  chip?: StripChip;
  progress?: number;
}

function sumTodayFocusSeconds(tasks: Task[]): number {
  return tasks.filter((t) => t.today && t.status === 'done').reduce((sum, t) => sum + (t.timer?.spentSeconds ?? 0), 0);
}

function computeView(snapshot: Snapshot, display: ReturnType<typeof useDisplayTime>, captureHint: string): StripView {
  const { today, data } = snapshot;
  const now = Date.now();

  if (!today.current) {
    return { state: 'empty', title: captureHint, titleAllDim: true };
  }

  if (today.total > 0 && today.done === today.total) {
    const focusSeconds = sumTodayFocusSeconds(data.tasks);
    return {
      state: 'done',
      title: 'Done for today',
      dim: ` · ${today.done} of ${today.total}`,
      chip: { text: fmtDuration(focusSeconds) },
      progress: 1
    };
  }

  const progress = today.total > 0 ? today.done / today.total : undefined;

  if (today.unplanned) {
    const inboxOpenCount = data.tasks.filter(
      (t) => t.status === 'open' && t.parentId === undefined && !isSnoozed(t, now) && t.listId === INBOX_ID
    ).length;
    return {
      state: 'unplanned',
      title: today.current.title,
      dim: ' · Inbox',
      chip: { text: `Plan today · ${inboxOpenCount}`, variant: 'plan', onClick: () => void window.tb.invoke('palette:show', 'plan') },
      progress
    };
  }

  const timer = today.current.timer;
  if (!timer) {
    return { state: 'idle', title: today.current.title, progress };
  }

  const running = timer.runningSince !== undefined;
  if (running) {
    return {
      state: display.overtime ? 'overtime' : 'running',
      title: today.current.title,
      chip: { text: fmtClock(display.seconds), variant: display.overtime ? 'overtime' : undefined },
      progress
    };
  }

  if (timer.plannedSeconds !== undefined && timer.spentSeconds > 0) {
    return {
      state: 'paused',
      title: today.current.title,
      chip: { text: `‖ ${fmtClock(display.seconds)}`, variant: 'paused' },
      progress
    };
  }

  return { state: 'idle', title: today.current.title, progress };
}

function tomorrowNineAm(): number {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}

export function StripApp() {
  const snapshot = useSnapshot();
  const [stripState, setStripState] = useState<{ expanded: boolean; hidden: boolean }>({ expanded: false, hidden: false });
  const [completing, setCompleting] = useState<{ title: string } | undefined>(undefined);
  const [showUndoRow, setShowUndoRow] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const prevCurrentRef = useRef<Task | undefined>(undefined);
  const completingTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const undoRowTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const lastUndoRevRef = useRef<number | undefined>(undefined);

  const hoverTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const hoverStartPointRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const dragStartRef = useRef<{ x: number; y: number; t: number; started: boolean } | undefined>(undefined);

  const display = useDisplayTime(snapshot?.today.current?.timer);
  useApplyTheme(snapshot);

  // --- strip:state (expanded/hidden) --------------------------------------------
  useEffect(() => {
    return window.tb.on('strip:state', setStripState);
  }, []);

  // --- reduced motion: fold prefers-reduced-motion + the in-app setting ----------
  useEffect(() => {
    const setting = snapshot?.data.settings.reducedMotion ?? 'system';
    const systemReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const reduced = setting === 'on' || (setting === 'system' && systemReduced);
    document.body.dataset.reducedMotion = String(reduced);
  }, [snapshot?.data.settings.reducedMotion]);

  // --- ResizeObserver: report content size to main --------------------------------
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (stripState.hidden) return; // the sliver's size must never overwrite the docked size
      const rect = el.getBoundingClientRect();
      void window.tb.invoke('strip:reportSize', { width: Math.ceil(rect.width), height: Math.ceil(rect.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
    // Re-observe whenever the rendered mode changes (Strip/Panel/Pill/Sliver swap the
    // DOM node under `rootRef`); by the time this effect runs the ref already points
    // at the new node (refs commit before effects run).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stripState.expanded, stripState.hidden, snapshot?.data.settings.strip.collapsed]);

  // --- completion feedback: strike + "Undo" for 1.2s, then swap ------------------
  useEffect(() => {
    if (!snapshot) return;
    const prev = prevCurrentRef.current;
    const currentId = snapshot.today.current?.id;
    if (prev && prev.id !== currentId) {
      const updated = snapshot.data.tasks.find((t) => t.id === prev.id);
      if (updated?.status === 'done') {
        setCompleting({ title: prev.title });
        clearTimeout(completingTimeoutRef.current);
        completingTimeoutRef.current = setTimeout(() => setCompleting(undefined), COMPLETION_HOLD_MS);
      }
    }
    prevCurrentRef.current = snapshot.today.current;
  }, [snapshot]);

  useEffect(() => () => clearTimeout(completingTimeoutRef.current), []);

  // --- panel undo row: 5s after it first sees a new lastUndo.rev (C2, fix round 1) --
  useEffect(() => {
    if (!snapshot?.lastUndo) return;
    if (snapshot.lastUndo.rev === lastUndoRevRef.current) return;
    lastUndoRevRef.current = snapshot.lastUndo.rev;
    setShowUndoRow(true);
    clearTimeout(undoRowTimeoutRef.current);
    undoRowTimeoutRef.current = setTimeout(() => setShowUndoRow(false), UNDO_ROW_MS);
  }, [snapshot?.lastUndo]);

  useEffect(() => () => clearTimeout(undoRowTimeoutRef.current), []);

  // --- hover-to-expand: 150ms stationary within 4px ------------------------------
  const onMouseMove: MouseEventHandler = (e) => {
    const point = { x: e.clientX, y: e.clientY };
    const start = hoverStartPointRef.current;
    if (!start) {
      hoverStartPointRef.current = point;
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = setTimeout(() => {
        void window.tb.invoke('strip:expand', true);
      }, HOVER_STATIONARY_MS);
      return;
    }
    const moved = Math.hypot(point.x - start.x, point.y - start.y);
    if (moved >= HOVER_MOVE_TOLERANCE_PX) {
      hoverStartPointRef.current = point;
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = setTimeout(() => {
        void window.tb.invoke('strip:expand', true);
      }, HOVER_STATIONARY_MS);
    }
  };

  const onMouseEnter = (): void => {
    void window.tb.invoke('strip:hover', true);
  };

  const onMouseLeave = (): void => {
    clearTimeout(hoverTimerRef.current);
    hoverStartPointRef.current = undefined;
    void window.tb.invoke('strip:hover', false);
  };

  // --- drag: 6px / 200ms, or any movement while the handle is held ---------------
  const onHandleMouseDown: MouseEventHandler = (e) => {
    dragStartRef.current = { x: e.clientX, y: e.clientY, t: Date.now(), started: false };
  };

  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      const drag = dragStartRef.current;
      if (!drag || drag.started) return;
      const moved = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
      const elapsed = Date.now() - drag.t;
      if (moved >= DRAG_MOVE_PX && elapsed <= DRAG_MOVE_MS) {
        drag.started = true;
        void window.tb.invoke('strip:dragStart');
      }
    };
    const onUp = (): void => {
      const drag = dragStartRef.current;
      if (drag?.started) {
        void window.tb.invoke('strip:dragEnd');
      }
      dragStartRef.current = undefined;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const onTitleClick = (): void => {
    void window.tb.invoke('strip:expand', !stripState.expanded);
  };

  const onTitleDoubleClick = (): void => {
    void window.tb.invoke('planner:show');
  };

  const platform = snapshot?.platform ?? 'win32';
  const captureAccelerator = snapshot?.data.settings.hotkeys.capture ?? 'Control+Alt+Space';
  const captureHint = useMemo(() => {
    const glyphs = keyGlyphs(captureAccelerator, platform).join(platform === 'darwin' ? '' : '+');
    return `Nothing yet · ${glyphs} to add a task`;
  }, [captureAccelerator, platform]);

  const undoGlyphs = useMemo(
    () => keyGlyphs(snapshot?.data.settings.hotkeys.undo ?? 'Control+Alt+Backspace', platform).join(platform === 'darwin' ? '' : '+'),
    [snapshot?.data.settings.hotkeys.undo, platform]
  );

  if (!snapshot) return null;

  const edge = snapshot.data.settings.strip.edge;

  const view: StripView = completing
    ? { state: 'done', title: completing.title, strike: true, chip: { text: 'Undo', onClick: () => onUndo() } }
    : computeView(snapshot, display, captureHint);

  const titleText = view.titleAllDim ? '' : view.title;
  const dimText = view.titleAllDim ? view.title : view.dim;

  function onUndo(): void {
    setCompleting(undefined);
    clearTimeout(completingTimeoutRef.current);
    void window.tb.invoke('store:undo');
  }

  function onMakeCurrent(id: string): void {
    dispatch({ type: 'task/makeCurrent', id });
  }
  function onComplete(id: string): void {
    dispatch({ type: 'task/complete', id, by: 'user' });
  }
  function onSkip(id: string): void {
    dispatch({ type: 'task/skip', id });
  }
  function onSnooze(id: string): void {
    dispatch({ type: 'task/snooze', id, until: tomorrowNineAm() });
  }

  if (stripState.hidden) {
    return <div ref={rootRef} className="sliver" />;
  }

  if (stripState.expanded) {
    const stripElement = (
      <Strip
        state={view.state}
        edge={edge}
        title={titleText}
        dim={dimText}
        strike={view.strike}
        chip={view.chip}
        progress={view.progress}
        onHandleMouseDown={onHandleMouseDown}
        onMouseMove={onMouseMove}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onTitleClick={onTitleClick}
        onTitleDoubleClick={onTitleDoubleClick}
      />
    );
    return (
      <Panel
        ref={rootRef}
        snapshot={snapshot}
        edge={edge}
        stripElement={stripElement}
        showUndo={showUndoRow}
        onUndo={() => {
          // Hide immediately rather than waiting on the round-trip: store.undo()
          // clears Snapshot.lastUndo, but the effect above only reacts to a NEW rev.
          setShowUndoRow(false);
          void window.tb.invoke('store:undo');
        }}
        undoGlyphs={undoGlyphs}
        onMakeCurrent={onMakeCurrent}
        onComplete={onComplete}
        onSkip={onSkip}
        onSnooze={onSnooze}
      />
    );
  }

  if (snapshot.data.settings.strip.collapsed) {
    return <Pill ref={rootRef} title={titleText || view.title} display={display} />;
  }

  return (
    <Strip
      ref={rootRef}
      state={view.state}
      edge={edge}
      title={titleText}
      dim={dimText}
      strike={view.strike}
      chip={view.chip}
      progress={view.progress}
      clickThrough={snapshot.data.settings.strip.clickThrough}
      onHandleMouseDown={onHandleMouseDown}
      onMouseMove={onMouseMove}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onTitleClick={onTitleClick}
      onTitleDoubleClick={onTitleDoubleClick}
    />
  );
}
