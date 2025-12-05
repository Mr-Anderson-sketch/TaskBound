import type { CSSProperties, FC } from 'react';
import logoIcon from '../assets/logo-icon.png';

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
    <header className="flex items-center justify-between pr-4 pt-3 pb-1.5 text-xs bg-brand-navy/40 gap-2 min-w-0" style={dragRegionStyle} onDoubleClick={onToggleMaximize}>
      <div className="flex items-center gap-3 min-w-0 flex-shrink">
        {/* Responsive logo: shrinks from 48px -> 40px -> 32px */}
        <img
          src={logoIcon}
          alt="TimeBound"
          className="h-12 w-12 min-[350px]:h-10 min-[350px]:w-10 min-[300px]:h-8 min-[300px]:w-8 flex-shrink-0 transition-all duration-200"
        />
        <div className="flex flex-col justify-center min-w-0">
          {/* Responsive heading: shrinks from xl -> lg -> base */}
          <h1 className="text-xl min-[350px]:text-lg min-[300px]:text-base font-bold text-brand-ice tracking-tight leading-none whitespace-nowrap transition-all duration-200">
            TimeBound
          </h1>
          <p className="text-xs text-brand-aqua/80 leading-tight hidden sm:block">Focus, finish, and track your wins.</p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0" style={noDragRegionStyle}>
        <button
          type="button"
          className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-coral whitespace-nowrap ${
            alwaysOnTop
              ? 'border-brand-coral bg-brand-coral text-brand-navy shadow-[0_4px_14px_rgba(255,107,107,0.35)]'
              : 'border-brand-ice/40 bg-brand-dusk/80 text-brand-ice hover:border-brand-coral/60 hover:text-brand-coral'
          }`}
          onClick={onToggleAlwaysOnTop}
          aria-pressed={alwaysOnTop}
          title={alwaysOnTop ? 'Always on top is enabled' : 'Always on top is disabled'}
        >
          <span className="hidden min-[400px]:inline">Pin:</span>
          <span className="hidden min-[400px]:inline">{alwaysOnTop ? 'On' : 'Off'}</span>
          <span className="min-[400px]:hidden">📌</span>
        </button>
        <div className="flex items-center gap-1">
          {/* Minimize button with SVG icon */}
          <button
            type="button"
            className={`${buttonBase} hover:bg-brand-ice/10`}
            aria-label="Minimize window"
            title="Minimize"
            onClick={onMinimize}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
            </svg>
          </button>
          {/* Maximize/Restore button with SVG icon */}
          <button
            type="button"
            className={`${buttonBase} hover:bg-brand-ice/10`}
            aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
            title={isMaximized ? 'Restore' : 'Maximize'}
            onClick={onToggleMaximize}
          >
            {isMaximized ? (
              // Restore icon (overlapping squares)
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5H6.5A2.5 2.5 0 0 0 4 7v2.5M9 4.5V7a2 2 0 0 1-2 2H4.5M9 4.5h8.5A2 2 0 0 1 19.5 6.5V15M20 15h-2.5A2.5 2.5 0 0 1 15 12.5V10" />
              </svg>
            ) : (
              // Maximize icon (single square)
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                <rect x="4" y="4" width="16" height="16" rx="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
          {/* Close button with SVG icon */}
          <button
            type="button"
            className={`${buttonBase} hover:bg-brand-coral/30 text-brand-coral`}
            aria-label="Close window"
            title="Close"
            onClick={onClose}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
};
