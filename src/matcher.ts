import { log } from './log.js'
import { normalizeTmpPath } from './normalize.js'
import type { Call, Canonicalize, MatcherStateLike, Recording } from './types.js'

// cwd/env/stdin are omitted: their values vary per-machine and would break
// cross-machine replay. Users who need them must opt in via custom canonicalize.
export const defaultCanonicalize: Canonicalize = (call) => ({
  command: call.command,
  args: call.args.map(normalizeTmpPath),
})

export class MatcherState implements MatcherStateLike {
  private consumedIndices: Set<number> = new Set()
  private canonicalRecordings: ReadonlyArray<Partial<Call>>

  constructor(
    private readonly recordings: readonly Recording[],
    private readonly canonicalize: Canonicalize,
  ) {
    this.canonicalRecordings = recordings.map((r) => canonicalize(r.call))
  }

  findMatch(call: Call): Recording | null {
    const canonicalCall = this.canonicalize(call)
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
        `ambiguous match: ${candidates.length} unconsumed recordings could match \`${call.command} ${call.args.join(' ')}\` — taking first`,
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
