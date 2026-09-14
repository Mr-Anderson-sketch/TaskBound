// main/windows/csp — the Content-Security-Policy applied to every renderer's
// webContents.session. See CLAUDE.md ("sandbox: true, contextIsolation: true") and
// DESIGN.md's "no telemetry, no network calls" rule: connect-src is 'self' only, plus
// the Vite dev server origin in dev (it serves modules and HMR over ws:// there).
import type { Session } from 'electron';

export function contentSecurityPolicy(isDev: boolean): string {
  return (
    `default-src 'self'; script-src 'self'${isDev ? ' http://localhost:5173' : ''}; ` +
    `style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; ` +
    `connect-src 'self'${isDev ? ' ws://localhost:5173 http://localhost:5173' : ''}; ` +
    `object-src 'none'; base-uri 'none'; form-action 'none'`
  );
}

/** Installs the policy on every response the session serves, via a response-header
 * rewrite (rather than a `<meta http-equiv>` tag) so it applies uniformly to every
 * document the renderer loads, including the dev server's HTML. */
export function installCsp(session: Session, isDev: boolean): void {
  const policy = contentSecurityPolicy(isDev);
  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy]
      }
    });
  });
}
