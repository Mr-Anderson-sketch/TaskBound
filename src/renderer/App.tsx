import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Task } from '../shared/types';
import { useAppStore } from './store/state';
import { TaskRow } from './components/TaskRow';
import { EditModal } from './components/EditModal';
import { ReminderPopup } from './components/Popup';
import { AddTimeModal } from './components/AddTimeModal';
import { formatSeconds } from './utils/time';

const REMINDER_INTERVAL_MS = 3 * 60 * 1000;

const getActiveTask = (tasks: Task[]): Task | undefined =>
  tasks.find((task) => task.status !== 'completed' && task.status !== 'struck');

export default function App() {
  const { state, hydrated, addTask, completeActiveTask, addTime, updateTask, dispatchTick } = useAppStore();
  const [modalState, setModalState] = useState<{ mode: 'create' | 'edit'; task?: Task } | null>(null);
  const [addTimeOpen, setAddTimeOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reminderOpen, setReminderOpen] = useState(false);
  const reminderTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snoozeUntilRef = useRef<number | null>(null);
  const lastReminderTaskIdRef = useRef<string | null>(null);

  const activeTask = useMemo(() => getActiveTask(state.tasks), [state.tasks]);
  const pendingCount = useMemo(() => state.tasks.filter((task) => task.status === 'pending').length, [state.tasks]);
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
      if (!activeTask) {
        return;
      }
      addTime(activeTask.id, seconds);
      setAddTimeOpen(false);
    },
    [addTime, activeTask]
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

  useEffect(() => {
    if (!errorMessage) {
      return;
    }
    const timeout = setTimeout(() => setErrorMessage(null), 3200);
    return () => clearTimeout(timeout);
  }, [errorMessage]);

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

  return (
    <div className="min-h-screen bg-brand-navy text-brand-ice">
      <main className="mx-auto flex h-full max-w-xl flex-col gap-4 p-4">
        <header className="rounded-2xl border border-brand-ice/20 bg-brand-dusk/90 p-4 shadow-xl backdrop-blur">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-brand-ice">TimeBound</h1>
              <p className="text-xs text-brand-aqua/80">Focus, finish, and track your wins.</p>
            </div>
            <div className="text-right text-sm">
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

        <section className="flex-1 space-y-2 overflow-y-auto rounded-2xl border border-brand-ice/10 bg-brand-dusk/70 p-4 shadow-lg">
          {state.tasks.length === 0 ? (
            <p className="text-center text-sm text-brand-ice/70">Create your first task to begin timeboxing.</p>
          ) : (
            state.tasks.slice(0, 5).map((task, index) => (
              <TaskRow
                key={task.id}
                task={task}
                index={index}
                isActive={activeTask?.id === task.id}
                onEdit={handleEditTask}
              />
            ))
          )}
          {state.tasks.length > 5 ? (
            <p className="text-xs text-brand-ice/60">+ {state.tasks.length - 5} more tasks queued</p>
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
            disabled={!activeTask}
          >
            Add Time +
          </button>
        </section>

        <footer className="text-xs text-brand-ice/60">
          {pendingCount > 0 ? `${pendingCount} task${pendingCount === 1 ? '' : 's'} pending` : 'All tasks completed'}
        </footer>
      </main>

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

      {errorMessage ? (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border border-brand-coral bg-brand-coral/15 px-4 py-2 text-sm text-brand-coral shadow-lg">
          {errorMessage}
        </div>
      ) : null}
    </div>
  );
}
