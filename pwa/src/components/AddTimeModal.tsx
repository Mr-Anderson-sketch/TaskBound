import { ChangeEvent, useEffect, useState } from 'react';

interface AddTimeModalProps {
  open: boolean;
  onSubmit: (seconds: number) => void;
  onCancel: () => void;
}

export function AddTimeModal({ open, onSubmit, onCancel }: AddTimeModalProps) {
  const MIN_TOTAL_MINUTES = 1;
  const MAX_TOTAL_MINUTES = 180;
  const MAX_HOURS = Math.floor(MAX_TOTAL_MINUTES / 60);
  const [hours, setHours] = useState<number>(0);
  const [minutes, setMinutes] = useState<number>(5);

  useEffect(() => {
    if (open) {
      setHours(0);
      setMinutes(5);
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const handleConfirm = () => {
    const totalMinutes = Math.max(MIN_TOTAL_MINUTES, Math.min(MAX_TOTAL_MINUTES, hours * 60 + minutes));
    onSubmit(totalMinutes * 60);
  };

  const clampPair = (nextHours: number, nextMinutes: number) => {
    const safeHours = Number.isFinite(nextHours) ? Math.max(0, Math.min(MAX_HOURS, Math.floor(nextHours))) : 0;
    const safeMinutes = Number.isFinite(nextMinutes) ? Math.max(0, Math.min(59, Math.floor(nextMinutes))) : 0;
    const totalMinutes = safeHours * 60 + safeMinutes;
    const clampedTotal = Math.max(MIN_TOTAL_MINUTES, Math.min(MAX_TOTAL_MINUTES, totalMinutes));
    return {
      hours: Math.floor(clampedTotal / 60),
      minutes: clampedTotal % 60
    };
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-navy/85 px-4">
      <div className="w-full max-w-xs rounded-lg border border-brand-teal/40 bg-brand-dusk p-5 shadow-2xl">
        <h3 className="text-base font-semibold text-brand-ice">Add Time</h3>
        <p className="mt-2 text-sm text-brand-ice/80">Adding time will deduct 1 score point.</p>
        <div className="mt-5 space-y-3">
          <div className="flex items-center justify-between text-xs text-brand-ice/70">
            <span>Time to add</span>
            <span className="rounded-full bg-brand-coral/25 px-2 py-1 text-[11px] font-semibold text-brand-coral">
              {hours > 0 ? `${hours}h ` : ''}{minutes.toString().padStart(2, '0')}m
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-brand-ice/70">
              <span>Hours</span>
              <input
                type="number"
                min={0}
                max={MAX_HOURS}
                value={hours}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  const next = Number(event.target.value);
                  const { hours: h, minutes: m } = clampPair(next, minutes);
                  setHours(h);
                  setMinutes(m);
                }}
                className="app-region-no-drag w-full rounded-md border border-brand-teal/40 bg-brand-navy px-2 py-1 text-sm text-brand-ice focus:border-brand-coral focus:outline-none focus:ring-1 focus:ring-brand-coral/60"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-brand-ice/70">
              <span>Minutes</span>
              <input
                type="number"
                min={0}
                max={59}
                value={minutes}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  const next = Number(event.target.value);
                  const { hours: h, minutes: m } = clampPair(hours, next);
                  setHours(h);
                  setMinutes(m);
                }}
                className="app-region-no-drag w-full rounded-md border border-brand-teal/40 bg-brand-navy px-2 py-1 text-sm text-brand-ice focus:border-brand-coral focus:outline-none focus:ring-1 focus:ring-brand-coral/60"
              />
            </label>
          </div>
          <p className="text-[11px] text-brand-ice/60">
            Maximum additional time is {Math.floor(MAX_TOTAL_MINUTES / 60)}h {(MAX_TOTAL_MINUTES % 60).toString().padStart(2, '0')}m.
          </p>
        </div>
        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            className="rounded-md border border-brand-ice/30 px-4 py-2 text-sm text-brand-ice hover:border-brand-ice/60"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-md bg-brand-coral px-4 py-2 text-sm font-semibold text-brand-navy hover:bg-brand-coral/90"
            onClick={handleConfirm}
          >
            Add Time
          </button>
        </div>
      </div>
    </div>
  );
}
