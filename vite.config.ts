import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { stripCspMeta } from './scripts/vite-strip-csp.mjs';

export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [
    react(),
    // Fix round 1, finding 10 (regex corrected in fix round 2, open item 1 — the
    // original pattern required `<meta http-equiv=...` on one line, but
    // src/renderer/index.html spans the tag across several; see
    // scripts/vite-strip-csp.mjs): the static CSP meta tag in index.html encodes
    // the PRODUCTION policy (no 'unsafe-inline' script-src) so it's exactly
    // contentSecurityPolicy(false) — but Vite's dev-server HMR client needs an
    // inline preamble script, which that policy blocks (main's installCsp() header
    // is more permissive in dev, but a stricter meta-tag CSP still applies
    // independently and wins). Strip the meta tag in `vite dev`/`npm run dev` only;
    // production builds (and this file itself) are untouched.
    {
      name: 'strip-csp-meta-in-dev',
      apply: 'serve',
      transformIndexHtml: (html: string) => stripCspMeta(html)
    }
  ],
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    sourcemap: true
  },
  server: {
    port: 5173,
    host: true,
    strictPort: true
  }
});
