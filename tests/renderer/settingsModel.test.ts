// Task 5.1 addendum ruling 8: pure helpers behind the Settings shell — section list,
// theme swatch colours, int clamping, and the text-size scale mapping. Plain 'node'
// env, same convention as tests/renderer/commands.test.ts.
import { describe, it, expect } from 'vitest';
import themesJson from '../../src/renderer/theme/themes.json';
import {
  SETTINGS_SECTIONS,
  sectionFromView,
  clampInt,
  textScale,
  themeSwatchColors
} from '../../src/renderer/settings/settingsModel';

describe('SETTINGS_SECTIONS', () => {
  it('lists strip, hotkeys, timer, theme, startup, score in that order', () => {
    expect(SETTINGS_SECTIONS.map((s) => s.id)).toEqual(['strip', 'hotkeys', 'timer', 'theme', 'startup', 'score']);
  });
});

describe('sectionFromView', () => {
  it('extracts the section from a settings:<section> view id', () => {
    expect(sectionFromView('settings:theme')).toBe('theme');
    expect(sectionFromView('settings:hotkeys')).toBe('hotkeys');
  });

  it('falls back to strip for an unrecognised or non-settings view', () => {
    expect(sectionFromView('settings:bogus')).toBe('strip');
    expect(sectionFromView('today')).toBe('strip');
  });
});

describe('clampInt', () => {
  it('clamps within [min, max] and rounds', () => {
    expect(clampInt(5, 1, 240)).toBe(5);
    expect(clampInt(0, 1, 240)).toBe(1);
    expect(clampInt(1000, 1, 240)).toBe(240);
    expect(clampInt(5.6, 0, 10)).toBe(6);
  });

  it('falls back to min for a non-finite input', () => {
    expect(clampInt(NaN, 1, 240)).toBe(1);
    expect(clampInt(Infinity, 1, 240)).toBe(1);
  });
});

describe('textScale', () => {
  it('maps S/M/L to the DESIGN.md --text-scale values', () => {
    expect(textScale('S')).toBe(0.923);
    expect(textScale('M')).toBe(1);
    expect(textScale('L')).toBe(1.077);
  });
});

describe('themeSwatchColors', () => {
  it('reads bg/ink/accent from themes.json for the given theme and mode as oklch() strings', () => {
    const colors = themeSwatchColors(themesJson, 'kraft', 'dark');
    expect(colors.bg).toBe('oklch(0.23 0.028 65)');
    expect(colors.ink).toBe('oklch(0.935 0.02 80)');
    expect(colors.accent).toBe('oklch(0.78 0.16 55)');
  });

  it('reads the light-mode swatch for every theme name without throwing', () => {
    for (const name of ['ledger', 'kraft', 'phosphor', 'slate']) {
      const colors = themeSwatchColors(themesJson, name, 'light');
      expect(colors.bg).toMatch(/^oklch\(/);
      expect(colors.ink).toMatch(/^oklch\(/);
      expect(colors.accent).toMatch(/^oklch\(/);
    }
  });
});
