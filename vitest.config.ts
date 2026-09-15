import { defineConfig } from 'vitest/config';

// Unit tests live in tests/. `npm test` runs this twice under two time zones
// (America/New_York, Asia/Kolkata) so calendar and DST logic is exercised for real.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // Every unit test (including tests/renderer/format.test.ts) is pure logic with no
    // DOM dependency, so plain 'node' covers all of it — no jsdom dependency needed.
    environment: 'node',
    clearMocks: true,
    restoreMocks: true,
    reporters: 'default'
  }
});
