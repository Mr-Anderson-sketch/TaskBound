// renderer/settings/sections/Score — Task 5.1 addendum ruling 4 "Score" section.
import { useState } from 'react';
import type { Settings } from '../../../core/types';
import type { ActionInput } from '../../lib/useStore';
import { Toggle } from '../../ui/Toggle';
import { SettingRow } from '../SettingRow';

export interface ScoreSectionProps {
  score: Settings['score'];
  dispatchOwn: (action: ActionInput) => void;
}

export function ScoreSection({ score, dispatchOwn }: ScoreSectionProps) {
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <h1>Score</h1>
      <p className="pane-desc">An optional nudge from the first version.</p>

      <SettingRow
        label="Show score"
        hint="An optional nudge from the first version: +1 when you finish early, -1 when you add time."
      >
        {(id) => (
          <Toggle
            checked={score.enabled}
            onChange={(v) => dispatchOwn({ type: 'settings/patch', patch: { score: { enabled: v } } })}
            labelledBy={id}
          />
        )}
      </SettingRow>

      <SettingRow label="Current value" hint="Read-only.">
        {() => <span className="score-value">{score.value}</span>}
      </SettingRow>

      <SettingRow label="Reset score" hint="Sets the score back to 0.">
        {() =>
          confirming ? (
            <span className="confirm-inline">
              <span>Reset to 0?</span>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  dispatchOwn({ type: 'settings/patch', patch: { score: { value: 0 } } });
                  setConfirming(false);
                }}
              >
                Reset
              </button>
              <button type="button" className="btn" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" className="btn" onClick={() => setConfirming(true)}>
              Reset to 0
            </button>
          )
        }
      </SettingRow>
    </>
  );
}
