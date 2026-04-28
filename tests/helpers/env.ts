/**
 * Restore an env var to its previous value, or delete it if it was unset.
 *
 * Used in test teardown to undo `process.env.X = '...'` mutations from
 * `beforeEach` without clobbering host environment values. Pair with
 * a snapshot of the original value captured before the mutation:
 *
 *   const original = process.env.SHELL_CASSETTE_MODE
 *   beforeEach(() => { process.env.SHELL_CASSETTE_MODE = 'auto' })
 *   afterEach(() => { restoreEnv('SHELL_CASSETTE_MODE', original) })
 */
export function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
