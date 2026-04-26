import { DEFAULT_CONFIG } from '../../src/config.js'
import { MatcherState } from '../../src/matcher.js'
import type { CassetteSession } from '../../src/types.js'

// Mirror wrapper.ts lazy-load invariant: the wrapper only initializes
// session.matcher on the lazy-load path (when loadedFile is null on first
// call). Tests that pre-populate loadedFile must also pre-populate matcher,
// or ensureMatcher() throws "internal bug" on the first call. Tracked under
// issue #26 (CassetteSession type permits unreachable states).
export const makeSession = (overrides: Partial<CassetteSession> = {}): CassetteSession => {
  const base: CassetteSession = {
    name: 'test',
    path: '/tmp/test.json',
    scopeDefault: 'auto',
    loadedFile: { version: 1, recordings: [] },
    matcher: null,
    newRecordings: [],
    redactedKeys: [],
    warnings: [],
    ...overrides,
  }
  if (base.loadedFile !== null && base.matcher === null) {
    base.matcher = new MatcherState(base.loadedFile.recordings, DEFAULT_CONFIG.matcher)
  }
  return base
}
