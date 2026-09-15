// renderer/planner/Menu — a small overlay menu anchored under the selected row (Task 4.2
// addendum ruling 3): keyboard-navigable with arrows/Enter/Escape, focus-trapped,
// `role="menu"` / `role="menuitem"`. Shared by the snooze, due, and move-to-list menus
// (each supplies its own items/body; Menu owns positioning, outside-click, and the
// arrow/Enter/Escape wiring). Escape and a click outside both close and return focus to
// the task list (ruling 6: "every menu and the command palette return focus to the list
// on close").
import { useEffect, useRef, useState } from 'react';
import type { ReactNode, KeyboardEvent } from 'react';

export interface MenuItem {
  id: string;
  label: string;
}

export interface MenuProps {
  /** The task row DOM element this menu is anchored under. */
  anchor: HTMLElement;
  /** Plain, arrow-navigable items (snooze/move menus). Omit and render `children`
   * instead for a menu with its own custom body (the due picker's text field). */
  items?: MenuItem[];
  onSelect?: (id: string) => void;
  /** Custom body (the due picker) instead of `items`/`onSelect`. */
  children?: ReactNode;
  onClose: () => void;
  label: string;
}

const MENU_GAP = 4;

export function Menu({ anchor, items, onSelect, children, onClose, label }: MenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const rect = anchor.getBoundingClientRect();

  useEffect(() => {
    // Focus the menu itself (custom-body menus focus their own first control, e.g.
    // DueField's input, via their own effect) so arrow/Enter/Escape work immediately.
    if (!items) return;
    rootRef.current?.focus();
  }, [items]);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [onClose]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (!items) return; // custom-body menus handle their own arrow/Enter
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[activeIndex];
      if (item) onSelect?.(item.id);
    }
  };

  return (
    <div
      ref={rootRef}
      className="menu"
      role="menu"
      aria-label={label}
      tabIndex={items ? 0 : -1}
      onKeyDown={onKeyDown}
      style={{ position: 'fixed', top: rect.bottom + MENU_GAP, left: rect.left }}
    >
      {items
        ? items.map((item, i) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={i === activeIndex ? 'mi sel' : 'mi'}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => onSelect?.(item.id)}
            >
              {item.label}
            </button>
          ))
        : children}
    </div>
  );
}
