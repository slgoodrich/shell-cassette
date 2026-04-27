import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Static `import ... from '../package.json' with { type: 'json' }` would widen
// tsconfig's rootDir past src/. readFileSync sidesteps the compiler constraint
// and pays only one synchronous disk read at module init (cached by Node's
// module loader for any second importer).
const pkg = JSON.parse(
  readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../package.json'),
    'utf8',
  ),
) as { name: string; version: string }

export const PACKAGE_NAME: string = pkg.name
export const PACKAGE_VERSION: string = pkg.version

/**
 * Identifying tuple written to `_recorded_by` on every cassette this version
 * of shell-cassette emits. Read from package.json once at module init.
 */
export const RECORDED_BY: { readonly name: string; readonly version: string } = Object.freeze({
  name: PACKAGE_NAME,
  version: PACKAGE_VERSION,
})
