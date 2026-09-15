// renderer/settings/KeyRecorder — one hotkey's recorder control (Task 5.2 binding
// ruling). Focus -> "Press keys…"; each keydown while recording is turned into a
// candidate accelerator by the pure keyRecorderModel, then validated over IPC
// `hotkeys:test` (main's `validateAccelerator`). A bare (no-modifier) Escape cancels
// without saving; a bare Backspace resets this hotkey to its default and saves. Once a
// valid accelerator is saved, `statusOk` (from `hotkeys:status`, polled by the owning
// Hotkeys section after every save) reports whether the OS actually granted the
// registration — false shows "In use by another app" even outside recording mode.
import { useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { keyGlyphs } from '../../shared/platform';
import type { Platform } from '../../shared/platform';
import { acceleratorFromKeyEvent, isModifierOnlyKey } from './keyRecorderModel';

const NEEDS_MODIFIER_MESSAGE = 'Needs Ctrl, Alt or ⌘';
const RESERVED_MESSAGE = 'Reserved by the system';
const UNPARSEABLE_MESSAGE = 'Not a valid shortcut';
const IN_USE_MESSAGE = 'In use by another app';

function reasonMessage(reason: string | undefined): string {
  if (reason === 'denylisted') return RESERVED_MESSAGE;
  if (reason === 'no-modifier') return NEEDS_MODIFIER_MESSAGE;
  return UNPARSEABLE_MESSAGE;
}

export interface KeyRecorderProps {
  /** Accessible name for this specific recorder, e.g. "Quick capture hotkey". */
  label: string;
  value: string;
  defaultValue: string;
  platform: Platform;
  /** `hotkeys:status[name]` for the CURRENTLY SAVED `value` — false shows "In use by
   * another app" (Task 5.2 binding ruling). */
  statusOk: boolean;
  onSave: (accelerator: string) => void;
}

export function KeyRecorder({ label, value, defaultValue, platform, statusOk, onSave }: KeyRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const btnRef = useRef<HTMLButtonElement>(null);
  // Guards against `hotkeys:test`'s async response landing after this recorder has
  // already been unmounted (e.g. the user navigated to another settings section
  // mid-validation) or started a fresh recording attempt.
  const requestIdRef = useRef(0);

  const start = (): void => {
    setRecording(true);
    setError(undefined);
  };

  const stop = (): void => setRecording(false);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();

    const noModifier = !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;

    if (e.key === 'Escape' && noModifier) {
      stop();
      btnRef.current?.blur();
      return;
    }
    if (e.key === 'Backspace' && noModifier) {
      stop();
      btnRef.current?.blur();
      onSave(defaultValue);
      return;
    }

    const accelerator = acceleratorFromKeyEvent(e, platform);
    if (!accelerator) {
      // A bare modifier press: keep waiting silently. Anything else with no modifier
      // held (e.g. a plain letter) can never become a valid global accelerator —
      // surface that immediately rather than waiting on a round trip.
      if (!isModifierOnlyKey(e.key)) setError(NEEDS_MODIFIER_MESSAGE);
      return;
    }

    setError(undefined);
    stop();
    btnRef.current?.blur();
    const requestId = ++requestIdRef.current;
    void window.tb.invoke('hotkeys:test', accelerator).then((result) => {
      if (requestId !== requestIdRef.current) return; // superseded by a later attempt
      if (result.ok) {
        onSave(accelerator);
      } else {
        setError(reasonMessage(result.reason));
      }
    });
  };

  const glyphs = keyGlyphs(value, platform).join(platform === 'darwin' ? '' : '+');
  const inUse = !recording && !error && !statusOk;

  return (
    <div className="key-recorder-wrap">
      <button
        ref={btnRef}
        type="button"
        className={recording ? 'key-recorder recording' : 'key-recorder'}
        aria-label={label}
        onFocus={start}
        onBlur={stop}
        onKeyDown={onKeyDown}
      >
        {recording ? 'Press keys…' : glyphs}
      </button>
      {error && <span className="key-recorder-error">{error}</span>}
      {inUse && <span className="key-recorder-error">{IN_USE_MESSAGE}</span>}
    </div>
  );
}
