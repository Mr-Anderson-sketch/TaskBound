import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { combineToSeconds, splitSeconds } from '../utils/time';
import { MAX_TASK_MINUTES } from '../utils/parse';

interface SheetProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}

export function Sheet({ title, subtitle, onClose, children }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    const first = ref.current?.querySelector<HTMLElement>('textarea, input, button.primary');
    first?.focus();
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={ref} className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {subtitle ? <p className="sub">{subtitle}</p> : null}
        {children}
      </div>
    </div>
  );
}

const PRESETS = [15, 25, 45, 60, 90];

function DurationPicker({ minutes, onChange }: { minutes: number; onChange: (minutes: number) => void }) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const set = (h: number, m: number) => onChange(Math.min(MAX_TASK_MINUTES, Math.max(0, h * 60 + m)));
  return (
    <>
      <div className="presets" role="group" aria-label="Quick durations">
        {PRESETS.map((preset) => (
          <button key={preset} type="button" aria-pressed={minutes === preset} onClick={() => onChange(preset)}>
            {preset >= 60 ? `${preset / 60 === 1 ? '1h' : `${preset / 60}h`}` : `${preset}m`}
          </button>
        ))}
      </div>
      <div className="split">
        <label className="field">
          Hours
          <input
            type="number"
            min={0}
            max={MAX_TASK_MINUTES / 60}
            value={hours}
            onChange={(event) => set(Number(event.target.value) || 0, mins)}
          />
        </label>
        <label className="field">
          Minutes
          <input type="number" min={0} max={59} value={mins} onChange={(event) => set(hours, Math.min(59, Number(event.target.value) || 0))} />
        </label>
      </div>
    </>
  );
}

interface TaskSheetProps {
  mode: 'create' | 'edit';
  initialTitle?: string;
  initialSeconds?: number;
  requireTime: boolean;
  onSubmit: (payload: { title: string; seconds?: number }) => void;
  onClose: () => void;
}

export function TaskSheet({ mode, initialTitle = '', initialSeconds, requireTime, onSubmit, onClose }: TaskSheetProps) {
  const initial = splitSeconds(initialSeconds);
  const [title, setTitle] = useState(initialTitle);
  const [minutes, setMinutes] = useState(initialSeconds ? initial.hours * 60 + initial.minutes : 25);
  const [useTime, setUseTime] = useState(mode === 'create' || requireTime || initialSeconds !== undefined);
  const [error, setError] = useState<string | null>(null);

  const seconds = useTime ? combineToSeconds(0, minutes) : undefined;
  const costsPoint = mode === 'edit' && (initialSeconds ?? 0) > 0 && (seconds ?? 0) > (initialSeconds ?? 0);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setError('Give the task a name.');
      return;
    }
    if (useTime && (!seconds || seconds <= 0)) {
      setError('Pick a time above zero.');
      return;
    }
    if (!useTime && requireTime) {
      setError('This task needs a time so the timer can run.');
      return;
    }
    onSubmit({ title: title.trim(), seconds });
  };

  return (
    <Sheet title={mode === 'create' ? 'New task' : 'Edit task'} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label className="field">
          Task
          <textarea
            rows={2}
            value={title}
            placeholder="What are you doing?"
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                submit(event);
              }
            }}
          />
        </label>
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, color: 'var(--text)', fontSize: 13 }}>
          <input type="checkbox" checked={useTime} onChange={(event) => setUseTime(event.target.checked)} style={{ width: 16, height: 16 }} />
          Time limit {requireTime ? '(needed)' : ''}
        </label>
        {useTime ? <DurationPicker minutes={minutes} onChange={setMinutes} /> : null}
        {costsPoint ? <p className="sub" style={{ margin: 0 }}>Adding time costs 1 point.</p> : null}
        {error ? <p className="error">{error}</p> : null}
        <footer>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            {mode === 'create' ? 'Add task' : costsPoint ? 'Save · −1 point' : 'Save'}
          </button>
        </footer>
      </form>
    </Sheet>
  );
}

const ADD_PRESETS = [5, 10, 15, 30];

export function AddTimeSheet({ taskTitle, onSubmit, onClose }: { taskTitle: string; onSubmit: (seconds: number) => void; onClose: () => void }) {
  const [minutes, setMinutes] = useState(5);
  return (
    <Sheet title="Add time" subtitle={`To “${taskTitle}”. Adding time costs 1 point.`} onClose={onClose}>
      <div className="presets" role="group" aria-label="Minutes to add">
        {ADD_PRESETS.map((preset) => (
          <button key={preset} type="button" aria-pressed={minutes === preset} onClick={() => setMinutes(preset)}>
            +{preset}m
          </button>
        ))}
      </div>
      <label className="field">
        Minutes
        <input type="number" min={1} max={180} value={minutes} onChange={(event) => setMinutes(Math.min(180, Math.max(0, Number(event.target.value) || 0)))} />
      </label>
      <footer>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn primary" disabled={minutes <= 0} onClick={() => onSubmit(minutes * 60)}>
          Add {minutes}m
        </button>
      </footer>
    </Sheet>
  );
}

export function BulkSheet({ onSubmit, onClose }: { onSubmit: (text: string) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  return (
    <Sheet title="Add several tasks" subtitle="One per line. Times are optional." onClose={onClose}>
      <p className="formats">
        Write intro 25m
        <br />
        Deep work 1h30
        <br />
        Review deck [00:45]
        <br />
        Call Priya
      </p>
      <label className="field">
        Tasks
        <textarea rows={7} value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      <footer>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn primary" disabled={!text.trim()} onClick={() => onSubmit(text)}>
          Add tasks
        </button>
      </footer>
    </Sheet>
  );
}

export function ConfirmSheet({
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet title={title} subtitle={body} onClose={onClose}>
      <footer>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn danger primary" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </footer>
    </Sheet>
  );
}

export function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  const mod = /Mac/i.test(navigator.userAgent) ? '⌘' : 'Ctrl';
  const rows: Array<[string, string]> = [
    [`${mod} ⇧ Space`, 'Quick add, from any app'],
    ['N', 'Add a task'],
    ['Space', 'Pause / resume'],
    [`${mod} ↵`, 'Complete current task'],
    [`${mod} =`, 'Add 5 minutes'],
    ['F', 'Focus mode'],
    ['Esc', 'Leave focus mode'],
    ['Delete', 'Delete selected tasks']
  ];
  return (
    <Sheet title="Keyboard shortcuts" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(([keys, label]) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
            <span>{label}</span>
            <span className="kbd">{keys}</span>
          </div>
        ))}
      </div>
      <footer>
        <button type="button" className="btn primary" onClick={onClose}>
          Done
        </button>
      </footer>
    </Sheet>
  );
}
