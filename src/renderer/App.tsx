import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragCancelEvent,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS as DndCSS } from '@dnd-kit/utilities';
import type { Task, WindowState } from '../shared/types';
import { useAppStore } from './store/state';
import { TaskRow } from './components/TaskRow';
import { EditModal } from './components/EditModal';
import { ReminderPopup } from './components/Popup';
import { AddTimeModal } from './components/AddTimeModal';
import { BulkTaskModal } from './components/BulkTaskModal';
import { FocusSpotlight } from './components/FocusSpotlight';
import { TitleBar } from './components/TitleBar';
import { formatSeconds } from './utils/time';
import type { ElectronApi } from '../shared/ipc';
import { v4 as uuidv4 } from 'uuid';

const REMINDER_INTERVAL_MS = 3 * 60 * 1000;
const FOCUS_SPOTLIGHT_INACTIVITY_MS = 40 * 1000;

const getActiveTask = (tasks: Task[]): Task | undefined =>
  tasks.find((task) => task.status !== 'completed' && task.status !== 'struck');

interface SortableTaskRowProps {
  task: Task;
  index: number;
  isActive: boolean;
  isSelected: boolean;
  multiSelectCount: number;
  onEdit: (task: Task) => void;
  onSelect: (task: Task, event?: React.MouseEvent) => void;
  onAddTime: (task: Task) => void;
  onDelete: (task: Task) => void;
  onDeleteMultiple: () => void;
  onMakeActive: (task: Task) => void;
}

function SortableTaskRow({ task, index, isActive, isSelected, multiSelectCount, onEdit, onSelect, onAddTime, onDelete, onDeleteMultiple, onMakeActive }: SortableTaskRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const style: CSSProperties = {
    transform: transform ? DndCSS.Transform.toString(transform) : undefined,
    transition,
    cursor: isDragging ? 'grabbing' : undefined,
    zIndex: isDragging ? 1 : undefined
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TaskRow
        task={task}
        index={index}
        isActive={isActive}
        isSelected={isSelected}
        multiSelectCount={multiSelectCount}
        onEdit={onEdit}
        onSelect={onSelect}
        onAddTime={onAddTime}
        onDelete={onDelete}
        onDeleteMultiple={onDeleteMultiple}
        onMakeActive={onMakeActive}
      />
    </div>
  );
}

export default function App() {
  const {
    state,
    hydrated,
    addTask,
    completeActiveTask,
    addTime,
    updateTask,
    deleteTask,
    deleteTasks,
    reorderTasks,
    dispatchTick,
    setAlwaysOnTop,
    pauseTask,
    resumeTask
  } = useAppStore();
  const [modalState, setModalState] = useState<{ mode: 'create' | 'edit'; task?: Task } | null>(null);
  const [addTimeOpen, setAddTimeOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [lastSelectedTaskId, setLastSelectedTaskId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [tasksToDelete, setTasksToDelete] = useState<string[]>([]);
  const reminderTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snoozeUntilRef = useRef<number | null>(null);
  const lastReminderTaskIdRef = useRef<string | null>(null);
  const [focusSpotlightOpenState, setFocusSpotlightOpenState] = useState(false);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const focusSpotlightOpenRef = useRef(focusSpotlightOpenState);
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeTaskRef = useRef<Task | undefined>(undefined);
  const lastTrackedTaskIdRef = useRef<string | null>(null);
  const dragGuardRef = useRef(false);
  const dragResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showAllTasks, setShowAllTasks] = useState(false);
  const [showUploadMenu, setShowUploadMenu] = useState(false);
  const [showBulkTaskModal, setShowBulkTaskModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadMenuRef = useRef<HTMLDivElement>(null);
  const minimalModeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousWindowSizeRef = useRef<{ width: number; height: number } | null>(null);

  const openTasks = useMemo(
    () => state.tasks.filter((task) => task.status !== 'completed' && task.status !== 'struck'),
    [state.tasks]
  );
  const activeTask = useMemo(() => getActiveTask(state.tasks), [state.tasks]);
  const pendingCount = useMemo(() => state.tasks.filter((task) => task.status === 'pending').length, [state.tasks]);
  const orderedTasks = useMemo(() => [...state.tasks].reverse(), [state.tasks]);
  const shouldBeMinimal = useMemo(() => openTasks.length === 0, [openTasks.length]);
  const isMinimalMode = useMemo(() => focusSpotlightOpenState && shouldBeMinimal, [focusSpotlightOpenState, shouldBeMinimal]);
  const visibleTasks = useMemo(() => {
    return showAllTasks ? orderedTasks : orderedTasks.slice(0, 5);
  }, [orderedTasks, showAllTasks]);
  const hiddenTaskCount = orderedTasks.length - 5;
  const alwaysOnTopEnabled = state.preferences.alwaysOnTop;
  const selectedTask = useMemo(
    () => (selectedTaskId ? state.tasks.find((t) => t.id === selectedTaskId) : null),
    [selectedTaskId, state.tasks]
  );
  const taskForAddTime = selectedTask ?? activeTask;
  const requiresTimeForNextTask = useMemo(() => {
    if (openTasks.length === 0) {
      return true;
    }
    return !openTasks.some((task) => {
      const remaining = typeof task.remainingSeconds === 'number' ? task.remainingSeconds : undefined;
      const assigned = typeof task.timeAssignedSeconds === 'number' ? task.timeAssignedSeconds : undefined;
      return (remaining ?? assigned ?? 0) > 0;
    });
  }, [openTasks]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

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

  useEffect(() => {
    return () => {
      if (dragResetTimeoutRef.current) {
        clearTimeout(dragResetTimeoutRef.current);
      }
    };
  }, []);

  // Close upload menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (uploadMenuRef.current && !uploadMenuRef.current.contains(event.target as Node)) {
        setShowUploadMenu(false);
      }
    };

    if (showUploadMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showUploadMenu]);

  // Global keyboard shortcut for deleting tasks
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check if Delete or Backspace is pressed
      if (event.key === 'Delete' || event.key === 'Backspace') {
        // Don't trigger if user is typing in an input/textarea or modal is open
        const target = event.target as HTMLElement;
        if (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          modalState !== null ||
          addTimeOpen ||
          showBulkTaskModal ||
          showDeleteConfirm
        ) {
          return;
        }

        // Delete selected tasks
        if (selectedTaskIds.size > 0) {
          event.preventDefault();
          const taskIdsToDelete = Array.from(selectedTaskIds);

          // Prevent deleting the active task
          const activeTaskId = activeTask?.id;
          const filteredTaskIds = taskIdsToDelete.filter(id => id !== activeTaskId);

          if (filteredTaskIds.length > 0) {
            // Show confirmation for multiple tasks
            if (filteredTaskIds.length > 1) {
              setTasksToDelete(filteredTaskIds);
              setShowDeleteConfirm(true);
            } else {
              // Single task - delete directly
              deleteTasks(filteredTaskIds);
              setSelectedTaskIds(new Set());
              setLastSelectedTaskId(null);
              if (selectedTaskId && filteredTaskIds.includes(selectedTaskId)) {
                setSelectedTaskId(null);
              }
            }
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedTaskIds, activeTask, modalState, addTimeOpen, showBulkTaskModal, showDeleteConfirm, deleteTasks, selectedTaskId]);

  const closeModal = useCallback(() => {
    setModalState(null);
  }, []);

  const handleAddTask = useCallback(() => {
    setModalState({ mode: 'create' });
  }, []);

  const handleEditTask = useCallback((task: Task) => {
    setModalState({ mode: 'edit', task });
  }, []);

  const handleSelectTask = useCallback((task: Task, event?: React.MouseEvent) => {
    if (dragGuardRef.current) {
      return;
    }

    // Multi-select with Shift or Ctrl/Cmd
    if (event?.shiftKey && lastSelectedTaskId) {
      // Shift+Click: Select range
      const lastIndex = orderedTasks.findIndex(t => t.id === lastSelectedTaskId);
      const currentIndex = orderedTasks.findIndex(t => t.id === task.id);

      if (lastIndex !== -1 && currentIndex !== -1) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);
        const rangeIds = orderedTasks.slice(start, end + 1).map(t => t.id);

        setSelectedTaskIds(new Set(rangeIds));
        setSelectedTaskId(task.id);
      }
    } else if (event?.ctrlKey || event?.metaKey) {
      // Ctrl/Cmd+Click: Toggle individual selection
      setSelectedTaskIds(prev => {
        const newSet = new Set(prev);
        if (newSet.has(task.id)) {
          newSet.delete(task.id);
        } else {
          newSet.add(task.id);
        }
        return newSet;
      });
      setSelectedTaskId(task.id);
      setLastSelectedTaskId(task.id);
    } else {
      // Regular click: Select single task
      setSelectedTaskIds(new Set([task.id]));
      setSelectedTaskId(task.id);
      setLastSelectedTaskId(task.id);
    }
  }, [lastSelectedTaskId, orderedTasks]);

  const handleTaskAddTime = useCallback((task: Task) => {
    setSelectedTaskId(task.id);
    setAddTimeOpen(true);
  }, []);

  const handleTaskDelete = useCallback((task: Task) => {
    deleteTask(task.id);
    if (selectedTaskId === task.id) {
      setSelectedTaskId(null);
    }
    setSelectedTaskIds(prev => {
      const newSet = new Set(prev);
      newSet.delete(task.id);
      return newSet;
    });
  }, [deleteTask, selectedTaskId]);

  const handleDeleteMultiple = useCallback(() => {
    const taskIdsToDelete = Array.from(selectedTaskIds);
    // Prevent deleting the active task
    const activeTaskId = activeTask?.id;
    const filteredTaskIds = taskIdsToDelete.filter(id => id !== activeTaskId);

    if (filteredTaskIds.length > 0) {
      // Show confirmation for multiple tasks
      if (filteredTaskIds.length > 1) {
        setTasksToDelete(filteredTaskIds);
        setShowDeleteConfirm(true);
      } else {
        // Single task - delete directly
        deleteTasks(filteredTaskIds);
        setSelectedTaskIds(new Set());
        setLastSelectedTaskId(null);
        if (selectedTaskId && filteredTaskIds.includes(selectedTaskId)) {
          setSelectedTaskId(null);
        }
      }
    }
  }, [selectedTaskIds, activeTask, deleteTasks, selectedTaskId]);

  const handleMakeActive = useCallback((task: Task) => {
    // Find the current active task index
    const activeIndex = state.tasks.findIndex(t => t.status !== 'completed' && t.status !== 'struck');

    if (activeIndex === -1) {
      // No active task, just move to the end
      const otherTaskIds = state.tasks.filter(t => t.id !== task.id).map(t => t.id);
      const newOrder = [task.id, ...otherTaskIds];
      reorderTasks(newOrder);
      return;
    }

    // Insert the selected task right after the current active task
    const taskIds = state.tasks.map(t => t.id);
    const selectedTaskIndex = taskIds.indexOf(task.id);

    // Remove the task from its current position
    const reordered = [...taskIds];
    reordered.splice(selectedTaskIndex, 1);

    // Insert it right after the active task (which shifts active task position if needed)
    const newActiveIndex = reordered.findIndex(id => id === taskIds[activeIndex]);
    reordered.splice(newActiveIndex + 1, 0, task.id);

    // Don't reverse - we're working with state.tasks which is already in correct storage order
    reorderTasks(reordered);
  }, [state.tasks, reorderTasks]);

  const scheduleDragReset = useCallback(() => {
    if (dragResetTimeoutRef.current) {
      clearTimeout(dragResetTimeoutRef.current);
    }
    dragResetTimeoutRef.current = setTimeout(() => {
      dragGuardRef.current = false;
      dragResetTimeoutRef.current = null;
    }, 120);
  }, []);

  const handleDragStart = useCallback((_: DragStartEvent) => {
    if (dragResetTimeoutRef.current) {
      clearTimeout(dragResetTimeoutRef.current);
      dragResetTimeoutRef.current = null;
    }
    dragGuardRef.current = true;
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        const currentOrder = orderedTasks.map((task) => task.id);
        const fromIndex = currentOrder.indexOf(active.id as string);
        const toIndex = currentOrder.indexOf(over.id as string);
        if (fromIndex !== -1 && toIndex !== -1) {
          const reorderedUi = arrayMove(currentOrder, fromIndex, toIndex);
          reorderTasks([...reorderedUi].reverse());
        }
      }
      scheduleDragReset();
    },
    [orderedTasks, reorderTasks, scheduleDragReset]
  );

  const handleDragCancel = useCallback((_: DragCancelEvent) => {
    scheduleDragReset();
  }, [scheduleDragReset]);

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

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (!content) {
        setErrorMessage('Failed to read file content.');
        return;
      }

      try {
        const tasks: Array<{ title: string; seconds?: number }> = [];

        if (file.name.endsWith('.csv')) {
          // Parse CSV format: Task, Time (in minutes)
          const lines = content.split('\n').filter(line => line.trim());
          // Skip header row if it contains "Task" or "Time"
          const startIndex = lines[0] && (lines[0].toLowerCase().includes('task') || lines[0].toLowerCase().includes('time')) ? 1 : 0;

          for (let i = startIndex; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const parts = line.split(',').map(p => p.trim());
            if (parts.length < 1) continue;

            const title = parts[0];
            const timeInMinutes = parts[1] ? parseInt(parts[1], 10) : undefined;
            const seconds = timeInMinutes && !isNaN(timeInMinutes) ? timeInMinutes * 60 : undefined;

            if (title) {
              tasks.push({ title, seconds });
            }
          }
        } else {
          // Parse text format: Task name [HH:MM] or Task name [MM:SS] or Task; x mins
          const lines = content.split('\n').filter(line => line.trim());

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // Check for semicolon format: Task; x mins or Task; x
            const semicolonMatch = trimmed.match(/^(.+?);\s*(\d+)\s*(?:mins?)?$/i);
            if (semicolonMatch) {
              const title = semicolonMatch[1].trim();
              const minutes = parseInt(semicolonMatch[2], 10);
              const seconds = minutes * 60;
              if (title) {
                tasks.push({ title, seconds });
              }
              continue;
            }

            // Check for time in brackets [HH:MM] or [MM:SS]
            const bracketMatch = trimmed.match(/^(.+?)\s*\[(\d{1,2}):(\d{2})\]\s*$/);
            if (bracketMatch) {
              const title = bracketMatch[1].trim();
              const first = parseInt(bracketMatch[2], 10);
              const second = parseInt(bracketMatch[3], 10);
              const seconds = (first * 60) + second;
              tasks.push({ title, seconds });
            } else {
              // No time specified
              tasks.push({ title: trimmed });
            }
          }
        }

        if (tasks.length === 0) {
          setErrorMessage('No valid tasks found in file.');
          return;
        }

        // Add all tasks to the store
        tasks.forEach(task => {
          addTask(task.title, task.seconds);
        });

        setErrorMessage(`Successfully imported ${tasks.length} task${tasks.length === 1 ? '' : 's'}!`);
      } catch (error) {
        console.error('Failed to parse file:', error);
        setErrorMessage('Failed to parse file. Please check the format.');
      }
    };

    reader.onerror = () => {
      setErrorMessage('Failed to read file.');
    };

    reader.readAsText(file);

    // Reset the input so the same file can be uploaded again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [addTask]);

  const handleUploadButtonClick = useCallback(() => {
    setShowUploadMenu(!showUploadMenu);
  }, [showUploadMenu]);

  const handleFileUploadClick = useCallback(() => {
    setShowUploadMenu(false);
    fileInputRef.current?.click();
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (tasksToDelete.length > 0) {
      deleteTasks(tasksToDelete);
      setSelectedTaskIds(new Set());
      setLastSelectedTaskId(null);
      if (selectedTaskId && tasksToDelete.includes(selectedTaskId)) {
        setSelectedTaskId(null);
      }
    }
    setShowDeleteConfirm(false);
    setTasksToDelete([]);
  }, [tasksToDelete, deleteTasks, selectedTaskId]);

  const handleCancelDelete = useCallback(() => {
    setShowDeleteConfirm(false);
    setTasksToDelete([]);
  }, []);

  const handleBulkTaskSubmit = useCallback((tasksText: string) => {
    try {
      const tasks: Array<{ title: string; seconds?: number }> = [];
      const lines = tasksText.split('\n').filter(line => line.trim());

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Check for semicolon format: Task; x mins or Task; x
        const semicolonMatch = trimmed.match(/^(.+?);\s*(\d+)\s*(?:mins?)?$/i);
        if (semicolonMatch) {
          const title = semicolonMatch[1].trim();
          const minutes = parseInt(semicolonMatch[2], 10);
          const seconds = minutes * 60;
          if (title) {
            tasks.push({ title, seconds });
          }
          continue;
        }

        // Check for time in brackets [HH:MM] or [MM:SS]
        const bracketMatch = trimmed.match(/^(.+?)\s*\[(\d{1,2}):(\d{2})\]\s*$/);
        if (bracketMatch) {
          const title = bracketMatch[1].trim();
          const first = parseInt(bracketMatch[2], 10);
          const second = parseInt(bracketMatch[3], 10);
          const seconds = (first * 60) + second;
          tasks.push({ title, seconds });
        } else {
          // No time specified
          tasks.push({ title: trimmed });
        }
      }

      if (tasks.length === 0) {
        setErrorMessage('No valid tasks found.');
        return;
      }

      // Add all tasks to the store
      tasks.forEach(task => {
        addTask(task.title, task.seconds);
      });

      setErrorMessage(`Successfully added ${tasks.length} task${tasks.length === 1 ? '' : 's'}!`);
      setShowBulkTaskModal(false);
    } catch (error) {
      console.error('Failed to parse tasks:', error);
      setErrorMessage('Failed to parse tasks. Please check the format.');
    }
  }, [addTask]);

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

  const startMinimalModeCountdown = useCallback(() => {
    if (minimalModeTimerRef.current) {
      clearTimeout(minimalModeTimerRef.current);
      minimalModeTimerRef.current = null;
    }

    if (!shouldBeMinimal) {
      if (focusSpotlightOpenRef.current) {
        updateFocusSpotlightOpen(false);
      }
      return;
    }

    if (!alwaysOnTopEnabled) {
      return;
    }

    if (focusSpotlightOpenRef.current) {
      return;
    }

    minimalModeTimerRef.current = setTimeout(() => {
      updateFocusSpotlightOpen(true);
      minimalModeTimerRef.current = null;
    }, 30000);
  }, [shouldBeMinimal, alwaysOnTopEnabled, updateFocusSpotlightOpen]);

  const handleExpandMinimal = useCallback(() => {
    if (!isMinimalMode) {
      return;
    }

    updateFocusSpotlightOpen(false);

    if (!electronApi) {
      return;
    }

    const fallback = previousWindowSizeRef.current ?? {
      width: Math.max(window.innerWidth, 420),
      height: Math.max(window.innerHeight, 520)
    };

    previousWindowSizeRef.current = null;

    electronApi.setWindowSize?.(fallback.width, fallback.height).catch((error) => {
      console.error('Failed to restore window size from minimal mode', error);
    });

    startMinimalModeCountdown();
  }, [electronApi, isMinimalMode, startMinimalModeCountdown, updateFocusSpotlightOpen]);

  const handleFocusMode = useCallback(async () => {
    if (!activeTask || !electronApi) {
      return;
    }
    clearInactivityTimer();
    updateFocusSpotlightOpen(true);
    await electronApi.setWindowSize?.(340, 240);
    await electronApi.moveWindowToTopRight?.();
  }, [activeTask, electronApi, clearInactivityTimer, updateFocusSpotlightOpen]);

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
      clearInactivityTimer();
      startMinimalModeCountdown();
      return;
    }

    // Active task exists - cancel minimal mode timer
    if (minimalModeTimerRef.current) {
      clearTimeout(minimalModeTimerRef.current);
      minimalModeTimerRef.current = null;
    }

    const activeId = activeTask.id;
    const isNewTask = lastTrackedTaskIdRef.current !== activeId;
    lastTrackedTaskIdRef.current = activeId;

    if (!focusSpotlightOpenRef.current && (isNewTask || !inactivityTimerRef.current)) {
      scheduleFocusSpotlight();
    }
  }, [activeTask, scheduleFocusSpotlight, clearInactivityTimer, startMinimalModeCountdown]);

  useEffect(() => {
    if (!activeTask) {
      startMinimalModeCountdown();
    }
  }, [activeTask, alwaysOnTopEnabled, shouldBeMinimal, startMinimalModeCountdown]);

  useEffect(() => {
    if (selectedTaskId && !state.tasks.find((t) => t.id === selectedTaskId)) {
      setSelectedTaskId(null);
    }
  }, [selectedTaskId, state.tasks]);

  // Cancel minimal mode timer if PIN is turned off
  useEffect(() => {
    if (!alwaysOnTopEnabled && minimalModeTimerRef.current) {
      clearTimeout(minimalModeTimerRef.current);
      minimalModeTimerRef.current = null;
    }
  }, [alwaysOnTopEnabled]);

  useEffect(() => {
    if (focusSpotlightOpenState) {
      document.body.classList.add('hide-scrollbar');
    } else {
      document.body.classList.remove('hide-scrollbar');
    }
  }, [focusSpotlightOpenState]);

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

  // Auto-resize and reposition window when entering/exiting minimal mode
  useEffect(() => {
    if (!hydrated || !electronApi) {
      return;
    }

    if (isMinimalMode) {
      if (!previousWindowSizeRef.current) {
        previousWindowSizeRef.current = {
          width: Math.max(window.innerWidth, 340),
          height: Math.max(window.innerHeight, 240)
        };
      }

      // Enter minimal mode: resize small and move to top-right
      electronApi.setWindowSize?.(340, 80).then(() => {
        return electronApi.moveWindowToTopRight?.();
      }).catch((error) => {
        console.error('Failed to resize window for minimal mode', error);
      });
    } else if (focusSpotlightOpenState && !shouldBeMinimal) {
      previousWindowSizeRef.current = null;
      // Regular focus spotlight mode with active task
      electronApi.setWindowSize?.(340, 240).then(() => {
        return electronApi.moveWindowToTopRight?.();
      }).catch((error) => {
        console.error('Failed to resize window for focus mode', error);
      });
    } else if (previousWindowSizeRef.current) {
      const { width, height } = previousWindowSizeRef.current;
      previousWindowSizeRef.current = null;
      electronApi.setWindowSize?.(width, height).catch((error) => {
        console.error('Failed to restore window size after minimal mode', error);
      });
    }
  }, [isMinimalMode, focusSpotlightOpenState, shouldBeMinimal, hydrated, electronApi]);

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
    focusSpotlightOpenState && !isMinimalMode
      ? 'pointer-events-none opacity-0'
      : 'border-2 border-brand-ice/5 rounded-3xl shadow-[0_0_30px_rgba(148,187,233,0.08)]'
  }`;

  return (
      <div className={rootClasses} style={dragLayerStyle}>
        <div className={appContainerClasses}>
        <div className={`relative ${isMinimalMode ? 'group' : ''}`}>
          <TitleBar
            alwaysOnTop={alwaysOnTopEnabled}
            isMaximized={isWindowMaximized}
            onToggleAlwaysOnTop={handleToggleAlwaysOnTop}
            onMinimize={() => electronApi?.minimizeWindow?.()}
            onToggleMaximize={() => electronApi?.toggleMaximizeWindow?.()}
            onClose={() => electronApi?.closeWindow?.()}
          />
          {isMinimalMode && (
            <div className="pointer-events-none absolute left-1/2 top-full mt-2 -translate-x-1/2">
              <button
                type="button"
                className="app-region-no-drag pointer-events-auto rounded-full border border-brand-ice/40 bg-brand-navy/95 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-brand-ice opacity-0 transition hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-coral group-hover:opacity-100"
                onClick={handleExpandMinimal}
              >
                Show more
              </button>
            </div>
          )}
        </div>
        {!isMinimalMode && (
        <main className="flex flex-1 flex-col gap-4">
  <header className="app-region-no-drag rounded-2xl border border-brand-ice/20 bg-brand-dusk/90 p-4 shadow-xl backdrop-blur">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="text-sm text-brand-ice/70">
                Completed: {state.stats.totalCompleted} total | {state.stats.todayCompleted} today
              </div>
              <button
                onClick={handleAddTask}
                className="rounded-full border-2 border-brand-coral/80 bg-brand-coral/20 px-4 py-2 text-sm font-semibold text-brand-coral transition hover:bg-brand-coral/30 hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-coral"
              >
                + Add Task
              </button>
            </div>
            <div className="font-semibold text-brand-coral text-sm">
              Score: {scoreSign}
              {scoreValue}
            </div>
          </div>
          {activeTask ? (
            <div className="mt-4 rounded-lg border border-brand-teal/50 bg-brand-teal/20 p-3">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <p className="text-xs uppercase tracking-wide text-brand-aqua/80">Active Task</p>
                  <p className="mt-1 text-sm font-semibold text-brand-ice">{activeTask.title}</p>
                  <p className="font-mono text-sm text-brand-aqua/80">
                    Time left: {activeTime} {activeTask.isPaused && <span className="text-brand-coral">(Paused)</span>}
                  </p>
                </div>
                <button
                  type="button"
                  className="flex-shrink-0 ml-3 flex h-10 w-10 items-center justify-center rounded-full border-2 border-brand-aqua/60 bg-brand-aqua/20 text-brand-aqua transition hover:bg-brand-aqua/30 hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-aqua"
                  onClick={() => activeTask.isPaused ? resumeTask(activeTask.id) : pauseTask(activeTask.id)}
                  title={activeTask.isPaused ? 'Resume timer' : 'Pause timer'}
                  aria-label={activeTask.isPaused ? 'Resume timer' : 'Pause timer'}
                >
                  {activeTask.isPaused ? (
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-brand-ice/70">No active task. Add one to get started.</p>
          )}
        </header>

  <section className="app-region-no-drag flex-1 space-y-2 overflow-y-auto rounded-2xl border border-brand-ice/10 bg-brand-dusk/70 p-4 shadow-lg">
          {state.tasks.length === 0 ? (
            <p className="text-center text-sm text-brand-ice/70">Create your first task to begin timeboxing.</p>
          ) : (
            <>
              <DndContext
                sensors={sensors}
                modifiers={[restrictToVerticalAxis]}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragCancel={handleDragCancel}
              >
                <SortableContext items={visibleTasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
                  {visibleTasks.map((task, index) => (
                    <SortableTaskRow
                      key={task.id}
                      task={task}
                      index={index}
                      isActive={activeTask?.id === task.id}
                      isSelected={selectedTaskIds.has(task.id)}
                      multiSelectCount={selectedTaskIds.size}
                      onEdit={handleEditTask}
                      onSelect={handleSelectTask}
                      onAddTime={handleTaskAddTime}
                      onDelete={handleTaskDelete}
                      onDeleteMultiple={handleDeleteMultiple}
                      onMakeActive={handleMakeActive}
                    />
                  ))}
                </SortableContext>
              </DndContext>
              {hiddenTaskCount > 0 && (
                <button
                  type="button"
                  className="w-full rounded-lg border border-brand-aqua/30 bg-brand-aqua/10 px-3 py-2 text-xs font-semibold text-brand-aqua transition hover:bg-brand-aqua/20"
                  onClick={() => setShowAllTasks(!showAllTasks)}
                >
                  {showAllTasks ? '− Show Less' : `+ Show ${hiddenTaskCount} More Task${hiddenTaskCount === 1 ? '' : 's'}`}
                </button>
              )}
            </>
          )}
        </section>

        <section className="grid grid-cols-4 gap-3">
          <button
            type="button"
            className="rounded-xl border border-brand-coral/80 bg-brand-coral px-3 py-2 text-sm font-semibold text-brand-navy hover:bg-brand-coral/90"
            onClick={handleAddTask}
          >
            + Add Task
          </button>
          <div className="relative" ref={uploadMenuRef}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.csv"
              onChange={handleFileUpload}
              className="hidden"
            />
            <button
              type="button"
              className="w-full rounded-xl border border-brand-aqua/70 bg-brand-aqua/20 px-3 py-2 text-sm font-semibold text-brand-aqua hover:bg-brand-aqua/30"
              onClick={handleUploadButtonClick}
            >
              Upload ▼
            </button>
            {showUploadMenu && (
              <div className="absolute bottom-full left-0 z-50 mb-2 w-full rounded-lg border border-brand-aqua/40 bg-brand-dusk shadow-xl">
                <button
                  type="button"
                  className="w-full px-4 py-2 text-left text-sm text-brand-aqua hover:bg-brand-aqua/10 rounded-t-lg transition-colors"
                  onClick={handleFileUploadClick}
                >
                  Upload File
                </button>
                <button
                  type="button"
                  className="w-full px-4 py-2 text-left text-sm text-brand-aqua hover:bg-brand-aqua/10 rounded-b-lg transition-colors"
                  onClick={() => {
                    setShowUploadMenu(false);
                    setShowBulkTaskModal(true);
                  }}
                >
                  Enter Tasks
                </button>
              </div>
            )}
          </div>
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

        <div className="flex gap-2">
          <button
            type="button"
            className="flex-1 rounded-xl border border-brand-coral/50 bg-brand-coral/20 px-3 py-2 text-sm font-semibold text-brand-coral transition hover:bg-brand-coral/25 disabled:cursor-not-allowed disabled:border-brand-ice/10 disabled:bg-brand-dusk/50 disabled:text-brand-ice/30"
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
          <button
            type="button"
            className="flex-1 rounded-xl border border-brand-teal/50 bg-brand-teal/20 px-3 py-2 text-sm font-semibold text-brand-teal transition hover:bg-brand-teal/25 disabled:cursor-not-allowed disabled:border-brand-ice/10 disabled:bg-brand-dusk/50 disabled:text-brand-ice/30"
            onClick={handleFocusMode}
            disabled={!activeTask}
            title="Activate spotlight, minimize window, and move to top-right corner"
          >
            Focus Mode
          </button>
        </div>

        <footer className="text-xs text-brand-ice/60">
          {pendingCount > 0 ? `${pendingCount} task${pendingCount === 1 ? '' : 's'} pending` : 'All tasks completed'}
        </footer>
        </main>
        )}
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

      <BulkTaskModal
        open={showBulkTaskModal}
        onSubmit={handleBulkTaskSubmit}
        onCancel={() => setShowBulkTaskModal(false)}
      />

      <ReminderPopup
        open={reminderOpen}
        taskTitle={activeTask?.title}
        onSetTime={handleReminderSetTime}
        onRemindLater={handleReminderSnooze}
        onCloseApp={handleReminderCloseApp}
      />

      {!isMinimalMode && (
        <FocusSpotlight
          open={focusSpotlightOpenState}
          taskTitle={activeTask?.title}
          timeRemaining={activeTime}
          onClose={() => {
            updateFocusSpotlightOpen(false);
          }}
        />
      )}

      {errorMessage ? (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border border-brand-coral bg-brand-coral/15 px-4 py-2 text-sm text-brand-coral shadow-lg">
          {errorMessage}
        </div>
      ) : null}

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-brand-ice/30 bg-brand-navy p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-brand-ice mb-2">Confirm Deletion</h3>
            <p className="text-sm text-brand-ice/80 mb-6">
              Are you sure you want to delete <span className="font-semibold text-brand-coral">{tasksToDelete.length} tasks</span>? This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                className="flex-1 rounded-lg border border-brand-ice/40 bg-brand-dusk/80 px-4 py-2 text-sm font-semibold text-brand-ice hover:bg-brand-dusk transition"
                onClick={handleCancelDelete}
              >
                Cancel
              </button>
              <button
                type="button"
                className="flex-1 rounded-lg border border-red-500 bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 transition"
                onClick={handleConfirmDelete}
              >
                Delete {tasksToDelete.length} Tasks
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
