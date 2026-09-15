// scripts/vite-strip-csp — the transform behind vite.config.ts's `strip-csp-meta-in-dev`
// plugin, pulled into its own module so it's unit-testable without spinning up Vite
// (see tests/scripts/vite-strip-csp.test.ts). Task 1.8+1.9 fix round 2, open item 1.
//
// Removes the static, PRODUCTION-only CSP <meta> tag from index.html for Vite's dev
// server: that tag is exactly contentSecurityPolicy(false) (no 'unsafe-inline'
// script-src), which blocks the dev server's inline HMR preamble script. Production
// builds never run this — see vite.config.ts, `apply: 'serve'`.
//
// `src/renderer/index.html` spans the tag across several lines:
//   <meta
//     http-equiv="Content-Security-Policy"
//     content="..."
//   />
// so the regex must tolerate whitespace (including newlines) between `<meta` and
// `http-equiv`, not just between attributes — a plain `<meta http-equiv=...` pattern
// never matches that shape. `[^>]` (a negated character class) already matches
// newlines on its own, so the attribute-content span needs no special handling.
const CSP_META_RE = /<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>\s*/i;

/** @param {string} html @returns {string} */
export function stripCspMeta(html) {
  return html.replace(CSP_META_RE, '');
}
