// renderer/palette/Capture — title-only capture (DESIGN.md "Palette (keyboard
// sheets)": capture mode). Full token parsing (dates, tags, lists, timers) is Slice 2;
// this is title-only per the brief.
import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { dispatch } from '../lib/useStore';

export function Capture() {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape') {
      void window.tb.invoke('palette:hide');
      return;
    }
    if (e.key !== 'Enter') return;

    const title = inputRef.current?.value.trim();
    if (!title) return; // empty input + Enter does nothing

    dispatch({ type: 'task/add', id: crypto.randomUUID(), title, today: true, makeCurrent: e.shiftKey });
    void window.tb.invoke('palette:hide');
  };

  return (
    <>
      <div className="in">
        <input ref={inputRef} type="text" placeholder="Add a task" onKeyDown={onKeyDown} autoFocus />
      </div>
      <div className="foot">
        <span>
          <kbd>Enter</kbd> add · <kbd>Shift+Enter</kbd> add and make current · <kbd>Esc</kbd> close
        </span>
      </div>
    </>
  );
}
