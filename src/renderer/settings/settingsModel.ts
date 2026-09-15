// renderer/settings/settingsModel — pure helpers behind the Settings shell (Task 5.1
// addendum ruling 8): the section nav list, theme-card swatch colours (from
// themes.json), NumberField-style int clamping, and the text-size scale mapping. No
// DOM, no dispatch — unit-tested in the plain 'node' Vitest environment, same
// convention as commandsModel.ts.
import type { Settings } from '../../core/types';

// Task 5.3 adds 'data', last in the nav (docs/design/settings.png).
export type SettingsSection = 'strip' | 'hotkeys' | 'timer' | 'theme' | 'startup' | 'score' | 'data';

export interface SettingsSectionEntry {
  id: SettingsSection;
  label: string;
}

export const SETTINGS_SECTIONS: readonly SettingsSectionEntry[] = [
  { id: 'strip', label: 'Strip' },
  { id: 'hotkeys', label: 'Hotkeys' },
  { id: 'timer', label: 'Timer & pomodoro' },
  { id: 'theme', label: 'Theme' },
  { id: 'startup', label: 'Startup & notifications' },
  { id: 'score', label: 'Score' },
  { id: 'data', label: 'Data' }
];

/** `settings:<section>` -> `<section>` if it names a real section, else the first one
 * ('strip') — a defensive fallback for a stale/unknown section id (e.g. an older
 * `planner:navigate` payload from a future version). */
export function sectionFromView(view: string): SettingsSection {
  const raw = view.startsWith('settings:') ? view.slice('settings:'.length) : view;
  const found = SETTINGS_SECTIONS.find((s) => s.id === raw);
  return found ? found.id : 'strip';
}

/** Clamps `value` to an integer within `[min, max]`; a non-finite input falls back to
 * `min` rather than propagating NaN. Shared by NumberField's commit-on-blur/Enter
 * revert logic and by any other int-bounded control. */
export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

const TEXT_SCALE: Record<Settings['textSize'], number> = { S: 0.923, M: 1, L: 1.077 };

/** DESIGN.md/addendum ruling 5: `--text-scale` for S/M/L. */
export function textScale(size: Settings['textSize']): number {
  return TEXT_SCALE[size];
}

export interface ThemeSwatchColors {
  bg: string;
  ink: string;
  accent: string;
}

// `number[]`, not a 3-tuple: themes.json is imported as plain JSON (resolveJsonModule),
// which TypeScript infers as `number[]` for a JSON array literal, not a fixed-length
// tuple — matching that here (rather than asserting a tuple type at the import site)
// keeps this helper usable directly against the real themes.json import.
interface ThemesJsonShape {
  themes: Record<
    string,
    {
      light: { bg: number[]; ink: number[]; accent: number[] };
      dark: { bg: number[]; ink: number[]; accent: number[] };
    }
  >;
}

function oklch([l, c, h]: number[]): string {
  return `oklch(${l} ${c} ${h})`;
}

/** The three-stripe swatch colours (bg/ink/accent, CSS `oklch()` strings) for a theme
 * card in the GIVEN mode (Task 5.1 addendum ruling 4: "three-stripe swatch from the
 * theme's bg/ink/accent in the CURRENT mode") — `mode` is already resolved from
 * 'system' by the caller (Settings never itself knows systemDark). */
export function themeSwatchColors(themes: ThemesJsonShape, name: string, mode: 'light' | 'dark'): ThemeSwatchColors {
  const roles = themes.themes[name][mode];
  return { bg: oklch(roles.bg), ink: oklch(roles.ink), accent: oklch(roles.accent) };
}
