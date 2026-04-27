import { log } from './log.js'
import { normalizeTmpPath } from './normalize.js'
import { redact } from './redact.js'
import { stripCounter } from './redact-pipeline.js'
import type { Call, Canonicalize, MatcherStateLike, Recording, RedactConfig } from './types.js'

// cwd/env/stdin are omitted: their values vary per-machine and would break
// cross-machine replay. Users who need them must opt in via custom canonicalize.
export const defaultCanonicalize: Canonicalize = (call, redactConfig) => {
  return {
    command: call.command,
    args: call.args.map((arg) => {
      // 1. v0.3: normalize mkdtemp paths
      const tmpNormalized = normalizeTmpPath(arg)
      // 2. v0.4: strip counter from any cassette-stored counter-tagged
      //    placeholders. Idempotent: counter-stripped form passes through
      //    unchanged.
      const stripped = stripCounter(tmpNormalized)
      // 3. v0.4: apply pipeline in stripped mode for fresh-call args
      //    containing raw credentials. counted: false is required because
      //    counted: true would emit `:N` suffixes driven by current-session
      //    counter state, which would differ from the stripped cassette form
      //    (where counters were stripped in step 2). Both arms must produce
      //    identical strings; stripped mode is the only mode that gives
      //    that invariant.
      return redact({ source: 'args', value: stripped }, redactConfig, { counted: false }).output
    }),
  }
}

export class MatcherState implements MatcherStateLike {
  private consumedIndices: Set<number> = new Set()
  private canonicalRecordings: ReadonlyArray<Partial<Call>>

  constructor(
    private readonly recordings: readonly Recording[],
    private readonly canonicalize: Canonicalize,
    private readonly redactConfig: Readonly<RedactConfig>,
  ) {
    this.canonicalRecordings = recordings.map((r) => canonicalize(r.call, redactConfig))
  }

  findMatch(call: Call): Recording | null {
    const canonicalCall = this.canonicalize(call, this.redactConfig)
    const candidates: { index: number; rec: Recording }[] = []
    for (let i = 0; i < this.recordings.length; i++) {
      if (this.consumedIndices.has(i)) continue
      const canonicalRec = this.canonicalRecordings[i]
      const rec = this.recordings[i]
      if (
        canonicalRec !== undefined &&
        rec !== undefined &&
        canonicalEqual(canonicalCall, canonicalRec)
      ) {
        candidates.push({ index: i, rec })
      }
    }

    const first = candidates[0]
    if (first === undefined) return null

    if (candidates.length > 1) {
      log(
        `ambiguous match: ${candidates.length} unconsumed recordings could match \`${call.command} ${call.args.join(' ')}\` (taking first)`,
      )
    }

    this.consumedIndices.add(first.index)
    return first.rec
  }
}

// Hand-rolled comparator over the known Partial<Call> field set.
// Fast (no allocation per comparison), explicit, no JSON quirks.
// "undefined" on either side is treated as "field not part of canonical form".
function canonicalEqual(a: Partial<Call>, b: Partial<Call>): boolean {
  if (a.command !== b.command) return false
  if (!arraysEqual(a.args, b.args)) return false
  if (a.cwd !== b.cwd) return false
  if (!envsEqual(a.env, b.env)) return false
  if (a.stdin !== b.stdin) return false
  return true
}

function arraysEqual(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === undefined && b === undefined) return true
  if (a === undefined || b === undefined) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function envsEqual(
  a: Record<string, string> | undefined,
  b: Record<string, string> | undefined,
): boolean {
  if (a === undefined && b === undefined) return true
  if (a === undefined || b === undefined) return false
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  if (ak.length !== bk.length) return false
  for (const k of ak) {
    if (a[k] !== b[k]) return false
  }
  return true
}
