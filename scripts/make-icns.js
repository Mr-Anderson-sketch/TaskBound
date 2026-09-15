#!/usr/bin/env node
// scripts/make-icns.js — Task 6.2 ruling 4: builds build/icon.icns from
// build/icon-512x512.png (existing, from scripts/generate-icons.js) and
// build/icon-1024x1024.png (from scripts/generate-tray-icon.js) as `ic09`/`ic10`
// PNG-format icon entries.
//
// Pure Node, no image library needed: since macOS 10.7 an .icns file's per-size
// entries may hold raw PNG bytes directly (Apple "Icon Image Format" — see
// https://en.wikipedia.org/wiki/Apple_Icon_Image_format), so assembling one is just
// wrapping two existing PNG files in a tiny TLV container:
//   'icns' + uint32BE(total length)            (8-byte file header)
//   then, per entry: 4-byte OSType + uint32BE(8 + data.length) + PNG bytes
// `ic09` is the 512x512 entry, `ic10` is 512x512@2x (i.e. 1024x1024).
//
// Run standalone (`node scripts/make-icns.js`) after the two source PNGs exist. On
// any failure (missing source, write error) this exits non-zero WITHOUT touching
// package.json — the caller (a human, or a future packaging step) keeps
// `build.mac.icon` pointed at `build/icon-512x512.png` in that case; see
// docs/DECISIONS.md.
const fs = require('fs');
const path = require('path');

const BUILD_DIR = path.join(__dirname, '../build');
const PNG_512 = path.join(BUILD_DIR, 'icon-512x512.png');
const PNG_1024 = path.join(BUILD_DIR, 'icon-1024x1024.png');
const OUT = path.join(BUILD_DIR, 'icon.icns');

function isPng(buf) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return buf.length >= 8 && buf.subarray(0, 8).equals(sig);
}

function entry(osType, data) {
  if (osType.length !== 4) throw new Error(`osType must be 4 chars: ${osType}`);
  const header = Buffer.alloc(8);
  header.write(osType, 0, 4, 'ascii');
  header.writeUInt32BE(8 + data.length, 4);
  return Buffer.concat([header, data]);
}

function main() {
  for (const p of [PNG_512, PNG_1024]) {
    if (!fs.existsSync(p)) {
      console.error(`make-icns: missing ${p}`);
      console.error('Run scripts/generate-icons.js (for the 512) and scripts/generate-tray-icon.js (for the 1024) first.');
      process.exitCode = 1;
      return;
    }
  }
  const png512 = fs.readFileSync(PNG_512);
  const png1024 = fs.readFileSync(PNG_1024);
  if (!isPng(png512) || !isPng(png1024)) {
    console.error('make-icns: one of the source files is not a valid PNG (bad signature)');
    process.exitCode = 1;
    return;
  }

  const entries = Buffer.concat([entry('ic09', png512), entry('ic10', png1024)]);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(8 + entries.length, 4);
  const icns = Buffer.concat([header, entries]);

  fs.writeFileSync(OUT, icns);
  console.log(`make-icns: wrote ${path.relative(process.cwd(), OUT)} (${icns.length} bytes: ic09 ${png512.length}B, ic10 ${png1024.length}B)`);
}

main();
