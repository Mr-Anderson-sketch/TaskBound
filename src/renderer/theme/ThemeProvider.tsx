// renderer/theme/ThemeProvider — sets `data-theme`/`data-mode` on <html> from the
// snapshot's settings (DESIGN.md: "Mode follows the OS by default"), and pulls in the
// generated theme tokens plus the bundled font files (CLAUDE.md: "must never fetch
// fonts from the network"). A hook, not a wrapping component (fix round 1, finding
// 17: every *App.tsx has several early-return branches before its first real JSX,
// so a <ThemeProvider> wrapper component was never actually usable — and never
// used) — call `useApplyTheme(snapshot)` directly wherever an *App component fetches
// its own snapshot.
import { useEffect } from 'react';
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
  // Task 5.1 addendum ruling 5: also mirrors settings.textSize onto <html> as
  // `data-text-size`, driving app.css's `--text-scale` (and the strip's own exact
  // 12/13/14 px title sizing) in every window.
  const textSize = snapshot?.data.settings.textSize;

  useEffect(() => {
    if (!name || !mode) return;
    const resolved = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;
    document.documentElement.setAttribute('data-theme', name);
    document.documentElement.setAttribute('data-mode', resolved);
  }, [name, mode, systemDark]);

  useEffect(() => {
    if (!textSize) return;
    document.documentElement.setAttribute('data-text-size', textSize);
  }, [textSize]);
}
