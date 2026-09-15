// renderer/settings/sections/Startup — Task 5.1 addendum ruling 4 "Startup &
// notifications" section.
import type { ActionInput } from '../../lib/useStore';
import { Toggle } from '../../ui/Toggle';
import { SettingRow } from '../SettingRow';

export interface StartupSectionProps {
  startOnLogin: boolean;
  notifications: boolean;
  dispatchOwn: (action: ActionInput) => void;
}

export function StartupSection({ startOnLogin, notifications, dispatchOwn }: StartupSectionProps) {
  return (
    <>
      <h1>Startup &amp; notifications</h1>
      <p className="pane-desc">What happens when you sign in, and what TimeBound can tell you.</p>

      <SettingRow label="Start TimeBound when I sign in" hint="Launches TimeBound automatically.">
        {(id) => (
          <Toggle
            checked={startOnLogin}
            onChange={(v) => dispatchOwn({ type: 'settings/patch', patch: { startOnLogin: v } })}
            labelledBy={id}
          />
        )}
      </SettingRow>

      <SettingRow label="Notifications" hint="Lets TimeBound notify you about timers and breaks.">
        {(id) => (
          <Toggle
            checked={notifications}
            onChange={(v) => dispatchOwn({ type: 'settings/patch', patch: { notifications: v } })}
            labelledBy={id}
          />
        )}
      </SettingRow>
    </>
  );
}
