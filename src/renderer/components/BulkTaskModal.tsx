import { useState } from 'react';

interface BulkTaskModalProps {
  open: boolean;
  onSubmit: (tasksText: string) => void;
  onCancel: () => void;
}

export function BulkTaskModal({ open, onSubmit, onCancel }: BulkTaskModalProps) {
  const [tasksText, setTasksText] = useState('');

  if (!open) {
    return null;
  }

  const handleSubmit = () => {
    if (tasksText.trim()) {
      onSubmit(tasksText);
      setTasksText('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-navy/85 px-4">
      <div className="w-full max-w-lg rounded-lg border border-brand-aqua/40 bg-brand-dusk p-5 shadow-2xl">
        <h3 className="text-base font-semibold text-brand-ice">Add Multiple Tasks</h3>
        <p className="mt-2 text-sm text-brand-ice/80">Enter tasks one per line. Supported formats:</p>
        <div className="mt-2 space-y-1 text-xs text-brand-ice/60">
          <p>• Task name [HH:MM] - e.g., "Write report [01:30]"</p>
          <p>• Task; x mins - e.g., "Testing123; 5"</p>
          <p>• Task name - e.g., "Call John" (no time)</p>
        </div>

        <textarea
          value={tasksText}
          onChange={(e) => setTasksText(e.target.value)}
          placeholder="Review presentation [00:45]&#10;Testing123; 15&#10;Email team&#10;Update documentation; 30"
          className="app-region-no-drag mt-4 w-full rounded-md border border-brand-aqua/40 bg-brand-navy px-3 py-2 text-sm text-brand-ice placeholder:text-brand-ice/40 focus:border-brand-coral focus:outline-none focus:ring-1 focus:ring-brand-coral/60 resize-none"
          rows={8}
        />

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            className="rounded-md border border-brand-ice/30 px-4 py-2 text-sm text-brand-ice hover:border-brand-ice/60"
            onClick={() => {
              setTasksText('');
              onCancel();
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-md bg-brand-aqua px-4 py-2 text-sm font-semibold text-brand-navy hover:bg-brand-aqua/90 disabled:cursor-not-allowed disabled:bg-brand-aqua/40 disabled:text-brand-navy/50"
            onClick={handleSubmit}
            disabled={!tasksText.trim()}
          >
            Add Tasks
          </button>
        </div>
      </div>
    </div>
  );
}
