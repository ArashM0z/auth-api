import { defineConfig } from 'vitest/config';

// Unit-only config used by Stryker mutation testing: pure-logic tests that
// need no Redis/Docker, so mutants are killed fast.
export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
  },
});
