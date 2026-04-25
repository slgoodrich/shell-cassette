import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/dogfood/**', 'tests/plugin/fixtures/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // src/vitest.ts reports 0% in the table because its hooks fire in the vitest subprocess
      // spawned by tests/plugin/lifecycle.test.ts. v8 coverage doesn't follow into subprocesses.
      // The plugin is tested; the report just can't see it. Don't add fake coverage here.
      exclude: ['src/**/*.d.ts'],
      thresholds: {
        lines: 80,
        branches: 75
      }
    }
  }
})
