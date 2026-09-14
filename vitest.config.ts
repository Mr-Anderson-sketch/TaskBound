import { defineConfig } from 'vitest/config';

// Unit tests live in tests/. `npm test` runs this twice under two time zones
// (America/New_York, Asia/Kolkata) so calendar and DST logic is exercised for real.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
    environmentMatchGlobs: [['tests/renderer/**', 'jsdom']],
    clearMocks: true,
    restoreMocks: true,
    reporters: 'default'
  }
});
