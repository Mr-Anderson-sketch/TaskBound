// renderer/palette/PaletteApp — the keyboard-sheets window shell. Capture, PlanToday,
// CloseDay, and Onboarding are built out; `commands` is still a deliberate `// Slice 2`
// stub. `key={sessionId}` (bumped on every `palette:mode`, even a re-show of the SAME
// mode) forces a full remount of whichever child is active, so each session starts with
// fresh state — Capture already achieved this itself via its own `palette:mode`
// listener (unaffected: remounting it is equivalent, and its unmount-cleanup effect
// still cancels any pending post-paste hide timer); PlanToday/CloseDay/Onboarding rely
// on the remount instead of duplicating that listener logic.
import { useEffect, useRef, useState } from 'react';
import type { PaletteMode } from '../../shared/ipc';
import { useApplyTheme } from '../theme/ThemeProvider';
import { useSnapshot } from '../lib/useStore';
import { Capture } from './Capture';
import { PlanToday } from './PlanToday';
import { CloseDay } from './CloseDay';
import { Onboarding } from './Onboarding';

// Task 2.3, addendum ruling 6: cap what we ever report so a very long candidate list
// (its own `.list` already scrolls internally) can't grow the window past this.
const MAX_REPORTED_HEIGHT = 480;
const MIN_REPORTED_HEIGHT = 60;

export function PaletteApp() {
  const snapshot = useSnapshot();
  const [mode, setMode] = useState<PaletteMode>('capture');
  const [sessionId, setSessionId] = useState(0);
  useApplyTheme(snapshot);

  useEffect(() => {
    return window.tb.on('palette:mode', (m) => {
      setMode(m);
      setSessionId((n) => n + 1);
    });
  }, []);

  // Autofocus the input whenever the window (re)gains focus.
  useEffect(() => {
    const onFocus = (): void => {
      document.querySelector<HTMLInputElement>('.palette input')?.focus();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // Reports content height to main (palette:reportSize) so PaletteWindow can resize the
  // native window to fit each mode's sheet (132 for capture, up to 480 for plan/close).
  // A ref-CALLBACK (not useEffect+useRef) so the observer attaches the instant the
  // `.palette` div actually mounts — including the first paint after `snapshot` arrives,
  // when the early `if (!snapshot) return null` below means nothing was rendered yet on
  // the very first effect pass.
  const observerRef = useRef<ResizeObserver | null>(null);
  const rootRef = (el: HTMLDivElement | null): void => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = Math.min(MAX_REPORTED_HEIGHT, Math.max(MIN_REPORTED_HEIGHT, Math.ceil(entry.contentRect.height)));
        void window.tb.invoke('palette:reportSize', { height });
      }
    });
    ro.observe(el);
    observerRef.current = ro;
  };

  if (!snapshot) return null;

  return (
    <div className={`palette mode-${mode}`} ref={rootRef}>
      {mode === 'capture' ? (
        <Capture key={sessionId} lists={snapshot.data.lists} />
      ) : mode === 'plan' ? (
        <PlanToday key={sessionId} snapshot={snapshot} />
      ) : mode === 'close' ? (
        <CloseDay key={sessionId} data={snapshot.data} />
      ) : mode === 'onboarding' ? (
        <Onboarding key={sessionId} snapshot={snapshot} />
      ) : (
        <div className="stub">Coming soon</div> /* Slice 2: commands */
      )}
    </div>
  );
}
