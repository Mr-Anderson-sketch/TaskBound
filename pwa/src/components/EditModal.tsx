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
  onCancel,
}: EditModalProps) {
  const initialTime = useMemo(() => splitSeconds(initialSeconds), [initialSeconds]);
  const MAX_TOTAL_MINUTES = 240;
  const MAX_HOURS = Math.floor(MAX_TOTAL_MINUTES / 60);
  const clampDuration = (rawHours: number, rawMinutes: number) => {
    const safeHours = Number.isFinite(rawHours) ? Math.max(0, Math.floor(rawHours)) : 0;
    const safeMinutes = Number.isFinite(rawMinutes) ? Math.max(0, Math.floor(rawMinutes)) : 0;
    const combinedMinutes = safeHours * 60 + safeMinutes;
    const limitedMinutes = Math.min(MAX_TOTAL_MINUTES, combinedMinutes);
    return {
      hours: Math.min(MAX_HOURS, Math.floor(limitedMinutes / 60)),
      minutes: limitedMinutes % 60
    };
  };
  const [title, setTitle] = useState(initialTitle);
  const normalizedInitial = clampDuration(initialTime.hours, initialTime.minutes);
  const [hours, setHours] = useState<number>(normalizedInitial.hours);
  const [minutes, setMinutes] = useState<number>(normalizedInitial.minutes);
  const [useTime, setUseTime] = useState<boolean>(initialSeconds !== undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle(initialTitle);
      const clamped = clampDuration(initialTime.hours, initialTime.minutes);
      setHours(clamped.hours);
      setMinutes(clamped.minutes);
      setUseTime(initialSeconds !== undefined);
      setError(null);
    }
  }, [open, initialTitle, initialSeconds, initialTime.hours, initialTime.minutes]);

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
      computedSeconds = combineToSeconds(hours, minutes);
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
      <div className="w-full max-w-md rounded-xl border border-brand-teal/40 bg-brand-dusk p-6 shadow-2xl flex flex-col max-h-[80vh]">
        <header className="mb-4 app-region-no-drag">
          <h2 className="modal-heading font-semibold text-brand-ice">{heading}</h2>
          {subtitle ? <p className="modal-subtitle mt-1 text-brand-ice/80">{subtitle}</p> : null}
        </header>
        <div className="space-y-4 overflow-auto flex-1">
          <label className="modal-label block font-medium text-brand-ice">
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
              <label htmlFor="edit-modal-time-toggle" className="modal-label text-brand-ice">
                Attach time limit
              </label>
            </div>
            <div className="flex items-center gap-2 text-xs text-brand-ice/70">
              <span>Time required: {requireTime ? 'Yes' : 'Optional'}</span>
            </div>
          </div>
          {useTime ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <label className="modal-label block text-brand-ice">
                  Hours
                  <input
                    type="number"
                    min={0}
                    max={MAX_HOURS}
                    className="app-region-no-drag mt-2 w-full rounded-md border border-brand-teal/40 bg-brand-navy px-3 py-2 text-sm text-brand-ice focus:border-brand-coral focus:outline-none focus:ring-1 focus:ring-brand-coral/60"
                    value={hours}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => {
                      const raw = Number(event.target.value);
                      setHours((previous) => {
                        if (Number.isNaN(raw)) {
                          return previous;
                        }
                        const safe = Math.max(0, Math.min(MAX_HOURS, Math.floor(raw)));
                        const totalMinutes = safe * 60 + minutes;
                        if (totalMinutes > MAX_TOTAL_MINUTES) {
                          const clampedTotal = Math.min(MAX_TOTAL_MINUTES, totalMinutes);
                          setMinutes(clampedTotal % 60);
                          return Math.floor(clampedTotal / 60);
                        }
                        return safe;
                      });
                    }}
                  />
                </label>
                <label className="modal-label block text-brand-ice">
                  Minutes
                  <input
                    type="number"
                    min={0}
                    max={59}
                    className="app-region-no-drag mt-2 w-full rounded-md border border-brand-teal/40 bg-brand-navy px-3 py-2 text-sm text-brand-ice focus:border-brand-coral focus:outline-none focus:ring-1 focus:ring-brand-coral/60"
                    value={minutes}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => {
                      const raw = Number(event.target.value);
                      setMinutes((previous) => {
                        if (Number.isNaN(raw)) {
                          return previous;
                        }
                        const safe = Math.max(0, Math.min(59, Math.floor(raw)));
                        const totalMinutes = hours * 60 + safe;
                        if (totalMinutes > MAX_TOTAL_MINUTES) {
                          const clampedTotal = Math.min(MAX_TOTAL_MINUTES, totalMinutes);
                          setHours(Math.floor(clampedTotal / 60));
                          return clampedTotal % 60;
                        }
                        return safe;
                      });
                    }}
                  />
                </label>
              </div>
              <p className="modal-subtitle text-brand-ice/60">
                Maximum task length is {Math.floor(MAX_TOTAL_MINUTES / 60)}h {(MAX_TOTAL_MINUTES % 60).toString().padStart(2, '0')}m.
              </p>
            </div>
          ) : null}
          {error ? <p className="text-sm text-brand-coral">{error}</p> : null}
        </div>
  <footer className="mt-6 flex justify-end gap-3 app-region-no-drag">
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

