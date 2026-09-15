// scripts/generate-tray-icon.js — Task 6.1 (spec Part 5.1 "Tray"): generates the
// macOS menu bar's template image pair (`build/trayTemplate.png` 16x16 and
// `build/trayTemplate@2x.png` 32x32 for Retina — Electron auto-loads the `@2x` file
// from the same directory as the base one), plus `build/icon-1024x1024.png` (an
// upsized copy of the source logo, used by `scripts/make-icns.js`'s `ic10` entry).
//
// Follows scripts/generate-icons.js's pattern (same SOURCE_IMAGE, same OUTPUT_DIR,
// sharp as the optional dependency it already is). Template images must be flat
// black with alpha — macOS recolors them itself for light/dark menu bars and
// tinting — so this does NOT just resize the colour icon like the old
// `tray.ts` did; it flattens every opaque pixel's RGB to black via a raw pixel
// pass (not sharp's `.tint()`, which blends toward a colour rather than replacing
// it, and not `.linear()`, whose per-channel alpha handling isn't reliably
// documented) while leaving the alpha channel (the logo's actual silhouette)
// untouched.
//
// If sharp cannot load (no prebuilt binary for this platform/arch), falls back to
// drawing a simple filled dot/ring glyph with a tiny hand-rolled PNG writer built
// on Node's own `zlib` (a core module, not a new dependency) — good enough to ship
// a template icon without ANY image library.
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

const SOURCE_IMAGE = path.join(__dirname, '../public/Logos/TB - Fin Cyan -512/2.png');
const OUTPUT_DIR = path.join(__dirname, '../build');

/** Flattens `raw` (RGBA, `width`x`height`) so every pixel's R/G/B is 0 while its
 * alpha is left exactly as-is — a valid macOS template image shape. */
function blackenRgba(raw, width, height) {
  const out = Buffer.from(raw); // copy — never mutate the caller's buffer
  for (let i = 0; i < width * height * 4; i += 4) {
    out[i] = 0;
    out[i + 1] = 0;
    out[i + 2] = 0;
    // out[i + 3] (alpha) untouched.
  }
  return out;
}

async function generateWithSharp(sharp) {
  async function templatePng(size, outPath) {
    const { data, info } = await sharp(SOURCE_IMAGE)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const blackened = blackenRgba(data, info.width, info.height);
    await sharp(blackened, { raw: { width: info.width, height: info.height, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toFile(outPath);
  }

  await templatePng(16, path.join(OUTPUT_DIR, 'trayTemplate.png'));
  await templatePng(32, path.join(OUTPUT_DIR, 'trayTemplate@2x.png'));
  console.log('Generated build/trayTemplate.png and build/trayTemplate@2x.png (via sharp)');

  // Byproduct: a 1024x1024 PNG for scripts/make-icns.js's ic10 entry (source is
  // only 512x512, so this is an upsize — acceptable per Task 6.2 ruling 4: "if
  // feasible on Windows", not "if the source is already that large").
  await sharp(SOURCE_IMAGE)
    .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUTPUT_DIR, 'icon-1024x1024.png'));
  console.log('Generated build/icon-1024x1024.png (via sharp, upsized from the 512px source)');
}

// --- pure-Node fallback: a tiny PNG writer, no dependency on sharp at all ---------

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeData), 0);
  return Buffer.concat([len, typeData, crc]);
}

/** Writes a minimal 8-bit RGBA PNG from a raw pixel buffer, no external library —
 * used only when sharp is unavailable. `draw(x, y)` returns the alpha (0-255) for
 * that pixel; RGB is always 0 (a template image is monochrome black-with-alpha). */
function writeGlyphPng(size, draw, outPath) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const alpha = draw(x, y);
      const px = rowStart + 1 + x * 4;
      raw[px] = 0;
      raw[px + 1] = 0;
      raw[px + 2] = 0;
      raw[px + 3] = alpha;
    }
  }
  const idatData = zlib.deflateSync(raw);

  const png = Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idatData),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(outPath, png);
}

/** A simple filled ring glyph (a recognizable, non-square silhouette) — not the
 * real logo, but a legible fallback. Centered, ~80% of the canvas, ~18% stroke. */
function ringAlpha(size) {
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const outerR = size * 0.42;
  const innerR = size * 0.24;
  return (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    return d <= outerR && d >= innerR ? 255 : 0;
  };
}

function generateFallback() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  writeGlyphPng(16, ringAlpha(16), path.join(OUTPUT_DIR, 'trayTemplate.png'));
  writeGlyphPng(32, ringAlpha(32), path.join(OUTPUT_DIR, 'trayTemplate@2x.png'));
  console.log('Generated build/trayTemplate.png and build/trayTemplate@2x.png (pure-Node fallback glyph — sharp unavailable)');
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  if (!fs.existsSync(SOURCE_IMAGE)) {
    console.error(`generate-tray-icon: source image not found: ${SOURCE_IMAGE}`);
    console.error('Falling back to the pure-Node glyph.');
    generateFallback();
    return;
  }
  let sharp;
  try {
    sharp = require('sharp');
  } catch (err) {
    console.warn('generate-tray-icon: sharp unavailable, using the pure-Node fallback glyph:', err.message);
    generateFallback();
    return;
  }
  try {
    await generateWithSharp(sharp);
  } catch (err) {
    console.warn('generate-tray-icon: sharp failed at runtime, using the pure-Node fallback glyph:', err.message);
    generateFallback();
  }
}

main().catch((err) => {
  console.error('generate-tray-icon: fatal error', err);
  process.exitCode = 1;
});
