// renderer/theme/ThemeProvider — sets `data-theme`/`data-mode` on <html> from the
// snapshot's settings (DESIGN.md: "Mode follows the OS by default"), and pulls in the
// generated theme tokens plus the bundled font files (CLAUDE.md: "must never fetch
// fonts from the network"). Exposes both a hook (`useApplyTheme`, for components with
// several early-return branches, like StripApp) and a wrapping component.
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/instrument-serif/400.css';
import '../theme/themes.css';
import type { Snapshot } from '../../shared/ipc';

export function useApplyTheme(snapshot: Snapshot | undefined): void {
  const name = snapshot?.data.settings.theme.name;
  const mode = snapshot?.data.settings.theme.mode;
  const systemDark = snapshot?.systemDark;

  useEffect(() => {
    if (!name || !mode) return;
    const resolved = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;
    document.documentElement.setAttribute('data-theme', name);
    document.documentElement.setAttribute('data-mode', resolved);
  }, [name, mode, systemDark]);
}

export function ThemeProvider({ snapshot, children }: { snapshot: Snapshot | undefined; children: ReactNode }) {
  useApplyTheme(snapshot);
  return <>{children}</>;
}
