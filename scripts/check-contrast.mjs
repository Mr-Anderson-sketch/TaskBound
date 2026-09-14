// Verifies WCAG contrast for every theme in src/renderer/theme/themes.json.
// Usage: node scripts/check-contrast.mjs   (exit 1 on any failure)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const themes = JSON.parse(readFileSync(path.join(here, '../src/renderer/theme/themes.json'), 'utf8'));

// oklch(L C H) -> sRGB [0..1]
export function oklchToRgb([L, C, H]) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  const gam = (c) => { const v = Math.min(1, Math.max(0, c)); return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; };
  return [gam(r), gam(g), gam(bb)];
}
export const toHex = (rgb) => '#' + rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
const lum = (rgb) => { const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); const [r, g, b] = rgb.map(f); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a, b) => { const la = lum(oklchToRgb(a)), lb = lum(oklchToRgb(b)); const [hi, lo] = la > lb ? [la, lb] : [lb, la]; return (hi + 0.05) / (lo + 0.05); };

// pairs: [foreground, background, minimum]
const PAIRS = [
  ['ink', 'bg', 7], ['ink', 'surface', 7], ['muted', 'bg', 4.5], ['muted', 'surface', 4.5],
  ['accent', 'bg', 4.5], ['accent', 'surface', 4.5], ['accentInk', 'accent', 4.5],
  ['ok', 'bg', 3], ['warn', 'bg', 3], ['danger', 'bg', 4.5],
  ['stripInk', 'stripBg', 7], ['stripMuted', 'stripBg', 4.5], ['accent', 'stripBg', 3],
];
let failures = 0;
for (const [name, theme] of Object.entries(themes.themes)) {
  for (const mode of ['light', 'dark']) {
    const t = theme[mode];
    const rows = PAIRS.map(([fg, bg, min]) => { const c = contrast(t[fg], t[bg]); const ok = c >= min; if (!ok) failures++; return `${ok ? 'ok  ' : 'FAIL'} ${fg.padEnd(10)} on ${bg.padEnd(8)} ${c.toFixed(2).padStart(6)} (min ${min})`; });
    console.log(`\n${name} / ${mode}`);
    console.log(rows.join('\n'));
  }
}
console.log(failures ? `\n${failures} failure(s)` : '\nAll contrast checks pass.');
process.exit(failures ? 1 : 0);
