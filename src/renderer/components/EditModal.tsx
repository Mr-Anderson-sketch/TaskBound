import { useEffect, useMemo, useState, ChangeEvent } from 'react';
import { combineToSeconds, splitSeconds } from '../utils/time';

interface EditModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  heading: string;
  subtitle?: string;
  initialTitle?: string;
  initialSeconds?: number;
  requireTime?: boolean;
  confirmLabel?: string;
  onSubmit: (payload: { title: string; seconds?: number }) => void;
  onCancel: () => void;
}

export function EditModal({
  open,
  mode,
  heading,
  subtitle,
  initialTitle = '',
  initialSeconds,
  requireTime = false,
  confirmLabel,
  onSubmit,
  onCancel
}: EditModalProps) {
  const initialTime = useMemo(() => splitSeconds(initialSeconds), [initialSeconds]);
  const [title, setTitle] = useState(initialTitle);
  const [minutes, setMinutes] = useState<number>(initialTime.minutes);
  const [seconds, setSeconds] = useState<number>(initialTime.seconds);
  const [useTime, setUseTime] = useState<boolean>(initialSeconds !== undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle(initialTitle);
      setMinutes(initialTime.minutes);
      setSeconds(initialTime.seconds);
      setUseTime(initialSeconds !== undefined);
      setError(null);
    }
  }, [open, initialTitle, initialSeconds, initialTime.minutes, initialTime.seconds]);

  if (!open) {
    return null;
  }

  const handleSubmit = () => {
    if (!title.trim()) {
      setError('Task title is required.');
      return;
    }

    let computedSeconds: number | undefined;
    if (useTime) {
      computedSeconds = combineToSeconds(minutes, seconds);
      if (computedSeconds <= 0) {
        setError('Please provide a positive amount of time.');
        return;
      }
    } else if (requireTime) {
      setError('Please provide a time limit before continuing.');
      return;
    }

    onSubmit({ title: title.trim(), seconds: computedSeconds });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-navy/85 px-4">
      <div className="w-full max-w-md rounded-xl border border-brand-teal/40 bg-brand-dusk p-6 shadow-2xl">
        <header className="mb-4">
          <h2 className="text-lg font-semibold text-brand-ice">{heading}</h2>
          {subtitle ? <p className="mt-1 text-sm text-brand-ice/80">{subtitle}</p> : null}
        </header>
        <div className="space-y-4">
          <label className="block text-sm font-medium text-brand-ice">
            Task Title
            <textarea
              className="mt-2 w-full resize-none rounded-md border border-brand-teal/40 bg-brand-navy px-3 py-2 text-sm text-brand-ice focus:border-brand-coral focus:outline-none focus:ring-1 focus:ring-brand-coral/60"
              rows={3}
              value={title}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setTitle(event.target.value)}
              placeholder="Describe the task"
            />
          </label>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <input
                id="edit-modal-time-toggle"
                type="checkbox"
                className="h-4 w-4 rounded border-brand-teal/40 bg-brand-navy text-brand-coral focus:ring-brand-coral/60"
                checked={useTime}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setUseTime(event.target.checked)}
              />
              <label htmlFor="edit-modal-time-toggle" className="text-sm text-brand-ice">
                Attach time limit
              </label>
            </div>
            <div className="flex items-center gap-2 text-xs text-brand-ice/70">
              <span>Time required: {requireTime ? 'Yes' : 'Optional'}</span>
            </div>
          </div>
          {useTime ? (
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm text-brand-ice">
                Minutes
                <input
                  type="number"
                  min={0}
                  className="mt-1 w-full rounded-md border border-brand-teal/40 bg-brand-navy px-3 py-2 text-sm text-brand-ice focus:border-brand-coral focus:outline-none focus:ring-1 focus:ring-brand-coral/60"
                  value={minutes}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setMinutes(Number(event.target.value))}
                />
              </label>
              <label className="text-sm text-brand-ice">
                Seconds
                <input
                  type="number"
                  min={0}
                  max={59}
                  className="mt-1 w-full rounded-md border border-brand-teal/40 bg-brand-navy px-3 py-2 text-sm text-brand-ice focus:border-brand-coral focus:outline-none focus:ring-1 focus:ring-brand-coral/60"
                  value={seconds}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setSeconds(Number(event.target.value))}
                />
              </label>
            </div>
          ) : null}
          {error ? <p className="text-sm text-brand-coral">{error}</p> : null}
        </div>
        <footer className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            className="rounded-md border border-brand-ice/30 px-4 py-2 text-sm font-medium text-brand-ice hover:border-brand-ice/60"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-md bg-brand-coral px-4 py-2 text-sm font-semibold text-brand-navy hover:bg-brand-coral/90"
            onClick={handleSubmit}
          >
            {confirmLabel ?? (mode === 'create' ? 'Add Task' : 'Save Changes')}
          </button>
        </footer>
      </div>
    </div>
  );
}
