import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { contrast, oklchToRgb, toHex } from '../../scripts/check-contrast.mjs';

// The design system promises AA (and AAA for body text) in every theme and mode.
// This test keeps that promise honest whenever themes.json changes.
const themes = JSON.parse(readFileSync(path.resolve(__dirname, '../../src/renderer/theme/themes.json'), 'utf8')).themes as Record<
  string,
  Record<'light' | 'dark', Record<string, [number, number, number]>>
>;

const PAIRS: Array<[string, string, number]> = [
  ['ink', 'bg', 7],
  ['ink', 'surface', 7],
  ['muted', 'bg', 4.5],
  ['muted', 'surface', 4.5],
  ['accent', 'bg', 4.5],
  ['accent', 'surface', 4.5],
  ['accentInk', 'accent', 4.5],
  ['danger', 'bg', 4.5],
  ['ok', 'bg', 3],
  ['warn', 'bg', 3],
  ['stripInk', 'stripBg', 7],
  ['stripMuted', 'stripBg', 4.5],
  ['accent', 'stripBg', 3]
];

describe('theme contrast', () => {
  for (const [name, theme] of Object.entries(themes)) {
    for (const mode of ['light', 'dark'] as const) {
      it(`${name}/${mode} meets every contrast floor`, () => {
        const t = theme[mode];
        for (const [fg, bg, min] of PAIRS) {
          const ratio = contrast(t[fg], t[bg]);
          expect(ratio, `${fg} on ${bg} (${toHex(oklchToRgb(t[fg]))} on ${toHex(oklchToRgb(t[bg]))})`).toBeGreaterThanOrEqual(min);
        }
      });
    }
  }
  it('defines the same roles in every theme and mode', () => {
    const roles = Object.keys(themes.ledger.light).sort();
    for (const theme of Object.values(themes)) {
      expect(Object.keys(theme.light).sort()).toEqual(roles);
      expect(Object.keys(theme.dark).sort()).toEqual(roles);
    }
  });
});
