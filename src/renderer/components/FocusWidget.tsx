import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ThemeName } from '../../shared/types';
import type { FocusLayout } from '../native';
import { IconCheck, IconExpand, IconPause, IconPlay, ProgressRing } from './Icons';

export const FOCUS_EXTRA_HEIGHT: Record<ThemeName, number> = { dark: 118, light: 62 };

interface FocusWidgetProps {
  theme: ThemeName;
  layout: FocusLayout;
  title?: string;
  nextTitle?: string;
  time: string;
  fraction: number;
  paused: boolean;
  hasTime: boolean;
  timeUpTitle: string | null;
  onTogglePause: () => void;
  onDone: () => void;
  onAddFive: () => void;
  onTimeUpAddFive: () => void;
  onTimeUpDismiss: () => void;
  onExit: () => void;
  onExpandedChange: (expanded: boolean) => Promise<void>;
  forceOpen?: boolean;
}

export function FocusWidget(props: FocusWidgetProps) {
  const { theme, layout, title, nextTitle, time, fraction, paused, hasTime, timeUpTitle, onExpandedChange } = props;
  const [hovered, setHovered] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const want = hovered || timeUpTitle !== null || Boolean(props.forceOpen);

  useEffect(() => {
    if (timer.current) {
      clearTimeout(timer.current);
    }
    if (want === expanded) {
      return;
    }
    // Small delays so the widget doesn't flicker when the pointer just passes over it.
    timer.current = setTimeout(
      () => {
        onExpandedChange(want)
          .catch((error) => console.error('Focus resize failed', error))
          .finally(() => setExpanded(want));
      },
      want ? 140 : 380
    );
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    };
  }, [want, expanded, onExpandedChange]);

  const enter = useCallback(() => setHovered(true), []);
  const leave = useCallback(() => setHovered(false), []);

  const stateClass = `${expanded ? ' expanded' : ''}${timeUpTitle ? ' timeup' : ''}${paused ? ' paused' : ''}`;
  const displayTitle = timeUpTitle ? `Time’s up · ${timeUpTitle}` : title ?? 'Nothing running';

  const controls = timeUpTitle ? (
    <div className="controls">
      <span className="label" style={{ flex: 1 }} />
      <button type="button" className="round" onClick={props.onTimeUpAddFive} aria-label="Add 5 more minutes">
        +5
      </button>
      <button type="button" className="round primary" onClick={props.onTimeUpDismiss} aria-label="OK, next task">
        <IconCheck size={16} />
      </button>
    </div>
  ) : (
    <div className="controls">
      {theme === 'dark' ? (
        <span className="big mono" style={{ flex: 1 }}>
          {time}
        </span>
      ) : (
        <span className="label">{nextTitle ? `Next · ${nextTitle}` : 'Last task in the list'}</span>
      )}
      <button type="button" className="round" onClick={props.onAddFive} disabled={!title} aria-label="Add 5 minutes">
        +5
      </button>
      <button type="button" className="round" onClick={props.onTogglePause} disabled={!title || !hasTime} aria-label={paused ? 'Resume' : 'Pause'}>
        {paused ? <IconPlay size={15} /> : <IconPause size={15} />}
      </button>
      <button type="button" className="round primary" onClick={props.onDone} disabled={!title} aria-label="Complete task">
        <IconCheck size={16} />
      </button>
      <button type="button" className="round" onClick={props.onExit} aria-label="Open full window">
        <IconExpand size={15} />
      </button>
    </div>
  );

  const ring = (track: string) => <ProgressRing size={18} stroke={2.5} fraction={fraction} color="var(--accent)" track={track} />;

  if (theme === 'dark') {
    const notch = layout.placement === 'menubar' ? layout.notch : null;
    const barHeight = layout.placement === 'menubar' ? layout.menuBarHeight : Math.min(layout.height, 40);
    const wing = notch ? (layout.width - notch.width) / 2 : undefined;
    const wingStyle: CSSProperties = wing ? { width: wing, flex: 'none' } : { flex: 1 };
    return (
      <div
        className={`widget island${layout.placement === 'floating' ? ' floating' : ''}${stateClass}`}
        style={{ '--bar-h': `${barHeight}px` } as CSSProperties}
        onMouseEnter={enter}
        onMouseLeave={leave}
      >
        <div className="bar" data-tauri-drag-region onDoubleClick={props.onExit}>
          <div className="wing left" style={wingStyle} data-tauri-drag-region>
            {ring('#2a2d33')}
            <span className="name" data-tauri-drag-region>
              {displayTitle}
            </span>
          </div>
          {notch ? <div style={{ width: notch.width, flex: 'none' }} data-tauri-drag-region /> : null}
          <div className="wing right" style={wingStyle} data-tauri-drag-region>
            <span className="clock mono">{time}</span>
          </div>
        </div>
        <div className="panel" aria-hidden={!expanded}>
          {!timeUpTitle ? (
            <div className="row-top">
              <span style={{ color: '#9aa0a8', fontWeight: 500 }}>{nextTitle ? `Next · ${nextTitle}` : 'Last task in the list'}</span>
              {paused ? <span className="paused-tag">Paused</span> : null}
            </div>
          ) : null}
          {timeUpTitle ? <div className="row-top"><span>Time’s up — {timeUpTitle}</span></div> : null}
          {controls}
          <div className="track">
            <div style={{ width: `${fraction * 100}%` }} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`widget capsule${stateClass}`} onMouseEnter={enter} onMouseLeave={leave}>
      <div className="bar" data-tauri-drag-region onDoubleClick={props.onExit}>
        <ProgressRing size={26} stroke={3.5} fraction={fraction} color="var(--accent)" track="rgba(0,0,0,0.1)" />
        <span className="name" data-tauri-drag-region>
          {displayTitle}
        </span>
        <span className="clock mono">{time}</span>
      </div>
      <div className="panel" aria-hidden={!expanded}>
        {controls}
      </div>
    </div>
  );
}
