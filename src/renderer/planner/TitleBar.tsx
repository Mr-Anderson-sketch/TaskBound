// renderer/planner/TitleBar — the 40 px planner title bar (DESIGN.md "Planner"; Task 4.1
// addendum rulings 6-7): brand, an inline capture field, a Ctrl+K hint (display-only —
// the command palette itself is Task 4.2), and window controls on Windows/Linux (native
// traffic lights + a 78 px reserved gap on macOS). The whole bar is a drag region;
// every interactive element inside opts out with `-webkit-app-region: no-drag`.
import { useState } from 'react';
import { Capture } from '../palette/Capture';
import { keyGlyphs } from '../../shared/platform';
import type { Platform } from '../../shared/platform';
import type { List } from '../../core/types';

export interface TitleBarProps {
  platform: Platform;
  captureAccelerator: string;
  lists: List[];
  /** Ruling 7: defaults new tasks to the current view's list when it is `list:<id>`. */
  defaultListId?: string;
  /** Ruling 7: `today: true` only when the current view is Today. */
  today: boolean;
  onMinimize: () => void;
  onClose: () => void;
}

export function TitleBar({ platform, captureAccelerator, lists, defaultListId, today, onMinimize, onClose }: TitleBarProps) {
  const [active, setActive] = useState(false);
  const glyphs = keyGlyphs(captureAccelerator, platform).join(platform === 'darwin' ? '' : '+');

  return (
    <div className={platform === 'darwin' ? 'tb mac' : 'tb'}>
      <span className="brand">TimeBound</span>
      <div className={active ? 'cap active' : 'cap'}>
        {active ? (
          <Capture lists={lists} defaultListId={defaultListId} today={today} onDone={() => setActive(false)} />
        ) : (
          <button type="button" className="cap-trigger" onClick={() => setActive(true)}>
            <span className="ph">Add a task…</span>
            <kbd>{glyphs}</kbd>
          </button>
        )}
      </div>
      <span className="cmdk">{platform === 'darwin' ? '⌘K' : 'Ctrl+K'}</span>
      {platform !== 'darwin' && (
        <div className="wc">
          <button type="button" aria-label="Minimize" onClick={onMinimize}>
            &#8212;
          </button>
          <button type="button" aria-label="Close" onClick={onClose}>
            &#10005;
          </button>
        </div>
      )}
    </div>
  );
}
