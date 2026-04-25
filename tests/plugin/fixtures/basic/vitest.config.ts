import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['../../../../src/vitest.ts'],
    include: ['src/**/*.test.ts'],
  },
})
