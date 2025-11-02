interface ReminderPopupProps {
  open: boolean;
  taskTitle?: string;
  onSetTime: () => void;
  onRemindLater: () => void;
  onCloseApp: () => void;
}

export function ReminderPopup({ open, taskTitle, onSetTime, onRemindLater, onCloseApp }: ReminderPopupProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-brand-navy/85 px-4">
      <div className="w-full max-w-sm rounded-lg border border-brand-coral/60 bg-brand-dusk p-5 shadow-2xl">
        <h3 className="text-lg font-semibold text-brand-coral">Time not set</h3>
        <p className="mt-2 text-sm text-brand-ice/80">
          Time not set for current task{taskTitle ? `: "${taskTitle}"` : ''}. Please assign time.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            className="rounded-md bg-brand-coral px-4 py-2 text-sm font-semibold text-brand-navy hover:bg-brand-coral/90"
            onClick={onSetTime}
          >
            Set Time
          </button>
          <button
            type="button"
            className="rounded-md border border-brand-ice/20 px-4 py-2 text-sm font-medium text-brand-ice hover:border-brand-ice/40"
            onClick={onRemindLater}
          >
            Remind Me Later
          </button>
          <button
            type="button"
            className="rounded-md border border-brand-coral px-4 py-2 text-sm font-medium text-brand-coral hover:bg-brand-coral/20"
            onClick={onCloseApp}
          >
            Close App
          </button>
        </div>
      </div>
    </div>
  );
}
