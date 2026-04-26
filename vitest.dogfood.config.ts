import { defineConfig } from 'vitest/config'

// Dogfood tests run separately from the regular suite because they import
// `src/vitest.ts` which registers global beforeEach/afterEach hooks. Those
// hooks try to derive a cassette path for every test in the run and would
// interfere with regular unit/integration tests that don't expect to be
// auto-cassetted.
//
// Run with `npm run test:dogfood`. CI runs both this and the regular suite.
export default defineConfig({
  test: {
    include: ['tests/dogfood/**/*.test.ts'],
  },
})
