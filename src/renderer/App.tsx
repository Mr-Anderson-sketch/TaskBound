import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { Task } from '../shared/types';
import { completedToday, isDone, summarizeDay, toLocalDateKey } from '../shared/stateHelpers';
import { useAppStore } from './store/state';
import { native, platform, type FocusLayout } from './native';
import { parseCsv, parseTaskLines, type ParsedTask } from './utils/parse';
import { playChime, primeAudio } from './utils/chime';
import { AddBar, Header, NowCard, SummaryPopover, remainingOf } from './components/MainParts';
import { TaskList, PopupMenu, type MenuItem } from './components/TaskList';
import { AddTimeSheet, BulkSheet, ConfirmSheet, ShortcutsSheet, TaskSheet } from './components/Sheets';
import { FOCUS_EXTRA_HEIGHT, FocusWidget } from './components/FocusWidget';

const QUICK_ADD_HOTKEY = 'CommandOrControl+Shift+Space';
const FIVE_MINUTES = 5 * 60;
const SHELL_RADIUS = 22;

type SheetState =
  | { kind: 'task'; mode: 'create' | 'edit'; task?: Task; requireTime: boolean }
  | { kind: 'addTime'; task: Task }
  | { kind: 'bulk' }
  | { kind: 'shortcuts' }
  | { kind: 'confirm'; title: string; body: string; confirmLabel: string; onConfirm: () => void }
  | null;

interface Toast {
  id: number;
  title: string;
  body?: string;
  actions?: Array<{ label: string; onClick: () => void }>;
}

interface TimeUp {
  taskId: string;
  title: string;
}

const isTyping = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
};

export default function App() {
  const store = useAppStore();
  const { state, hydrated, loadFailed } = store;
  const theme = state.preferences.theme;

  const [mode, setMode] = useState<'main' | 'focus'>('main');
  const [focusLayout, setFocusLayout] = useState<FocusLayout | null>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: Array<MenuItem | 'sep'> } | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [timeUp, setTimeUp] = useState<TimeUp | null>(null);
  const [forceFocusOpen, setForceFocusOpen] = useState(false);
  const addInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toastId = useRef(0);
  const focusExpandedRef = useRef(false);
  const ignoreMovesUntil = useRef(0);
  const userMovedFocus = useRef(false);
  const prevStatuses = useRef<Map<string, Task['status']> | null>(null);
  const trayKey = useRef('');

  // ---------- derived ----------
  const openTasks = useMemo(() => state.tasks.filter((task) => !isDone(task)), [state.tasks]);
  const activeTask = openTasks[0];
  const upNext = useMemo(() => openTasks.slice(1), [openTasks]);
  const doneToday = useMemo(() => {
    const today = toLocalDateKey(new Date());
    return state.tasks
      .filter((task) => isDone(task) && task.completedAt && toLocalDateKey(new Date(task.completedAt)) === today)
      .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  }, [state.tasks]);
  const doneIds = useMemo(() => state.tasks.filter(isDone).map((task) => task.id), [state.tasks]);
  const requireTime = useMemo(
    () => !openTasks.some((task) => (task.remainingSeconds ?? task.timeAssignedSeconds ?? 0) > 0),
    [openTasks]
  );
  const { time, total, fraction } = remainingOf(activeTask);
  const activeHasTime = (activeTask?.timeAssignedSeconds ?? 0) > 0;
  const today = completedToday(state);

  // ---------- toasts ----------
  const pushToast = useCallback((toast: Omit<Toast, 'id'>, ms = 3500) => {
    toastId.current += 1;
    const id = toastId.current;
    setToasts((list) => [...list.slice(-2), { ...toast, id }]);
    window.setTimeout(() => setToasts((list) => list.filter((item) => item.id !== id)), ms);
  }, []);

  // ---------- theme & platform ----------
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.platform = platform;
  }, [theme]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    const radius = mode === 'focus' ? (theme === 'light' ? 26 : 0) : SHELL_RADIUS;
    native.setThemeEffects(theme, mode, radius).catch((error) => console.error('Theme effects failed', error));
  }, [theme, mode, hydrated]);

  useEffect(() => {
    document.body.classList.toggle('focus-mode', mode === 'focus');
  }, [mode]);

  const alwaysOnTopPref = state.preferences.alwaysOnTop;
  useEffect(() => {
    if (hydrated) {
      native.setAlwaysOnTop(alwaysOnTopPref).catch(() => undefined);
    }
  }, [hydrated, alwaysOnTopPref]);

  useEffect(() => {
    const prime = () => primeAudio();
    window.addEventListener('pointerdown', prime, { once: true });
    return () => window.removeEventListener('pointerdown', prime);
  }, []);

  useEffect(() => {
    if (loadFailed) {
      pushToast({ title: 'Couldn’t read your saved tasks.', body: 'Changes won’t be saved until TimeBound restarts.' }, 15000);
    }
  }, [loadFailed, pushToast]);

  // ---------- time's up ----------
  useEffect(() => {
    if (!hydrated) {
      return;
    }
    const previous = prevStatuses.current;
    const next = new Map(state.tasks.map((task) => [task.id, task.status]));
    prevStatuses.current = next;
    if (!previous) {
      return;
    }
    const expired = state.tasks.find((task) => task.status === 'struck' && previous.get(task.id) !== undefined && previous.get(task.id) !== 'struck');
    if (!expired) {
      return;
    }
    const last = expired.history[expired.history.length - 1];
    if (last?.type !== 'auto_complete') {
      return;
    }
    setTimeUp({ taskId: expired.id, title: expired.title });
    playChime();
    const nextTask = state.tasks.find((task) => !isDone(task));
    native.notify('Time’s up', nextTask ? `${expired.title} · next: ${nextTask.title}` : expired.title).catch(() => undefined);
  }, [state.tasks, hydrated]);

  useEffect(() => {
    if (!timeUp) {
      return;
    }
    const id = window.setTimeout(() => setTimeUp(null), 30000);
    return () => window.clearTimeout(id);
  }, [timeUp]);

  const timeUpAddFive = useCallback(() => {
    if (timeUp) {
      store.reopenWithTime(timeUp.taskId, FIVE_MINUTES);
      setTimeUp(null);
    }
  }, [timeUp, store]);

  // ---------- task actions ----------
  const togglePause = useCallback(() => {
    if (!activeTask || !activeHasTime) {
      return;
    }
    if (activeTask.isPaused) {
      store.resumeTask(activeTask.id);
    } else {
      store.pauseTask(activeTask.id);
    }
  }, [activeTask, activeHasTime, store]);

  const completeActive = useCallback(() => {
    if (activeTask) {
      store.completeActiveTask();
      setTimeUp(null);
    }
  }, [activeTask, store]);

  const addFive = useCallback(() => {
    if (!activeTask) {
      return;
    }
    store.addTime(activeTask.id, FIVE_MINUTES);
    if ((activeTask.timeAssignedSeconds ?? 0) > 0 && mode === 'main') {
      pushToast({ title: 'Added 5 minutes · −1 point' });
    }
  }, [activeTask, store, mode, pushToast]);

  const addTasks = useCallback(
    (tasks: ParsedTask[], source: string) => {
      if (tasks.length === 0) {
        pushToast({ title: `No tasks found in ${source}.` });
        return;
      }
      tasks.forEach((task) => store.addTask(task.title, task.seconds));
      pushToast({ title: `Added ${tasks.length} task${tasks.length === 1 ? '' : 's'}` });
    },
    [store, pushToast]
  );

  const orderWith = useCallback(
    (openOrder: string[]) => store.reorderTasks([...openOrder, ...doneIds]),
    [store, doneIds]
  );

  const startNow = useCallback(
    (task: Task) => orderWith([task.id, ...openTasks.filter((other) => other.id !== task.id).map((other) => other.id)]),
    [orderWith, openTasks]
  );

  const doNext = useCallback(
    (task: Task) => {
      if (!activeTask) {
        return;
      }
      const rest = openTasks.filter((other) => other.id !== task.id && other.id !== activeTask.id).map((other) => other.id);
      orderWith([activeTask.id, task.id, ...rest]);
    },
    [orderWith, openTasks, activeTask]
  );

  const deleteWithConfirm = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) {
        return;
      }
      const clear = () => {
        store.deleteTasks(ids);
        setSelectedIds(new Set());
      };
      if (ids.length === 1) {
        clear();
        return;
      }
      setSheet({ kind: 'confirm', title: `Delete ${ids.length} tasks?`, body: 'This can’t be undone.', confirmLabel: `Delete ${ids.length}`, onConfirm: clear });
    },
    [store]
  );

  // ---------- selection ----------
  const listOrder = useMemo(() => [...upNext, ...doneToday].map((task) => task.id), [upNext, doneToday]);

  const handleSelect = useCallback(
    (task: Task, event: ReactMouseEvent) => {
      if (event.shiftKey && anchorId) {
        const a = listOrder.indexOf(anchorId);
        const b = listOrder.indexOf(task.id);
        if (a !== -1 && b !== -1) {
          setSelectedIds(new Set(listOrder.slice(Math.min(a, b), Math.max(a, b) + 1)));
          return;
        }
      }
      if (event.metaKey || event.ctrlKey) {
        setSelectedIds((current) => {
          const next = new Set(current);
          if (next.has(task.id)) {
            next.delete(task.id);
          } else {
            next.add(task.id);
          }
          return next;
        });
      } else {
        setSelectedIds((current) => (current.size === 1 && current.has(task.id) ? new Set() : new Set([task.id])));
      }
      setAnchorId(task.id);
    },
    [anchorId, listOrder]
  );

  useEffect(() => {
    setSelectedIds((current) => {
      const alive = new Set([...current].filter((id) => state.tasks.some((task) => task.id === id)));
      return alive.size === current.size ? current : alive;
    });
  }, [state.tasks]);

  const openEdit = useCallback(
    (task: Task) => setSheet({ kind: 'task', mode: 'edit', task, requireTime: false }),
    []
  );

  const handleRowMenu = useCallback(
    (task: Task, x: number, y: number) => {
      const multi = selectedIds.size > 1 && selectedIds.has(task.id);
      if (multi) {
        setMenu({ x, y, items: [{ label: `Delete ${selectedIds.size} tasks`, danger: true, onClick: () => deleteWithConfirm([...selectedIds]) }] });
        return;
      }
      const done = isDone(task);
      const items: Array<MenuItem | 'sep'> = done
        ? [
            { label: 'Edit…', onClick: () => openEdit(task) },
            'sep',
            { label: 'Delete', danger: true, onClick: () => deleteWithConfirm([task.id]) }
          ]
        : [
            { label: 'Start now', onClick: () => startNow(task) },
            { label: 'Do next', onClick: () => doNext(task), disabled: upNext[0]?.id === task.id },
            'sep',
            { label: 'Edit…', onClick: () => openEdit(task) },
            { label: 'Add time…', onClick: () => setSheet({ kind: 'addTime', task }), disabled: !(task.timeAssignedSeconds ?? 0) },
            'sep',
            { label: 'Delete', danger: true, onClick: () => deleteWithConfirm([task.id]) }
          ];
      setMenu({ x, y, items });
    },
    [selectedIds, deleteWithConfirm, openEdit, startNow, doNext, upNext]
  );

  // ---------- focus mode ----------
  const moveGuard = () => {
    ignoreMovesUntil.current = Date.now() + 900;
  };

  const enterFocus = useCallback(async () => {
    setMenu(null);
    setSheet(null);
    setShowSummary(false);
    moveGuard();
    try {
      const layout = await native.enterFocusMode(theme, state.preferences.focusPositions?.[theme]);
      focusExpandedRef.current = false;
      userMovedFocus.current = false;
      setFocusLayout(layout);
      setMode('focus');
    } catch (error) {
      console.error('Failed to enter focus mode', error);
      pushToast({ title: 'Couldn’t start focus mode.' });
    }
  }, [theme, state.preferences.focusPositions, pushToast]);

  const exitFocus = useCallback(async () => {
    moveGuard();
    try {
      if (userMovedFocus.current) {
        const position = await native.getFocusPosition();
        if (position) {
          store.setFocusPosition(theme, position);
        }
      }
      userMovedFocus.current = false;
      await native.exitFocusMode(state.preferences.alwaysOnTop);
    } catch (error) {
      console.error('Failed to exit focus mode', error);
    }
    setMode('main');
    setFocusLayout(null);
  }, [state.preferences.alwaysOnTop, store, theme]);

  const setFocusExpanded = useCallback(
    async (expanded: boolean) => {
      moveGuard();
      focusExpandedRef.current = expanded;
      const layout = await native.setFocusExpanded(expanded, FOCUS_EXTRA_HEIGHT[theme]);
      setFocusLayout(layout);
    },
    [theme]
  );

  // Only a position the user chose by dragging is remembered; our own resizes/moves are ignored.
  useEffect(() => {
    if (mode !== 'focus') {
      return;
    }
    let unlisten: (() => void) | undefined;
    let disposed = false;
    native
      .onMoved(() => {
        if (Date.now() >= ignoreMovesUntil.current) {
          userMovedFocus.current = true;
        }
      })
      .then((fn) => {
        if (disposed) {
          fn();
        } else {
          unlisten = fn;
        }
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [mode]);

  // ---------- menu bar / tray ----------
  useEffect(() => {
    if (!hydrated) {
      return;
    }
    const running = Boolean(activeTask && activeHasTime && !activeTask.isPaused);
    const title = state.preferences.menuBarTimer && activeTask && activeHasTime ? (activeTask.isPaused ? `${time} ❚❚` : time) : null;
    const tooltip = activeTask ? `${activeTask.title} — ${activeHasTime ? `${time} left` : 'no time set'}` : 'TimeBound';
    const key = `${title}|${tooltip}|${Boolean(activeTask)}|${running}`;
    if (key === trayKey.current) {
      return;
    }
    trayKey.current = key;
    native.updateTray(title, tooltip, Boolean(activeTask), running).catch(() => undefined);
  }, [hydrated, activeTask, activeHasTime, time, state.preferences.menuBarTimer]);

  const focusAddInput = useCallback(() => {
    window.setTimeout(() => addInputRef.current?.focus(), 60);
  }, []);

  const latest = useRef({ togglePause, completeActive, enterFocus, exitFocus, mode, focusAddInput });
  latest.current = { togglePause, completeActive, enterFocus, exitFocus, mode, focusAddInput };

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    let disposed = false;
    const cleanups: Array<() => void> = [];
    const keep = (fn: () => void) => (disposed ? fn() : cleanups.push(fn));
    native
      .onTrayAction(async (action) => {
        const current = latest.current;
        if (action === 'pause') current.togglePause();
        if (action === 'complete') current.completeActive();
        if (action === 'focus' && current.mode === 'main') await current.enterFocus();
        if (action === 'show' && current.mode === 'focus') await current.exitFocus();
      })
      .then(keep);
    native
      .registerHotkey(QUICK_ADD_HOTKEY, async () => {
        const current = latest.current;
        if (current.mode === 'focus') {
          await current.exitFocus();
        }
        await native.showWindow();
        current.focusAddInput();
      })
      .then(keep);
    return () => {
      disposed = true;
      cleanups.forEach((fn) => fn());
    };
  }, [hydrated]);

  // Dev-only scripted tour of the native window behaviour (test plan §3). Stripped from release builds.
  const selftestRef = useRef({ enterFocus, exitFocus, setTheme: store.setTheme, setForceFocusOpen, theme });
  selftestRef.current = { enterFocus, exitFocus, setTheme: store.setTheme, setForceFocusOpen, theme };
  useEffect(() => {
    if (import.meta.env.VITE_SELFTEST !== '1' || !hydrated) {
      return;
    }
    import('./selftest').then(({ runSelfTest }) => runSelfTest(() => selftestRef.current));
  }, [hydrated]);

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (sheet || menu || isTyping(event.target)) {
        return;
      }
      const mod = event.metaKey || event.ctrlKey;
      if (mode === 'focus') {
        if (event.key === 'Escape') {
          event.preventDefault();
          exitFocus();
        }
        return;
      }
      if (event.key === ' ' && !mod) {
        event.preventDefault();
        togglePause();
      } else if (mod && event.key === 'Enter') {
        event.preventDefault();
        completeActive();
      } else if (mod && (event.key === '=' || event.key === '+')) {
        event.preventDefault();
        addFive();
      } else if (!mod && (event.key === 'n' || event.key === 'N')) {
        event.preventDefault();
        focusAddInput();
      } else if (mod && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        focusAddInput();
      } else if (!mod && (event.key === 'f' || event.key === 'F') && activeTask) {
        event.preventDefault();
        enterFocus();
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedIds.size > 0) {
        event.preventDefault();
        deleteWithConfirm([...selectedIds]);
      } else if (event.key === 'Escape') {
        setSelectedIds(new Set());
        setShowSummary(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet, menu, mode, exitFocus, togglePause, completeActive, addFive, focusAddInput, enterFocus, activeTask, selectedIds, deleteWithConfirm]);

  // ---------- file import ----------
  const handleFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result ?? '');
        addTasks(file.name.toLowerCase().endsWith('.csv') ? parseCsv(text) : parseTaskLines(text), file.name);
      };
      reader.onerror = () => pushToast({ title: 'Couldn’t read that file.' });
      reader.readAsText(file);
    },
    [addTasks, pushToast]
  );

  const openMoreMenu = useCallback(
    (x: number, y: number) => {
      setMenu({
        x,
        y,
        items: [
          { label: 'Add several tasks…', onClick: () => setSheet({ kind: 'bulk' }) },
          { label: 'Import from file…', onClick: () => fileInputRef.current?.click() },
          'sep',
          { label: 'Keep on top', checked: state.preferences.alwaysOnTop, onClick: () => store.setAlwaysOnTop(!state.preferences.alwaysOnTop) },
          {
            label: platform === 'mac' ? 'Timer in menu bar' : 'Timer in tray',
            checked: state.preferences.menuBarTimer,
            onClick: () => store.setMenuBarTimer(!state.preferences.menuBarTimer)
          },
          {
            label: 'Reset focus position',
            disabled: !state.preferences.focusPositions?.[theme],
            onClick: () => store.setFocusPosition(theme, null)
          },
          'sep',
          {
            label: 'Clear finished tasks',
            disabled: doneIds.length === 0,
            onClick: () =>
              setSheet({
                kind: 'confirm',
                title: `Clear ${doneIds.length} finished task${doneIds.length === 1 ? '' : 's'}?`,
                body: 'Your score and completion counts stay the same.',
                confirmLabel: 'Clear',
                onConfirm: () => store.clearFinished()
              })
          },
          { label: 'Keyboard shortcuts', onClick: () => setSheet({ kind: 'shortcuts' }) },
          'sep',
          { label: 'Quit TimeBound', onClick: () => native.quit() }
        ]
      });
    },
    [state.preferences, store, theme, doneIds.length]
  );

  if (!hydrated) {
    return null;
  }

  // ---------- render: focus ----------
  if (mode === 'focus' && focusLayout) {
    return (
      <FocusWidget
        theme={theme}
        layout={focusLayout}
        title={activeTask?.title}
        nextTitle={upNext[0]?.title}
        time={activeTask ? (activeHasTime ? time : 'no time') : '--:--'}
        fraction={fraction}
        paused={Boolean(activeTask?.isPaused)}
        hasTime={activeHasTime}
        timeUpTitle={timeUp?.title ?? null}
        onTogglePause={togglePause}
        onDone={completeActive}
        onAddFive={addFive}
        onTimeUpAddFive={timeUpAddFive}
        onTimeUpDismiss={() => setTimeUp(null)}
        onExit={exitFocus}
        onExpandedChange={setFocusExpanded}
        forceOpen={forceFocusOpen}
      />
    );
  }

  // ---------- render: main ----------
  return (
    <div className="shell">
      <Header
        theme={theme}
        today={today}
        score={state.score}
        onSummary={() => setShowSummary((value) => !value)}
        onToggleTheme={() => store.setTheme(theme === 'dark' ? 'light' : 'dark')}
        onMenu={openMoreMenu}
        onMinimize={() => native.minimize()}
        onClose={() => native.quit()}
      />

      <div className="scroll">
        <NowCard
          task={activeTask}
          position={1}
          openCount={openTasks.length}
          time={time}
          total={total}
          fraction={fraction}
          onDone={completeActive}
          onTogglePause={togglePause}
          onAddFive={addFive}
          onFocus={enterFocus}
          onSetTime={() => activeTask && setSheet({ kind: 'task', mode: 'edit', task: activeTask, requireTime: true })}
        />
        <TaskList
          upNext={upNext}
          doneToday={doneToday}
          selectedIds={selectedIds}
          onReorder={(ids) => activeTask && orderWith([activeTask.id, ...ids, ...upNext.slice(ids.length).map((task) => task.id)])}
          onSelect={handleSelect}
          onEdit={openEdit}
          onContextMenu={handleRowMenu}
        />
      </div>

      <AddBar ref={addInputRef} requireTime={requireTime} onAdd={(title, seconds) => store.addTask(title, seconds)} />

      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.csv,.md"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            handleFile(file);
          }
          event.target.value = '';
        }}
      />

      {showSummary ? (
        <SummaryPopover summary={summarizeDay(state.tasks)} total={state.stats.totalCompleted} score={state.score} onClose={() => setShowSummary(false)} />
      ) : null}

      <div className="toasts" aria-live="polite">
        {timeUp ? (
          <div className="toast" role="alert">
            <div className="msg">
              <b>Time’s up · {timeUp.title}</b>
              {activeTask ? <span>Next: {activeTask.title}</span> : null}
            </div>
            <button type="button" onClick={timeUpAddFive}>
              +5 min
            </button>
            <button type="button" onClick={() => setTimeUp(null)}>
              OK
            </button>
          </div>
        ) : null}
        {toasts.map((toast) => (
          <div key={toast.id} className="toast">
            <div className="msg">
              <b>{toast.title}</b>
              {toast.body ? <span>{toast.body}</span> : null}
            </div>
          </div>
        ))}
      </div>

      {menu ? <PopupMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}

      {sheet?.kind === 'task' ? (
        <TaskSheet
          mode={sheet.mode}
          initialTitle={sheet.task?.title}
          initialSeconds={sheet.task?.timeAssignedSeconds}
          requireTime={sheet.requireTime}
          onClose={() => setSheet(null)}
          onSubmit={({ title, seconds }) => {
            if (sheet.mode === 'create') {
              store.addTask(title, seconds);
            } else if (sheet.task) {
              store.updateTask(sheet.task.id, title, seconds);
            }
            setSheet(null);
          }}
        />
      ) : null}
      {sheet?.kind === 'addTime' ? (
        <AddTimeSheet
          taskTitle={sheet.task.title}
          onClose={() => setSheet(null)}
          onSubmit={(seconds) => {
            store.addTime(sheet.task.id, seconds);
            setSheet(null);
          }}
        />
      ) : null}
      {sheet?.kind === 'bulk' ? (
        <BulkSheet
          onClose={() => setSheet(null)}
          onSubmit={(text) => {
            addTasks(parseTaskLines(text), 'that text');
            setSheet(null);
          }}
        />
      ) : null}
      {sheet?.kind === 'shortcuts' ? <ShortcutsSheet onClose={() => setSheet(null)} /> : null}
      {sheet?.kind === 'confirm' ? (
        <ConfirmSheet
          title={sheet.title}
          body={sheet.body}
          confirmLabel={sheet.confirmLabel}
          onClose={() => setSheet(null)}
          onConfirm={() => {
            sheet.onConfirm();
            setSheet(null);
          }}
        />
      ) : null}
    </div>
  );
}

