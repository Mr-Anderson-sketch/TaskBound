// main/windows/csp — the Content-Security-Policy applied to every renderer's
// webContents.session. See CLAUDE.md ("sandbox: true, contextIsolation: true") and
// DESIGN.md's "no telemetry, no network calls" rule: connect-src is 'self' only, plus
// the Vite dev server origin in dev (it serves modules and HMR over ws:// there).
import type { Session } from 'electron';

export function contentSecurityPolicy(isDev: boolean): string {
  // Dev-only additions: Vite's dev server serves modules from its own origin, and its
  // React-refresh preamble is an inline <script>, so 'unsafe-inline' is needed there
  // (never in production, where every script is bundled and self-hosted).
  const devScript = isDev ? " 'unsafe-inline' http://localhost:5173" : '';
  const devConnect = isDev ? ' ws://localhost:5173 http://localhost:5173' : '';
  return (
    `default-src 'self'; script-src 'self'${devScript}; ` +
    `style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; ` +
    `connect-src 'self'${devConnect}; ` +
    `object-src 'none'; base-uri 'none'; form-action 'none'`
  );
}

/** Installs the policy on every response the session serves, via a response-header
 * rewrite (rather than a `<meta http-equiv>` tag) so it applies uniformly to every
 * document the renderer loads, including the dev server's HTML. Strips any
 * pre-existing `Content-Security-Policy` header (matched case-insensitively, since
 * HTTP header names are case-insensitive and a dev server or a future response could
 * otherwise leave two CSP headers active, which browsers intersect rather than
 * override — letting the weaker one silently narrow or conflict with ours). */
export function installCsp(session: Session, isDev: boolean): void {
  const policy = contentSecurityPolicy(isDev);
  session.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(details.responseHeaders ?? {})) {
      if (key.toLowerCase() === 'content-security-policy') continue;
      responseHeaders[key] = value;
    }
    responseHeaders['Content-Security-Policy'] = [policy];
    callback({ responseHeaders });
  });
}
