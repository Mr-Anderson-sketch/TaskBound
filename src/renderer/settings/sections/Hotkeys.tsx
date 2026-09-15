// renderer/settings/sections/Hotkeys — Task 5.2 binding ruling: a new Settings section
// listing the five configurable global shortcuts, each with a KeyRecorder. Saving
// dispatches `settings/patch { hotkeys }`; `hotkeys:status` is refetched whenever the
// saved hotkeys change, so a freshly-saved-but-not-actually-granted accelerator shows
// "In use by another app" without waiting on an unrelated re-render.
import { useEffect, useState } from 'react';
import type { Settings } from '../../../core/types';
import type { ActionInput } from '../../lib/useStore';
import type { Platform } from '../../../shared/platform';
import { KeyRecorder } from '../KeyRecorder';

type HotkeyName = keyof Settings['hotkeys'];

const HOTKEY_ROWS: Array<{ name: HotkeyName; label: string; hint: string }> = [
  { name: 'capture', label: 'Quick capture', hint: 'Opens the capture field from anywhere.' },
  { name: 'toggleStrip', label: 'Show/hide strip', hint: 'Toggles the focus strip.' },
  { name: 'completeAdvance', label: 'Complete & advance', hint: "Completes the current task and moves to what's next." },
  { name: 'toggleTimer', label: 'Start/pause timer', hint: "Starts or pauses the current task's timer." },
  { name: 'undo', label: 'Undo', hint: 'Undoes the last change.' }
];

type HotkeyStatus = Record<HotkeyName, boolean>;
const ALL_OK: HotkeyStatus = { capture: true, toggleStrip: true, completeAdvance: true, toggleTimer: true, undo: true };

export interface HotkeysSectionProps {
  hotkeys: Settings['hotkeys'];
  defaults: Settings['hotkeys'];
  platform: Platform;
  dispatchOwn: (action: ActionInput) => void;
}

export function HotkeysSection({ hotkeys, defaults, platform, dispatchOwn }: HotkeysSectionProps) {
  const [status, setStatus] = useState<HotkeyStatus>(ALL_OK);

  useEffect(() => {
    let disposed = false;
    void window.tb.invoke('hotkeys:status').then((s) => {
      if (!disposed) setStatus(s);
    });
    return () => {
      disposed = true;
    };
    // Re-poll whenever the persisted hotkeys change (a save just landed, possibly from
    // another window) — JSON, not the object reference, so an unrelated settings/patch
    // doesn't cause a pointless re-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(hotkeys)]);

  return (
    <>
      <h1>Hotkeys</h1>
      <p className="pane-desc">Global shortcuts that work anywhere, even when TimeBound isn't focused.</p>
      {HOTKEY_ROWS.map((row) => (
        <div className="setting-row" key={row.name}>
          <div className="row-label">
            <span>{row.label}</span>
            <span className="row-hint">{row.hint}</span>
          </div>
          <div className="row-control">
            <KeyRecorder
              label={`${row.label} hotkey`}
              value={hotkeys[row.name]}
              defaultValue={defaults[row.name]}
              platform={platform}
              statusOk={status[row.name]}
              onSave={(accelerator) =>
                dispatchOwn({ type: 'settings/patch', patch: { hotkeys: { [row.name]: accelerator } } })
              }
            />
          </div>
        </div>
      ))}
    </>
  );
}
