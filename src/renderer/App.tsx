import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Task, WindowState } from '../shared/types';
import { useAppStore } from './store/state';
import { TaskRow } from './components/TaskRow';
import { EditModal } from './components/EditModal';
import { ReminderPopup } from './components/Popup';
import { AddTimeModal } from './components/AddTimeModal';
import { FocusSpotlight } from './components/FocusSpotlight';
import { TitleBar } from './components/TitleBar';
import { formatSeconds } from './utils/time';
import type { ElectronApi } from '../shared/ipc';

const REMINDER_INTERVAL_MS = 3 * 60 * 1000;
const FOCUS_SPOTLIGHT_INACTIVITY_MS = 60 * 1000;

const getActiveTask = (tasks: Task[]): Task | undefined =>
  tasks.find((task) => task.status !== 'completed' && task.status !== 'struck');

export default function App() {
  const {
    state,
    hydrated,
    addTask,
    completeActiveTask,
    addTime,
    updateTask,
    dispatchTick,
    setAlwaysOnTop
  } = useAppStore();
  const [modalState, setModalState] = useState<{ mode: 'create' | 'edit'; task?: Task } | null>(null);
  const [addTimeOpen, setAddTimeOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const reminderTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snoozeUntilRef = useRef<number | null>(null);
  const lastReminderTaskIdRef = useRef<string | null>(null);
  const [focusSpotlightOpenState, setFocusSpotlightOpenState] = useState(false);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const focusSpotlightOpenRef = useRef(focusSpotlightOpenState);
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeTaskRef = useRef<Task | undefined>(undefined);
  const lastTrackedTaskIdRef = useRef<string | null>(null);

  const activeTask = useMemo(() => getActiveTask(state.tasks), [state.tasks]);
  const pendingCount = useMemo(() => state.tasks.filter((task) => task.status === 'pending').length, [state.tasks]);
  const orderedTasks = useMemo(() => [...state.tasks].reverse(), [state.tasks]);
  const alwaysOnTopEnabled = state.preferences.alwaysOnTop;
  const selectedTask = useMemo(
    () => (selectedTaskId ? state.tasks.find((t) => t.id === selectedTaskId) : null),
    [selectedTaskId, state.tasks]
  );
  const taskForAddTime = selectedTask ?? activeTask;
  const requiresTimeForNextTask = useMemo(() => {
    const openTasks = state.tasks.filter((task) => task.status !== 'completed' && task.status !== 'struck');
    if (openTasks.length === 0) {
      return true;
    }
    return !openTasks.some((task) => {
      const remaining = typeof task.remainingSeconds === 'number' ? task.remainingSeconds : undefined;
      const assigned = typeof task.timeAssignedSeconds === 'number' ? task.timeAssignedSeconds : undefined;
      return (remaining ?? assigned ?? 0) > 0;
    });
  }, [state.tasks]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    const id = setInterval(() => {
      dispatchTick();
    }, 1000);
    return () => clearInterval(id);
  }, [hydrated, dispatchTick]);

  useEffect(() => {
    if (reminderTimeoutRef.current) {
      clearTimeout(reminderTimeoutRef.current);
      reminderTimeoutRef.current = null;
    }

    if (!hydrated) {
      return;
    }

    const currentActive = getActiveTask(state.tasks);
    if (!currentActive) {
      setReminderOpen(false);
      snoozeUntilRef.current = null;
      lastReminderTaskIdRef.current = null;
      return;
    }

    const hasTime = typeof (currentActive.timeAssignedSeconds ?? currentActive.remainingSeconds) === 'number' &&
      (currentActive.timeAssignedSeconds ?? currentActive.remainingSeconds ?? 0) > 0;
    if (hasTime) {
      setReminderOpen(false);
      snoozeUntilRef.current = null;
      lastReminderTaskIdRef.current = null;
      return;
    }

    if (reminderOpen) {
      return;
    }

    const now = Date.now();
    const activeTaskId = currentActive.id;
    const isNewActiveTask = lastReminderTaskIdRef.current !== activeTaskId;
    const snoozeUntil = isNewActiveTask ? null : snoozeUntilRef.current;

    lastReminderTaskIdRef.current = activeTaskId;
    if (isNewActiveTask) {
      snoozeUntilRef.current = null;
    }

    const delay = snoozeUntil && snoozeUntil > now ? snoozeUntil - now : isNewActiveTask ? 0 : REMINDER_INTERVAL_MS;
    reminderTimeoutRef.current = setTimeout(() => {
      setReminderOpen(true);
      reminderTimeoutRef.current = null;
    }, delay);

    return () => {
      if (reminderTimeoutRef.current) {
        clearTimeout(reminderTimeoutRef.current);
        reminderTimeoutRef.current = null;
      }
    };
  }, [hydrated, state.tasks, reminderOpen]);

  const closeModal = useCallback(() => {
    setModalState(null);
  }, []);

  const handleAddTask = useCallback(() => {
    setModalState({ mode: 'create' });
  }, []);

  const handleEditTask = useCallback((task: Task) => {
    setModalState({ mode: 'edit', task });
  }, []);

  const handleSelectTask = useCallback((task: Task) => {
    setSelectedTaskId((prev) => (prev === task.id ? null : task.id));
  }, []);

  const handleModalSubmit = useCallback(
    (payload: { title: string; seconds?: number }) => {
      if (!modalState) {
        return;
      }

      if (modalState.mode === 'create') {
        if (requiresTimeForNextTask && (!payload.seconds || payload.seconds <= 0)) {
          setErrorMessage('Please assign time before starting the next task.');
          return;
        }
        addTask(payload.title, payload.seconds);
        setModalState(null);
        return;
      }

      if (modalState.mode === 'edit' && modalState.task) {
        const previousSeconds = modalState.task.timeAssignedSeconds ?? 0;
        const nextSeconds = payload.seconds ?? 0;
        if (nextSeconds > previousSeconds) {
          const confirmed = window.confirm('Adding time will deduct one score point. Continue?');
          if (!confirmed) {
            return;
          }
        }
        updateTask(modalState.task.id, payload.title, payload.seconds);
        setModalState(null);
      }
    },
    [modalState, requiresTimeForNextTask, addTask, updateTask]
  );

  const handleAddTime = useCallback(
    (seconds: number) => {
      const targetTask = taskForAddTime;
      if (!targetTask) {
        return;
      }
      addTime(targetTask.id, seconds);
      setAddTimeOpen(false);
      setSelectedTaskId(null);
    },
    [addTime, taskForAddTime]
  );

  const handleReminderSnooze = useCallback(() => {
    snoozeUntilRef.current = Date.now() + REMINDER_INTERVAL_MS;
    setReminderOpen(false);
  }, []);

  const handleReminderSetTime = useCallback(() => {
    if (!activeTask) {
      return;
    }
    setReminderOpen(false);
    setModalState({ mode: 'edit', task: activeTask });
  }, [activeTask]);

  const handleReminderCloseApp = useCallback(() => {
    const api = (window as Window & { electronAPI?: { quitApp?: () => Promise<void> } }).electronAPI;
    void api?.quitApp?.();
  }, []);

  const updateFocusSpotlightOpen = useCallback((value: boolean) => {
    focusSpotlightOpenRef.current = value;
    setFocusSpotlightOpenState(value);
  }, []);

  const handleToggleAlwaysOnTop = useCallback(() => {
    setAlwaysOnTop(!alwaysOnTopEnabled).catch((error) => {
      console.error('Failed to update always-on-top preference', error);
      setErrorMessage('Unable to update window pin setting.');
    });
  }, [alwaysOnTopEnabled, setAlwaysOnTop]);

  const electronApi = useMemo(() => {
    return (window as Window & { electronAPI?: ElectronApi }).electronAPI ?? null;
  }, []);

  const clearInactivityTimer = useCallback(() => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
  }, []);

  const scheduleFocusSpotlight = useCallback(() => {
    clearInactivityTimer();
    if (!activeTaskRef.current || focusSpotlightOpenRef.current) {
      return;
    }

    inactivityTimerRef.current = setTimeout(() => {
      if (!focusSpotlightOpenRef.current && activeTaskRef.current) {
        updateFocusSpotlightOpen(true);
      }
      inactivityTimerRef.current = null;
    }, FOCUS_SPOTLIGHT_INACTIVITY_MS);
  }, [clearInactivityTimer, updateFocusSpotlightOpen]);

  useEffect(() => {
    if (!errorMessage) {
      return;
    }
    const timeout = setTimeout(() => setErrorMessage(null), 3200);
    return () => clearTimeout(timeout);
  }, [errorMessage]);

  useEffect(() => {
    activeTaskRef.current = activeTask ?? undefined;
    if (!activeTask) {
      lastTrackedTaskIdRef.current = null;
      updateFocusSpotlightOpen(false);
      clearInactivityTimer();
      return;
    }

    const activeId = activeTask.id;
    const isNewTask = lastTrackedTaskIdRef.current !== activeId;
    lastTrackedTaskIdRef.current = activeId;

    if (!focusSpotlightOpenRef.current && (isNewTask || !inactivityTimerRef.current)) {
      scheduleFocusSpotlight();
    }
  }, [activeTask, scheduleFocusSpotlight, clearInactivityTimer, updateFocusSpotlightOpen]);

  useEffect(() => {
    if (selectedTaskId && !state.tasks.find((t) => t.id === selectedTaskId)) {
      setSelectedTaskId(null);
    }
  }, [selectedTaskId, state.tasks]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    const handleActivity = () => {
      if (focusSpotlightOpenRef.current) {
        return;
      }
      scheduleFocusSpotlight();
    };

    const events: Array<keyof WindowEventMap> = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'];
    events.forEach((eventName) => window.addEventListener(eventName, handleActivity, { passive: true }));
    scheduleFocusSpotlight();

    return () => {
      events.forEach((eventName) => window.removeEventListener(eventName, handleActivity));
      clearInactivityTimer();
    };
  }, [hydrated, scheduleFocusSpotlight, clearInactivityTimer]);

  useEffect(() => {
    focusSpotlightOpenRef.current = focusSpotlightOpenState;
    if (!focusSpotlightOpenState) {
      scheduleFocusSpotlight();
    }
  }, [focusSpotlightOpenState, scheduleFocusSpotlight]);

  useEffect(() => {
    document.body.style.backgroundColor = 'transparent';
    return () => {
      document.body.style.backgroundColor = '';
    };
  }, []);

  useEffect(() => {
    const api = electronApi;
    if (!api?.getWindowState) {
      return;
    }

    let unsubscribe: (() => void) | undefined;

    api
      .getWindowState()
      .then((state: WindowState) => {
        setIsWindowMaximized(Boolean(state.isMaximized));
      })
      .catch((error: unknown) => {
        console.error('Failed to get window state', error);
      });

    if (api.onWindowStateChange) {
      unsubscribe = api.onWindowStateChange((state: WindowState) => {
        setIsWindowMaximized(Boolean(state.isMaximized));
      });
    }

    return () => {
      unsubscribe?.();
    };
  }, [electronApi]);

  if (!hydrated) {
    return (
      <div className="flex h-screen items-center justify-center bg-brand-navy text-brand-coral">
        Loading TimeBound...
      </div>
    );
  }

  const activeTime = formatSeconds(activeTask?.remainingSeconds ?? activeTask?.timeAssignedSeconds);
  const scoreSign = state.score > 0 ? '+' : state.score < 0 ? '-' : '';
  const scoreValue = Math.abs(state.score);

  const rootClasses = `min-h-screen text-brand-ice transition-colors duration-300 border-[3px] border-brand-ice/30 ${
    focusSpotlightOpenState ? 'bg-transparent hide-scrollbar' : 'bg-brand-navy'
  }`;

  const dragLayerStyle = { WebkitAppRegion: 'drag' } as unknown as CSSProperties;

  const appContainerClasses = `mx-auto flex h-full max-w-xl flex-col gap-3 px-4 pb-4 pt-2 transition duration-300 ${
    focusSpotlightOpenState
      ? 'pointer-events-none opacity-0'
      : 'border-2 border-brand-ice/5 rounded-3xl shadow-[0_0_30px_rgba(148,187,233,0.08)]'
  }`;

  return (
      <div className={rootClasses} style={dragLayerStyle}>
        <div className={appContainerClasses}>
        <TitleBar
          alwaysOnTop={alwaysOnTopEnabled}
          isMaximized={isWindowMaximized}
          onToggleAlwaysOnTop={handleToggleAlwaysOnTop}
          onMinimize={() => electronApi?.minimizeWindow?.()}
          onToggleMaximize={() => electronApi?.toggleMaximizeWindow?.()}
          onClose={() => electronApi?.closeWindow?.()}
        />
        <main className="flex flex-1 flex-col gap-4">
  <header className="app-region-no-drag rounded-2xl border border-brand-ice/20 bg-brand-dusk/90 p-4 shadow-xl backdrop-blur">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-brand-ice">TimeBound</h1>
              <p className="text-xs text-brand-aqua/80">Focus, finish, and track your wins.</p>
            </div>
            <div className="flex flex-col items-end gap-1 text-right text-sm">
              <div className="font-semibold text-brand-coral">
                Score: {scoreSign}
                {scoreValue}
              </div>
              <div className="text-brand-ice/70">
                Completed: {state.stats.totalCompleted} total | {state.stats.todayCompleted} today
              </div>
            </div>
          </div>
          {activeTask ? (
            <div className="mt-4 rounded-lg border border-brand-teal/50 bg-brand-teal/20 p-3">
              <p className="text-xs uppercase tracking-wide text-brand-aqua/80">Active Task</p>
              <p className="mt-1 text-sm font-semibold text-brand-ice">{activeTask.title}</p>
              <p className="font-mono text-sm text-brand-aqua/80">Time left: {activeTime}</p>
            </div>
          ) : (
            <p className="mt-4 text-sm text-brand-ice/70">No active task. Add one to get started.</p>
          )}
        </header>

  <section className="app-region-no-drag flex-1 space-y-2 overflow-y-auto rounded-2xl border border-brand-ice/10 bg-brand-dusk/70 p-4 shadow-lg">
          {state.tasks.length === 0 ? (
            <p className="text-center text-sm text-brand-ice/70">Create your first task to begin timeboxing.</p>
          ) : (
            orderedTasks.slice(0, 5).map((task, index) => (
              <TaskRow
                key={task.id}
                task={task}
                index={index}
                isActive={activeTask?.id === task.id}
                isSelected={selectedTaskId === task.id}
                onEdit={handleEditTask}
                onSelect={handleSelectTask}
              />
            ))
          )}
          {orderedTasks.length > 5 ? (
            <p className="text-xs text-brand-ice/60">+ {orderedTasks.length - 5} more tasks queued</p>
          ) : null}
        </section>

        <section className="grid grid-cols-3 gap-3">
          <button
            type="button"
            className="rounded-xl border border-brand-coral/80 bg-brand-coral px-3 py-2 text-sm font-semibold text-brand-navy hover:bg-brand-coral/90"
            onClick={handleAddTask}
          >
            + Add Task
          </button>
          <button
            type="button"
            className="rounded-xl border border-brand-teal/80 bg-brand-teal px-3 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:cursor-not-allowed disabled:border-brand-ice/10 disabled:bg-brand-dusk/50 disabled:text-brand-ice/40"
            onClick={completeActiveTask}
            disabled={!activeTask}
          >
            Complete
          </button>
          <button
            type="button"
            className="rounded-xl border border-brand-coral/70 bg-transparent px-3 py-2 text-sm font-semibold text-brand-coral hover:bg-brand-coral/10 disabled:cursor-not-allowed disabled:border-brand-ice/10 disabled:bg-brand-dusk/50 disabled:text-brand-ice/30"
            onClick={() => setAddTimeOpen(true)}
            disabled={!taskForAddTime}
          >
            Add Time +
          </button>
        </section>

        <button
          type="button"
          className="rounded-xl border border-brand-coral/50 bg-brand-coral/20 px-3 py-2 text-sm font-semibold text-brand-coral transition hover:bg-brand-coral/25 disabled:cursor-not-allowed disabled:border-brand-ice/10 disabled:bg-brand-dusk/50 disabled:text-brand-ice/30"
          onClick={() => {
            clearInactivityTimer();
            if (activeTask) {
              updateFocusSpotlightOpen(true);
            }
          }}
          disabled={!activeTask}
        >
          See Focus Spotlight
        </button>

        <footer className="text-xs text-brand-ice/60">
          {pendingCount > 0 ? `${pendingCount} task${pendingCount === 1 ? '' : 's'} pending` : 'All tasks completed'}
        </footer>
        </main>
      </div>

      {modalState ? (
        <EditModal
          open
          mode={modalState.mode}
          heading={modalState.mode === 'create' ? 'Add Task' : 'Edit Task'}
          subtitle={modalState.mode === 'create' ? 'Define your next focus block.' : 'Refine the task details.'}
          initialTitle={modalState.task?.title}
          initialSeconds={modalState.task?.timeAssignedSeconds}
          requireTime={modalState.mode === 'create' ? requiresTimeForNextTask : false}
          onSubmit={handleModalSubmit}
          onCancel={closeModal}
        />
      ) : null}

      <AddTimeModal open={addTimeOpen} onSubmit={handleAddTime} onCancel={() => setAddTimeOpen(false)} />

      <ReminderPopup
        open={reminderOpen}
        taskTitle={activeTask?.title}
        onSetTime={handleReminderSetTime}
        onRemindLater={handleReminderSnooze}
        onCloseApp={handleReminderCloseApp}
      />

      <FocusSpotlight
        open={focusSpotlightOpenState}
        taskTitle={activeTask?.title}
        timeRemaining={activeTime}
        onClose={() => {
          updateFocusSpotlightOpen(false);
        }}
      />

      {errorMessage ? (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border border-brand-coral bg-brand-coral/15 px-4 py-2 text-sm text-brand-coral shadow-lg">
          {errorMessage}
        </div>
      ) : null}
    </div>
  );
}
