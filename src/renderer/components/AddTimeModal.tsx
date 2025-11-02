import { ChangeEvent, useEffect, useState } from 'react';

interface AddTimeModalProps {
  open: boolean;
  onSubmit: (seconds: number) => void;
  onCancel: () => void;
}

export function AddTimeModal({ open, onSubmit, onCancel }: AddTimeModalProps) {
  const [minutes, setMinutes] = useState<number>(5);

  useEffect(() => {
    if (open) {
      setMinutes(5);
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const handleConfirm = () => {
    const totalSeconds = Math.max(1, Math.floor(minutes * 60));
    onSubmit(totalSeconds);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-navy/85 px-4">
      <div className="w-full max-w-xs rounded-lg border border-brand-teal/40 bg-brand-dusk p-5 shadow-2xl">
        <h3 className="text-base font-semibold text-brand-ice">Add Time</h3>
        <p className="mt-2 text-sm text-brand-ice/80">Adding time will deduct 1 score point.</p>
        <label className="mt-4 block text-sm text-brand-ice">
          Minutes to add
          <input
            type="number"
            min={1}
            max={180}
            className="mt-2 w-full rounded-md border border-brand-teal/40 bg-brand-navy px-3 py-2 text-sm text-brand-ice focus:border-brand-coral focus:outline-none focus:ring-1 focus:ring-brand-coral/60"
            value={minutes}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setMinutes(Number(event.target.value))}
          />
        </label>
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
