import { invoke } from '@tauri-apps/api/tauri';
import { appWindow } from '@tauri-apps/api/window';
import type { ThemeName } from '../shared/types';

interface Controls {
  enterFocus: () => Promise<void>;
  exitFocus: () => Promise<void>;
  setTheme: (theme: ThemeName) => void;
  setForceFocusOpen: (open: boolean) => void;
  theme: ThemeName;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (message: string) => invoke('selftest_log', { message }).catch(() => undefined);

const frame = async () => {
  const [position, size, scale] = await Promise.all([appWindow.outerPosition(), appWindow.outerSize(), appWindow.scaleFactor()]);
  const p = position.toLogical(scale);
  const s = size.toLogical(scale);
  return { x: Math.round(p.x), y: Math.round(p.y), w: Math.round(s.width), h: Math.round(s.height) };
};

const mark = async (name: string) => {
  await log(`mark ${name} ${JSON.stringify(await frame())}`);
  await sleep(1500); // time for the watcher to take its screenshot
};

let started = false;

export async function runSelfTest(controls: () => Controls) {
  // React StrictMode runs mount effects twice in dev; only one tour may run.
  if (started) {
    return;
  }
  started = true;
  const original = controls().theme;
  await log(`start theme=${original}`);
  await sleep(2500);
  await log(`screen ${JSON.stringify({ w: window.screen.width, h: window.screen.height, availTop: (window.screen as Screen & { availTop?: number }).availTop })}`);

  for (const theme of ['dark', 'light'] as ThemeName[]) {
    controls().setTheme(theme);
    await sleep(1800);
    const before = await frame();
    await mark(`${theme}-1-main`);

    await controls().enterFocus();
    await sleep(1500);
    await mark(`${theme}-2-focus`);

    controls().setForceFocusOpen(true);
    await sleep(1400);
    await mark(`${theme}-3-focus-expanded`);

    controls().setForceFocusOpen(false);
    await sleep(1400);
    await mark(`${theme}-4-focus-collapsed`);

    await controls().exitFocus();
    await sleep(1500);
    const after = await frame();
    await log(`restore ${theme} ${JSON.stringify(before) === JSON.stringify(after) ? 'OK' : 'MISMATCH'} before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
    await mark(`${theme}-5-main-restored`);
  }

  controls().setTheme(original);
  await sleep(1500);
  await log(`done theme=${controls().theme}`);
}
