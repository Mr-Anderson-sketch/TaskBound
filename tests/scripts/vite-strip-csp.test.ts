// Task 1.8+1.9 fix round 2, open item 1: the original regex required the CSP <meta>
// tag on one line, but src/renderer/index.html spans it across several — this ran
// the transform against a synthetic single-line string only, so it never caught the
// real bug. This test runs it against the REAL file.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { stripCspMeta } from '../../scripts/vite-strip-csp.mjs';

describe('stripCspMeta', () => {
  const original = readFileSync(path.resolve(__dirname, '../../src/renderer/index.html'), 'utf8');

  it('removes the multi-line CSP meta tag from the real index.html', () => {
    const stripped = stripCspMeta(original);

    expect(stripped).not.toContain('Content-Security-Policy');
    expect(stripped).not.toContain('http-equiv');
    expect(stripped.length).toBeLessThan(original.length);
  });

  it('leaves the rest of index.html untouched (other tags and content survive)', () => {
    const stripped = stripCspMeta(original);

    expect(stripped).toContain('<!doctype html>');
    expect(stripped).toContain('<html lang="en" data-theme="ledger" data-mode="light">');
    expect(stripped).toContain('<meta charset="utf-8" />');
    expect(stripped).toContain('<meta name="viewport" content="width=device-width, initial-scale=1" />');
    expect(stripped).toContain('<title>TimeBound</title>');
    expect(stripped).toContain('<div id="root"></div>');
    expect(stripped).toContain('<script type="module" src="./main.tsx"></script>');

    // Only the ONE CSP <meta> is gone; the other two <meta> tags (charset, viewport)
    // must survive — a naive "remove anything starting with <meta" would fail this.
    const metaCountBefore = (original.match(/<meta\b/g) ?? []).length;
    const metaCountAfter = (stripped.match(/<meta\b/g) ?? []).length;
    expect(metaCountBefore).toBe(3);
    expect(metaCountAfter).toBe(2);
  });

  it('is a no-op on HTML with no CSP meta tag', () => {
    const html = '<html><head><title>x</title></head><body></body></html>';
    expect(stripCspMeta(html)).toBe(html);
  });

  it('also matches a single-line CSP meta tag', () => {
    const html = '<head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'"></head>';
    expect(stripCspMeta(html)).toBe('<head></head>');
  });
});
