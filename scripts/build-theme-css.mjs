// Generates src/renderer/theme/themes.css from themes.json. Run: node scripts/build-theme-css.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '../src/renderer/theme/themes.json');
const out = path.join(here, '../src/renderer/theme/themes.css');
const { themes } = JSON.parse(readFileSync(src, 'utf8'));
const ok = ([l, c, h]) => `oklch(${l} ${c} ${h})`;
const kebab = (s) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
let css = `/* Generated from themes.json by scripts/build-theme-css.mjs. Do not edit by hand. */\n`;
for (const [name, theme] of Object.entries(themes)) {
  for (const mode of ['light', 'dark']) {
    const t = theme[mode];
    css += `[data-theme="${name}"][data-mode="${mode}"] {\n  color-scheme: ${mode};\n`;
    for (const [role, v] of Object.entries(t)) css += `  --${kebab(role)}: ${ok(v)};\n`;
    // derived tints: accent at low alpha for chips and selection
    css += `  --accent-tint: color-mix(in oklch, ${ok(t.accent)} 14%, transparent);\n`;
    css += `  --accent-tint-strong: color-mix(in oklch, ${ok(t.accent)} 28%, transparent);\n`;
    css += `}\n`;
  }
}
writeFileSync(out, css);
console.log('wrote', out, css.length, 'bytes');
