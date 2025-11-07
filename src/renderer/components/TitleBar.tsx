import type { CSSProperties, FC } from 'react';

interface TitleBarProps {
  alwaysOnTop: boolean;
  isMaximized: boolean;
  onToggleAlwaysOnTop: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}

const buttonBase =
  'flex h-7 w-7 items-center justify-center rounded-md text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-coral';

const dragRegionStyle = { WebkitAppRegion: 'drag' } as unknown as CSSProperties;
const noDragRegionStyle = { WebkitAppRegion: 'no-drag' } as unknown as CSSProperties;

export const TitleBar: FC<TitleBarProps> = ({
  alwaysOnTop,
  isMaximized,
  onToggleAlwaysOnTop,
  onMinimize,
  onToggleMaximize,
  onClose
}) => {
  return (
    <header className="flex items-center justify-between px-3 py-2 text-xs" style={dragRegionStyle} onDoubleClick={onToggleMaximize}>
      <div className="flex items-center gap-2 text-brand-ice/80">
        <div className="h-2 w-2 rounded-full bg-brand-coral/70" aria-hidden="true" />
        <span className="select-none text-sm font-semibold text-brand-ice">TimeBound</span>
      </div>
      <div className="flex items-center gap-2" style={noDragRegionStyle}>
        <button
          type="button"
          className={`flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-coral ${
            alwaysOnTop
              ? 'border-brand-coral bg-brand-coral text-brand-navy shadow-[0_4px_14px_rgba(255,107,107,0.35)]'
              : 'border-brand-ice/40 bg-brand-dusk/80 text-brand-ice hover:border-brand-coral/60 hover:text-brand-coral'
          }`}
          onClick={onToggleAlwaysOnTop}
          aria-pressed={alwaysOnTop}
          title={alwaysOnTop ? 'Always on top is enabled' : 'Always on top is disabled'}
        >
          <span>Pin:</span>
          <span>{alwaysOnTop ? 'On' : 'Off'}</span>
        </button>
        <div className="flex items-center gap-1 text-base">
          <button
            type="button"
            className={`${buttonBase} hover:bg-brand-ice/10`}
            aria-label="Minimize window"
            title="Minimize"
            onClick={onMinimize}
          >
            &minus;
          </button>
          <button
            type="button"
            className={`${buttonBase} hover:bg-brand-ice/10`}
            aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
            title={isMaximized ? 'Restore' : 'Maximize'}
            onClick={onToggleMaximize}
          >
            {isMaximized ? '❐' : '□'}
          </button>
          <button
            type="button"
            className={`${buttonBase} hover:bg-brand-coral/30 text-brand-coral`}
            aria-label="Close window"
            title="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </div>
    </header>
  );
};
