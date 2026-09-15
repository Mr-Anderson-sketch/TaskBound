// renderer/palette/Onboarding — the first-run sheet (DESIGN.md "Palette (keyboard
// sheets)"; Task 5.4). Three cards: (1) add a first task — embeds the real Capture
// component, or (when this run's data came from a legacy import) an "Imported N
// tasks" summary; (2) pick a strip edge — a live Segmented control; (3) five keys to
// remember. "Skip" on every card and finishing card 3 both dispatch
// `settings/patch { onboardingDone: true }` and hide the palette — there is no
// partial-progress state to preserve, so skip and finish are the same action.
import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { Snapshot } from '../../shared/ipc';
import { dispatch } from '../lib/useStore';
import { Capture } from './Capture';
import { Segmented } from '../ui/Segmented';
import { keyGlyphs } from '../../shared/platform';
import { hasLegacyImport, importedTaskCount } from './onboardingModel';
import type { Settings } from '../../core/types';

interface OnboardingProps {
  snapshot: Snapshot;
}

const TOTAL_STEPS = 3;

// Order and labels match docs/design/onboarding.png card 3 ("Ctrl+Alt+Space add ·
// Ctrl+Alt+Enter done · Ctrl+Alt+Shift+Enter timer · Ctrl+Alt+Shift+Space show or
// hide · Ctrl+Alt+Backspace undo" — the default accelerators for each, in this order).
const HOTKEY_ROWS: Array<{ key: keyof Settings['hotkeys']; label: string }> = [
  { key: 'capture', label: 'add' },
  { key: 'completeAdvance', label: 'done' },
  { key: 'toggleTimer', label: 'timer' },
  { key: 'toggleStrip', label: 'show or hide' },
  { key: 'undo', label: 'undo' }
];

export function Onboarding({ snapshot }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const { data, platform } = snapshot;
  const imported = hasLegacyImport(data);

  const finish = (): void => {
    dispatch({ type: 'settings/patch', patch: { onboardingDone: true } });
    void window.tb.invoke('palette:hide');
  };

  const next = (): void => setStep((s) => Math.min(TOTAL_STEPS - 1, s + 1));

  // Card 1's normal (non-imported) branch embeds Capture, which owns Enter/Escape
  // itself (its onDone below advances instead of hiding) — this handler must not
  // double-handle those keys there, so it no-ops for that one card state.
  //
  // Deliberately a REACT onKeyDown prop on the persistent wrapper div below, not a
  // raw `window.addEventListener` in a `useEffect`: a `useEffect` registered as a
  // *reaction* to this same keypress (e.g. Capture's Enter advancing step 0 -> 1)
  // can end up attached before the native event's bubble phase finishes reaching
  // `window` — React flushes an update's passive effects synchronously once it
  // finishes handling a discrete event like `keydown`, but the native event keeps
  // bubbling past React's root afterwards in that same synchronous pass — so a fresh
  // `window` listener from the NEW render can spuriously receive the SAME keypress
  // and advance a second time. React's synthetic `onKeyDown` here instead resolves
  // to whichever handler closure was current when this event's dispatch began
  // (collected once, before any of this event's own state updates apply), so it
  // never re-fires against its own after-effects.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (step === 0 && !imported) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (step === TOTAL_STEPS - 1) finish();
      else next();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish();
    }
  };

  return (
    <div className="onboarding" onKeyDown={onKeyDown}>
      <div className="ob-step">
        {step + 1} / {TOTAL_STEPS}
      </div>

      {step === 0 &&
        (imported ? (
          <>
            <div className="title" id="ob-title">
              Imported {importedTaskCount(data)} task{importedTaskCount(data) === 1 ? '' : 's'} from your previous TimeBound
            </div>
            <div className="ob-actions">
              <button type="button" className="btn" onClick={next}>
                Next
              </button>
              <button type="button" className="btn ghost" onClick={finish}>
                Skip
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="title" id="ob-title">
              Add your first task
            </div>
            <p className="ob-desc">
              Type it like you&rsquo;d say it: <em>&ldquo;call bank tomorrow 3pm #finance&rdquo;</em>. It lands on the strip the
              moment you press Enter.
            </p>
            <div className="ob-capture">
              <Capture lists={data.lists} onDone={next} />
            </div>
            <div className="ob-actions">
              <button type="button" className="btn ghost" onClick={finish}>
                Skip
              </button>
            </div>
          </>
        ))}

      {step === 1 && (
        <>
          <div className="title" id="ob-title">
            Pick an edge
          </div>
          <p className="ob-desc">The strip hugs the top or bottom of your screen and never covers the taskbar. Watch it move as you choose.</p>
          <Segmented
            labelledBy="ob-title"
            value={data.settings.strip.edge}
            onChange={(edge) => dispatch({ type: 'settings/patch', patch: { strip: { edge } } })}
            options={[
              { value: 'top', label: 'Top' },
              { value: 'bottom', label: 'Bottom' }
            ]}
          />
          <div className="ob-actions">
            <button type="button" className="btn" onClick={next}>
              Next
            </button>
            <button type="button" className="btn ghost" onClick={finish}>
              Skip
            </button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div className="title" id="ob-title">
            Five keys to remember
          </div>
          <div className="ob-keys">
            {HOTKEY_ROWS.map((row, i) => (
              <span className="ob-key" key={row.key}>
                <kbd>{keyGlyphs(data.settings.hotkeys[row.key], platform).join(platform === 'darwin' ? '' : '+')}</kbd>
                <span className="ob-key-label">{row.label}</span>
                {i < HOTKEY_ROWS.length - 1 && <span className="ob-key-sep">&middot;</span>}
              </span>
            ))}
          </div>
          <div className="ob-actions">
            <button type="button" className="btn wide" onClick={finish}>
              Start
            </button>
            <button type="button" className="btn ghost" onClick={finish}>
              Skip
            </button>
          </div>
        </>
      )}
    </div>
  );
}
