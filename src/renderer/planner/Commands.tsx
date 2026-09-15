// renderer/planner/Commands — the command palette (Task 4.2 addendum ruling 4): an
// overlay INSIDE the planner window (not the separate palette window — `PaletteMode`'s
// `'commands'` stays a Slice 2 stub there), 560 px, centred near the top. Fuzzy filter +
// rank live in commandsModel.ts (pure, unit-tested); this is the thin React shell:
// input, up to 8 results, arrow/Enter navigation, Escape closes, `role="dialog"` with
// `aria-modal`, results as `role="listbox"`.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { allCommands, filterCommands } from './commandsModel';
import type { CommandsContext, PaletteCommandAction } from './commandsModel';
import { useFocusTrap } from './useFocusTrap';

export interface CommandsProps {
  ctx: CommandsContext;
  onRun: (action: PaletteCommandAction) => void;
  onClose: () => void;
}

export function Commands({ ctx, onRun, onClose }: CommandsProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const commands = useMemo(() => allCommands(ctx), [ctx]);
  const results = useMemo(() => filterCommands(commands, query), [commands, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Fix round 1, finding 1: the palette is `aria-modal`, so Tab must never move focus
  // out of it. With the input as the palette's only tabbable element, this keeps Tab
  // simply parked on it (Task 4.2 fix round 1 binding: "Tab with a single tabbable
  // input simply stays on the input") rather than escaping to whatever's behind it.
  useFocusTrap(rootRef, true);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [onClose]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const command = results[activeIndex];
      if (command) onRun(command.action);
    }
  };

  const onOverlayMouseDown = (e: ReactMouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="cmdk-overlay" onMouseDown={onOverlayMouseDown}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Command palette" ref={rootRef}>
        <input
          ref={inputRef}
          type="text"
          className="cmdk-input"
          placeholder="Type a command…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Command palette"
        />
        <div className="cmdk-list" role="listbox" aria-label="Command results">
          {results.length === 0 ? (
            <div className="cmdk-empty">No matching commands</div>
          ) : (
            results.map((r, i) => (
              <div
                key={r.id}
                role="option"
                aria-selected={i === activeIndex}
                className={i === activeIndex ? 'cmdk-row sel' : 'cmdk-row'}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => onRun(r.action)}
              >
                <span className="cmdk-label">{r.label}</span>
                {r.hint && <kbd className="cmdk-hint">{r.hint}</kbd>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
