// UI end-to-end tests (test plan §2). Starts its own Vite server on a spare port.
// Usage: npm run e2e
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ configFile: path.join(ROOT, 'vite.config.ts'), server: { port: 5199, strictPort: false }, logLevel: 'error' });
await server.listen();
const BASE = server.resolvedUrls.local[0];
const OUT = path.join(ROOT, 'e2e', 'out');
mkdirSync(OUT, { recursive: true });

let failures = 0;
let passes = 0;
const check = (name, ok, detail = '') => {
  if (ok) {
    passes += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 400, height: 640 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));

await page.clock.install({ time: new Date('2026-10-16T10:00:00+05:30') });
await page.goto(BASE);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('.shell');

const nowTitle = () => page.locator('.now .title').innerText();
const nowTime = () => page.locator('.now .time').innerText();
const score = async () => Number((await page.locator('.chip .score').innerText()).trim());
const upNextNames = () => page.locator('section[aria-label="Up next"] .row .name').allInnerTexts();
const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const tick = (ms) => page.clock.runFor(ms);
const addQuick = async (text) => {
  await page.fill('#quick-add', text);
  await page.press('#quick-add', 'Enter');
};

console.log('E1 empty state');
check('shows "Nothing running"', await page.getByText('Nothing running.').isVisible());
await shot('dark-01-empty');
await addQuick('Write intro');
check('asks for a time when none is running', await page.getByText('Add a time so the timer can start').isVisible());

console.log('E2 quick add');
await page.fill('#quick-add', 'Write intro 25m');
check('duration chip appears while typing', (await page.locator('.addbar .parsed').innerText()) === '25m');
await page.press('#quick-add', 'Enter');
check('task becomes Now', (await nowTitle()) === 'Write intro');
check('clock starts at 25:00', (await nowTime()) === '25:00');
check('input clears', (await page.inputValue('#quick-add')) === '');

console.log('E3 timer');
await tick(3000);
check('clock counts down', (await nowTime()) === '24:57', await nowTime());

console.log('E4 pause / resume');
await page.getByRole('button', { name: 'Pause' }).first().click();
await tick(3000);
check('paused clock is frozen', (await nowTime()) === '24:57', await nowTime());
check('shows Paused', await page.locator('.now .paused-tag').isVisible());
await page.locator('body').click({ position: { x: 200, y: 5 } });
await page.keyboard.press('Space');
await tick(1000);
check('Space resumes', (await nowTime()) === '24:56', await nowTime());

console.log('E5 +5m');
await page.getByRole('button', { name: '+5m' }).click();
check('adds five minutes', (await nowTime()) === '29:56', await nowTime());
check('costs a point', (await score()) === -1, await score());
check('toast confirms', await page.getByText('Added 5 minutes').isVisible());

await addQuick('Schedule posts 15m');
await addQuick('Connect Claude 10m');
await addQuick('Email Priya');

console.log('E7 order, start now, do next');
check('up next is in run order', JSON.stringify(await upNextNames()) === JSON.stringify(['Schedule posts', 'Connect Claude', 'Email Priya']), JSON.stringify(await upNextNames()));
await page.locator('.row', { hasText: 'Connect Claude' }).click({ button: 'right' });
await shot('dark-02-context-menu');
await page.getByRole('menuitem', { name: 'Start now' }).click();
check('Start now makes it current', (await nowTitle()) === 'Connect Claude');
check('previous task waits first in line', (await upNextNames())[0] === 'Write intro', JSON.stringify(await upNextNames()));
check('previous task kept its time', (await page.locator('.row', { hasText: 'Write intro' }).locator('.dur').innerText()) === '29:56');
await page.locator('.row', { hasText: 'Email Priya' }).click({ button: 'right' });
await page.getByRole('menuitem', { name: 'Do next' }).click();
check('Do next moves it to the front of the queue', (await upNextNames())[0] === 'Email Priya', JSON.stringify(await upNextNames()));
await shot('dark-03-list');

console.log('E6 done');
await page.locator('body').click({ position: { x: 200, y: 5 } });
await page.keyboard.press('Meta+Enter');
check('⌘↵ completes and advances', (await nowTitle()) === 'Email Priya');
check('+2 for finishing early', (await score()) === 1, await score());
check('today counter', (await page.locator('.chip .mono').first().innerText()) === '1 today');
check('Done today section', await page.getByText('Done today · 1').isVisible());
check('timeless task shows Set time', await page.getByRole('button', { name: 'Set time' }).isVisible());
await shot('dark-04-no-time');
await page.getByRole('button', { name: 'Set time' }).click();
await page.getByRole('button', { name: '15m' }).click();
await page.getByRole('button', { name: 'Save', exact: true }).click();
check('Set time starts the clock', (await nowTime()) === '15:00', await nowTime());
check('first time assignment is free', (await score()) === 1, await score());

console.log('E8 edit');
await page.locator('.row', { hasText: 'Schedule posts' }).dblclick();
check('edit sheet opens', await page.getByRole('dialog', { name: 'Edit task' }).isVisible());
check('title prefilled', (await page.locator('.sheet textarea').inputValue()) === 'Schedule posts');
await page.getByRole('button', { name: '25m' }).click();
check('raising time warns about the point', await page.getByText('Adding time costs 1 point.').isVisible());
await shot('dark-05-edit-sheet');
await page.getByRole('button', { name: 'Save · −1 point' }).click();
check('row shows new time', (await page.locator('.row', { hasText: 'Schedule posts' }).locator('.dur').innerText()) === '25:00');
check('point deducted', (await score()) === 0, await score());

console.log('E9 add time sheet');
await page.locator('.row', { hasText: 'Schedule posts' }).click({ button: 'right' });
await page.getByRole('menuitem', { name: 'Add time…' }).click();
await page.getByRole('button', { name: '+10m' }).click();
await page.getByRole('button', { name: 'Add 10m' }).click();
check('time added', (await page.locator('.row', { hasText: 'Schedule posts' }).locator('.dur').innerText()) === '35:00');
check('point deducted', (await score()) === -1, await score());

console.log('E10 add several');
await page.getByRole('button', { name: 'More' }).click();
await shot('dark-06-menu');
await page.getByRole('menuitem', { name: 'Add several tasks…' }).click();
await page.fill('.sheet textarea', 'Alpha 5m\nBeta 1h30');
await page.getByRole('button', { name: 'Add tasks' }).click();
const names = await upNextNames();
check('both added at the end', names.includes('Alpha') && names.includes('Beta'), JSON.stringify(names));
check('1h30 parsed', (await page.locator('.row', { hasText: 'Beta' }).locator('.dur').innerText()) === '1:30:00');

console.log('E11 multi-select delete');
await page.locator('.row', { hasText: 'Alpha' }).click();
await page.locator('.row', { hasText: 'Beta' }).click({ modifiers: ['Shift'] });
check('range selected', (await page.locator('.row.selected').count()) === 2);
await page.keyboard.press('Delete');
check('confirm sheet for several', await page.getByRole('dialog', { name: 'Delete 2 tasks?' }).isVisible());
await page.getByRole('button', { name: 'Delete 2' }).click();
const afterDelete = await upNextNames();
check('both removed', !afterDelete.includes('Alpha') && !afterDelete.includes('Beta'), JSON.stringify(afterDelete));

console.log('E13 summary');
await page.locator('.header .chip').click();
check('summary opens', await page.getByRole('dialog', { name: 'Today' }).isVisible());
check('counts one task done', (await page.locator('.stat b').first().innerText()) === '1');
await shot('dark-07-summary');
await page.keyboard.press('Escape');

console.log('E16 time’s up');
await addQuick('Tiny 1m');
await page.locator('.row', { hasText: 'Tiny' }).click({ button: 'right' });
await page.getByRole('menuitem', { name: 'Start now' }).click();
const before = (await score());
await tick(61_000);
check('toast announces time’s up', await page.getByText('Time’s up · Tiny').isVisible());
check('auto finish +1', (await score()) === before + 1, await score());
check('next task took over', (await nowTitle()) !== 'Tiny');
await shot('dark-08-time-up');
await page.locator('.toast').getByRole('button', { name: '+5 min' }).click();
check('+5 min brings it back as current', (await nowTitle()) === 'Tiny' && (await nowTime()) === '05:00', `${await nowTitle()} ${await nowTime()}`);
check('net −1 for the extra time', (await score()) === before - 1, await score());

console.log('E15 focus mode (dark)');
await page.keyboard.press('f');
await page.waitForSelector('.widget.island');
check('island widget replaces the main window', (await page.locator('.shell').count()) === 0);
await page.setViewportSize({ width: 450, height: 37 });
await shot('dark-09-island');
await page.setViewportSize({ width: 450, height: 37 + 118 });
await page.locator('.widget').hover();
await tick(400);
await page.waitForSelector('.widget.expanded');
check('hover expands', true);
await page.waitForTimeout(450); // real-time wait for the fade-in
await shot('dark-10-island-expanded');
await page.locator('.widget').getByRole('button', { name: 'Pause' }).click();
check('pause from widget', await page.locator('.widget.paused').isVisible());
await page.locator('.widget').getByRole('button', { name: 'Resume' }).click();
await page.keyboard.press('Escape');
await page.setViewportSize({ width: 400, height: 640 });
await page.waitForSelector('.shell');
check('Esc returns to the main window', true);

console.log('E12 theme');
await page.getByRole('button', { name: 'Switch to light mode' }).click();
check('light theme applied', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light');
await shot('light-01-main');
await tick(500); // let the debounced save run before reloading
await page.reload();
await page.waitForSelector('.shell');
check('theme persists', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light');

console.log('E17 persistence');
check('tasks persist', (await nowTitle()) === 'Tiny', await nowTitle());
check('score persists', (await score()) === before - 1, await score());

console.log('E18 light screenshots');
await page.locator('.row').first().click({ button: 'right' });
await shot('light-02-context-menu');
await page.keyboard.press('Escape');
await page.locator('.row', { hasText: 'Schedule posts' }).dblclick();
await shot('light-03-edit-sheet');
await page.keyboard.press('Escape');
await page.locator('.header .chip').click();
await shot('light-04-summary');
await page.keyboard.press('Escape');

console.log('E15 focus mode (light)');
await page.getByRole('button', { name: 'Focus mode' }).click();
await page.waitForSelector('.widget.capsule');
await page.setViewportSize({ width: 300, height: 52 });
await shot('light-05-capsule');
await page.setViewportSize({ width: 300, height: 52 + 62 });
await page.locator('.widget').hover();
await tick(400);
await page.waitForSelector('.widget.expanded');
await page.waitForTimeout(450);
await shot('light-06-capsule-expanded');
await page.locator('.widget').getByRole('button', { name: 'Open full window' }).click();
await page.setViewportSize({ width: 400, height: 640 });
await page.waitForSelector('.shell');
check('expand button returns to the main window', true);

console.log('E14 menu toggles');
await page.getByRole('button', { name: 'More' }).click();
await page.getByRole('menuitem', { name: /Timer in menu bar|Timer in tray/ }).click();
await tick(500);
const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('timebound-preview-state')).preferences);
check('menu bar timer toggled off', prefs.menuBarTimer === false, JSON.stringify(prefs));
await page.getByRole('button', { name: 'More' }).click();
await page.getByRole('menuitem', { name: 'Clear finished tasks' }).click();
await page.getByRole('button', { name: 'Clear', exact: true }).click();
check('finished tasks cleared', (await page.getByText(/Done today/).count()) === 0);
await page.getByRole('button', { name: 'More' }).click();
await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click();
await shot('light-07-shortcuts');
await page.keyboard.press('Escape');

check('no console or page errors', errors.length === 0, errors.join(' | '));

await browser.close();
await server.close();
console.log(`\n${passes} passed, ${failures} failed. Screenshots: ${OUT}`);
process.exit(failures ? 1 : 0);
