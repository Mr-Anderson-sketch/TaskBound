import { defineConfig } from '@playwright/test';

// End-to-end tests drive the BUILT Electron app (run `npm run build` first).
// workers: 1 because the app holds a single-instance lock and global shortcuts.
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  outputDir: 'e2e/.results',
  use: { trace: 'retain-on-failure' }
});
