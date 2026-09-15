// renderer/planner/Detail — the planner's detail pane (Task 4.3 addendum ruling 3):
// title, list, tags, due, repeats, snooze, notes (autosaved), the timer block, and
// sub-tasks. Layout ("three": fixed 300 px column, "two": inline card under the row) is
// the caller's job (PlannerApp.tsx) — this component only renders its content and
// handles Escape (closes, returns focus to the list via `onClose`).
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { Action, Data, Due, Task } from '../../core/types';
import type { ActionInput } from '../lib/useStore';
import { childrenOf, currentTask, isSnoozed } from '../../core/select';
import { describeRule, nextOccurrence } from '../../core/recur';
import { ymd, addDays } from '../../core/dates';
import { fmtClock } from '../../core/timer';
import { useDisplayTime } from '../lib/useDisplayTime';
import { INBOX_ID } from '../../core/defaults';
import { DueField } from './DueField';
import { Menu } from './Menu';
import { TagInput } from './TagInput';
import { SubTasks } from './SubTasks';
import { RecurrenceEditor } from './RecurrenceEditor';
import { shortDateLabel } from './TaskRow';
import { snoozeOptions } from './keys';

export interface DetailProps {
  task: Task;
  data: Data;
  now: number;
  dispatchOwn: (action: ActionInput) => void;
  onClose: () => void;
  /** Task 4.3 addendum ruling 6: clicking a tag chip navigates to that tag's view. */
  onNavigateTag?: (tag: string) => void;
}

function dueLabel(due: Due): string {
  return due.time ? `${shortDateLabel(due.date)} · ${due.time}` : shortDateLabel(due.date);
}

function snoozeLabel(until: number): string {
  const d = new Date(until);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${shortDateLabel(ymd(until))} · ${hh}:${mm}`;
}

const PLANNED_MIN = 1;
const PLANNED_MAX = 240;

export function Detail({ task, data, now, dispatchOwn, onClose, onNavigateTag }: DetailProps) {
  // --- title -------------------------------------------------------------------
  const [titleValue, setTitleValue] = useState(task.title);
  useEffect(() => setTitleValue(task.title), [task.id, task.title]);
  const commitTitle = (): void => {
    const trimmed = titleValue.trim();
    if (trimmed !== '' && trimmed !== task.title) dispatchOwn({ type: 'task/edit', id: task.id, patch: { title: trimmed } });
    else setTitleValue(task.title);
  };

  // --- tags: local optimistic echo, like title/notes below — TagInput's own "add"
  // computes the next array from whatever `tags` it was LAST given, so two adds fired in
  // quick succession (well within the store's IPC round-trip) must see the first add
  // reflected immediately rather than both racing off the same stale `task.tags`. -----
  const [tags, setTags] = useState(task.tags);
  useEffect(() => setTags(task.tags), [task.id]);
  const updateTags = (next: string[]): void => {
    setTags(next);
    dispatchOwn({ type: 'task/edit', id: task.id, patch: { tags: next } });
  };

  // --- due ------------------------------------------------------------------
  const dueButtonRef = useRef<HTMLButtonElement>(null);
  const [dueOpen, setDueOpen] = useState(false);

  // --- repeats ----------------------------------------------------------------
  const [recurOpen, setRecurOpen] = useState(false);
  const today = ymd(now);

  // --- snooze -------------------------------------------------------------------
  const snoozeButtonRef = useRef<HTMLButtonElement>(null);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [snoozePicking, setSnoozePicking] = useState(false);
  const snoozed = isSnoozed(task, now);

  // --- notes: autosave 500 ms after the last keystroke, and on blur -----------
  const [notes, setNotes] = useState(task.notes ?? '');
  useEffect(() => setNotes(task.notes ?? ''), [task.id, task.notes]);
  const notesTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const saveNotes = (value: string): void => {
    if (value === (task.notes ?? '')) return;
    dispatchOwn({ type: 'task/edit', id: task.id, patch: { notes: value === '' ? undefined : value } });
  };
  const onNotesChange = (value: string): void => {
    setNotes(value);
    clearTimeout(notesTimerRef.current);
    notesTimerRef.current = setTimeout(() => saveNotes(value), 500);
  };
  useEffect(() => () => clearTimeout(notesTimerRef.current), []);

  // --- timer --------------------------------------------------------------------
  const display = useDisplayTime(task.timer);
  const isRunning = task.timer?.runningSince !== undefined;
  const plannedMinutes = task.timer?.plannedSeconds !== undefined ? Math.round(task.timer.plannedSeconds / 60) : undefined;
  const [plannedInput, setPlannedInput] = useState(plannedMinutes !== undefined ? String(plannedMinutes) : '');
  useEffect(() => setPlannedInput(plannedMinutes !== undefined ? String(plannedMinutes) : ''), [task.id, plannedMinutes]);

  // Context rule (addendum): every planner control that starts a timer calls
  // `timer:toggle` when the task IS the current task; dispatches `timer/start` for a
  // non-current task only when pomodoro is off; when pomodoro is on and the task isn't
  // current, `task/makeCurrent` first, then `timer:toggle`. Pause/Stop dispatch
  // `timer/pause`/`timer/stop` directly.
  const onStartPause = async (): Promise<void> => {
    if (isRunning) {
      dispatchOwn({ type: 'timer/pause', id: task.id });
      return;
    }
    const current = currentTask(data, now);
    if (current?.id === task.id) {
      await window.tb.invoke('timer:toggle');
    } else if (data.settings.timer.pomodoro) {
      await window.tb.invoke('store:dispatch', { type: 'task/makeCurrent', id: task.id, now: Date.now() } as Action);
      await window.tb.invoke('timer:toggle');
    } else {
      dispatchOwn({ type: 'timer/start', id: task.id });
    }
  };
  const onStop = (): void => dispatchOwn({ type: 'timer/stop', id: task.id });

  const commitPlanned = (): void => {
    const trimmed = plannedInput.trim();
    if (trimmed === '') {
      dispatchOwn({ type: 'task/edit', id: task.id, patch: { plannedSeconds: null } });
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setPlannedInput(plannedMinutes !== undefined ? String(plannedMinutes) : '');
      return;
    }
    const minutes = Math.min(PLANNED_MAX, Math.max(PLANNED_MIN, Math.round(parsed)));
    dispatchOwn({ type: 'task/edit', id: task.id, patch: { plannedSeconds: minutes * 60 } });
  };

  const onEnterBlurs = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
    }
  };

  const onRootKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const sortedLists = [...data.lists].sort((a, b) => (a.id === INBOX_ID ? -1 : b.id === INBOX_ID ? 1 : a.order - b.order));

  return (
    <div className="detail" role="complementary" aria-label="Task details" onKeyDown={onRootKeyDown}>
      <div className="detail-head">
        <input
          type="text"
          className="detail-title"
          aria-label="Task title"
          value={titleValue}
          onChange={(e) => setTitleValue(e.target.value)}
          onKeyDown={onEnterBlurs}
          onBlur={commitTitle}
        />
        <button type="button" className="detail-close" aria-label="Close details" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="detail-row">
        <span className="detail-label">List</span>
        <select
          aria-label="List"
          value={task.listId}
          onChange={(e) => dispatchOwn({ type: 'task/move', id: task.id, listId: e.target.value })}
        >
          {sortedLists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      <div className="detail-row">
        <span className="detail-label">Tags</span>
        <TagInput tags={tags} onChange={updateTags} onTagClick={onNavigateTag} />
      </div>

      <div className="detail-row">
        <span className="detail-label">Due</span>
        <button type="button" ref={dueButtonRef} className="detail-value link" onClick={() => setDueOpen(true)}>
          {task.due ? dueLabel(task.due) : '—'}
        </button>
      </div>
      {dueOpen && dueButtonRef.current && (
        <Menu anchor={dueButtonRef.current} onClose={() => setDueOpen(false)} label="Due date">
          <DueField
            now={now}
            onClose={() => setDueOpen(false)}
            onApply={(due) => {
              dispatchOwn({ type: 'task/edit', id: task.id, patch: { due } });
              setDueOpen(false);
            }}
          />
        </Menu>
      )}

      <div className="detail-row">
        <span className="detail-label">Repeats</span>
        <span className="detail-value">{task.recurrence ? describeRule(task.recurrence) : 'Never'}</span>
        <button type="button" className="btn ghost" onClick={() => setRecurOpen(true)}>
          Edit
        </button>
      </div>
      {recurOpen && (
        <RecurrenceEditor
          rule={task.recurrence}
          anchor={task.due?.date ?? today}
          onClose={() => setRecurOpen(false)}
          onSave={(rule) => {
            const patch: { recurrence: typeof rule; due?: Due } = { recurrence: rule };
            // Ruling 3: "If a recurrence is set and the task has no due date, also set
            // due.date to the first occurrence on or after today."
            if (rule && task.due === undefined) {
              patch.due = { date: nextOccurrence(rule, addDays(today, -1)) };
            }
            dispatchOwn({ type: 'task/edit', id: task.id, patch });
          }}
        />
      )}

      {snoozed && (
        <div className="detail-row">
          <span className="detail-label">Snooze</span>
          <span className="detail-value">{snoozeLabel(task.snoozedUntil!)}</span>
          <button type="button" className="btn ghost" onClick={() => dispatchOwn({ type: 'task/snooze', id: task.id, until: now })}>
            Clear
          </button>
        </div>
      )}
      {!snoozed && (
        <div className="detail-row">
          <span className="detail-label">Snooze</span>
          <button type="button" ref={snoozeButtonRef} className="btn ghost" onClick={() => setSnoozeOpen(true)}>
            Snooze…
          </button>
        </div>
      )}
      {snoozeOpen && snoozeButtonRef.current && (
        <Menu
          anchor={snoozeButtonRef.current}
          onClose={() => {
            setSnoozeOpen(false);
            setSnoozePicking(false);
          }}
          label="Snooze"
          items={!snoozePicking ? snoozeOptions(now).map((o) => ({ id: o.id, label: o.label })) : undefined}
          onSelect={
            !snoozePicking
              ? (id) => {
                  if (id === 'pick') {
                    setSnoozePicking(true);
                    return;
                  }
                  const until = snoozeOptions(now).find((o) => o.id === id)?.until;
                  if (until !== undefined) dispatchOwn({ type: 'task/snooze', id: task.id, until });
                  setSnoozeOpen(false);
                }
              : undefined
          }
        >
          {snoozePicking && (
            <DueField
              now={now}
              onClose={() => {
                setSnoozeOpen(false);
                setSnoozePicking(false);
              }}
              onApply={(due) => {
                if (due) {
                  const at = new Date(due.date + 'T' + (due.time ?? '09:00'));
                  dispatchOwn({ type: 'task/snooze', id: task.id, until: at.getTime() });
                }
                setSnoozeOpen(false);
                setSnoozePicking(false);
              }}
            />
          )}
        </Menu>
      )}

      <textarea
        className="detail-notes"
        aria-label="Notes"
        placeholder="Notes…"
        value={notes}
        onChange={(e) => onNotesChange(e.target.value)}
        onBlur={() => {
          clearTimeout(notesTimerRef.current);
          saveNotes(notes);
        }}
      />

      <div className="detail-timer">
        <span className="detail-clock">{fmtClock(display.seconds)}</span>
        <button type="button" className="btn ghost" onClick={() => void onStartPause()}>
          {isRunning ? 'Pause' : 'Start'}
        </button>
        <button type="button" className="btn ghost" onClick={onStop}>
          Stop
        </button>
        {plannedMinutes !== undefined && <span className="detail-planned">of {plannedMinutes} min</span>}
        <input
          type="number"
          className="detail-planned-input"
          aria-label="Planned minutes"
          min={PLANNED_MIN}
          max={PLANNED_MAX}
          placeholder="min"
          value={plannedInput}
          onChange={(e) => setPlannedInput(e.target.value)}
          onKeyDown={onEnterBlurs}
          onBlur={commitPlanned}
        />
      </div>

      {task.parentId === undefined && <SubTasks parent={task} childTasks={childrenOf(data, task.id)} dispatchOwn={dispatchOwn} />}
    </div>
  );
}
