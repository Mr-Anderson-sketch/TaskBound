// renderer/palette/PaletteApp — the keyboard-sheets window shell. Capture is built out
// (live natural-language parsing with token chips, Task 2.2); every other mode is a
// deliberate `// Slice 2` stub.
import { useEffect, useState } from 'react';
import type { PaletteMode } from '../../shared/ipc';
import { useApplyTheme } from '../theme/ThemeProvider';
import { useSnapshot } from '../lib/useStore';
import { Capture } from './Capture';

export function PaletteApp() {
  const snapshot = useSnapshot();
  const [mode, setMode] = useState<PaletteMode>('capture');
  useApplyTheme(snapshot);

  useEffect(() => {
    return window.tb.on('palette:mode', setMode);
  }, []);

  // Autofocus the input whenever the window (re)gains focus.
  useEffect(() => {
    const onFocus = (): void => {
      document.querySelector<HTMLInputElement>('.palette input')?.focus();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  if (!snapshot) return null;

  return (
    <div className="palette">
      {mode === 'capture' ? <Capture lists={snapshot.data.lists} /> : <div className="stub">Coming soon</div> /* Slice 2 */}
    </div>
  );
}
