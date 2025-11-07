import { useEffect } from 'react';
import type { CSSProperties } from 'react';

interface FocusSpotlightProps {
  open: boolean;
  taskTitle?: string;
  timeRemaining?: string;
  onClose: () => void;
}

export function FocusSpotlight(props: FocusSpotlightProps) {
  const { open, taskTitle, timeRemaining, onClose } = props;

  const overlayStyle = { WebkitAppRegion: 'drag' } as unknown as CSSProperties;

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open || !taskTitle) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-transparent backdrop-blur-2xl p-4 sm:p-6 md:p-10"
      style={overlayStyle}
    >
  <div className="relative flex w-full max-w-3xl flex-col gap-6 overflow-hidden rounded-3xl border border-brand-coral/50 bg-brand-navy/60 p-6 text-brand-ice shadow-[0_35px_60px_-15px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:p-8 md:p-10 app-region-no-drag">
        <button
          type="button"
          className="absolute right-4 top-4 rounded-full border border-brand-coral/70 bg-brand-coral px-3 py-1 text-xs font-semibold text-brand-navy shadow-md transition hover:brightness-110 sm:right-6 sm:py-1.5 sm:text-sm"
          onClick={onClose}
          aria-label="Close focus spotlight"
        >
          ×
        </button>
        <div className="space-y-5 sm:space-y-6">
          <div className="flex items-center justify-center">
            <span className="rounded-full bg-brand-coral/80 px-5 py-1 text-xs font-semibold uppercase tracking-[0.35em] text-brand-navy shadow sm:px-6 sm:text-sm">
              Focus Spotlight
            </span>
          </div>
          <p className="focus-overlay-heading text-center font-bold text-brand-ice">
            {taskTitle}
          </p>
          <div className="text-center">
            <span className="focus-overlay-timer inline-flex items-center justify-center rounded-xl bg-brand-coral/25 px-4 py-2 font-black text-brand-coral sm:px-6">
              {timeRemaining ?? '--:--'}
            </span>
          </div>
          <p className="focus-overlay-subcopy text-center text-brand-ice/70">
            Stay on track—focus on this single task until the timer completes.
          </p>
        </div>
      </div>
    </div>
  );
}
