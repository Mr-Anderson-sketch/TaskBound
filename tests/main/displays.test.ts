import { describe, it, expect } from 'vitest';
import {
  displayKey,
  displaySignature,
  clampAlong,
  dockBounds,
  dockedEdgeY,
  panelBounds,
  sliverBounds,
  handleRect,
  pointIn,
  isTaskbarAutoHide,
  restorePosition,
  nextCollapsedSize,
  nextReportedWidth,
  reanchorY
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

  it('docks against a granted rect (Task 7.1) instead of workArea when one is given', () => {
    const d = makeDisplay(); // plain workArea would give y = 720 - 32 = 688
    const granted = { x: 0, y: 700, width: 1366, height: 40 };
    const rect = dockBounds(d, 'bottom', { width: 420, height: 32 }, undefined, false, granted);
    expect(rect.y).toBe(700 + 40 - 32);
    // x-axis clamping is unaffected by the grant — still against the display's own workArea.
    expect(rect.x).toBe((1366 - 420) / 2);
  });
});

// Task 7.1 (win32 AppBar) ruling 4: while a reservation is active, dock against the
// GRANTED rect's own edge instead of `workArea` — otherwise workArea (already
// shrunk by our own reservation) would push the strip inward on every redock.
describe('dockedEdgeY', () => {
  it('falls back to the plain workArea edge (bottom) when there is no grant', () => {
    const d = makeDisplay(); // workArea height 720, 48 px taskbar
    expect(dockedEdgeY(d, 'bottom', 32)).toBe(720 - 32);
  });

  it('falls back to the plain workArea edge (top) when there is no grant', () => {
    const d = makeDisplay({ workArea: { x: 0, y: 40, width: 1366, height: 728 } });
    expect(dockedEdgeY(d, 'top', 32)).toBe(40);
  });

  it('still applies the 2px taskbar-auto-hide reserve when there is no grant', () => {
    const d = makeDisplay({ workArea: { x: 0, y: 0, width: 1366, height: 768 } });
    expect(dockedEdgeY(d, 'bottom', 32, true)).toBe(768 - 32 - 2);
  });

  it('bottom edge with a grant: content bottom = granted rect bottom, ignoring workArea entirely', () => {
    const d = makeDisplay(); // workArea would otherwise put y at 720-32=688
    const granted = { x: 0, y: 700, width: 1366, height: 40 }; // granted bottom = 740
    expect(dockedEdgeY(d, 'bottom', 32, false, granted)).toBe(740 - 32);
  });

  it('top edge with a grant: content top = granted rect top, ignoring workArea entirely', () => {
    const d = makeDisplay();
    const granted = { x: 0, y: 12, width: 1366, height: 40 };
    expect(dockedEdgeY(d, 'top', 32, false, granted)).toBe(12);
  });

  it('a grant overrides the taskbar-auto-hide reserve too (the grant IS the true reserved edge)', () => {
    const d = makeDisplay({ workArea: { x: 0, y: 0, width: 1366, height: 768 } });
    const granted = { x: 0, y: 700, width: 1366, height: 40 };
    expect(dockedEdgeY(d, 'bottom', 32, true, granted)).toBe(740 - 32);
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
  it('bottom sliver on a 1366x768 display with a 48 px taskbar (workArea height 720) is flush to the work area, y = 716', () => {
    const strip = { x: 100, y: 720 - 32, width: 420, height: 32 };
    const workArea = { x: 0, y: 0, width: 1366, height: 720 };
    const rect = sliverBounds(strip, 'bottom', workArea);
    expect(rect).toEqual({ x: 100, y: 716, width: 420, height: 4 });
  });

  it('bottom sliver on an auto-hide taskbar display (workArea = bounds) is flush to the physical edge, y = 764', () => {
    // workArea reaches the full display height when the taskbar auto-hides, so the
    // work-area-edge sliver and the physical-edge sliver coincide here.
    const strip = { x: 100, y: 768 - 32 - 2, width: 420, height: 32 }; // dockBounds' 2 px reserve
    const workArea = { x: 0, y: 0, width: 1366, height: 768 };
    const rect = sliverBounds(strip, 'bottom', workArea);
    expect(rect).toEqual({ x: 100, y: 764, width: 420, height: 4 });
  });

  it('top sliver mirrors the bottom case: flush to workArea.y, not the taskbar-auto-hide-reserved strip y', () => {
    const strip = { x: 100, y: 40 + 2, width: 420, height: 32 }; // reserved 2 px from the work area top
    const workArea = { x: 0, y: 40, width: 1366, height: 728 };
    const rect = sliverBounds(strip, 'top', workArea);
    expect(rect).toEqual({ x: 100, y: 40, width: 420, height: 4 });
  });

  it('top sliver on an auto-hide taskbar display (workArea = bounds) is flush to the physical top edge', () => {
    const strip = { x: 100, y: 2, width: 420, height: 32 };
    const workArea = { x: 0, y: 0, width: 1366, height: 768 };
    const rect = sliverBounds(strip, 'top', workArea);
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

// Fix round 1, finding 9: "strip stuck at pill width after un-collapsing" — the
// reported width must only be adopted while collapsed.
describe('nextCollapsedSize', () => {
  it('adopts the reported width while collapsed (the pill is content-driven)', () => {
    expect(nextCollapsedSize({ width: 180, height: 24 }, true, 420, 44)).toEqual({ width: 180, height: 24 });
  });

  it('ignores the reported width when not collapsed, tracking settingsWidth instead', () => {
    // A stale pill-mode width (180) reported just after uncollapsing must not stick.
    expect(nextCollapsedSize({ width: 180, height: 32 }, false, 420, 44)).toEqual({ width: 420, height: 32 });
  });

  it('caps the reported height at maxHeight regardless of collapsed', () => {
    expect(nextCollapsedSize({ width: 420, height: 60 }, false, 420, 44)).toEqual({ width: 420, height: 44 });
    expect(nextCollapsedSize({ width: 180, height: 60 }, true, 420, 44)).toEqual({ width: 180, height: 44 });
  });
});

// Fix round 2, open item 2: finding 9 was only fixed for the collapsed (pill) path —
// StripWindow.handleReportedSize's EXPANDED branch still adopted the raw reported
// width regardless of settings.strip.collapsed. nextReportedWidth is the single rule
// both branches now share.
describe('nextReportedWidth', () => {
  it('adopts the reported width while collapsed', () => {
    expect(nextReportedWidth(180, true, 420)).toBe(180);
  });

  it('ignores the reported width when not collapsed (expanded or not), tracking settingsWidth', () => {
    expect(nextReportedWidth(180, false, 420)).toBe(420);
  });
});

// Fix round 2, open item 3: the first cut of C1 anchored to the raw work-area edge,
// discarding dockBounds's deliberate 2 px "taskbar auto-hide" reserve baked into
// requestedY — the strip then covered the taskbar's auto-hide reveal row.
describe('reanchorY', () => {
  it('bottom edge, no reserve: keeps the actual rect flush to the requested bottom edge', () => {
    // requested y=688 (720 workArea - 32 height, no reserve), OS floors height to 39.
    expect(reanchorY(688, 32, 39, 'bottom')).toBe(688 + 32 - 39); // 681
  });

  it('bottom edge, with the 2px auto-hide reserve baked into requestedY: reserve survives', () => {
    // dockBounds' 2px reserve: requested y = 720 - 32 - 2 = 686.
    const y = reanchorY(686, 32, 39, 'bottom');
    expect(y).toBe(686 + 32 - 39); // 679
    // The actual rect's bottom edge is still 2px shy of the true work-area bottom
    // (720), not flush against it.
    expect(y + 39).toBe(720 - 2);
  });

  it('top edge, no reserve: y stays exactly at requestedY regardless of actualHeight', () => {
    expect(reanchorY(0, 32, 39, 'top')).toBe(0);
  });

  it('top edge, with the 2px auto-hide reserve baked into requestedY: reserve survives', () => {
    expect(reanchorY(2, 32, 39, 'top')).toBe(2);
  });

  it('is a no-op when actualHeight equals the requested height', () => {
    expect(reanchorY(688, 32, 32, 'bottom')).toBe(688);
    expect(reanchorY(0, 32, 32, 'top')).toBe(0);
  });
});
