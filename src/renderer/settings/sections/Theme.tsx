// renderer/settings/sections/Theme — Task 5.1 addendum ruling 4 "Theme" section: four
// theme cards (three-stripe swatch, radiogroup) plus Appearance/Text size/Reduced
// motion segmented controls.
import themesJson from '../../theme/themes.json';
import type { Settings } from '../../../core/types';
import type { ActionInput } from '../../lib/useStore';
import { Segmented } from '../../ui/Segmented';
import { SettingRow } from '../SettingRow';
import { themeSwatchColors } from '../settingsModel';

const THEME_NAMES = ['ledger', 'kraft', 'phosphor', 'slate'] as const;
const THEME_LABELS: Record<(typeof THEME_NAMES)[number], string> = {
  ledger: 'Ledger',
  kraft: 'Kraft',
  phosphor: 'Phosphor',
  slate: 'Slate'
};

export interface ThemeSectionProps {
  theme: Settings['theme'];
  textSize: Settings['textSize'];
  reducedMotion: Settings['reducedMotion'];
  systemDark: boolean;
  dispatchOwn: (action: ActionInput) => void;
}

export function ThemeSection({ theme, textSize, reducedMotion, systemDark, dispatchOwn }: ThemeSectionProps) {
  const resolvedMode = theme.mode === 'system' ? (systemDark ? 'dark' : 'light') : theme.mode;

  return (
    <>
      <h1>Theme</h1>
      <p className="pane-desc">Pick a palette and how it reads on screen.</p>

      <div className="theme-cards" role="radiogroup" aria-label="Theme">
        {THEME_NAMES.map((name) => {
          const colors = themeSwatchColors(themesJson, name, resolvedMode);
          const selected = theme.name === name;
          return (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={selected}
              className={selected ? 'theme-card sel' : 'theme-card'}
              onClick={() => dispatchOwn({ type: 'settings/patch', patch: { theme: { name } } })}
            >
              <span className="swatch">
                <span style={{ background: colors.bg }} />
                <span style={{ background: colors.ink }} />
                <span style={{ background: colors.accent }} />
              </span>
              <span className="theme-name">{THEME_LABELS[name]}</span>
            </button>
          );
        })}
      </div>

      <SettingRow label="Appearance" hint="Mode follows the OS by default.">
        {(id) => (
          <Segmented
            labelledBy={id}
            value={theme.mode}
            onChange={(mode) => dispatchOwn({ type: 'settings/patch', patch: { theme: { mode } } })}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
              { value: 'system', label: 'System' }
            ]}
          />
        )}
      </SettingRow>

      <SettingRow label="Text size" hint="Scales the strip, planner and palette text.">
        {(id) => (
          <Segmented
            labelledBy={id}
            value={textSize}
            onChange={(v) => dispatchOwn({ type: 'settings/patch', patch: { textSize: v } })}
            options={[
              { value: 'S', label: 'S' },
              { value: 'M', label: 'M' },
              { value: 'L', label: 'L' }
            ]}
          />
        )}
      </SettingRow>

      <SettingRow label="Reduced motion" hint="Turns sliding and pulsing animations into instant changes.">
        {(id) => (
          <Segmented
            labelledBy={id}
            value={reducedMotion}
            onChange={(v) => dispatchOwn({ type: 'settings/patch', patch: { reducedMotion: v } })}
            options={[
              { value: 'system', label: 'System' },
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' }
            ]}
          />
        )}
      </SettingRow>
    </>
  );
}
