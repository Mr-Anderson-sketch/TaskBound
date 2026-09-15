// tests/renderer/useFocusTrap — pure `nextTabIndex` tests (Task 4.2 fix round 1,
// finding 1). The hook itself (DOM-touching) is covered by e2e/planner-keys.spec.ts.
import { describe, it, expect } from 'vitest';
import { nextTabIndex } from '../../src/renderer/planner/useFocusTrap';

describe('nextTabIndex', () => {
  it('Tab (shift: false) advances by one', () => {
    expect(nextTabIndex(0, 3, false)).toBe(1);
    expect(nextTabIndex(1, 3, false)).toBe(2);
  });

  it('Tab wraps from the last tabbable back to the first', () => {
    expect(nextTabIndex(2, 3, false)).toBe(0);
  });

  it('Shift+Tab moves back by one', () => {
    expect(nextTabIndex(2, 3, true)).toBe(1);
    expect(nextTabIndex(1, 3, true)).toBe(0);
  });

  it('Shift+Tab wraps from the first tabbable back to the last', () => {
    expect(nextTabIndex(0, 3, true)).toBe(2);
  });

  it('currentIndex -1 (focus not on any tabbable yet, e.g. still on the container): Tab enters at the first, Shift+Tab at the last', () => {
    expect(nextTabIndex(-1, 3, false)).toBe(0);
    expect(nextTabIndex(-1, 3, true)).toBe(2);
  });

  it('a single tabbable element (e.g. the command palette input) stays on itself either direction', () => {
    expect(nextTabIndex(0, 1, false)).toBe(0);
    expect(nextTabIndex(0, 1, true)).toBe(0);
    expect(nextTabIndex(-1, 1, false)).toBe(0);
    expect(nextTabIndex(-1, 1, true)).toBe(0);
  });

  it('no tabbable elements at all returns -1 (nowhere to go)', () => {
    expect(nextTabIndex(-1, 0, false)).toBe(-1);
    expect(nextTabIndex(-1, 0, true)).toBe(-1);
  });
});
