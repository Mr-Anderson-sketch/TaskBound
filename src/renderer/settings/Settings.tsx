// renderer/settings/Settings — the Settings shell (Task 5.1 addendum rulings 1-2):
// rendered inside the planner's `.main` (to the right of the existing view Rail) when
// `view` is `settings:<section>`. A 180 px section nav + a pane; the pane title is
// Instrument Serif 24 px with a one-line description, each setting a hairline-
// separated row (see SettingRow.tsx). No tabs inside tabs, no accordions.
import { defaultSettings } from '../../core/defaults';
import type { Data } from '../../core/types';
import type { ActionInput } from '../lib/useStore';
import type { Snapshot } from '../../shared/ipc';
import type { Platform } from '../../shared/platform';
import type { ViewId } from '../planner/TaskList';
import { SETTINGS_SECTIONS, sectionFromView } from './settingsModel';
import { StripSection } from './sections/Strip';
import { HotkeysSection } from './sections/Hotkeys';
import { TimerSection } from './sections/Timer';
import { ThemeSection } from './sections/Theme';
import { StartupSection } from './sections/Startup';
import { ScoreSection } from './sections/Score';

const DEFAULT_HOTKEYS = defaultSettings().hotkeys;

export interface SettingsProps {
  /** A `settings:<section>` ViewId — anything else falls back to the first section. */
  view: ViewId;
  data: Data;
  platform: Platform;
  capabilities: Snapshot['capabilities'];
  systemDark: boolean;
  onSelectSection: (view: ViewId) => void;
  dispatchOwn: (action: ActionInput) => void;
}

export function Settings({ view, data, platform, capabilities, systemDark, onSelectSection, dispatchOwn }: SettingsProps) {
  const section = sectionFromView(view);
  const { settings } = data;

  return (
    <div className="settings">
      <nav className="settings-nav" aria-label="Settings sections">
        {SETTINGS_SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={section === s.id ? 'i sel' : 'i'}
            onClick={() => onSelectSection(`settings:${s.id}` as ViewId)}
          >
            {s.label}
          </button>
        ))}
      </nav>
      <div className="settings-pane">
        {section === 'strip' && (
          <StripSection strip={settings.strip} capabilities={capabilities} platform={platform} dispatchOwn={dispatchOwn} />
        )}
        {section === 'hotkeys' && (
          <HotkeysSection hotkeys={settings.hotkeys} defaults={DEFAULT_HOTKEYS} platform={platform} dispatchOwn={dispatchOwn} />
        )}
        {section === 'timer' && <TimerSection timer={settings.timer} dispatchOwn={dispatchOwn} />}
        {section === 'theme' && (
          <ThemeSection
            theme={settings.theme}
            textSize={settings.textSize}
            reducedMotion={settings.reducedMotion}
            systemDark={systemDark}
            dispatchOwn={dispatchOwn}
          />
        )}
        {section === 'startup' && (
          <StartupSection startOnLogin={settings.startOnLogin} notifications={settings.notifications} dispatchOwn={dispatchOwn} />
        )}
        {section === 'score' && <ScoreSection score={settings.score} dispatchOwn={dispatchOwn} />}
      </div>
    </div>
  );
}
