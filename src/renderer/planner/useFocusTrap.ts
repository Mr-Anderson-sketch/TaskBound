// renderer/planner/useFocusTrap — a small shared Tab-trap for the planner's overlays
// (Task 4.2 fix round 1, finding 1): `Menu.tsx` and `Commands.tsx` handled
// Escape/arrows/Enter but not Tab, so a single Tab could move focus clean out of an
// open `role="menu"` or `aria-modal` `role="dialog"`. While `active`, this keeps Tab and
// Shift+Tab cycling among the container's own tabbable DESCENDANTS (buttons, inputs,
// `[tabindex="0"]`, excluding `disabled`) — never the container itself, since
// `Element.querySelectorAll` only matches descendants — wrapping at both ends, and
// moves focus into the container on activation if focus is currently outside it.
import { useEffect } from 'react';
import type { RefObject } from 'react';

const TABBABLE_SELECTOR = 'button:not([disabled]), input:not([disabled]), [tabindex="0"]:not([disabled])';

function tabbablesIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR));
}

/**
 * The next index to focus for a Tab (`shift: false`) or Shift+Tab (`shift: true`)
 * press, cycling through `count` tabbable elements and wrapping at both ends.
 * `currentIndex` is `-1` when focus isn't on any of them yet (e.g. it's still on the
 * container itself) — Tab from there enters at the first item (`0`), Shift+Tab enters
 * at the last (`count - 1`), matching how Tab conventionally enters a group. `count <= 0`
 * (nothing tabbable) returns `-1` (nowhere to go). Pure — no DOM — so it's unit-tested
 * directly (`tests/renderer/useFocusTrap.test.ts`); the DOM-touching parts of the hook
 * itself are covered by e2e (`e2e/planner-keys.spec.ts`).
 */
export function nextTabIndex(currentIndex: number, count: number, shift: boolean): number {
  if (count <= 0) return -1;
  if (shift) return currentIndex <= 0 ? count - 1 : currentIndex - 1;
  return currentIndex >= count - 1 ? 0 : currentIndex + 1;
}

/**
 * While `active`, traps Tab/Shift+Tab within `containerRef`'s current element. Attaches
 * one native `keydown` listener directly to the container (not `document`) — since every
 * tabbable element the trap cares about is by definition a descendant, a keydown
 * targeting any of them (or the container itself) still reaches this listener via normal
 * bubbling, and `preventDefault()` here suppresses the browser's native Tab focus-move
 * the same way it already suppresses Enter's native button-activate in `Menu.tsx`.
 * Existing per-component "focus my first control on open" effects (Commands.tsx's input,
 * DueField's input) run first (child-before-parent, or simply earlier in the same
 * component) and are left alone — this only steps in when focus is NOT already inside.
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    if (!container.contains(document.activeElement)) {
      const tabbables = tabbablesIn(container);
      (tabbables[0] ?? container).focus();
    }

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return;
      const tabbables = tabbablesIn(container);
      e.preventDefault();
      if (tabbables.length === 0) {
        container.focus();
        return;
      }
      const currentIndex = tabbables.indexOf(document.activeElement as HTMLElement);
      const next = nextTabIndex(currentIndex, tabbables.length, e.shiftKey);
      tabbables[next]?.focus();
    };

    container.addEventListener('keydown', onKeyDown);
    return () => container.removeEventListener('keydown', onKeyDown);
  }, [containerRef, active]);
}
