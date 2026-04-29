import { existsSync } from 'node:fs'
import path from 'node:path'

/**
 * Absolute path to the built CLI entry point.
 */
export const CLI = path.resolve('dist/bin.js')

/**
 * True when `dist/bin.js` exists. e2e suites use this to skip cleanly when
 * the CLI hasn't been built (so a fresh `npm test` from a clean checkout
 * works without a prior `npm run build`). CI builds before test, so all
 * e2e suites run there.
 *
 * Usage:
 *   describe.skipIf(!HAS_BUILT_CLI)('cli foo e2e', () => { ... })
 */
export const HAS_BUILT_CLI = existsSync(CLI)
