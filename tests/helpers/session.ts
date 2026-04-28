import { DEFAULT_CONFIG } from '../../src/config.js'
import { MatcherState } from '../../src/matcher.js'
import type { CassetteSession, LoadedSession, PendingSession } from '../../src/types.js'

/**
 * Build a CassetteSession for tests.
 *
 * Passing `loadedFile: null` (default in overrides) without a `matcher`
 * returns a PendingSession. Passing a non-null `loadedFile` (and no
 * explicit `matcher`) auto-constructs a MatcherState so the session is a
 * valid LoadedSession. You may also pass an explicit `matcher` to override.
 *
 * The union type is CassetteSession so callers can assign to either branch
 * without an explicit cast.
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
