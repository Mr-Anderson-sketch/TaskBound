// renderer/settings/sections/Timer — Task 5.1 addendum ruling 4 "Timer" section.
import type { Settings } from '../../../core/types';
import type { ActionInput } from '../../lib/useStore';
import { NumberField } from '../../ui/NumberField';
import { Toggle } from '../../ui/Toggle';
import { SettingRow } from '../SettingRow';

export interface TimerSectionProps {
  timer: Settings['timer'];
  dispatchOwn: (action: ActionInput) => void;
}

export function TimerSection({ timer, dispatchOwn }: TimerSectionProps) {
  const patch = (p: Partial<Settings['timer']>): void => dispatchOwn({ type: 'settings/patch', patch: { timer: p } });

  return (
    <>
      <h1>Timer &amp; pomodoro</h1>
      <p className="pane-desc">How work sessions and breaks are timed.</p>

      <SettingRow label="Pomodoro" hint="Work in fixed sessions with breaks in between.">
        {(id) => <Toggle checked={timer.pomodoro} onChange={(v) => patch({ pomodoro: v })} labelledBy={id} />}
      </SettingRow>

      <SettingRow label="Work session minutes" hint="Length of a pomodoro work session.">
        {(id) => <NumberField labelledBy={id} min={1} max={240} value={timer.workMinutes} onChange={(v) => patch({ workMinutes: v })} />}
      </SettingRow>

      <SettingRow label="Break minutes" hint="Length of the break after a work session.">
        {(id) => <NumberField labelledBy={id} min={1} max={240} value={timer.breakMinutes} onChange={(v) => patch({ breakMinutes: v })} />}
      </SettingRow>

      <SettingRow label="Default planned minutes" hint="Starting point for a new timer.">
        {(id) => (
          <NumberField labelledBy={id} min={1} max={240} value={timer.defaultPlannedMinutes} onChange={(v) => patch({ defaultPlannedMinutes: v })} />
        )}
      </SettingRow>

      <SettingRow label="Pause when idle for" hint="Minutes of no input before the timer pauses. 0 = never.">
        {(id) => (
          <NumberField labelledBy={id} min={0} max={120} value={timer.idlePauseMinutes} onChange={(v) => patch({ idlePauseMinutes: v })} />
        )}
      </SettingRow>

      <SettingRow label="Pause after sleep or lock longer than" hint="Minutes away before a running timer is treated as paused.">
        {(id) => (
          <NumberField
            labelledBy={id}
            min={1}
            max={120}
            value={timer.awayThresholdMinutes}
            onChange={(v) => patch({ awayThresholdMinutes: v })}
          />
        )}
      </SettingRow>
    </>
  );
}
