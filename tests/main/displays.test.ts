import { describe, it, expect } from 'vitest';
import {
  displayKey,
  displaySignature,
  clampAlong,
  dockBounds,
  panelBounds,
  sliverBounds,
  handleRect,
  pointIn,
  isTaskbarAutoHide,
  restorePosition
} from '../../src/main/windows/displays';
import type { DisplayLike } from '../../src/main/windows/displays';

function makeDisplay(overrides: Partial<DisplayLike> = {}): DisplayLike {
  return {
    id: 1,
    bounds: { x: 0, y: 0, width: 1366, height: 768 },
    workArea: { x: 0, y: 0, width: 1366, height: 720 }, // 48 px taskbar at the bottom
    scaleFactor: 1,
    ...overrides
  };
}

describe('displayKey / displaySignature', () => {
  it('displayKey is the stringified id', () => {
    expect(displayKey(makeDisplay({ id: 42 }))).toBe('42');
  });

  it('displaySignature is resolution+scale', () => {
    expect(displaySignature(makeDisplay({ scaleFactor: 1.5 }))).toBe('1366x768@1.5');
  });
});

describe('dockBounds', () => {
  it('bottom dock on a 1366x768 display with a 48 px taskbar gives y = 720 - 32', () => {
    const d = makeDisplay();
    const rect = dockBounds(d, 'bottom', { width: 420, height: 32 });
    expect(rect.y).toBe(720 - 32);
    expect(rect.height).toBe(32);
  });

  it('top dock sits flush to the work area top', () => {
    const d = makeDisplay({ workArea: { x: 0, y: 40, width: 1366, height: 728 } }); // taskbar on top
    const rect = dockBounds(d, 'top', { width: 420, height: 32 });
    expect(rect.y).toBe(40);
  });

  it('centres horizontally when no `along` is given', () => {
    const d = makeDisplay();
    const rect = dockBounds(d, 'bottom', { width: 420, height: 32 });
    expect(rect.x).toBe((1366 - 420) / 2);
  });

  it('reserves 2 px when the taskbar auto-hides (bottom)', () => {
    const d = makeDisplay({ workArea: { x: 0, y: 0, width: 1366, height: 768 } }); // no reserved gap
    const rect = dockBounds(d, 'bottom', { width: 420, height: 32 }, undefined, true);
    expect(rect.y).toBe(768 - 32 - 2);
  });

  it('reserves 2 px when the taskbar auto-hides (top)', () => {
    const d = makeDisplay({ workArea: { x: 0, y: 0, width: 1366, height: 768 } });
    const rect = dockBounds(d, 'top', { width: 420, height: 32 }, undefined, true);
    expect(rect.y).toBe(2);
  });

  it('clamps a restored `along` x so the strip stays inside the work area', () => {
    const d = makeDisplay();
    const rect = dockBounds(d, 'bottom', { width: 420, height: 32 }, 5000);
    expect(rect.x).toBe(1366 - 420);
  });

  it('rounds a fractional centred x to an integer (odd width)', () => {
    const d = makeDisplay(); // workArea.x = 0, width 1366 -> (1366-421)/2 = 472.5
    const rect = dockBounds(d, 'bottom', { width: 421, height: 32 });
    expect(Number.isInteger(rect.x)).toBe(true);
    expect(rect.x).toBe(473);
  });

  it('centres correctly on a display with a non-zero workArea.x (secondary monitor to the right)', () => {
    const d = makeDisplay({
      bounds: { x: 1366, y: 0, width: 1280, height: 720 },
      workArea: { x: 1366, y: 0, width: 1280, height: 720 }
    });
    const rect = dockBounds(d, 'bottom', { width: 420, height: 32 });
    expect(rect.x).toBe(1366 + (1280 - 420) / 2);
    expect(Number.isInteger(rect.x)).toBe(true);
  });

  it('centres correctly on a display with a negative workArea.x (secondary monitor to the left)', () => {
    const d = makeDisplay({
      bounds: { x: -1920, y: 0, width: 1920, height: 1080 },
      workArea: { x: -1920, y: 0, width: 1920, height: 1080 }
    });
    const rect = dockBounds(d, 'bottom', { width: 421, height: 32 }); // odd width -> fractional centring
    expect(rect.x).toBe(Math.round(-1920 + (1920 - 421) / 2));
    expect(Number.isInteger(rect.x)).toBe(true);
  });
});

describe('clampAlong', () => {
  it('keeps the strip inside the work area on the left', () => {
    const d = makeDisplay();
    expect(clampAlong(d, -100, 420)).toBe(0);
  });

  it('keeps the strip inside the work area beyond the right edge', () => {
    const d = makeDisplay();
    expect(clampAlong(d, 2000, 420)).toBe(1366 - 420);
  });

  it('leaves an in-bounds x untouched', () => {
    const d = makeDisplay();
    expect(clampAlong(d, 100, 420)).toBe(100);
  });

  it('pins to the work area left edge when the strip is wider than the work area', () => {
    const d = makeDisplay({ workArea: { x: 50, y: 0, width: 300, height: 720 } });
    expect(clampAlong(d, 100, 420)).toBe(50);
  });

  it('rounds a fractional x to an integer', () => {
    const d = makeDisplay();
    expect(clampAlong(d, 100.6, 420)).toBe(101);
  });
});

describe('panelBounds', () => {
  it('panel above a bottom strip has y = strip.y - panelHeight', () => {
    const strip = { x: 100, y: 688, width: 420, height: 32 };
    const rect = panelBounds(strip, 'bottom', 200);
    expect(rect.y).toBe(688 - 200);
    expect(rect.height).toBe(32 + 200);
    expect(rect.x).toBe(100);
    expect(rect.width).toBe(420);
  });

  it('panel below a top strip grows downward from the strip origin', () => {
    const strip = { x: 100, y: 0, width: 420, height: 32 };
    const rect = panelBounds(strip, 'top', 200);
    expect(rect.y).toBe(0);
    expect(rect.height).toBe(32 + 200);
  });
});

describe('sliverBounds', () => {
  it('bottom sliver is a 4 px strip flush to the display bottom when the strip itself is already flush', () => {
    const strip = { x: 100, y: 688, width: 420, height: 32 };
    const displayBounds = { x: 0, y: 0, width: 1366, height: 720 };
    const rect = sliverBounds(strip, 'bottom', displayBounds);
    expect(rect).toEqual({ x: 100, y: 720 - 4, width: 420, height: 4 });
  });

  it('top sliver is a 4 px strip flush to the display top when the strip itself is already flush', () => {
    const strip = { x: 100, y: 40, width: 420, height: 32 };
    const displayBounds = { x: 0, y: 40, width: 1366, height: 728 };
    const rect = sliverBounds(strip, 'top', displayBounds);
    expect(rect).toEqual({ x: 100, y: 40, width: 420, height: 4 });
  });

  it('bottom sliver uses the display\'s physical bottom edge, not the taskbar-auto-hide-reserved strip y', () => {
    // The strip is nudged 2 px off the true bottom edge (taskbarAutoHide reserve),
    // but the sliver must still be flush to the real screen edge so the cursor can
    // reach it by slamming into the corner.
    const strip = { x: 100, y: 686, width: 420, height: 32 }; // 720 - 32 - 2
    const displayBounds = { x: 0, y: 0, width: 1366, height: 720 };
    const rect = sliverBounds(strip, 'bottom', displayBounds);
    expect(rect).toEqual({ x: 100, y: 720 - 4, width: 420, height: 4 });
  });

  it('top sliver uses the display\'s physical top edge, not the taskbar-auto-hide-reserved strip y', () => {
    const strip = { x: 100, y: 2, width: 420, height: 32 }; // reserved 2 px from the true top
    const displayBounds = { x: 0, y: 0, width: 1366, height: 768 };
    const rect = sliverBounds(strip, 'top', displayBounds);
    expect(rect).toEqual({ x: 100, y: 0, width: 420, height: 4 });
  });
});

describe('handleRect', () => {
  it('is a 24x24 rect, 4 px from the left, vertically centred', () => {
    const strip = { x: 100, y: 688, width: 420, height: 32 };
    const rect = handleRect(strip);
    expect(rect).toEqual({ x: 104, y: 688 + (32 - 24) / 2, width: 24, height: 24 });
  });
});

describe('pointIn', () => {
  it('true for a point inside the rect', () => {
    expect(pointIn({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5 })).toBe(true);
  });

  it('false for a point outside the rect', () => {
    expect(pointIn({ x: 0, y: 0, width: 10, height: 10 }, { x: 50, y: 5 })).toBe(false);
  });
});

describe('isTaskbarAutoHide', () => {
  it('true on bottom when the work area reaches the display bottom', () => {
    const d = makeDisplay({ workArea: { x: 0, y: 0, width: 1366, height: 768 } });
    expect(isTaskbarAutoHide(d, 'bottom')).toBe(true);
  });

  it('false on bottom when the taskbar reserves space', () => {
    const d = makeDisplay(); // 48 px taskbar reserved
    expect(isTaskbarAutoHide(d, 'bottom')).toBe(false);
  });

  it('true on top when the work area reaches the display top', () => {
    const d = makeDisplay({ workArea: { x: 0, y: 0, width: 1366, height: 768 } });
    expect(isTaskbarAutoHide(d, 'top')).toBe(true);
  });

  it('false on top when the taskbar reserves space', () => {
    const d = makeDisplay({ workArea: { x: 0, y: 40, width: 1366, height: 728 } });
    expect(isTaskbarAutoHide(d, 'top')).toBe(false);
  });
});

describe('restorePosition', () => {
  it('hits by displayKey (id) first', () => {
    const d = makeDisplay({ id: 7 });
    const positions = { '7': { x: 10, y: 20 } };
    expect(restorePosition(positions, d)).toEqual({ x: 10, y: 20 });
  });

  it('falls back to displaySignature when the id is not found', () => {
    const d = makeDisplay({ id: 7, scaleFactor: 1 });
    const positions = { [displaySignature(d)]: { x: 30, y: 40 } };
    expect(restorePosition(positions, d)).toEqual({ x: 30, y: 40 });
  });

  it('returns undefined when neither key is found', () => {
    const d = makeDisplay({ id: 7 });
    expect(restorePosition({}, d)).toBeUndefined();
  });
});
