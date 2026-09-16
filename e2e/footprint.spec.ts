// e2e/footprint.spec.ts — Deliverable 2 (ship-measurement): measures the strip's real
// on-screen footprint. Skipped by default; run with `npm run e2e:footprint` (or
// `TB_MEASURE=1 playwright test e2e/footprint.spec.ts`). Reads the strip window's OS
// bounds (>= 39 DIP on Windows — a transparent-window minimum) AND the real clipped
// content rect (`tb.strip.lastShape`, ~32 px) plus the renderer's own `.strip` element
// bounding rect, for both edges, all three text sizes, and the collapsed pill. Writes
// docs/FOOTPRINT.md and per-theme strip screenshots into docs/screenshots/.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { launchApp, windowInfo } from './launch';

const DOC_PATH = path.resolve(__dirname, '..', 'docs', 'FOOTPRINT.md');
const SCREENSHOT_DIR = path.resolve(__dirname, '..', 'docs', 'screenshots');

type Evaluable = {
  __tb: {
    store: { dispatch: (a: unknown) => unknown };
    strip: { lastShape: { x: number; y: number; width: number; height: number } | undefined };
  };
};

interface Measurement {
  label: string;
  edge: string;
  textSize?: string;
  collapsed?: boolean;
  windowWidth: number;
  windowHeight: number;
  shapeWidth: number;
  shapeHeight: number;
  rendererWidth: number;
  rendererHeight: number;
}

async function measure(
  launched: Awaited<ReturnType<typeof launchApp>>,
  label: string,
  edge: string,
  opts: { textSize?: string; collapsed?: boolean } = {}
): Promise<Measurement> {
  await launched.app.evaluate(
    (_electron, { edge: e, textSize, collapsed }) => {
      const tb = (globalThis as unknown as Evaluable).__tb;
      const patch: Record<string, unknown> = { strip: { edge: e, collapsed: !!collapsed } };
      if (textSize) patch.textSize = textSize;
      tb.store.dispatch({ type: 'settings/patch', now: Date.now(), patch });
    },
    { edge, textSize: opts.textSize, collapsed: opts.collapsed }
  );

  const strip = await launched.window('strip');
  // Let the resize/reportSize round-trip (renderer -> strip:reportSize -> main
  // setBounds/setShape) settle before reading bounds.
  await strip.waitForTimeout(400);

  const selector = opts.collapsed ? '.pill' : '.strip';

  const infos = await windowInfo(launched.app);
  const info = infos.find((w) => w.url.includes('#/strip'))!;
  const shape = await launched.app.evaluate(() => (globalThis as unknown as Evaluable).__tb.strip.lastShape);

  const rendererBox = await strip.locator(selector).boundingBox({ timeout: 10_000 });

  return {
    label,
    edge,
    textSize: opts.textSize,
    collapsed: opts.collapsed,
    windowWidth: info.bounds.width,
    windowHeight: info.bounds.height,
    shapeWidth: shape?.width ?? NaN,
    shapeHeight: shape?.height ?? NaN,
    rendererWidth: rendererBox?.width ?? NaN,
    rendererHeight: rendererBox?.height ?? NaN
  };
}

function pct(part: number, whole: number): string {
  return `${((part / whole) * 100).toFixed(3)}%`;
}

test('footprint: measure the strip window/content/renderer bounds across edges, text sizes, and the collapsed pill', async () => {
  test.skip(!process.env.TB_MEASURE, 'set TB_MEASURE=1 (npm run e2e:footprint) to run the footprint measurement');
  test.setTimeout(120_000);

  let workArea!: { width: number; height: number };
  let displayBounds!: { width: number; height: number };
  let scaleFactor!: number;
  let errorsSeen: string[] = [];
  const measurements: Measurement[] = [];

  // Every phase below runs in its OWN fresh `launchApp()`, closed before the next one
  // starts. (Not required for correctness — the actual bug chased for a while here was
  // in this test file: `ElectronApplication.evaluate(fn, arg)` calls `fn(electronApi,
  // arg)`, so a single-parameter callback like `({edge, collapsed}) => ...` silently
  // destructures the ELECTRON API object, not the intended `arg` — every field reads
  // `undefined` with no error. Fixed by adding the `_electron` first parameter
  // everywhere an arg is passed. Kept the serialized-launch structure anyway since it
  // keeps each measurement's window state simple to reason about.)
  for (const edge of ['bottom', 'top']) {
    for (const textSize of ['S', 'M', 'L']) {
      const launched = await launchApp();
      try {
        await launched.window('strip');
        await launched.app.evaluate(() => {
          const tb = (globalThis as unknown as Evaluable).__tb;
          tb.store.dispatch({ type: 'task/add', id: 'measure-1', now: Date.now(), title: 'Measure the strip footprint', today: true });
        });
        if (!displayBounds) {
          workArea = await launched.app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
          displayBounds = await launched.app.evaluate(({ screen }) => screen.getPrimaryDisplay().bounds);
          scaleFactor = await launched.app.evaluate(({ screen }) => screen.getPrimaryDisplay().scaleFactor);
        }
        measurements.push(await measure(launched, `${edge} / ${textSize}`, edge, { textSize }));
        errorsSeen = errorsSeen.concat(launched.errors());
      } finally {
        await launched.close();
      }
    }

    const pillLaunch = await launchApp();
    try {
      await pillLaunch.window('strip');
      await pillLaunch.app.evaluate(() => {
        const tb = (globalThis as unknown as Evaluable).__tb;
        tb.store.dispatch({ type: 'task/add', id: 'measure-pill', now: Date.now(), title: 'Measure the strip footprint', today: true });
      });
      measurements.push(await measure(pillLaunch, `${edge} / collapsed pill`, edge, { collapsed: true }));
      errorsSeen = errorsSeen.concat(pillLaunch.errors());
    } finally {
      await pillLaunch.close();
    }
  }

  // --- per-theme screenshots (deliverable 2: "screenshots of the strip ... per theme";
  // honestly, this captures the STRIP WINDOW only via Playwright's page.screenshot() —
  // a PowerShell CopyFromScreen desktop capture in this environment only returns the
  // wallpaper, not real window contents, so it isn't used here or anywhere else in this
  // task). --------------------------------------------------------------------------
  {
    const shotLaunch = await launchApp();
    try {
      await shotLaunch.window('strip');
      await shotLaunch.app.evaluate(() => {
        const tb = (globalThis as unknown as Evaluable).__tb;
        tb.store.dispatch({ type: 'task/add', id: 'measure-shot', now: Date.now(), title: 'Measure the strip footprint', today: true });
        tb.store.dispatch({ type: 'settings/patch', now: Date.now(), patch: { strip: { edge: 'bottom', collapsed: false } } });
      });
      for (const theme of ['ledger', 'kraft', 'phosphor', 'slate']) {
        await shotLaunch.app.evaluate(
          (_electron, name) => {
            const tb = (globalThis as unknown as Evaluable).__tb;
            tb.store.dispatch({ type: 'settings/patch', now: Date.now(), patch: { theme: { name, mode: 'light' } } });
          },
          theme
        );
        const strip = await shotLaunch.window('strip');
        await strip.waitForTimeout(200);
        await strip.screenshot({ path: path.join(SCREENSHOT_DIR, `footprint-${theme}.png`) });
      }
      errorsSeen = errorsSeen.concat(shotLaunch.errors());
    } finally {
      await shotLaunch.close();
    }
  }

  {
    // --- write docs/FOOTPRINT.md -----------------------------------------------------
    const rows = measurements
      .map(
        (m) =>
          `| ${m.label} | ${m.windowWidth}x${m.windowHeight} | ${m.shapeWidth}x${m.shapeHeight} | ${m.rendererWidth.toFixed(1)}x${m.rendererHeight.toFixed(1)} |`
      )
      .join('\n');

    const contentHeights = measurements.filter((m) => !m.collapsed).map((m) => m.shapeHeight);
    const minContentHeight = Math.min(...contentHeights);
    const maxContentHeight = Math.max(...contentHeights);
    const pillHeight = measurements.find((m) => m.collapsed)?.shapeHeight ?? NaN;
    const stripWidth = measurements[0].windowWidth;

    const targets: Array<{ name: string; w: number; h: number }> = [
      { name: '1366x768 (this machine)', w: 1366, h: 768 },
      { name: '1920x1080', w: 1920, h: 1080 },
      { name: '2560x1440', w: 2560, h: 1440 }
    ];

    const areaTable = targets
      .map((t) => {
        const area = t.w * t.h;
        const stripArea = stripWidth * maxContentHeight;
        return `| ${t.name} | ${pct(stripArea, area)} | ${pct(maxContentHeight, t.h)} |`;
      })
      .join('\n');

    const doc = `# Strip footprint — docs/FOOTPRINT.md

Measured on this machine: Windows 11, primary display ${displayBounds.width}x${displayBounds.height} DIP, work area ${workArea.width}x${workArea.height}, scale factor ${scaleFactor}.

Three numbers per row: the OS **window** bounds (>= 39 px tall on Windows — a
transparent-frameless-window minimum, per StripWindow's \`reanchorAndClip\` comment in
src/main/windows/strip.ts), the **clipped content shape** applied via \`setShape\`
(\`tb.strip.lastShape\`, the real visible/interactive rect — ~32 px at text size M), and
the **renderer's own \`.strip\`/\`.pill\` element** bounding rect (should match the shape
within a pixel).

| configuration | window WxH | content shape WxH | renderer element WxH |
| --- | --- | --- | --- |
${rows}

Content height range across S/M/L text sizes: ${minContentHeight}-${maxContentHeight} px.
Collapsed pill height: ${pillHeight} px.

## Screen footprint at common resolutions

Using the largest measured content height (${maxContentHeight} px, text size L) and the
default strip width (${stripWidth} px) at 100% scale. The window's DIP size does not
change with the OS's display-scaling setting — at 125%/150% scale the strip still
occupies the same *fraction* of the work area (Electron sizes everything in DIP), but
the physical-pixel numbers below assume 100% scale; at 125%/150% each DIP maps to more
physical pixels, so treat these as the 100%-scale case and the DIP fraction as the
scale-independent number.

| target resolution (100% scale) | % of screen area | % of screen height |
| --- | --- | --- |
${areaTable}

## Screenshots

Per-theme strip screenshots (docs/screenshots/footprint-*.png) are captured with
Playwright's \`page.screenshot()\` directly on the strip window — this is the real
strip content. A desktop-level capture (e.g. PowerShell's \`CopyFromScreen\`) was NOT
used for anything in this task: in this environment it only returns the wallpaper, not
real window contents, so it would be misleading to include.
`;
    fs.mkdirSync(path.dirname(DOC_PATH), { recursive: true });
    fs.writeFileSync(DOC_PATH, doc);

    expect(measurements.length).toBeGreaterThan(0);
    expect(errorsSeen).toEqual([]);
  }
});
