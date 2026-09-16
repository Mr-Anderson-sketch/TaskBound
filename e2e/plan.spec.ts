import path from 'node:path';
import { test, expect } from '@playwright/test';
import { launchApp, windowInfo } from './launch';
import { dayKeyForRollover, addDays } from '../src/core/dates';

test.setTimeout(60_000);

const SCREENSHOT_DIR = path.resolve(__dirname, '..', 'docs', 'screenshots');

// Task 2.3, addendum ruling 9b: Task 2.2 found that hide() immediately followed by
// show() in the same tick lets a stray `blur` from the hide re-trigger the
// blur-hides-the-window handler, hiding the freshly-shown palette. The fix ignores a
// `blur` that arrives within 150 ms of `show()`; this exercises it with a real
// hide()+show('plan') pair issued inside ONE `app.evaluate` (so they really do land in
// the same JS tick on the main process side).
test('palette.hide() immediately followed by palette.show(\'plan\') in one tick stays visible', async () => {
  const launched = await launchApp();
  try {
    await launched.window('strip');
    await launched.app.evaluate(() => {
      (globalThis as unknown as { __tb: { palette: { show: (m: string) => void } } }).__tb.palette.show('capture');
    });
    await launched.window('palette', 5000);

    await launched.app.evaluate(() => {
      const p = (globalThis as unknown as { __tb: { palette: { hide: () => void; show: (m: string) => void } } }).__tb.palette;
      p.hide();
      p.show('plan');
    });

    const palette = await launched.window('palette', 5000);
    await palette.waitForTimeout(1000);

    const infos = await windowInfo(launched.app);
    expect(infos.find((w) => w.url.includes('#/palette'))?.visible).toBe(true);
    await expect(palette.locator('.palette .title')).toContainText('Plan today');

    expect(launched.errors()).toEqual([]);
  } finally {
    await launched.close();
  }
});

// Task 2.3 acceptance (addendum ruling 11): day/rollover, Plan today, and Close the day.
test('day/rollover marks yesterday, Plan today lists rolled-over/inbox candidates, Enter applies the change, and Close the day records a note', async () => {
  const launched = await launchApp();
  try {
    await launched.window('strip');

    // The app's own Clock already dispatched day/rollover for REAL today at boot
    // (Task 2.3 ruling 9) — re-dispatching for that exact date would be a guaranteed
    // no-op (ruling 3's idempotency guard). So this test's own deliberate rollover
    // dispatch targets the day BEFORE real today instead, with tasks "created" the day
    // before THAT — the same one-day relationship the brief describes (tasks created
    // "yesterday" relative to the day being rolled), just shifted a day earlier so it
    // never collides with boot's already-applied date. `planCandidates` (core/select.ts)
    // doesn't care either way — it's a live query against the real current time, not
    // the `days[]` record — so the Plan/Close UI below is unaffected by the shift.
    const realNow = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const simulatedNow = realNow - oneDayMs;
    const createdAt = simulatedNow - oneDayMs;

    await launched.app.evaluate(
      (_electron, { createdAt }) => {
        const tb = (globalThis as unknown as { __tb: { store: { dispatch: (a: unknown) => number } } }).__tb;
        tb.store.dispatch({ type: 'task/add', id: 'rolled-1', now: createdAt, title: 'Finish the Q2 retro notes', today: true });
        tb.store.dispatch({ type: 'task/add', id: 'rolled-2', now: createdAt, title: 'Email the vendor invoice', today: true });
        tb.store.dispatch({ type: 'task/add', id: 'inbox-1', now: createdAt, title: 'Sketch the onboarding flow' });
      },
      { createdAt }
    );

    const simulatedDate = dayKeyForRollover(simulatedNow);
    await launched.app.evaluate(
      (_electron, { simulatedNow, simulatedDate }) => {
        const tb = (globalThis as unknown as { __tb: { store: { dispatch: (a: unknown) => number } } }).__tb;
        tb.store.dispatch({ type: 'day/rollover', now: simulatedNow, date: simulatedDate });
      },
      { simulatedNow, simulatedDate }
    );

    const rolledYesterdayKey = addDays(simulatedDate, -1);
    const days = await launched.app.evaluate(
      () => (globalThis as unknown as { __tb: { store: { get: () => { data: { days: unknown[] } } } } }).__tb.store.get().data.days
    );
    expect((days as Array<{ date: string; rolledOver: number }>).find((d) => d.date === rolledYesterdayKey)?.rolledOver).toBe(2);

    // --- Plan today -----------------------------------------------------------------

    await launched.app.evaluate(() => {
      (globalThis as unknown as { __tb: { palette: { show: (m: string) => void } } }).__tb.palette.show('plan');
    });
    const palette = await launched.window('palette', 5000);

    const rows = palette.locator('.palette .pl');
    await expect(rows).toHaveCount(3, { timeout: 2000 }); // 2 rolled-over + 1 inbox
    await expect(rows.nth(0)).toContainText('Finish the Q2 retro notes');
    await expect(rows.nth(0)).toContainText('rolled over');
    await expect(rows.nth(1)).toContainText('Email the vendor invoice');
    await expect(rows.nth(2)).toContainText('Sketch the onboarding flow');
    await expect(rows.nth(2)).toContainText('inbox');
    // Initial selection: rolled-over checked, inbox unchecked.
    await expect(rows.nth(0).locator('.cb')).toHaveClass(/on/);
    await expect(rows.nth(1).locator('.cb')).toHaveClass(/on/);
    await expect(rows.nth(2).locator('.cb')).not.toHaveClass(/on/);

    // Fix round 1, reviewer point 5: `show('plan')` now pre-sizes the window to a
    // per-mode estimate (360 px) before it's shown at all, so the sheet no longer
    // first paints at capture's 132 px and visibly grows — but the renderer's
    // ResizeObserver (-> palette:reportSize -> setContentHeight) still asynchronously
    // refines that estimate down to this 3-row sheet's real (smaller) content height.
    // Wait for that refinement to land before screenshotting, or the shot shows the
    // oversized 360 px estimate with empty space below the footer instead of the
    // tightly-fitted final sheet.
    await expect
      .poll(async () => {
        const infos = await windowInfo(launched.app);
        return infos.find((w) => w.url.includes('#/palette'))?.bounds.height ?? 0;
      })
      .toBeLessThan(300);
    await palette.screenshot({ path: path.join(SCREENSHOT_DIR, 'plan-today.png') });

    await palette.keyboard.press('ArrowDown'); // focus row 1 ("Email the vendor invoice")
    await palette.keyboard.press(' '); // uncheck it
    await expect(rows.nth(1).locator('.cb')).not.toHaveClass(/on/);

    await palette.keyboard.press('Enter');

    await expect
      .poll(async () => {
        const infos = await windowInfo(launched.app);
        return infos.find((w) => w.url.includes('#/palette'))?.visible ?? false;
      })
      .toBe(false);

    const tasksAfter = await launched.app.evaluate(
      () => (globalThis as unknown as { __tb: { store: { get: () => { data: { tasks: unknown[] } } } } }).__tb.store.get().data.tasks
    );
    const byId = new Map((tasksAfter as Array<{ id: string; today: boolean }>).map((t) => [t.id, t.today]));
    expect(byId.get('rolled-1')).toBe(true);
    expect(byId.get('rolled-2')).toBe(false);

    const strip = await launched.window('strip');
    await expect(strip.locator('.strip .title')).toContainText('Finish the Q2 retro notes', { timeout: 2000 });

    // Give Close the day something real to report instead of an all-zero fresh-install
    // look: fold a 25-minute focus segment into today and complete the task (`now`
    // values 25 minutes apart, not a real wait — see foldTimerSegment in reducer.ts).
    // "Rolled over" for the real day genuinely is 0 here — this test's own simulated
    // rollover above deliberately targets a day before real today (see the comment at
    // the top of this test) precisely so it doesn't collide with the idempotency guard
    // on real today's own boot-time rollover, so there's no way to also fake a nonzero
    // rolled-over count for real today without touching core — left as a real 0.
    const completeNow = Date.now();
    await launched.app.evaluate(
      (_electron, { completeNow }) => {
        const tb = (globalThis as unknown as { __tb: { store: { dispatch: (a: unknown) => number } } }).__tb;
        tb.store.dispatch({ type: 'timer/start', id: 'rolled-1', now: completeNow - 25 * 60_000 });
        tb.store.dispatch({ type: 'task/complete', id: 'rolled-1', now: completeNow, by: 'user' });
      },
      { completeNow }
    );

    // --- Close the day ----------------------------------------------------------------

    await launched.app.evaluate(() => {
      (globalThis as unknown as { __tb: { palette: { show: (m: string) => void } } }).__tb.palette.show('close');
    });
    const closePalette = await launched.window('palette', 5000);
    await expect(closePalette.locator('.palette .title')).toContainText('Close the day');

    const noteInput = closePalette.locator('.palette .note input');
    await noteInput.click();
    await noteInput.fill('Solid focused day');

    // Same pre-size-then-refine story as Plan today above: close's estimate is
    // 260 px, refined down to this sheet's real (smaller) content height.
    await expect
      .poll(async () => {
        const infos = await windowInfo(launched.app);
        return infos.find((w) => w.url.includes('#/palette'))?.bounds.height ?? 0;
      })
      .toBeLessThan(250);
    await closePalette.screenshot({ path: path.join(SCREENSHOT_DIR, 'close-day.png') });

    await noteInput.press('Enter');

    await expect
      .poll(async () => {
        const infos = await windowInfo(launched.app);
        return infos.find((w) => w.url.includes('#/palette'))?.visible ?? false;
      })
      .toBe(false);

    const todayKey = dayKeyForRollover(Date.now());
    const daysAfter = await launched.app.evaluate(
      () => (globalThis as unknown as { __tb: { store: { get: () => { data: { days: unknown[] } } } } }).__tb.store.get().data.days
    );
    const todayRecord = (daysAfter as Array<{ date: string; closedAt?: number; note?: string }>).find((d) => d.date === todayKey);
    expect(todayRecord?.closedAt).toBeDefined();
    expect(todayRecord?.note).toBe('Solid focused day');

    expect(launched.errors()).toEqual([]);
  } finally {
    await launched.close();
  }
});
