import { DEFAULT_CONFIG } from '../../src/config.js'
import { MatcherState } from '../../src/matcher.js'
import type { CassetteSession, LoadedSession, PendingSession } from '../../src/types.js'

/**
 * Build a CassetteSession for tests.
 *
 * Branches on `loadedFile`:
 * - `loadedFile: null` (or unset) returns a PendingSession with
 *   `matcher: null` and `loadedFile: null`. Any `matcher` override passed
 *   in this branch is ignored, since PendingSession.matcher is the `null`
 *   literal type.
 * - non-null `loadedFile` returns a LoadedSession; an explicit `matcher`
 *   override is honored, otherwise one is auto-constructed from the
 *   cassette's recordings.
 *
 * The "loaded with `loadedFile: null`" runtime state (lazy-load completed
 * for a cassette that does not exist on disk yet) is reachable in
 * production but is not constructible via this helper today. If a test
 * needs that exact shape, route through the wrapper's lazy-load path or
 * extend this helper.
 */
export const makeSession = (overrides: Partial<CassetteSession> = {}): CassetteSession => {
  const canonicalize = overrides.canonicalize ?? DEFAULT_CONFIG.canonicalize

  if (overrides.loadedFile !== undefined && overrides.loadedFile !== null) {
    // Build a LoadedSession: loadedFile is present, initialize matcher if needed.
    const loadedFile = overrides.loadedFile
    const matcher =
      overrides.matcher ??
      new MatcherState(
        loadedFile.recordings,
        canonicalize,
        overrides.redactConfig ?? DEFAULT_CONFIG.redact,
      )
    const loaded: LoadedSession = {
      name: 'test',
      path: '/tmp/test.json',
      scopeDefault: 'auto',
      canonicalize,
      redactConfig: DEFAULT_CONFIG.redact,
      redactEnabled: true,
      redactCounters: new Map(),
      redactionEntries: [],
      newRecordings: [],
      warnings: [],
      ...overrides,
      loadedFile,
      matcher,
    }
    return loaded
  }

  // Build a PendingSession: matcher: null, loadedFile: null.
  const pending: PendingSession = {
    name: 'test',
    path: '/tmp/test.json',
    scopeDefault: 'auto',
    canonicalize,
    redactConfig: DEFAULT_CONFIG.redact,
    redactEnabled: true,
    redactCounters: new Map(),
    redactionEntries: [],
    newRecordings: [],
    warnings: [],
    ...overrides,
    loadedFile: null,
    matcher: null,
  }
  return pending
}
